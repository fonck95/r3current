import { GameRuntime } from './game/runtime.js';
import { LevelEditor } from './engine/editor.js';

let game;
let editor;
let lastTime = 0;

async function init() {
  const canvas = document.getElementById('gfx');
  const hud = document.getElementById('hud');

  game = new GameRuntime(canvas);
  await game.initialize();

  editor = new LevelEditor(game, {
    onModeChange: () => {
      // Ensure HUD updates immediately when toggling modes
      hud.textContent = game.composeHud({
        dt: 0,
        editMode: editor.isEditMode(),
        selectedShape: editor.getSelectedShape(),
        selectedRotation: editor.getSelectedRotation(),
        activeLayer: editor.getActiveLayer(),
      });
    },
  });
  editor.initialize();

  window.addEventListener('keydown', (event) => {
    game.handleKeyDown(event, editor.isEditMode());
  });
  window.addEventListener('keyup', (event) => {
    game.handleKeyUp(event);
  });

  window.addEventListener('resize', () => game.resize());
  game.resize();

  hud.textContent = game.composeHud({
    dt: 0,
    editMode: editor.isEditMode(),
    selectedShape: editor.getSelectedShape(),
    selectedRotation: editor.getSelectedRotation(),
    activeLayer: editor.getActiveLayer(),
  });

  requestAnimationFrame(loop);

  function loop(time) {
    requestAnimationFrame(loop);

    const dtRaw = (time - lastTime) / 1000;
    const dt = Math.min(Math.max(dtRaw, 0), game.getMaxDelta());
    lastTime = time;

    game.update(dt, editor.isEditMode());

    const overlays = editor.getOverlayDrawables();
    game.buildDrawables(overlays);
    game.render();

    hud.textContent = game.composeHud({
      dt,
      editMode: editor.isEditMode(),
      selectedShape: editor.getSelectedShape(),
      selectedRotation: editor.getSelectedRotation(),
      activeLayer: editor.getActiveLayer(),
    });
  }
}

init();
