import { Player } from './player.js';
import {
  createWorld,
  step,
  loadBricks,
  serializeBricks,
} from './physics.js';
import { BabylonRenderer } from './babylonRenderer.js';

export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
const FIXED_DT = 1 / 60;
const MAX_DT = 0.02;

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

    this.renderer = new BabylonRenderer(canvas, {
      virtualWidth: VIRTUAL_WIDTH,
      virtualHeight: VIRTUAL_HEIGHT,
    });
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
    return MAX_DT;
  }

  async initialize() {
    this.renderer.initialize();
    this.loadPersistedBricks();
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
    if (isEditMode) {
      return;
    }

    this.player.input(this.keys);

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.player.update(this.world, FIXED_DT);
      step(this.world, FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
  }

  buildDrawables(overlays = []) {
    const drawables = [];
    const editMode = this.isEditMode;

    const brickSet = new Set(this.world.bricks);

    this.world.bricks.forEach((body, brickIndex) => {
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
        depthIndex: editMode ? brickIndex : 0,
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
        depthIndex: editMode ? this.world.bricks.length : 0,
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
      y: VIRTUAL_HEIGHT - 60,
      w: VIRTUAL_WIDTH,
      h: 60,
      shape: 'rect',
      color: [0.3, 0.3, 0.3, 1.0],
      rotation: 0,
      layer: 'world',
      depthIndex: editMode ? this.world.bricks.length + 1 : 0,
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
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * VIRTUAL_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT;
    return { x, y };
  }

  composeHud({ dt, editMode, selectedShape, selectedRotation }) {
    const fps = dt > 0 ? (1 / dt).toFixed(0) : '0';
    const mode = editMode ? 'EDICIÓN' : 'JUEGO';
    const renderer = 'Babylon.js';
    const rotInfo = editMode ? ` | Rotación: ${selectedRotation.toFixed(0)}°` : '';
    const animState = !editMode ? ` | Anim: ${this.player.animationController.currentState}` : '';
    const bricks = this.world.bricks.length;

    const statusLine = `${renderer} | FPS: ${fps} | Modo: ${mode}${animState}${rotInfo}`;
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
    if (this.drawables.length) {
      this.renderer.syncDrawables(this.drawables);
    }
  }
}
