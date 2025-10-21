const BABYLON = window.BABYLON;

if (!BABYLON) {
  throw new Error('Babylon.js no se ha cargado. Inclúyelo antes de inicializar el editor.');
}

const HIGHLIGHT_COLOR = BABYLON.Color3.FromHexString('#ffd166');
const GIZMO_SNAP = 0.5;
const DEFAULT_DEPTH = 4;

export class LevelEditor {
  constructor(game, options = {}) {
    this.game = game;
    this.scene = game.getScene();
    this.onModeChange = options.onModeChange ?? (() => {});

    this.editMode = false;
    this.selectedBrick = null;

    this.ui = {
      toggle: document.getElementById('toggle-edit'),
      add: document.getElementById('add-brick'),
      remove: document.getElementById('delete-brick'),
      toolbar: document.getElementById('toolbar'),
      help: document.getElementById('help'),
      width: document.getElementById('brush-width'),
      height: document.getElementById('brush-height'),
      color: document.getElementById('brush-color'),
    };

    this.brush = {
      width: parseFloat(this.ui.width?.value ?? '8') || 8,
      height: parseFloat(this.ui.height?.value ?? '2') || 2,
      depth: DEFAULT_DEPTH,
      color: this.ui.color?.value ?? '#ff9d5c',
    };

    this.pointerObserver = null;
    this.gizmoManager = null;
  }

