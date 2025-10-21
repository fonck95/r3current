function createTrianglePoints(BABYLON) {
  return [
    new BABYLON.Vector3(-0.5, -0.5, 0),
    new BABYLON.Vector3(0.5, -0.5, 0),
    new BABYLON.Vector3(0, 0.5, 0),
  ];
}

function colorKey(color) {
  return color.map((c) => c.toFixed(4)).join('_');
}

export class BabylonRenderer {
  constructor(canvas, { virtualWidth, virtualHeight } = {}) {
    if (!window.BABYLON) {
      throw new Error('Babylon.js no está disponible en el contexto global');
    }

    this.canvas = canvas;
    this.virtualWidth = virtualWidth || 1920;
    this.virtualHeight = virtualHeight || 1080;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.meshPool = new Map();
    this.materials = new Map();
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    this.scaleX = 1;
    this.scaleY = 1;
  }

  initialize() {
    const { BABYLON } = window;

    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.05, 1.0);

    this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -1000), this.scene);
    this.camera.setTarget(BABYLON.Vector3.Zero());
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 4000;

    this.updateViewport();

    this.engine.runRenderLoop(() => {
      if (this.scene) {
        this.scene.render();
      }
    });
  }

  dispose() {
    if (this.engine) {
      this.engine.stopRenderLoop();
    }
    if (this.scene) {
      this.scene.dispose();
    }
    this.materials.forEach((mat) => mat.dispose());
    this.materials.clear();
    this.meshPool.clear();
    this.engine?.dispose();
    this.engine = null;
    this.scene = null;
    this.camera = null;
  }

  updateViewport() {
    if (!this.camera) return;

    this.canvasWidth = this.canvas.width;
    this.canvasHeight = this.canvas.height;

    this.scaleX = this.canvasWidth / this.virtualWidth;
    this.scaleY = this.canvasHeight / this.virtualHeight;

    const halfW = this.canvasWidth / 2;
    const halfH = this.canvasHeight / 2;

    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
    this.camera.orthoBottom = -halfH;
    this.camera.orthoTop = halfH;
  }

  resize() {
    if (!this.engine) return;
    this.updateViewport();
    this.engine.resize();
  }

  syncDrawables(drawables) {
    if (!this.scene) return;

    const used = new Set();

    drawables.forEach((drawable, index) => {
      const key = drawable.id || `anon_${index}`;
      let mesh = this.meshPool.get(key);

      if (!mesh || mesh.metadata?.shape !== drawable.shape) {
        mesh?.dispose();
        mesh = this.createMesh(key, drawable);
        this.meshPool.set(key, mesh);
      }

      this.applyDrawable(mesh, drawable);
      used.add(key);
    });

    this.meshPool.forEach((mesh, key) => {
      if (!used.has(key)) {
        mesh.dispose();
        this.meshPool.delete(key);
      }
    });
  }

  render() {
    // El bucle de render de Babylon se ejecuta automáticamente.
  }

  createMesh(name, drawable) {
    const { BABYLON } = window;
    let mesh;

    switch (drawable.shape) {
      case 'circle':
        mesh = BABYLON.MeshBuilder.CreateDisc(name, {
          radius: 0.5,
          tessellation: 48,
          sideOrientation: BABYLON.Mesh.DOUBLESIDE,
        }, this.scene);
        break;
      case 'triangle':
        mesh = BABYLON.MeshBuilder.CreatePolygon(name, {
          shape: createTrianglePoints(BABYLON),
          sideOrientation: BABYLON.Mesh.DOUBLESIDE,
        }, this.scene);
        break;
      case 'rect':
      default:
        mesh = BABYLON.MeshBuilder.CreatePlane(name, {
          size: 1,
          sideOrientation: BABYLON.Mesh.DOUBLESIDE,
        }, this.scene);
        break;
    }

    mesh.metadata = { shape: drawable.shape };
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.material = this.getMaterial(drawable.color || [1, 1, 1, 1]);
    mesh.billboardMode = BABYLON.AbstractMesh.BILLBOARDMODE_NONE;
    mesh.rotation.x = 0;
    mesh.rotation.y = 0;

    return mesh;
  }

  applyDrawable(mesh, drawable) {
    const color = drawable.color || [1, 1, 1, 1];
    const key = colorKey(color);
    if (!mesh.material || mesh.material.metadata?.colorKey !== key) {
      mesh.material = this.getMaterial(color);
    }

    const centerX = drawable.x + drawable.w * 0.5;
    const centerY = drawable.y + drawable.h * 0.5;

    const sceneX = centerX * this.scaleX - this.canvasWidth * 0.5;
    const sceneY = this.canvasHeight * 0.5 - centerY * this.scaleY;

    mesh.position.x = sceneX;
    mesh.position.y = sceneY;
    mesh.position.z = drawable.layer === 'overlay' ? 50 : 0;

    mesh.rotation.z = -(drawable.rotation || 0);

    mesh.scaling.x = Math.max(0.0001, drawable.w * this.scaleX);
    mesh.scaling.y = Math.max(0.0001, drawable.h * this.scaleY);
    mesh.scaling.z = 1;

    mesh.renderingGroupId = drawable.layer === 'overlay' ? 1 : 0;
  }

  getMaterial(color) {
    const { BABYLON } = window;
    const key = colorKey(color);

    if (!this.materials.has(key)) {
      const material = new BABYLON.StandardMaterial(`mat_${this.materials.size}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(color[0], color[1], color[2]);
      material.emissiveColor = new BABYLON.Color3(color[0], color[1], color[2]);
      material.alpha = color[3] ?? 1;
      material.disableLighting = true;
      material.backFaceCulling = false;
      material.twoSidedLighting = true;
      material.metadata = { colorKey: key };
      this.materials.set(key, material);
    }

    return this.materials.get(key);
  }
}
