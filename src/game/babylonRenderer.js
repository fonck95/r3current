function colorKey(color) {
  return color.map((c) => c.toFixed(4)).join('_');
}

const EDIT_DEPTH_STEP = 40;

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
    this.mode = 'play';
    this.editBackground = null;
    this.editBackgroundTexture = null;
    this.editTargetZ = 0;
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
    this.camera.maxZ = 8000;

    this.updateViewport();
    this.createEditBackground();
    this.setMode('play');

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
    this.editBackground = null;
    this.editBackgroundTexture = null;
    this.mode = 'play';
    this.editTargetZ = 0;
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

    this.updateEditBackground();
  }

  resize() {
    if (!this.engine) return;
    this.updateViewport();
    this.engine.resize();
  }

  syncDrawables(drawables) {
    if (!this.scene) return;

    const used = new Set();

    let maxDepthIndex = 0;

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

      if (typeof drawable.depthIndex === 'number') {
        maxDepthIndex = Math.max(maxDepthIndex, drawable.depthIndex);
      }
    });

    this.meshPool.forEach((mesh, key) => {
      if (!used.has(key)) {
        mesh.dispose();
        this.meshPool.delete(key);
      }
    });

    if (this.editBackground) {
      const depth = Math.max(200, (maxDepthIndex + 4) * EDIT_DEPTH_STEP);
      this.editBackground.position.z = depth;
    }

    this.editTargetZ = Math.max(0, maxDepthIndex * EDIT_DEPTH_STEP * 0.5);
    if (this.mode === 'edit' && this.camera) {
      this.camera.setTarget(new BABYLON.Vector3(0, 0, this.editTargetZ));
    }
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
        mesh = BABYLON.MeshBuilder.CreateDisc(name, {
          radius: 0.5,
          tessellation: 3,
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

    const baseRotation = drawable.shape === 'triangle' ? Math.PI / 2 : 0;
    mesh.metadata = { shape: drawable.shape, baseRotation };
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
    if (this.mode === 'edit') {
      const depthIndex = drawable.depthIndex ?? 0;
      mesh.position.z = drawable.layer === 'overlay' ? -EDIT_DEPTH_STEP : depthIndex * EDIT_DEPTH_STEP;
    } else {
      mesh.position.z = drawable.layer === 'overlay' ? 50 : 0;
    }

    const baseRotation = mesh.metadata?.baseRotation || 0;
    mesh.rotation.z = baseRotation - (drawable.rotation || 0);

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

  createEditBackground() {
    const { BABYLON } = window;
    if (!this.scene) return;

    this.editBackgroundTexture = new BABYLON.DynamicTexture('edit_bg_tex', { width: 1024, height: 1024 }, this.scene, true);
    const ctx = this.editBackgroundTexture.getContext();
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const divisions = 16;
    for (let i = 0; i <= divisions; i += 1) {
      const pos = (1024 / divisions) * i;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, 1024);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(1024, pos);
      ctx.stroke();
    }
    this.editBackgroundTexture.update();

    const material = new BABYLON.StandardMaterial('edit_bg_mat', this.scene);
    material.diffuseTexture = this.editBackgroundTexture;
    material.emissiveTexture = this.editBackgroundTexture;
    material.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.28);
    material.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.28);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.backFaceCulling = false;
    material.disableLighting = true;

    this.editBackground = BABYLON.MeshBuilder.CreatePlane('edit_bg', {
      size: 1,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, this.scene);
    this.editBackground.isPickable = false;
    this.editBackground.renderingGroupId = 0;
    this.editBackground.material = material;
    this.editBackground.isVisible = false;
    this.updateEditBackground();
  }

  updateEditBackground() {
    if (!this.editBackground) return;
    this.editBackground.scaling.x = this.canvasWidth * 1.2;
    this.editBackground.scaling.y = this.canvasHeight * 1.2;
    this.editBackground.position.x = 0;
    this.editBackground.position.y = 0;
  }

  setMode(mode) {
    if (!this.camera || this.mode === mode) {
      this.mode = mode;
      if (this.editBackground) {
        this.editBackground.isVisible = mode === 'edit';
      }
      return;
    }

    const { BABYLON } = window;
    this.mode = mode;

    if (mode === 'edit') {
      const distance = Math.max(this.canvasWidth, this.canvasHeight) * 1.1;
      this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
      this.camera.position = new BABYLON.Vector3(-distance * 0.35, distance * 0.15, -distance);
      this.camera.setTarget(new BABYLON.Vector3(0, 0, this.editTargetZ));
      this.camera.fov = BABYLON.Tools.ToRadians(45);
      this.camera.minZ = 0.1;
      this.camera.maxZ = 8000;
      if (this.editBackground) {
        this.editBackground.isVisible = true;
      }
    } else {
      this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
      this.camera.position = new BABYLON.Vector3(0, 0, -1000);
      this.camera.setTarget(BABYLON.Vector3.Zero());
      this.camera.minZ = 0.1;
      this.camera.maxZ = 8000;
      this.updateViewport();
      if (this.editBackground) {
        this.editBackground.isVisible = false;
      }
    }
  }
}
