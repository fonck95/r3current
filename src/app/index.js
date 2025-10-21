import { GameApplication } from './app.js';

const app = new GameApplication();
app.boot().catch((error) => {
  console.error('No se pudo iniciar la aplicación del juego:', error);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}
