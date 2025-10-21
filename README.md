# r3current

Experimento de plataforma jugable que comparte la misma escena entre un modo 2D y un editor 3D. Todo el render y la interacción 3D se realizan con [Babylon.js](https://www.babylonjs.com/).

## Estructura del proyecto

```
.
├── index.html          # Shell principal con estilos y carga del runtime/editor
├── README.md
└── src/
    ├── main.js         # Punto de arranque: inicializa juego y editor
    ├── game/
    │   └── runtime.js  # Bucle principal, física 2D y utilidades Babylon
    └── engine/
        └── editor.js   # Herramientas del editor 3D y binding de UI
```

## Requisitos

* Servir los archivos de manera estática (`npx serve .`, `python -m http.server`, etc.).
* Navegador moderno compatible con módulos ES y WebGL 2.

Babylon.js se carga desde CDN, por lo que no es necesario ningún paso de build.

## Uso

1. Abre `index.html` (idealmente sirviéndolo desde un servidor local).
2. El juego arranca en modo **2D** con cámara ortográfica. Usa `A/D` o las flechas para desplazarte y `Espacio` para saltar.
3. Presiona **“🔧 Ver Editor 3D”** para alternar al editor:
   * El modo edición activa una cámara orbital y muestra gizmos para mover plataformas.
   * Clic izquierdo sobre una plataforma: selecciona y activa el gizmo.
   * `Shift + Click` sobre una plataforma: la elimina.
   * Clic sobre el lienzo vacío: crea una nueva plataforma con el tamaño/color configurado en el panel.
   * Los sliders controlan ancho y alto de la plataforma; el selector de color actualiza la selección activa.
   * El botón “Nueva Plataforma” genera una pieza en el centro de la vista.
4. Vuelve al modo **Juego 2D** con el mismo botón para probar el nivel.

Los cambios se guardan automáticamente en `localStorage` bajo la clave `babylon-platformer-bricks`.

## Notas técnicas

* El runtime utiliza un bucle de físicas fijo para resolver colisiones 2D sobre la misma geometría que se visualiza en 3D.
* La cámara ortográfica sigue al jugador en modo juego; en el editor se usa una `ArcRotateCamera` configurada para recorrer la escena.
* El editor sincroniza tamaño, color y posición de cada plataforma con el runtime antes de volver al modo jugable.

## Contribuir

* Mantén aislada la lógica de juego en `src/game` y las herramientas de edición en `src/engine`.
* Reutiliza materiales Babylon mediante cachés para evitar duplicados.
* Si agregas nuevos tipos de geometría, expón factorías en el runtime y propaga la configuración al editor.
