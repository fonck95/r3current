import { Player } from '../gameplay/player.js';
import {
  createWorld,
  step,
  loadBricks,
  serializeBricks,
} from '../physics/index.js';
import { BabylonRenderer } from '../renderer/babylon/renderer.js';
import {
  VIRTUAL_WIDTH,
  VIRTUAL_HEIGHT,
  FIXED_DELTA,
  MAX_DELTA,
  FLOOR_HEIGHT,
} from '../core/constants.js';

export class GameRuntime {
  constructor(canvas) {
    this.canvas = canvas;
    this.world = createWorld(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    this.player = new Player(100, 100);
    this.world.bodies.push(this.player);

    this.keys = {};
    this.drawables = [];
    this.accumulator = 0;
    this.isEditMode = false;
    this.activeEditLayer = 0;

    this.renderer = new BabylonRenderer(canvas, {
      virtualWidth: VIRTUAL_WIDTH,
      virtualHeight: VIRTUAL_HEIGHT,
    });
  }

  async initialize() {
    await this.renderer.initialize();
    this.loadPersistedBricks();
  }

  dispose() {
    this.renderer?.dispose();
  }

  getWorld() {
    return this.world;
  }

  getPlayer() {
    return this.player;
  }

  getCanvas() {
    return this.canvas;
  }

  getMaxDelta() {
    return MAX_DELTA;
  }

  handleKeyDown(event, isEditMode) {
    this.keys[event.code] = true;
    if (event.code === 'Space' && !isEditMode) {
      event.preventDefault();
    }
  }

  handleKeyUp(event) {
    this.keys[event.code] = false;
  }

  update(dt, isEditMode) {
    this.isEditMode = Boolean(isEditMode);
    if (isEditMode) {
      return;
    }

    this.player.input(this.keys);

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DELTA) {
      this.player.update(this.world, FIXED_DELTA);
      step(this.world, FIXED_DELTA);
      this.accumulator -= FIXED_DELTA;
    }
  }

  buildDrawables(overlays = []) {
    const drawables = [];
    const editMode = this.isEditMode;
    const maxBrickLayer = this.world.bricks.reduce(
      (max, brick) => Math.max(max, brick.z ?? 0),
      0,
    );

    const brickSet = new Set(this.world.bricks);

    this.world.bricks.forEach((body, brickIndex) => {
      if (typeof body.z !== 'number') {
        body.z = 0;
      }
      drawables.push({
        id: body.id || `brick_${brickIndex}`,
        x: body.x,
        y: body.y,
        w: body.w,
        h: body.h,
        shape: body.shape || 'rect',
        color: body.color || [0.8, 0.4, 0.2, 1.0],
        rotation: body.rotation || 0,
        layer: 'world',
        depthIndex: editMode ? body.z ?? 0 : 0,
      });
    });

    this.world.bodies.forEach((body) => {
      if (body === this.player) return;
      if (brickSet.has(body)) return;
      drawables.push({
        id: body.id || `body_${drawables.length}`,
        x: body.x,
        y: body.y,
        w: body.w,
        h: body.h,
        shape: body.shape || 'rect',
        color: body.color || [0.8, 0.4, 0.2, 1.0],
        rotation: body.rotation || 0,
        layer: 'world',
        depthIndex: editMode ? (body.z ?? maxBrickLayer + 1) : 0,
      });
    });

    const playerDrawables = this.player.toDrawable().map((item, index) => ({
      ...item,
      id: `player_${index}`,
      layer: 'world',
      depthIndex: editMode ? -1 : 0,
    }));
    drawables.push(...playerDrawables);

    drawables.push({
      id: 'floor',
      x: 0,
      y: VIRTUAL_HEIGHT - FLOOR_HEIGHT,
      w: VIRTUAL_WIDTH,
      h: FLOOR_HEIGHT,
      shape: 'rect',
      color: [0.3, 0.3, 0.3, 1.0],
      rotation: 0,
      layer: 'world',
      depthIndex: editMode ? maxBrickLayer + 2 : 0,
    });

    overlays.forEach((overlay, index) => {
      drawables.push({
        ...overlay,
        id: overlay.id || `overlay_${index}`,
        layer: 'overlay',
        depthIndex: overlay.depthIndex ?? (editMode ? -5 : 0),
      });
    });

    this.drawables = drawables;
    this.renderer.syncDrawables(drawables);

    return drawables;
  }

