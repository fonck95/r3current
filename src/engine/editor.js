import {
  brick,
  removeBrick,
  pointInBrick,
} from '../game/physics.js';

const COLORS = [
  [0.9, 0.3, 0.3, 1.0],
  [0.3, 0.9, 0.3, 1.0],
  [0.3, 0.3, 0.9, 1.0],
  [0.9, 0.9, 0.3, 1.0],
  [0.9, 0.3, 0.9, 1.0],
  [0.3, 0.9, 0.9, 1.0],
  [0.9, 0.6, 0.3, 1.0],
  [0.6, 0.3, 0.9, 1.0],
  [0.9, 0.9, 0.9, 1.0],
  [0.5, 0.5, 0.5, 1.0],
];

export class LevelEditor {
  constructor(gameRuntime, options = {}) {
    this.game = gameRuntime;
    this.options = options;

    this.editMode = false;
    this.selectedShape = 'rect';
    this.selectedColor = COLORS[0];
    this.selectedRotation = 0;
    this.ghostBrick = null;
    this.dragStart = null;
    this.draggedBrick = null;
    this.hoverBrick = null;
    this.selectedBrick = null;
    this.panelVisible = false;

    this.currentLayer = 0;
    this.layerBounds = { min: -20, max: 20 };
    this.depthSlider = null;
    this.depthValueLabel = null;

    this.canvas = this.game.getCanvas();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  initialize() {
    this.setupUI();
    this.attachPointerEvents();
    window.addEventListener('keydown', this.onKeyDown);
    this.syncEditCamera();
  }

  attachPointerEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  teardown() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  setupUI() {
    const panelButton = document.getElementById('toggle-panel-btn');
    const panel = document.getElementById('editor-panel');
    panelButton?.addEventListener('click', () => {
      this.panelVisible = !this.panelVisible;
      panel?.classList.toggle('hidden', !this.panelVisible);
    });

    const palette = document.getElementById('color-palette');
    if (palette) {
      palette.innerHTML = '';
      COLORS.forEach((color, index) => {
        const btn = document.createElement('div');
        btn.className = `color-btn${index === 0 ? ' active' : ''}`;
        btn.style.background = `rgb(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255})`;
        btn.addEventListener('click', () => {
          palette.querySelectorAll('.color-btn').forEach((el) => el.classList.remove('active'));
          btn.classList.add('active');
          this.selectedColor = color;
        });
        palette.appendChild(btn);
      });
    }

    document.querySelectorAll('.shape-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shape-btn').forEach((el) => el.classList.remove('active'));
        btn.classList.add('active');
        this.selectedShape = btn.dataset.shape || 'rect';
      });
    });

    const rotationSlider = document.getElementById('rotation-slider');
    const rotationValue = document.getElementById('rotation-value');
    if (rotationSlider && rotationValue) {
      rotationSlider.value = `${this.selectedRotation}`;
      rotationValue.textContent = `${this.selectedRotation}°`;
      rotationSlider.addEventListener('input', (event) => {
        this.selectedRotation = parseFloat(event.target.value);
        rotationValue.textContent = `${this.selectedRotation}°`;
      });
    }

    document.querySelectorAll('.rotation-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const angle = parseFloat(btn.dataset.angle || '0');
        this.selectedRotation = angle;
        if (rotationSlider) {
          rotationSlider.value = angle;
        }
        if (rotationValue) {
          rotationValue.textContent = `${angle}°`;
        }
      });
    });

    this.depthSlider = document.getElementById('depth-slider');
    this.depthValueLabel = document.getElementById('depth-value');
    const applyDepthButton = document.getElementById('apply-depth');

    if (this.depthSlider) {
      this.depthSlider.min = `${this.layerBounds.min}`;
      this.depthSlider.max = `${this.layerBounds.max}`;
      this.depthSlider.value = `${this.currentLayer}`;
      this.depthSlider.addEventListener('input', (event) => {
        const next = Number.parseInt(event.target.value, 10);
        this.setActiveLayer(Number.isNaN(next) ? 0 : next, { fromSlider: true });
      });
    }

    document.querySelectorAll('.depth-step').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const direction = Number.parseInt(btn.dataset.direction || '0', 10);
        if (!direction) {
          return;
        }
        const step = event.shiftKey ? 5 : 1;
        this.shiftActiveLayer(direction * step);
      });
    });

    if (applyDepthButton) {
      applyDepthButton.addEventListener('click', () => {
        this.applyDepthToSelection();
      });
    }

    this.updateDepthUI();

    const toggleButton = document.getElementById('toggle-edit');
    toggleButton?.addEventListener('click', () => {
      this.toggleEditMode();
    });

    const clearAll = document.getElementById('clear-all');
    clearAll?.addEventListener('click', () => {
      if (!confirm('¿Eliminar todos los bricks?')) {
        return;
      }
      const world = this.game.getWorld();
      [...world.bricks].forEach((b) => removeBrick(world, b));
      this.selectedBrick = null;
      this.hoverBrick = null;
      this.draggedBrick = null;
      this.ghostBrick = null;
      this.updateDeleteButton();
      this.saveBricks();
    });

    const deleteSelected = document.getElementById('delete-selected');
    deleteSelected?.addEventListener('click', () => {
      if (!this.selectedBrick) {
        return;
      }
      removeBrick(this.game.getWorld(), this.selectedBrick);
      this.selectedBrick = null;
      this.hoverBrick = null;
      this.draggedBrick = null;
      this.updateDeleteButton();
      this.saveBricks();
    });

    this.applyEditModeClasses();
    this.updateDeleteButton();
  }

  toggleEditMode(forceValue) {
    const nextValue = typeof forceValue === 'boolean' ? forceValue : !this.editMode;
    if (this.editMode === nextValue) {
      return this.editMode;
    }
    this.editMode = nextValue;
    this.applyEditModeClasses();
    if (typeof this.game.setEditMode === 'function') {
      this.game.setEditMode(this.editMode);
    }
    if (!this.editMode) {
      this.selectedBrick = null;
      this.draggedBrick = null;
      this.dragStart = null;
      this.hoverBrick = null;
      this.ghostBrick = null;
      this.updateDeleteButton();
      const hint = document.getElementById('delete-hint');
      hint?.classList.remove('show');
    } else {
      this.syncEditCamera();
    }

    if (typeof this.options.onModeChange === 'function') {
      this.options.onModeChange(this.editMode);
    }

    return this.editMode;
  }

  applyEditModeClasses() {
    const toggleButton = document.getElementById('toggle-edit');
    if (toggleButton) {
      toggleButton.textContent = this.editMode ? '✅ Edición Activa' : '🔧 Activar Edición';
      toggleButton.classList.toggle('active', this.editMode);
    }
    this.canvas.classList.toggle('edit-mode', this.editMode);
  }

  isEditMode() {
    return this.editMode;
  }

  getSelectedRotation() {
    return this.selectedRotation;
  }

  getSelectedShape() {
    return this.selectedShape;
  }

  getActiveLayer() {
    return this.currentLayer;
  }

  setActiveLayer(value, options = {}) {
    const rounded = Math.round(Number.isFinite(value) ? value : 0);

    if (rounded < this.layerBounds.min) {
      this.layerBounds.min = rounded;
    }
    if (rounded > this.layerBounds.max) {
      this.layerBounds.max = rounded;
    }

    const changed = rounded !== this.currentLayer;
    if (changed) {
      this.currentLayer = rounded;
    }

    if (this.ghostBrick) {
      this.ghostBrick.z = this.currentLayer;
    }

    this.updateDepthUI({ fromSlider: options.fromSlider });

    if (changed || options.forceCamera || options.fromSelection) {
      this.syncEditCamera();
    }

    return this.currentLayer;
  }

  shiftActiveLayer(delta) {
    if (!delta) return this.currentLayer;
    return this.setActiveLayer(this.currentLayer + delta);
  }

  updateDepthUI({ fromSlider = false } = {}) {
    if (this.depthSlider) {
      this.depthSlider.min = `${this.layerBounds.min}`;
      this.depthSlider.max = `${this.layerBounds.max}`;
      if (!fromSlider) {
        this.depthSlider.value = `${this.currentLayer}`;
      }
    }
    if (this.depthValueLabel) {
      this.depthValueLabel.textContent = `${this.currentLayer}`;
    }
  }

  applyDepthToSelection() {
    if (!this.selectedBrick) {
      return;
    }
    if (typeof this.selectedBrick.z !== 'number') {
      this.selectedBrick.z = 0;
    }
    if (this.selectedBrick.z === this.currentLayer) {
      return;
    }
    this.selectedBrick.z = this.currentLayer;
    this.saveBricks();
  }

  syncEditCamera() {
    if (typeof this.game.setEditPlaneDepth === 'function') {
      this.game.setEditPlaneDepth(this.currentLayer);
    }
  }

  onKeyDown(event) {
    if (!this.editMode) {
      return;
    }

    const step = event.shiftKey ? 5 : 1;
    if (event.code === 'BracketLeft' || event.code === 'PageDown') {
      event.preventDefault();
      this.shiftActiveLayer(-step);
    } else if (event.code === 'BracketRight' || event.code === 'PageUp') {
      event.preventDefault();
      this.shiftActiveLayer(step);
    } else if (event.code === 'KeyF' && this.selectedBrick) {
      event.preventDefault();
      this.setActiveLayer(this.selectedBrick.z ?? 0, { fromSelection: true });
    }
  }

  onPointerDown(event) {
    if (!this.editMode) {
      return;
    }

    if (event.type !== 'pointercancel' && event.button !== 0) {
      return;
    }

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    const world = this.game.getWorld();
    const clickedBrick = this.findBrickAtPoint(pos.x, pos.y);

    if (clickedBrick) {
      if (typeof clickedBrick.z !== 'number') {
        clickedBrick.z = 0;
      }
      this.setActiveLayer(clickedBrick.z ?? 0, { fromSelection: true });
      if (event.shiftKey) {
        clickedBrick.color = [...this.selectedColor];
        this.saveBricks();
      } else if (event.ctrlKey || event.metaKey) {
        this.selectedRotation = (clickedBrick.rotation * 180) / Math.PI;
        const rotationSlider = document.getElementById('rotation-slider');
        const rotationValue = document.getElementById('rotation-value');
        if (rotationSlider) {
          rotationSlider.value = this.selectedRotation;
        }
        if (rotationValue) {
          rotationValue.textContent = `${Math.round(this.selectedRotation)}°`;
        }
      } else {
        this.selectedBrick = clickedBrick;
        this.draggedBrick = clickedBrick;
        this.dragStart = {
          x: pos.x - clickedBrick.x,
          y: pos.y - clickedBrick.y,
        };
        this.updateDeleteButton();
      }
    } else {
      this.selectedBrick = null;
      this.updateDeleteButton();

      this.dragStart = pos;
      this.ghostBrick = {
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
        shape: this.selectedShape,
        color: this.selectedColor,
        rotation: (this.selectedRotation * Math.PI) / 180,
        z: this.currentLayer,
      };
    }
  }

  onPointerMove(event) {
    if (!this.editMode) {
      return;
    }

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    this.hoverBrick = this.findBrickAtPoint(pos.x, pos.y);

    const hint = document.getElementById('delete-hint');
    if (hint) {
      if (this.hoverBrick) {
        hint.textContent = 'Click: Eliminar | Shift+Click: Color | Ctrl+Click: Copiar rotación | Rueda: Rotar | Alt/Ctrl+Rueda: Zoom';
        hint.classList.add('show');
      } else {
        hint.classList.remove('show');
      }
    }

    if (this.draggedBrick && this.dragStart) {
      this.draggedBrick.x = pos.x - this.dragStart.x;
      this.draggedBrick.y = pos.y - this.dragStart.y;
    } else if (this.dragStart && this.ghostBrick) {
      const minX = Math.min(this.dragStart.x, pos.x);
      const minY = Math.min(this.dragStart.y, pos.y);
      const w = Math.abs(pos.x - this.dragStart.x);
      const h = Math.abs(pos.y - this.dragStart.y);
      this.ghostBrick = {
        x: minX,
        y: minY,
        w,
        h,
        shape: this.selectedShape,
        color: this.selectedColor,
        rotation: (this.selectedRotation * Math.PI) / 180,
        z: this.currentLayer,
      };
    }
  }

  onPointerUp(event) {
    if (!this.editMode) {
      return;
    }

    if (event.type !== 'pointercancel' && event.button !== 0) {
      return;
    }

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    const world = this.game.getWorld();

    if (this.draggedBrick) {
      this.saveBricks();
      this.draggedBrick = null;
      this.dragStart = null;
    } else if (this.dragStart && this.ghostBrick) {
      if (this.ghostBrick.w > 10 && this.ghostBrick.h > 10) {
        brick(world, this.ghostBrick.x, this.ghostBrick.y, this.ghostBrick.w, this.ghostBrick.h, {
          shape: this.selectedShape,
          color: [...this.selectedColor],
          rotation: (this.selectedRotation * Math.PI) / 180,
          z: this.ghostBrick.z ?? this.currentLayer,
        });
        this.saveBricks();
      }

      this.dragStart = null;
      this.ghostBrick = null;
    }
  }

  onWheel(event) {
    if (!this.editMode) {
      return;
    }

    const hasRotationTarget = Boolean(this.draggedBrick || this.hoverBrick);
    const useCameraZoom = event.altKey || event.ctrlKey || !hasRotationTarget;

    if (useCameraZoom) {
      event.preventDefault();
      if (typeof this.game.adjustEditCameraDistance === 'function') {
        this.game.adjustEditCameraDistance(event.deltaY);
      }
      return;
    }

    if (!hasRotationTarget) {
      return;
    }

    event.preventDefault();
    const target = this.draggedBrick || this.hoverBrick;
    const delta = event.deltaY > 0 ? -15 : 15;
    target.rotation = (target.rotation + (delta * Math.PI) / 180) % (2 * Math.PI);
    if (target.rotation < 0) {
      target.rotation += 2 * Math.PI;
    }

    if (this.draggedBrick) {
      this.saveBricks();
    }
  }

  findBrickAtPoint(x, y) {
    const world = this.game.getWorld();
    const matches = [];

    for (let i = 0; i < world.bricks.length; i += 1) {
      const candidate = world.bricks[i];
      if (typeof candidate.z !== 'number') {
        candidate.z = 0;
      }
      if (pointInBrick(candidate, x, y)) {
        matches.push(candidate);
      }
    }

    if (!matches.length) {
      return null;
    }

    matches.sort((a, b) => {
      const depthA = Math.abs((a.z ?? 0) - this.currentLayer);
      const depthB = Math.abs((b.z ?? 0) - this.currentLayer);
      if (depthA === depthB) {
        return (b.z ?? 0) - (a.z ?? 0);
      }
      return depthA - depthB;
    });

    return matches[0];
  }

  updateDeleteButton() {
    const deleteBtn = document.getElementById('delete-selected');
    if (!deleteBtn) {
      return;
    }

    if (this.selectedBrick) {
      deleteBtn.classList.add('visible');
      deleteBtn.style.opacity = '1';
    } else {
      deleteBtn.classList.remove('visible');
      deleteBtn.style.opacity = '0';
    }
  }

  getOverlayDrawables() {
    if (!this.editMode) {
      return [];
    }

    const overlays = [];

    if (this.ghostBrick && this.ghostBrick.w > 0 && this.ghostBrick.h > 0) {
      overlays.push({
        x: this.ghostBrick.x,
        y: this.ghostBrick.y,
        w: this.ghostBrick.w,
        h: this.ghostBrick.h,
        shape: this.ghostBrick.shape,
        color: [...this.ghostBrick.color.slice(0, 3), 0.4],
        rotation: this.ghostBrick.rotation,
        depthIndex: (this.ghostBrick.z ?? this.currentLayer) - 0.25,
      });
    }

    if (this.hoverBrick && !this.draggedBrick && this.hoverBrick !== this.selectedBrick) {
      overlays.push({
        x: this.hoverBrick.x - 2,
        y: this.hoverBrick.y - 2,
        w: this.hoverBrick.w + 4,
        h: this.hoverBrick.h + 4,
        shape: 'rect',
        color: [1, 1, 1, 0.3],
        rotation: this.hoverBrick.rotation,
        depthIndex: (this.hoverBrick.z ?? this.currentLayer) - 0.5,
      });
    }

    if (this.selectedBrick) {
      overlays.push({
        x: this.selectedBrick.x - 4,
        y: this.selectedBrick.y - 4,
        w: this.selectedBrick.w + 8,
        h: this.selectedBrick.h + 8,
        shape: 'rect',
        color: [0.3, 0.8, 1.0, 0.6],
        rotation: 0,
        depthIndex: (this.selectedBrick.z ?? this.currentLayer) - 0.75,
      });
    }

    return overlays;
  }

  saveBricks() {
    this.game.saveBricks();
  }
}
