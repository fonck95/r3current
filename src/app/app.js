import { GameRuntime } from '../runtime/gameRuntime.js';
import { LevelEditor } from '../engine/editor/levelEditor.js';

export class GameApplication {
  constructor({ canvasId = 'gfx', hudId = 'hud' } = {}) {
    this.canvasId = canvasId;
    this.hudId = hudId;

    this.canvas = null;
    this.hudElement = null;
    this.runtime = null;
    this.editor = null;

    this.lastFrameTime = 0;
    this.animationFrameHandle = null;

    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
    this.boundOnResize = this.onResize.bind(this);
    this.boundGameLoop = this.gameLoop.bind(this);
  }

  async boot() {
    this.canvas = document.getElementById(this.canvasId);
    this.hudElement = document.getElementById(this.hudId);

    if (!this.canvas) {
      throw new Error(`No se encontró un <canvas> con id '${this.canvasId}'`);
    }
    if (!this.hudElement) {
      throw new Error(`No se encontró un elemento HUD con id '${this.hudId}'`);
    }

    this.runtime = new GameRuntime(this.canvas);
    await this.runtime.initialize();

    this.editor = new LevelEditor(this.runtime, {
      onModeChange: () => this.updateHud(0),
    });
    this.editor.initialize();

    window.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('keyup', this.boundOnKeyUp);
    window.addEventListener('resize', this.boundOnResize);

    this.runtime.resize();
    this.updateHud(0);

    this.lastFrameTime = performance.now();
    this.animationFrameHandle = requestAnimationFrame(this.boundGameLoop);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameHandle);
    window.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('keyup', this.boundOnKeyUp);
    window.removeEventListener('resize', this.boundOnResize);

    if (this.editor) {
      this.editor.teardown?.();
    }
    this.runtime?.dispose?.();

    this.runtime = null;
    this.editor = null;
  }

  onKeyDown(event) {
    if (!this.runtime || !this.editor) return;
    this.runtime.handleKeyDown(event, this.editor.isEditMode());
  }

  onKeyUp(event) {
    this.runtime?.handleKeyUp(event);
  }

  onResize() {
    this.runtime?.resize();
  }

  gameLoop(time) {
    this.animationFrameHandle = requestAnimationFrame(this.boundGameLoop);

    if (!this.runtime || !this.editor) {
      return;
    }

    const rawDelta = (time - this.lastFrameTime) / 1000;
    const dt = Math.min(Math.max(rawDelta, 0), this.runtime.getMaxDelta());
    this.lastFrameTime = time;

    this.runtime.update(dt, this.editor.isEditMode());

    const overlays = this.editor.getOverlayDrawables();
    this.runtime.buildDrawables(overlays);
    this.runtime.render();

    this.updateHud(dt);
  }

  updateHud(dt) {
    if (!this.hudElement || !this.runtime || !this.editor) {
      return;
    }

    this.hudElement.textContent = this.runtime.composeHud({
      dt,
      editMode: this.editor.isEditMode(),
      selectedShape: this.editor.getSelectedShape(),
      selectedRotation: this.editor.getSelectedRotation(),
      activeLayer: this.editor.getActiveLayer(),
    });
  }
}
