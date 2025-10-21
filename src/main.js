import { GameRuntime } from './game/runtime.js';
import { LevelEditor } from './engine/editor.js';

let game;
let editor;

async function bootstrap() {
  const canvas = document.getElementById('gfx');
  const hud = document.getElementById('hud');

  game = new GameRuntime(canvas);
  game.setHudCallback((text) => {
    hud.textContent = text;
  });
  await game.initialize();

  editor = new LevelEditor(game, {
    onModeChange: () => {
      hud.textContent = game.buildHudText();
    },
  });
  editor.initialize();

  game.start();

  window.addEventListener('resize', () => game.resize());

  window.addEventListener('keydown', (event) => {
    if (editor.handleKeyDown(event)) {
      return;
    }
    game.handleKeyDown(event);
  });

  window.addEventListener('keyup', (event) => {
    if (editor.handleKeyUp(event)) {
      return;
    }
    game.handleKeyUp(event);
  });
}

bootstrap().catch((error) => console.error(error));
