import { brick, removeBrick, pointInBrick } from '../../physics/index.js';

const DEFAULT_COLORS = [
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

const MIN_BRICK_SIZE = 10;
const HOVER_PADDING = 2;
const SELECTION_PADDING = 4;

export class LevelEditor {
  constructor(gameRuntime, options = {}) {
    this.game = gameRuntime;
    this.options = options;
    this.palette = options.palette ?? DEFAULT_COLORS;
    this.minBrickSize = options.minBrickSize ?? MIN_BRICK_SIZE;
    this.onModeChange = options.onModeChange;

    this.editMode = false;
    this.panelVisible = false;
    this.selectedShape = 'rect';
    this.selectedColor = [...(this.palette[0] ?? DEFAULT_COLORS[0])];
    this.selectedRotation = 0;

    this.ghostBrick = null;
    this.dragStart = null;
    this.draggedBrick = null;
    this.hoverBrick = null;
    this.selectedBrick = null;

    this.currentLayer = 0;
    this.layerBounds = { min: -20, max: 20 };

    this.canvas = this.game.getCanvas();
    this.ui = {
      panelButton: null,
      panel: null,
      rotationSlider: null,
      rotationValue: null,
      depthSlider: null,
      depthValue: null,
      toggleButton: null,
      deleteButton: null,
      hint: null,
      paletteContainer: null,
    };

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  initialize() {
    this.buildUi();
    this.attachPointerEvents();
    window.addEventListener('keydown', this.onKeyDown);
    this.syncEditCamera();
    return this;
  }

  teardown() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  buildUi() {
    this.ui.panelButton = document.getElementById('toggle-panel-btn');
    this.ui.panel = document.getElementById('editor-panel');
    this.ui.toggleButton = document.getElementById('toggle-edit');
    this.ui.deleteButton = document.getElementById('delete-selected');
    this.ui.hint = document.getElementById('delete-hint');

    if (this.ui.panel) {
      this.panelVisible = !this.ui.panel.classList.contains('hidden');
    }

    this.setupPanelToggle();
    this.setupColorPalette();
    this.setupShapeButtons();
    this.setupRotationControls();
    this.setupDepthControls();
    this.setupActionButtons();

    this.updateDepthUI();
    this.applyEditModeClasses();
    this.updateDeleteButton();
  }

  setupPanelToggle() {
    if (!this.ui.panelButton || !this.ui.panel) {
      return;
    }

    this.ui.panelButton.addEventListener('click', () => {
      this.togglePanelVisibility();
    });
  }

  togglePanelVisibility(forceValue) {
    const isCurrentlyVisible = !this.ui.panel?.classList.contains('hidden');
    const next = typeof forceValue === 'boolean' ? forceValue : !isCurrentlyVisible;
    this.panelVisible = next;
    this.ui.panel?.classList.toggle('hidden', !next);
  }

  setupColorPalette() {
    const palette = document.getElementById('color-palette');
    if (!palette) {
      return;
    }

    this.ui.paletteContainer = palette;
    palette.innerHTML = '';

    this.palette.forEach((color, index) => {
      const button = document.createElement('div');
      button.className = `color-btn${index === 0 ? ' active' : ''}`;
      button.style.background = `rgb(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255})`;
      button.addEventListener('click', () => {
        this.setSelectedColor(color);
        palette.querySelectorAll('.color-btn').forEach((el) => el.classList.remove('active'));
        button.classList.add('active');
      });
      palette.appendChild(button);
    });
  }

  setupShapeButtons() {
    document.querySelectorAll('.shape-btn').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.shape-btn').forEach((el) => el.classList.remove('active'));
        button.classList.add('active');
        this.selectedShape = button.dataset.shape || 'rect';
      });
    });
  }

  setupRotationControls() {
    this.ui.rotationSlider = document.getElementById('rotation-slider');
    this.ui.rotationValue = document.getElementById('rotation-value');

    if (this.ui.rotationSlider && this.ui.rotationValue) {
      this.ui.rotationSlider.value = `${this.selectedRotation}`;
      this.ui.rotationValue.textContent = `${this.selectedRotation}°`;
      this.ui.rotationSlider.addEventListener('input', (event) => {
        const value = Number.parseFloat(event.target.value);
        this.setSelectedRotation(Number.isFinite(value) ? value : 0);
      });
    }

    document.querySelectorAll('.rotation-preset').forEach((button) => {
      button.addEventListener('click', () => {
        const angle = Number.parseFloat(button.dataset.angle || '0');
        this.setSelectedRotation(Number.isFinite(angle) ? angle : 0);
      });
    });
  }

  setupDepthControls() {
    this.ui.depthSlider = document.getElementById('depth-slider');
    this.ui.depthValue = document.getElementById('depth-value');
    const applyDepthButton = document.getElementById('apply-depth');

    if (this.ui.depthSlider) {
      this.ui.depthSlider.min = `${this.layerBounds.min}`;
      this.ui.depthSlider.max = `${this.layerBounds.max}`;
      this.ui.depthSlider.value = `${this.currentLayer}`;
      this.ui.depthSlider.addEventListener('input', (event) => {
        const next = Number.parseInt(event.target.value, 10);
        this.setActiveLayer(Number.isNaN(next) ? 0 : next, { fromSlider: true });
      });
    }

    document.querySelectorAll('.depth-step').forEach((button) => {
      button.addEventListener('click', (event) => {
        const direction = Number.parseInt(button.dataset.direction || '0', 10);
        if (!direction) {
          return;
        }
        const step = event.shiftKey ? 5 : 1;
        this.shiftActiveLayer(direction * step);
      });
    });

    applyDepthButton?.addEventListener('click', () => this.applyDepthToSelection());
  }

  setupActionButtons() {
    this.ui.toggleButton?.addEventListener('click', () => this.toggleEditMode());

    const clearAll = document.getElementById('clear-all');
    clearAll?.addEventListener('click', () => {
      if (!confirm('¿Eliminar todos los bricks?')) {
        return;
      }
      const world = this.game.getWorld();
      [...world.bricks].forEach((item) => removeBrick(world, item));
      this.resetSelectionState();
      this.updateDeleteButton();
      this.saveBricks();
    });

    this.ui.deleteButton?.addEventListener('click', () => {
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
  }

  attachPointerEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  setSelectedColor(color) {
    this.selectedColor = [...color];
    if (this.hoverBrick && this.options.applyHoverColor) {
      this.hoverBrick.color = [...color];
    }
  }

  setSelectedRotation(value) {
    this.selectedRotation = value;
    if (this.ui.rotationSlider) {
      this.ui.rotationSlider.value = `${value}`;
    }
    if (this.ui.rotationValue) {
      this.ui.rotationValue.textContent = `${Math.round(value)}°`;
    }
  }

  toggleEditMode(forceValue) {
    const next = typeof forceValue === 'boolean' ? forceValue : !this.editMode;
    if (next === this.editMode) {
      return this.editMode;
    }
    this.editMode = next;
    this.applyEditModeClasses();
    this.game.setEditMode?.(this.editMode);

    if (!this.editMode) {
      this.resetSelectionState();
      this.updateDeleteButton();
      this.ui.hint?.classList.remove('show');
    } else {
      this.syncEditCamera();
    }

    if (typeof this.onModeChange === 'function') {
      this.onModeChange(this.editMode);
    }

    return this.editMode;
  }

  applyEditModeClasses() {
    if (this.ui.toggleButton) {
      this.ui.toggleButton.textContent = this.editMode ? '✅ Edición Activa' : '🔧 Activar Edición';
      this.ui.toggleButton.classList.toggle('active', this.editMode);
    }
    this.canvas.classList.toggle('edit-mode', this.editMode);
  }

  isEditMode() {
    return this.editMode;
  }

  resetSelectionState() {
    this.selectedBrick = null;
    this.hoverBrick = null;
    this.draggedBrick = null;
    this.ghostBrick = null;
    this.dragStart = null;
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
    if (this.ui.depthSlider) {
      this.ui.depthSlider.min = `${this.layerBounds.min}`;
      this.ui.depthSlider.max = `${this.layerBounds.max}`;
      if (!fromSlider) {
        this.ui.depthSlider.value = `${this.currentLayer}`;
      }
    }
    if (this.ui.depthValue) {
      this.ui.depthValue.textContent = `${this.currentLayer}`;
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
    this.game.setEditPlaneDepth?.(this.currentLayer);
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
    if (!this.editMode || (event.type !== 'pointercancel' && event.button !== 0)) {
      return;
    }

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    const clickedBrick = this.findBrickAtPoint(pos.x, pos.y);

    if (clickedBrick) {
      this.handleExistingBrickInteraction(event, clickedBrick, pos);
      return;
    }

    this.selectedBrick = null;
    this.updateDeleteButton();

    this.dragStart = pos;
    this.ghostBrick = {
      x: pos.x,
      y: pos.y,
      w: 0,
      h: 0,
      shape: this.selectedShape,
      color: [...this.selectedColor],
      rotation: (this.selectedRotation * Math.PI) / 180,
      z: this.currentLayer,
    };
  }

  handleExistingBrickInteraction(event, brickCandidate, pointerWorldPos) {
    if (typeof brickCandidate.z !== 'number') {
      brickCandidate.z = 0;
    }

    this.setActiveLayer(brickCandidate.z ?? 0, { fromSelection: true });

    if (event.shiftKey) {
      brickCandidate.color = [...this.selectedColor];
      this.saveBricks();
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      this.setSelectedRotation((brickCandidate.rotation * 180) / Math.PI);
      return;
    }

    this.selectedBrick = brickCandidate;
    this.draggedBrick = brickCandidate;
    this.dragStart = {
      x: pointerWorldPos.x - brickCandidate.x,
      y: pointerWorldPos.y - brickCandidate.y,
    };
    this.updateDeleteButton();
  }

  onPointerMove(event) {
    if (!this.editMode) {
      return;
    }

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    this.hoverBrick = this.findBrickAtPoint(pos.x, pos.y);
    this.updateHoverHint();

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
        color: [...this.selectedColor],
        rotation: (this.selectedRotation * Math.PI) / 180,
        z: this.currentLayer,
      };
    }
  }

  updateHoverHint() {
    if (!this.ui.hint) {
      return;
    }
    if (this.hoverBrick) {
      this.ui.hint.textContent =
        'Click: Eliminar | Shift+Click: Color | Ctrl+Click: Copiar rotación | Rueda: Rotar | Alt/Ctrl+Rueda: Zoom';
      this.ui.hint.classList.add('show');
    } else {
      this.ui.hint.classList.remove('show');
    }
  }

  onPointerUp(event) {
    if (!this.editMode || (event.type !== 'pointercancel' && event.button !== 0)) {
      return;
    }

    if (this.draggedBrick) {
      this.saveBricks();
      this.draggedBrick = null;
      this.dragStart = null;
      return;
    }

    if (!this.dragStart || !this.ghostBrick) {
      return;
    }

    if (this.ghostBrick.w > this.minBrickSize && this.ghostBrick.h > this.minBrickSize) {
      brick(this.game.getWorld(), this.ghostBrick.x, this.ghostBrick.y, this.ghostBrick.w, this.ghostBrick.h, {
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

  onWheel(event) {
    if (!this.editMode) {
      return;
    }

    const hasRotationTarget = Boolean(this.draggedBrick || this.hoverBrick);
    const useCameraZoom = event.altKey || event.ctrlKey || !hasRotationTarget;

    if (useCameraZoom) {
      event.preventDefault();
      this.game.adjustEditCameraDistance?.(event.deltaY);
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

    this.saveBricks();
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
    if (!this.ui.deleteButton) {
      return;
    }

    if (this.selectedBrick) {
      this.ui.deleteButton.classList.add('visible');
      this.ui.deleteButton.style.opacity = '1';
    } else {
      this.ui.deleteButton.classList.remove('visible');
      this.ui.deleteButton.style.opacity = '0';
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
        x: this.hoverBrick.x - HOVER_PADDING,
        y: this.hoverBrick.y - HOVER_PADDING,
        w: this.hoverBrick.w + HOVER_PADDING * 2,
        h: this.hoverBrick.h + HOVER_PADDING * 2,
        shape: 'rect',
        color: [1, 1, 1, 0.3],
        rotation: this.hoverBrick.rotation,
        depthIndex: (this.hoverBrick.z ?? this.currentLayer) - 0.5,
      });
    }

    if (this.selectedBrick) {
      overlays.push({
        x: this.selectedBrick.x - SELECTION_PADDING,
        y: this.selectedBrick.y - SELECTION_PADDING,
        w: this.selectedBrick.w + SELECTION_PADDING * 2,
        h: this.selectedBrick.h + SELECTION_PADDING * 2,
        shape: 'rect',
        color: [0.3, 0.8, 1.0, 0.6],
        rotation: 0,
        depthIndex: (this.selectedBrick.z ?? this.currentLayer) - 0.75,
      });
    }

    return overlays;
  }

  saveBricks() {
    this.game.saveBricks?.();
  }
}
