function colorKey(color) {
  return color.map((c) => c.toFixed(4)).join('_');
}

const EDIT_DEPTH_STEP = 40;
const EDIT_VIEW_PRESETS = {
  iso: { yaw: -Math.PI * 0.9, pitch: Math.PI / 12 },
  front: { yaw: Math.PI, pitch: 0 },
  side: { yaw: -Math.PI / 2, pitch: 0 },
  top: { yaw: Math.PI, pitch: Math.PI / 2 - 0.2 },
};
const EDIT_MIN_PITCH = -Math.PI / 2 + 0.05;
const EDIT_MAX_PITCH = Math.PI / 2 - 0.05;
const ORBIT_SENSITIVITY = 0.0045;

export class BabylonRenderer {
  constructor(canvas, { virtualWidth, virtualHeight } = {}) {
    if (!window.BABYLON) {
      throw new Error('Babylon.js no está disponible en el contexto global');
    }

    this.canvas = canvas;
    this.virtualWidth = virtualWidth || 1920;
    this.virtualHeight = virtualHeight || 1080;
    this.engine = null;
    this.engineType = 'webgl';
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
    this.activeEditLayer = 0;
    this.editCameraDistance = 0;
    this.lastDepthIndex = 0;
    this.editViewMode = 'iso';
    this.editOrbitYaw = EDIT_VIEW_PRESETS.iso.yaw;
    this.editOrbitPitch = EDIT_VIEW_PRESETS.iso.pitch;
    this.editTargetWorldOffset = { x: 0, y: 0 };
  }

  getDefaultEditCameraDistance() {
    return Math.max(this.canvasWidth, this.canvasHeight) * 1.1;
  }

  getMinEditCameraDistance() {
    return Math.max(200, Math.min(this.canvasWidth, this.canvasHeight) * 0.35);
  }

  getMaxEditCameraDistance() {
    return Math.max(this.canvasWidth, this.canvasHeight) * 8;
  }

