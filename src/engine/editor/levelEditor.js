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
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function normalizeColor(color) {
  if (!Array.isArray(color)) {
    return [0.8, 0.4, 0.2, 1.0];
  }
  const r = Number.isFinite(color[0]) ? color[0] : 0.8;
  const g = Number.isFinite(color[1]) ? color[1] : 0.4;
  const b = Number.isFinite(color[2]) ? color[2] : 0.2;
  const a = Number.isFinite(color[3]) ? color[3] : 1.0;
  return [r, g, b, a];
}

function makeColorKey(color) {
  if (!Array.isArray(color)) {
    return '';
  }
  return color
    .slice(0, 4)
    .map((component, index) => {
      const value = Number.isFinite(component) ? component : index === 3 ? 1 : 0;
      return value.toFixed(3);
    })
    .join('_');
}

export class LevelEditor {
  constructor(gameRuntime, options = {}) {
    this.game = gameRuntime;
    this.options = options;
    const paletteSource = Array.isArray(options.palette) && options.palette.length
      ? options.palette
      : DEFAULT_COLORS;
    this.palette = paletteSource.map((color) => normalizeColor(color));
    this.minBrickSize = options.minBrickSize ?? MIN_BRICK_SIZE;
    this.onModeChange = options.onModeChange;

    this.editMode = false;
    this.panelVisible = false;
    this.selectedShape = 'rect';
    const initialColor = this.palette[0] ?? normalizeColor(DEFAULT_COLORS[0]);
    this.selectedColor = [...initialColor];
    this.selectedRotation = 0;

    this.ghostBrick = null;
    this.dragStart = null;
    this.draggedBrick = null;
    this.hoverBrick = null;
    this.selectedBrick = null;
    this.cameraDrag = null;

    this.currentLayer = 0;
    this.layerBounds = { min: -20, max: 20 };
    this.selectedViewMode = 'iso';

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
      viewButtons: [],
      shapeButtons: [],
      paletteButtons: [],
    };

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.boundPreventContextMenu = (event) => event.preventDefault();
    this.saveRequestId = null;
  }

  initialize() {
    this.buildUi();
    this.attachPointerEvents();
    window.addEventListener('keydown', this.onKeyDown);
    this.setViewMode(this.selectedViewMode, { applyToRuntime: true });
    this.syncEditCamera();
    return this;
  }

  teardown() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.boundPreventContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.saveRequestId !== null) {
      cancelAnimationFrame(this.saveRequestId);
      this.saveRequestId = null;
    }
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
    this.setupViewControls();
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

  setupViewControls() {
    const grid = document.getElementById('view-mode-grid');
    if (!grid) {
      return;
    }

    this.ui.viewButtons = Array.from(grid.querySelectorAll('.view-btn'));
    this.ui.viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.view || 'iso';
        this.setViewMode(mode, { applyToRuntime: true });
      });
    });

    this.updateViewButtons(this.selectedViewMode);
  }

  togglePanelVisibility(forceValue) {
    const isCurrentlyVisible = !this.ui.panel?.classList.contains('hidden');
    const next = typeof forceValue === 'boolean' ? forceValue : !isCurrentlyVisible;
    this.panelVisible = next;
    this.ui.panel?.classList.toggle('hidden', !next);
  }

  setViewMode(mode, { applyToRuntime = false, updateButtons = true } = {}) {
    if (typeof mode !== 'string' || !mode) {
      return;
    }

    this.selectedViewMode = mode;
    if (applyToRuntime) {
      this.game.setEditViewMode?.(mode);
    }
    if (updateButtons) {
      this.updateViewButtons(mode);
    }
  }

  updateViewButtons(activeMode) {
    if (!Array.isArray(this.ui.viewButtons)) {
      return;
    }

    this.ui.viewButtons.forEach((button) => {
      const mode = button.dataset.view || '';
      button.classList.toggle('active', activeMode && mode === activeMode);
    });
  }

  markCustomView() {
    this.selectedViewMode = 'custom';
    this.updateViewButtons(null);
  }

  setupColorPalette() {
    const palette = document.getElementById('color-palette');
    if (!palette) {
      return;
    }

    this.ui.paletteContainer = palette;
    palette.innerHTML = '';
    this.ui.paletteButtons = [];

    this.palette.forEach((color) => {
      const button = document.createElement('div');
      const normalized = normalizeColor(color);
      button.className = 'color-btn';
      button.dataset.colorKey = makeColorKey(normalized);
      button.style.background = `rgb(${normalized[0] * 255}, ${normalized[1] * 255}, ${normalized[2] * 255})`;
      button.addEventListener('click', () => {
        this.setSelectedColor(normalized);
      });
      palette.appendChild(button);
      this.ui.paletteButtons.push(button);
    });

    this.updatePaletteSelection(this.selectedColor);
  }

  setupShapeButtons() {
    this.ui.shapeButtons = Array.from(document.querySelectorAll('.shape-btn'));
    this.ui.shapeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const shape = button.dataset.shape || 'rect';
        this.setSelectedShape(shape);
      });
    });
    this.updateShapeButtons(this.selectedShape);
  }

  setupRotationControls() {
    this.ui.rotationSlider = document.getElementById('rotation-slider');
    this.ui.rotationValue = document.getElementById('rotation-value');

    if (this.ui.rotationSlider && this.ui.rotationValue) {
      this.ui.rotationSlider.value = `${this.selectedRotation}`;
      this.ui.rotationValue.textContent = `${Math.round(this.selectedRotation)}°`;
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
    this.canvas.addEventListener('contextmenu', this.boundPreventContextMenu);
  }

  setSelectedColor(color, { fromSelection = false } = {}) {
    const normalized = normalizeColor(color);
    this.selectedColor = [...normalized];
    this.updatePaletteSelection(normalized);

    if (this.ghostBrick) {
      this.ghostBrick.color = [...normalized];
    }
    if (this.hoverBrick && this.options.applyHoverColor) {
      this.hoverBrick.color = [...normalized];
    }
    if (!fromSelection && this.selectedBrick) {
      this.selectedBrick.color = [...normalized];
      this.scheduleSave();
    }

    return this.selectedColor;
  }

  updatePaletteSelection(color) {
    if (!Array.isArray(this.ui.paletteButtons)) {
      return;
    }
    const targetKey = makeColorKey(color);
    this.ui.paletteButtons.forEach((button) => {
      const isActive = button.dataset.colorKey === targetKey;
      button.classList.toggle('active', isActive);
    });
  }

  setSelectedShape(shape, { fromSelection = false } = {}) {
    const nextShape = typeof shape === 'string' && shape ? shape : 'rect';
    this.selectedShape = nextShape;
    this.updateShapeButtons(nextShape);

    if (this.ghostBrick) {
      this.ghostBrick.shape = nextShape;
    }

    if (!fromSelection && this.selectedBrick) {
      this.selectedBrick.shape = nextShape;
      this.scheduleSave();
    }

    return this.selectedShape;
  }

  updateShapeButtons(activeShape) {
    if (!Array.isArray(this.ui.shapeButtons)) {
      return;
    }

    this.ui.shapeButtons.forEach((button) => {
      const buttonShape = button.dataset.shape || 'rect';
      button.classList.toggle('active', Boolean(activeShape) && buttonShape === activeShape);
    });
  }

  setSelectedRotation(value, { fromSelection = false } = {}) {
    const normalized = Number.isFinite(value) ? value : 0;
    this.selectedRotation = normalized;
    if (this.ui.rotationSlider && this.ui.rotationSlider.value !== `${normalized}`) {
      this.ui.rotationSlider.value = `${normalized}`;
    }
    if (this.ui.rotationValue) {
      this.ui.rotationValue.textContent = `${Math.round(normalized)}°`;
    }

    if (this.ghostBrick) {
      this.ghostBrick.rotation = normalized * DEG2RAD;
    }

    if (!fromSelection && this.selectedBrick) {
      this.selectedBrick.rotation = normalized * DEG2RAD;
      this.scheduleSave();
    }

    return this.selectedRotation;
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
      this.setViewMode(this.selectedViewMode, { applyToRuntime: true, updateButtons: false });
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
    this.updateHoverHint();
  }

  applySelectionFromBrick(brickCandidate, pointerWorldPos = null) {
    if (!brickCandidate) {
      this.selectedBrick = null;
      this.draggedBrick = null;
      this.dragStart = null;
      this.updateDeleteButton();
      this.updateHoverHint();
      return;
    }

    this.selectedBrick = brickCandidate;
    this.hoverBrick = brickCandidate;
    this.draggedBrick = null;
    this.dragStart = null;

    if (pointerWorldPos) {
      this.draggedBrick = brickCandidate;
      this.dragStart = {
        x: pointerWorldPos.x - brickCandidate.x,
        y: pointerWorldPos.y - brickCandidate.y,
      };
    }

    const rotationDegrees = Number.isFinite(brickCandidate.rotation)
      ? brickCandidate.rotation * RAD2DEG
      : 0;
    this.setSelectedShape(brickCandidate.shape || 'rect', { fromSelection: true });
    this.setSelectedRotation(rotationDegrees, { fromSelection: true });
    this.setSelectedColor(brickCandidate.color, { fromSelection: true });

    this.updateDeleteButton();
    this.updateHoverHint();
  }

  scheduleSave() {
    if (this.saveRequestId !== null) {
      return;
    }

    this.saveRequestId = requestAnimationFrame(() => {
      this.saveRequestId = null;
      this.saveBricks();
    });
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
    if (!this.editMode) {
      return;
    }

    const isCameraPan = event.button === 1 || (event.button === 0 && event.altKey);
    const isCameraOrbit = event.button === 2;

    if (isCameraPan || isCameraOrbit) {
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      const pos = this.game.screenToWorld(event.clientX, event.clientY);
      this.cameraDrag = {
        pointerId: event.pointerId,
        type: isCameraOrbit ? 'orbit' : 'pan',
        lastX: event.clientX,
        lastY: event.clientY,
        lastWorld: pos,
      };
      this.markCustomView();
      this.hoverBrick = null;
      this.updateHoverHint();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    if (!pos) {
      if (typeof this.canvas.releasePointerCapture === 'function') {
        const hasCapture =
          typeof this.canvas.hasPointerCapture === 'function'
            ? this.canvas.hasPointerCapture(event.pointerId)
            : true;
        if (hasCapture) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
      }
      return;
    }

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
      this.scheduleSave();
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const degrees = Number.isFinite(brickCandidate.rotation)
        ? brickCandidate.rotation * RAD2DEG
        : 0;
      this.setSelectedRotation(degrees, { fromSelection: true });
      return;
    }

    this.applySelectionFromBrick(brickCandidate, pointerWorldPos);
  }

  onPointerMove(event) {
    if (!this.editMode) {
      return;
    }

    if (this.cameraDrag && event.pointerId === this.cameraDrag.pointerId) {
      if (this.cameraDrag.type === 'orbit') {
        const deltaX = event.clientX - this.cameraDrag.lastX;
        const deltaY = event.clientY - this.cameraDrag.lastY;
        if (deltaX || deltaY) {
          this.game.orbitEditCamera?.(deltaX, deltaY);
          this.cameraDrag.lastX = event.clientX;
          this.cameraDrag.lastY = event.clientY;
        }
      } else if (this.cameraDrag.type === 'pan') {
        const pos = this.game.screenToWorld(event.clientX, event.clientY);
        if (pos && this.cameraDrag.lastWorld) {
          const deltaX = this.cameraDrag.lastWorld.x - pos.x;
          const deltaY = this.cameraDrag.lastWorld.y - pos.y;
          if (Math.abs(deltaX) > 1e-4 || Math.abs(deltaY) > 1e-4) {
            this.game.panEditCamera?.(deltaX, deltaY);
            const updated = this.game.screenToWorld(event.clientX, event.clientY);
            if (updated) {
              this.cameraDrag.lastWorld = updated;
            }
          }
        } else {
          this.cameraDrag.lastWorld = pos;
        }
      }
      event.preventDefault();
      return;
    }

    const pos = this.game.screenToWorld(event.clientX, event.clientY);
    if (!pos) {
      this.hoverBrick = null;
      this.updateHoverHint();
      return;
    }

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
        'Click: Seleccionar/Arrastrar | Shift+Click: Recolorear | Ctrl+Click: Copiar rotación | Rueda: Rotar | Alt/Ctrl+Rueda: Zoom';
      this.ui.hint.classList.add('show');
    } else {
      this.ui.hint.classList.remove('show');
    }
  }

  onPointerUp(event) {
    if (!this.editMode) {
      return;
    }

    if (this.cameraDrag && event.pointerId === this.cameraDrag.pointerId) {
      if (typeof this.canvas.releasePointerCapture === 'function') {
        const hasCapture =
          typeof this.canvas.hasPointerCapture === 'function'
            ? this.canvas.hasPointerCapture(event.pointerId)
            : true;
        if (hasCapture) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
      }
      this.cameraDrag = null;
      return;
    }

    const isCancel = event.type === 'pointercancel';
    if (!isCancel && event.button !== 0) {
      return;
    }

    if (typeof this.canvas.releasePointerCapture === 'function') {
      const hasCapture =
        typeof this.canvas.hasPointerCapture === 'function'
          ? this.canvas.hasPointerCapture(event.pointerId)
          : true;
      if (hasCapture) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
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
    if (this.saveRequestId !== null) {
      cancelAnimationFrame(this.saveRequestId);
      this.saveRequestId = null;
    }
    this.game.saveBricks?.();
  }
}
