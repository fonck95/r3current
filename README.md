# r3current

Experimento WebGPU/Canvas 2D que combina un runtime jugable con un editor visual para crear entornos basados en "bricks". El proyecto está escrito en JavaScript moderno y puede ejecutarse directamente en el navegador sin pasos de compilación.

## Estructura del proyecto

```
.
├── index.html          # Shell principal y estilos in-line
├── README.md
└── src/
    ├── main.js         # Punto de entrada: orquesta juego y editor
    ├── game/
    │   ├── animation.js  # Sistema de animación humanoide reutilizable
    │   ├── character.js  # Clase base para entidades físicas animadas
    │   ├── physics.js    # Motor de física, colisiones y utilidades de bricks
    │   ├── player.js     # Lógica específica del jugador jugable
    │   └── runtime.js    # Render, bucle principal y persistencia del mundo
    └── engine/
        └── editor.js     # Motor de edición: UI, gestos y persistencia de niveles
```

La carpeta `game/` agrupa todo lo relacionado con la experiencia jugable (física, animaciones, runtime). La carpeta `engine/` contiene la lógica del editor de niveles y las herramientas que operan sobre el mismo mundo. El archivo `src/main.js` actúa como mediador entre ambos contextos.

## Requisitos

* Navegador moderno con soporte para módulos ES6.
* WebGPU es opcional; si no está disponible, el motor utiliza automáticamente Canvas 2D.

## Uso

1. Levanta un servidor estático sencillo (por ejemplo `npx serve .`) o abre `index.html` directamente.
2. El juego inicia en modo jugable. Usa `A/D` o las flechas para moverte y `Espacio` para saltar.
3. Pulsa **"🔧 Activar Edición"** para entrar en el motor de edición:
   * Crea nuevos bricks arrastrando sobre el lienzo.
   * Cambia color, forma y rotación desde el panel flotante.
   * Guarda la escena automáticamente en `localStorage`.
4. Vuelve al modo juego con el mismo botón para probar los cambios.

## Persistencia

Los niveles se serializan automáticamente en `localStorage` bajo la clave `bricks`. Para restablecer el entorno basta con usar el botón "Eliminar todos los bricks" desde el panel del editor o limpiar el almacenamiento del navegador.

## Contribuir

* Mantén el código modular: la jugabilidad debe residir en `src/game` y las herramientas en `src/engine`.
* Prefiere funciones puras y utilidades reutilizables en el motor de física.
* Evita capturar dependencias globales siempre que sea posible; usa métodos públicos del runtime/editor.