  async createEngine(BABYLON) {
    const supportsWebGPU =
      BABYLON.WebGPUEngine && BABYLON.WebGPUEngine.IsSupportedAsync
        ? await BABYLON.WebGPUEngine.IsSupportedAsync
        : false;

    if (supportsWebGPU) {
      try {
        const engine = new BABYLON.WebGPUEngine(this.canvas);
        await engine.initAsync();
        this.engineType = 'webgpu';
        return engine;
      } catch (error) {
        console.warn('WebGPU no disponible, usando motor WebGL clásico.', error);
      }
    }

    this.engineType = 'webgl';
    return new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
    });
  }

  async initialize() {
    const { BABYLON } = window;

    this.engine = await this.createEngine(BABYLON);

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
    this.activeEditLayer = 0;
    this.editCameraDistance = 0;
    this.lastDepthIndex = 0;
    this.engineType = 'webgl';
    this.editViewMode = 'iso';
    this.editOrbitYaw = EDIT_VIEW_PRESETS.iso.yaw;
    this.editOrbitPitch = EDIT_VIEW_PRESETS.iso.pitch;
    this.editTargetWorldOffset = { x: 0, y: 0 };
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
    if (this.mode === 'edit') {
      if (!this.editCameraDistance) {
        this.editCameraDistance = this.getDefaultEditCameraDistance();
      }
      const minDistance = this.getMinEditCameraDistance();
      const maxDistance = this.getMaxEditCameraDistance();
      this.editCameraDistance = Math.min(Math.max(this.editCameraDistance, minDistance), maxDistance);
      this.updateEditCamera();
    }
    this.engine.resize();
  }

  getDisplayName() {
    return this.engineType === 'webgpu' ? 'Babylon.js WebGPU' : 'Babylon.js WebGL';
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

    this.lastDepthIndex = Math.max(0, maxDepthIndex);
    const furthestLayer = Math.max(this.lastDepthIndex, this.activeEditLayer, 0);
    if (this.editBackground) {
      const depth = furthestLayer * EDIT_DEPTH_STEP + Math.max(200, 4 * EDIT_DEPTH_STEP);
      this.editBackground.position.z = depth;
    }

    this.editTargetZ = this.activeEditLayer * EDIT_DEPTH_STEP;
    if (this.mode === 'edit') {
      this.updateEditCamera();
    }
  }

  setEditPlane(layerIndex) {
    const nextLayer = Number.isFinite(layerIndex) ? Math.round(layerIndex) : 0;
    if (this.activeEditLayer === nextLayer) {
      this.editTargetZ = this.activeEditLayer * EDIT_DEPTH_STEP;
      if (this.editBackground) {
        const furthest = Math.max(this.lastDepthIndex, this.activeEditLayer, 0);
        const depth = furthest * EDIT_DEPTH_STEP + Math.max(200, 4 * EDIT_DEPTH_STEP);
        this.editBackground.position.z = depth;
      }
      if (this.mode === 'edit') {
        this.updateEditCamera();
      }
      return;
    }
    this.activeEditLayer = nextLayer;
    this.editTargetZ = this.activeEditLayer * EDIT_DEPTH_STEP;
    if (this.editBackground) {
      const furthest = Math.max(this.lastDepthIndex, this.activeEditLayer, 0);
      const depth = furthest * EDIT_DEPTH_STEP + Math.max(200, 4 * EDIT_DEPTH_STEP);
      this.editBackground.position.z = depth;
    }
    if (this.mode === 'edit') {
      this.updateEditCamera();
    }
  }

  setEditViewMode(mode) {
    if (mode === 'custom') {
      this.editViewMode = 'custom';
      return;
    }

    const preset = EDIT_VIEW_PRESETS[mode] || EDIT_VIEW_PRESETS.iso;
    this.editViewMode = mode in EDIT_VIEW_PRESETS ? mode : 'iso';
    this.editOrbitYaw = preset.yaw;
    this.editOrbitPitch = preset.pitch;

    if (this.mode === 'edit') {
      this.updateEditCamera();
    }
  }

  orbitEditCamera(deltaX, deltaY) {
    if (!this.camera || this.mode !== 'edit') {
      return;
    }
    const hasYaw = Number.isFinite(deltaX) && Math.abs(deltaX) > 1e-6;
    const hasPitch = Number.isFinite(deltaY) && Math.abs(deltaY) > 1e-6;
    if (!hasYaw && !hasPitch) {
      return;
    }

    if (hasYaw) {
      this.editOrbitYaw += deltaX * ORBIT_SENSITIVITY;
    }
    if (hasPitch) {
      this.editOrbitPitch -= deltaY * ORBIT_SENSITIVITY;
    }

    this.editViewMode = 'custom';
    this.updateEditCamera();
  }

  panEditCamera(deltaX, deltaY) {
    if (!this.camera || this.mode !== 'edit') {
      return;
    }
    const moveX = Number.isFinite(deltaX) && Math.abs(deltaX) > 1e-4;
    const moveY = Number.isFinite(deltaY) && Math.abs(deltaY) > 1e-4;
    if (!moveX && !moveY) {
      return;
    }

    if (moveX) {
      this.editTargetWorldOffset.x += deltaX;
    }
    if (moveY) {
      this.editTargetWorldOffset.y += deltaY;
    }

    this.editViewMode = 'custom';
    this.updateEditCamera();
  }

  render() {
    // El bucle de render de Babylon se ejecuta automáticamente.
  }

  screenToWorld(clientX, clientY, layerIndex) {
    if (!this.scene || !this.camera) {
      return null;
    }

    const { BABYLON } = window;
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    const ray = this.scene.createPickingRay(localX, localY, BABYLON.Matrix.Identity(), this.camera, false);
    if (!ray) {
      return null;
    }

    const depthIndex = Number.isFinite(layerIndex) ? Math.round(layerIndex) : this.activeEditLayer;
    const planeZ = depthIndex * EDIT_DEPTH_STEP;
    const plane = BABYLON.Plane.FromPositionAndNormal(
      new BABYLON.Vector3(0, 0, planeZ),
      new BABYLON.Vector3(0, 0, 1),
    );

    const distance = ray.intersectsPlane(plane);
    if (distance === null || distance === undefined) {
      return null;
    }

    const hit = ray.origin.add(ray.direction.scale(distance));
    const worldX = (hit.x + this.canvasWidth * 0.5) / this.scaleX;
    const worldY = (this.canvasHeight * 0.5 - hit.y) / this.scaleY;

    return { x: worldX, y: worldY, z: depthIndex };
  }

  updateEditCamera() {
    if (!this.camera) return;
    const { BABYLON } = window;
    const defaultDistance = this.getDefaultEditCameraDistance();
    const minDistance = this.getMinEditCameraDistance();
    const maxDistance = this.getMaxEditCameraDistance();
    const nextDistance = this.editCameraDistance || defaultDistance;
    const distance = Math.min(Math.max(nextDistance, minDistance), maxDistance);
    this.editCameraDistance = distance;

    const clampedPitch = Math.min(Math.max(this.editOrbitPitch, EDIT_MIN_PITCH), EDIT_MAX_PITCH);
    if (clampedPitch !== this.editOrbitPitch) {
      this.editOrbitPitch = clampedPitch;
    }

    const cosPitch = Math.cos(this.editOrbitPitch);
    const sinPitch = Math.sin(this.editOrbitPitch);
    const sinYaw = Math.sin(this.editOrbitYaw);
    const cosYaw = Math.cos(this.editOrbitYaw);

    const offset = new BABYLON.Vector3(
      distance * cosPitch * sinYaw,
      distance * sinPitch,
      distance * cosPitch * cosYaw,
    );

    const target = new BABYLON.Vector3(
      this.editTargetWorldOffset.x * this.scaleX,
      -this.editTargetWorldOffset.y * this.scaleY,
      this.editTargetZ,
    );

    this.camera.setTarget(target);
    const position = target.add(offset);
    if (this.camera.position) {
      this.camera.position.copyFrom(position);
    } else {
      this.camera.position = position;
    }

    if (Math.abs(Math.abs(this.editOrbitPitch) - Math.PI / 2) < 0.1) {
      this.camera.upVector = new BABYLON.Vector3(0, 0, -1);
    } else {
      this.camera.upVector = new BABYLON.Vector3(0, 1, 0);
    }

    if (this.editBackground) {
      this.editBackground.position.x = target.x;
      this.editBackground.position.y = target.y;
    }

    if (this.mode === 'edit') {
      this.updateEditBackground();
    }
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
    mesh.rotation.z = baseRotation + (drawable.rotation || 0);

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
    if (material.diffuseTexture) {
      material.diffuseTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
      material.diffuseTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
      material.diffuseTexture.uScale = 8;
      material.diffuseTexture.vScale = 8;
    }

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
    const spanX = Math.max(this.canvasWidth, this.virtualWidth * this.scaleX) * 6;
    const spanY = Math.max(this.canvasHeight, this.virtualHeight * this.scaleY) * 6;
    this.editBackground.scaling.x = spanX;
    this.editBackground.scaling.y = spanY;
    this.editBackground.position.x = this.editTargetWorldOffset.x * this.scaleX;
    this.editBackground.position.y = -this.editTargetWorldOffset.y * this.scaleY;

    const texture = this.editBackground.material?.diffuseTexture;
    if (texture) {
      texture.uScale = spanX / 256;
      texture.vScale = spanY / 256;
    }
  }

  setMode(mode) {
    if (!this.camera) {
      this.mode = mode;
      return;
    }

    if (this.mode === mode) {
      this.mode = mode;
      if (this.editBackground) {
        this.editBackground.isVisible = mode === 'edit';
      }
      if (mode === 'edit') {
        if (!this.editCameraDistance) {
          this.editCameraDistance = this.getDefaultEditCameraDistance();
        }
        if (this.editViewMode !== 'custom') {
          const preset = EDIT_VIEW_PRESETS[this.editViewMode] || EDIT_VIEW_PRESETS.iso;
          this.editOrbitYaw = preset.yaw;
          this.editOrbitPitch = preset.pitch;
        }
        this.updateEditCamera();
      }
      return;
    }

    const { BABYLON } = window;
    this.mode = mode;

    if (mode === 'edit') {
      this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
      this.editCameraDistance = this.getDefaultEditCameraDistance();
      if (this.editViewMode !== 'custom') {
        const preset = EDIT_VIEW_PRESETS[this.editViewMode] || EDIT_VIEW_PRESETS.iso;
        this.editOrbitYaw = preset.yaw;
        this.editOrbitPitch = preset.pitch;
      }
      this.updateEditCamera();
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
      this.camera.upVector = new BABYLON.Vector3(0, 1, 0);
      this.camera.minZ = 0.1;
      this.camera.maxZ = 8000;
      this.updateViewport();
      if (this.editBackground) {
        this.editBackground.isVisible = false;
      }
      this.editCameraDistance = 0;
    }
  }

  adjustEditCameraDistance(deltaY) {
    if (!this.camera || this.mode !== 'edit') {
      return;
    }

    if (!Number.isFinite(deltaY) || deltaY === 0) {
      return;
    }

    if (!this.editCameraDistance) {
      this.editCameraDistance = this.getDefaultEditCameraDistance();
    }

    const minDistance = this.getMinEditCameraDistance();
    const maxDistance = this.getMaxEditCameraDistance();
    const normalized = Math.max(Math.min(deltaY / 120, 10), -10);
    const scale = Math.exp(normalized * 0.12);
    const nextDistance = Math.min(Math.max(this.editCameraDistance * scale, minDistance), maxDistance);

    if (Math.abs(nextDistance - this.editCameraDistance) < 1e-3) {
      return;
    }

    this.editCameraDistance = nextDistance;
    this.updateEditCamera();
  }
}