  render() {
    this.renderer.render();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.canvas.width = Math.max(1, width * dpr);
    this.canvas.height = Math.max(1, height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.renderer.resize();

    if (this.drawables.length) {
      this.renderer.syncDrawables(this.drawables);
    }
  }

  screenToWorld(clientX, clientY) {
    if (this.isEditMode && typeof this.renderer.screenToWorld === 'function') {
      const picked = this.renderer.screenToWorld(clientX, clientY, this.activeEditLayer);
      if (picked) {
        return picked;
      }
    }

    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * VIRTUAL_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT;
    return { x, y, z: this.activeEditLayer };
  }

  composeHud({ dt, editMode, selectedShape, selectedRotation, activeLayer }) {
    const fps = dt > 0 ? (1 / dt).toFixed(0) : '0';
    const mode = editMode ? 'EDICIÓN' : 'JUEGO';
    const rendererName = this.renderer.getDisplayName
      ? this.renderer.getDisplayName()
      : 'Babylon.js';
    const rotInfo = editMode ? ` | Rotación: ${selectedRotation.toFixed(0)}°` : '';
    const animState = !editMode ? ` | Anim: ${this.player.animationController.currentState}` : '';
    const bricks = this.world.bricks.length;
    const layerDisplay = Number.isFinite(activeLayer) ? Math.round(activeLayer) : this.activeEditLayer;
    const layerInfo = editMode ? ` | Capa: ${layerDisplay}` : '';

    const statusLine = `${rendererName} | FPS: ${fps} | Modo: ${mode}${animState}${rotInfo}${layerInfo}`;
    const helpLine = editMode
      ? `Forma: ${selectedShape} | Bricks: ${bricks}`
      : `A/D: Mover | Space: Saltar | Bricks: ${bricks}`;

    return `${statusLine}\n${helpLine}`;
  }

  loadPersistedBricks() {
    const saved = localStorage.getItem('bricks');
    if (!saved) return;

    try {
      loadBricks(this.world, JSON.parse(saved));
      console.log('Loaded', this.world.bricks.length, 'bricks from storage');
    } catch (e) {
      console.error('Failed to load bricks:', e);
    }
  }

  saveBricks() {
    try {
      localStorage.setItem('bricks', JSON.stringify(serializeBricks(this.world)));
    } catch (e) {
      console.error('Failed to save bricks:', e);
    }
  }

  setEditMode(value) {
    this.isEditMode = Boolean(value);
    this.renderer.setMode(this.isEditMode ? 'edit' : 'play');
    if (this.isEditMode) {
      this.setEditPlaneDepth(this.activeEditLayer);
    }
    if (this.drawables.length) {
      this.renderer.syncDrawables(this.drawables);
    }
    return this.isEditMode;
  }

  adjustEditCameraDistance(deltaY) {
    if (!this.isEditMode) {
      return;
    }
    if (typeof this.renderer.adjustEditCameraDistance === 'function') {
      this.renderer.adjustEditCameraDistance(deltaY);
    }
  }

  setEditPlaneDepth(layerIndex) {
    const nextLayer = Number.isFinite(layerIndex) ? Math.round(layerIndex) : 0;
    this.activeEditLayer = nextLayer;
    if (typeof this.renderer.setEditPlane === 'function') {
      this.renderer.setEditPlane(nextLayer);
    }
  }

  setEditViewMode(mode) {
    if (typeof this.renderer.setEditViewMode === 'function') {
      this.renderer.setEditViewMode(mode);
    }
  }

  orbitEditCamera(deltaX, deltaY) {
    if (!this.isEditMode) {
      return;
    }
    if (typeof this.renderer.orbitEditCamera === 'function') {
      this.renderer.orbitEditCamera(deltaX, deltaY);
    }
  }

  panEditCamera(deltaX, deltaY) {
    if (!this.isEditMode) {
      return;
    }
    if (typeof this.renderer.panEditCamera === 'function') {
      this.renderer.panEditCamera(deltaX, deltaY);
    }
  }
}