  initialize() {
    this._ensureUIElements();
    this._wireUI();
    this._buildGizmoManager();
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => this._handlePointer(pointerInfo));
    this._syncAttachableMeshes();
    this._updateButtons();
  }

  isEditMode() {
    return this.editMode;
  }

  handleKeyDown(event) {
    if (!this.editMode) {
      return false;
    }

    if ((event.code === 'Delete' || event.code === 'Backspace') && this.selectedBrick) {
      this.deleteSelected();
      event.preventDefault();
      return true;
    }

    if (event.code === 'Escape') {
      this.clearSelection();
      return true;
    }

    return false;
  }

  handleKeyUp() {
    return false;
  }

  toggle() {
    this._toggle();
  }

  _toggle() {
    const next = !this.editMode;
    this.editMode = next;
    this.game.setEditMode(next);
    this.onModeChange(next);

    if (next) {
      this.ui.toolbar?.classList.add('editing');
      this.ui.help?.classList.add('visible');
      this._syncAttachableMeshes();
    } else {
      this.ui.toolbar?.classList.remove('editing');
      this.ui.help?.classList.remove('visible');
      this.gizmoManager.attachToMesh(null);
      this.game.persistBricks();
      this.clearSelection();
    }

    this.ui.toggle.textContent = next ? '🎮 Volver al Juego' : '🔧 Ver Editor 3D';
    this._updateButtons();
    this.game.updateHud();
  }

  clearSelection() {
    if (this.selectedBrick) {
      this.game.getHighlightLayer().removeMesh(this.selectedBrick.mesh);
    }
    this.selectedBrick = null;
    if (this.gizmoManager) {
      this.gizmoManager.attachToMesh(null);
    }
    this._updateButtons();
  }

  selectBrick(brick) {
    if (!brick) {
      this.clearSelection();
      return;
    }

    if (this.selectedBrick && this.selectedBrick.id === brick.id) {
      return;
    }

    if (this.selectedBrick) {
      this.game.getHighlightLayer().removeMesh(this.selectedBrick.mesh);
    }

    this.selectedBrick = brick;
    this.game.getHighlightLayer().addMesh(brick.mesh, HIGHLIGHT_COLOR);

    if (this.gizmoManager) {
      this.gizmoManager.attachToMesh(brick.mesh);
    }

    this._syncSlidersWithSelection();
    this._updateButtons();
  }

  deleteSelected() {
    if (!this.selectedBrick) {
      return;
    }
    const id = this.selectedBrick.id;
    this.game.removeBrick(id);
    this.clearSelection();
    this._syncAttachableMeshes();
  }

  _createBrickAt(point) {
    if (!point) {
      return;
    }
    const snapped = new BABYLON.Vector3(
      this._snap(point.x),
      this._snap(point.y),
      0,
    );

    const brick = this.game.createBrick({
      size: { x: this.brush.width, y: this.brush.height, z: this.brush.depth },
      position: { x: snapped.x, y: snapped.y, z: snapped.z },
      color: this.brush.color,
    });
    this.game.persistBricks();
    this._syncAttachableMeshes();
    this.selectBrick(brick);
    this.game.updateHud();
  }

  _createBrickFromButton() {
    if (!this.editMode) {
      return;
    }
    const camera = this.game.getEditorCamera();
    const target = camera ? camera.target : new BABYLON.Vector3(0, 0, 0);
    const point = new BABYLON.Vector3(target.x, target.y, 0);
    this._createBrickAt(point);
  }

  _handlePointer(pointerInfo) {
    if (!this.editMode) {
      return;
    }

    if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) {
      return;
    }

    const event = pointerInfo.event;
    if (!event || event.button !== 0) {
      return;
    }

    const pick = pointerInfo.pickInfo;
    if (!pick || !pick.hit || !pick.pickedMesh) {
      this.clearSelection();
      return;
    }

    const mesh = pick.pickedMesh;
    const metadata = mesh.metadata || {};

    if (event.shiftKey && metadata.type === 'brick') {
      const brick = this.game.getBrickById(metadata.id);
      if (brick) {
        this.game.removeBrick(brick.id);
        if (this.selectedBrick && this.selectedBrick.id === brick.id) {
          this.clearSelection();
        }
        this._syncAttachableMeshes();
      }
      return;
    }

    if (metadata.type === 'brick') {
      const brick = this.game.getBrickById(metadata.id);
      if (brick) {
        this.selectBrick(brick);
      }
      return;
    }

    if (mesh === this.game.getInteractionPlane()) {
      this._createBrickAt(pick.pickedPoint);
    } else {
      this.clearSelection();
    }
  }

  _ensureUIElements() {
    if (!this.ui.toggle) {
      throw new Error('No se encontró el botón de alternar edición.');
    }
  }

  _wireUI() {
    this.ui.toggle.addEventListener('click', () => this._toggle());

    if (this.ui.add) {
      this.ui.add.addEventListener('click', () => this._createBrickFromButton());
    }

    if (this.ui.remove) {
      this.ui.remove.addEventListener('click', () => this.deleteSelected());
    }

    if (this.ui.width) {
      this.ui.width.addEventListener('input', () => {
        this.brush.width = parseFloat(this.ui.width.value) || this.brush.width;
        if (this.selectedBrick) {
          this.game.setBrickSize(this.selectedBrick.id, {
            x: this.brush.width,
            y: this.brush.height,
            z: this.brush.depth,
          });
          this.game.updateHud();
        }
      });
    }

    if (this.ui.height) {
      this.ui.height.addEventListener('input', () => {
        this.brush.height = parseFloat(this.ui.height.value) || this.brush.height;
        if (this.selectedBrick) {
          this.game.setBrickSize(this.selectedBrick.id, {
            x: this.brush.width,
            y: this.brush.height,
            z: this.brush.depth,
          });
          this.game.updateHud();
        }
      });
    }

    if (this.ui.color) {
      this.ui.color.addEventListener('input', () => {
        this.brush.color = this.ui.color.value || this.brush.color;
        if (this.selectedBrick) {
          this.game.setBrickColor(this.selectedBrick.id, this.brush.color);
          this.game.updateHud();
        }
      });
    }
  }

  _buildGizmoManager() {
    this.gizmoManager = new BABYLON.GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.attachToMesh(null);

    const positionGizmo = this.gizmoManager.gizmos.positionGizmo;
    if (positionGizmo) {
      positionGizmo.snapDistance = GIZMO_SNAP;
      positionGizmo.zGizmo.isEnabled = false;
      positionGizmo.onDragEndObservable.add(() => {
        if (this.selectedBrick) {
          this.selectedBrick.mesh.position.z = 0;
          this.game.persistBricks();
          this.game.updateHud();
        }
      });
    }
  }

  _syncAttachableMeshes() {
    if (!this.gizmoManager) {
      return;
    }
    this.gizmoManager.attachableMeshes = this.game.getBricks().map((brick) => brick.mesh);
  }

  _syncSlidersWithSelection() {
    if (!this.selectedBrick) {
      return;
    }
    this._setSliderValue(this.ui.width, this.selectedBrick.size.x);
    this._setSliderValue(this.ui.height, this.selectedBrick.size.y);
    this.brush.width = this.selectedBrick.size.x;
    this.brush.height = this.selectedBrick.size.y;
    if (this.ui.color) {
      this.ui.color.value = this.selectedBrick.color;
      this.brush.color = this.selectedBrick.color;
    }
  }

  _updateButtons() {
    if (this.ui.add) {
      this.ui.add.disabled = !this.editMode;
    }
    if (this.ui.remove) {
      this.ui.remove.disabled = !this.editMode || !this.selectedBrick;
    }
  }

  _snap(value) {
    return Math.round(value / GIZMO_SNAP) * GIZMO_SNAP;
  }

  _setSliderValue(slider, value) {
    if (!slider) {
      return;
    }
    const min = slider.min !== '' ? parseFloat(slider.min) : -Infinity;
    const max = slider.max !== '' ? parseFloat(slider.max) : Infinity;
    const clamped = Math.min(Math.max(value, min), max);
    slider.value = String(Number.isFinite(clamped) ? clamped : value);
  }
}
