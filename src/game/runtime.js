const BABYLON = window.BABYLON;

if (!BABYLON) {
  throw new Error('Babylon.js no se ha cargado. Asegúrate de incluir la librería antes del runtime.');
}

const STORAGE_KEY = 'babylon-platformer-bricks';
const FIXED_STEP = 1 / 120;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function copyVector3(target, source) {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  return target;
}

export class GameRuntime {
  constructor(canvas) {
    this.canvas = canvas;
    this.engine = new BABYLON.Engine(canvas, true, {
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: true,
      stencil: true,
    });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.04, 0.05, 0.1, 1);
    this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    this.scene.fogColor = new BABYLON.Color3(0.04, 0.05, 0.1);
    this.scene.fogDensity = 0.008;

    this._buildLighting();

    this.orthoHeight = 30;
    this.orthoWidth = this.orthoHeight;
    this.sideCameraDistance = 60;

    this.sideCamera = new BABYLON.FreeCamera('side-camera', new BABYLON.Vector3(0, 0, this.sideCameraDistance), this.scene);
    this.sideCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.sideCamera.minZ = 0.1;
    this.sideCamera.maxZ = 500;
    this.sideCamera.inputs.clear();

    this.editorCamera = new BABYLON.ArcRotateCamera(
      'editor-camera',
      Math.PI * 0.5,
      Math.PI / 2.3,
      70,
      new BABYLON.Vector3(0, 4, 0),
      this.scene,
    );
    this.editorCamera.lowerBetaLimit = 0.1;
    this.editorCamera.upperBetaLimit = Math.PI / 2.01;
    this.editorCamera.lowerRadiusLimit = 12;
    this.editorCamera.upperRadiusLimit = 140;
    this.editorCamera.wheelDeltaPercentage = 0.02;
    this.editorCamera.panningSensibility = 0;
    this.editorCamera.useAutoRotationBehavior = false;
    this.editorCamera.inputs.attached.pointers.buttons = [2];
    this.editorCamera.detachControl();

    this.scene.activeCamera = this.sideCamera;

    this.highlightLayer = new BABYLON.HighlightLayer('highlight-layer', this.scene, {
      blurHorizontalSize: 0.4,
      blurVerticalSize: 0.4,
    });
    this.highlightLayer.innerGlow = false;
    this.highlightLayer.outerGlow = true;
    this.highlightLayer.isEnabled = false;

    this.interactionPlane = BABYLON.MeshBuilder.CreatePlane('interaction-plane', {
      width: 200,
      height: 200,
    }, this.scene);
    this.interactionPlane.position = new BABYLON.Vector3(0, 0, 0);
    this.interactionPlane.isPickable = true;
    this.interactionPlane.visibility = 0;
    const planeMaterial = new BABYLON.StandardMaterial('plane-material', this.scene);
    planeMaterial.diffuseColor = new BABYLON.Color3(0.18, 0.24, 0.35);
    planeMaterial.alpha = 0.18;
    planeMaterial.backFaceCulling = false;
    this.interactionPlane.material = planeMaterial;
    this.interactionPlane.isVisible = false;
    this.interactionPlane.metadata = { type: 'interaction-plane' };

    this.materials = new Map();
    this.bricks = new Map();
    this.brickCounter = 0;

    this.player = this._createPlayer();
    this.spawnPoint = this.player.mesh.position.clone();

    this.keys = { left: false, right: false };
    this.pendingJump = false;
    this.accumulator = 0;

    this.gravity = -45;
    this.jumpSpeed = 22;
    this.moveSpeed = 14;
    this.maxFallSpeed = -70;

    this.editMode = false;
    this.hudCallback = () => {};
    this.lastHud = '';
  }

  async initialize() {
    this.resize();
    this._loadBricks();
    if (this.bricks.size === 0) {
      this._createDefaultLevel();
      this.persistBricks();
    }
    this.updateHud();
  }

  start() {
    this.engine.runRenderLoop(() => {
      const dt = clamp(this.engine.getDeltaTime() / 1000, 0, 0.1);
      this._update(dt);
      this.scene.render();
    });
  }

  resize() {
    this.engine.resize();
    const height = this.engine.getRenderHeight(true);
    const width = this.engine.getRenderWidth(true);
    if (height > 0) {
      const aspect = width / height;
      this.orthoWidth = this.orthoHeight * aspect;
    }
  }

  setHudCallback(callback) {
    this.hudCallback = callback;
  }

  buildHudText() {
    const mode = this.editMode ? 'Editor 3D' : 'Juego 2D';
    const pos = this.player.mesh.position;
    const velocity = this.player.velocity;
    return `Modo: ${mode}\nPosición jugador: x=${pos.x.toFixed(1)} y=${pos.y.toFixed(1)}\nVelocidad: vx=${velocity.x.toFixed(1)} vy=${velocity.y.toFixed(1)}\nPlataformas: ${this.bricks.size}`;
  }

  updateHud() {
    const text = this.buildHudText();
    if (text !== this.lastHud) {
      this.lastHud = text;
      this.hudCallback(text);
    }
  }

  handleKeyDown(event) {
    if (this.editMode) {
      return;
    }
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.keys.left = true;
        event.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keys.right = true;
        event.preventDefault();
        break;
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        this.pendingJump = true;
        event.preventDefault();
        break;
      default:
        break;
    }
  }

  handleKeyUp(event) {
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.keys.left = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keys.right = false;
        break;
      default:
        break;
    }
  }

  setEditMode(enabled) {
    if (this.editMode === enabled) {
      return;
    }

    this.editMode = enabled;

    if (enabled) {
      this.scene.activeCamera = this.editorCamera;
      this.editorCamera.attachControl(this.canvas, true);
      this.highlightLayer.isEnabled = true;
      this.interactionPlane.visibility = 0.12;
      this.interactionPlane.isVisible = true;
      this.editorCamera.setTarget(this._computeSceneCenter());
      this.editorCamera.alpha = Math.PI * 0.52;
      this.editorCamera.beta = clamp(this.editorCamera.beta, 0.2, Math.PI / 2.05);
    } else {
      this.editorCamera.detachControl();
      this.scene.activeCamera = this.sideCamera;
      this.highlightLayer.isEnabled = false;
      this.interactionPlane.visibility = 0;
      this.interactionPlane.isVisible = false;
      this.keys.left = false;
      this.keys.right = false;
      this.pendingJump = false;
      this.accumulator = 0;
      this._updateSideCamera();
      this.updateHud();
    }
  }

  getScene() {
    return this.scene;
  }

  getInteractionPlane() {
    return this.interactionPlane;
  }

  getHighlightLayer() {
    return this.highlightLayer;
  }

  getEditorCamera() {
    return this.editorCamera;
  }

  getBrickById(id) {
    return this.bricks.get(id) || null;
  }

  getBricks() {
    return Array.from(this.bricks.values());
  }

  createBrick(options = {}) {
    const id = options.id ?? ++this.brickCounter;
    if (id > this.brickCounter) {
      this.brickCounter = id;
    }

    const size = options.size ?? { x: 6, y: 2, z: 4 };
    const position = options.position ?? { x: 0, y: 0, z: 0 };
    const color = options.color ?? '#ff9d5c';

    const mesh = BABYLON.MeshBuilder.CreateBox(`brick-${id}`, {
      width: size.x,
      height: size.y,
      depth: size.z,
    }, this.scene);
    mesh.position = new BABYLON.Vector3(position.x, position.y, position.z);
    mesh.isPickable = true;
    mesh.metadata = { type: 'brick', id };
    mesh.material = this._getMaterial(color);

    const brick = {
      id,
      mesh,
      color,
      baseSize: { ...size },
      size: { ...size },
    };

    this.bricks.set(id, brick);
    return brick;
  }

  removeBrick(id) {
    const brick = this.bricks.get(id);
    if (!brick) {
      return;
    }
    this.highlightLayer.removeMesh(brick.mesh);
    brick.mesh.dispose();
    this.bricks.delete(id);
    this.persistBricks();
    this.updateHud();
  }

  setBrickColor(id, color) {
    const brick = this.bricks.get(id);
    if (!brick) {
      return;
    }
    brick.color = color;
    brick.mesh.material = this._getMaterial(color);
    this.persistBricks();
  }

  setBrickSize(id, size) {
    const brick = this.bricks.get(id);
    if (!brick) {
      return;
    }
    brick.size = { ...size };
    const base = brick.baseSize;
    brick.mesh.scaling.x = size.x / base.x;
    brick.mesh.scaling.y = size.y / base.y;
    brick.mesh.scaling.z = size.z / base.z;
    this.persistBricks();
  }

  persistBricks() {
    try {
      const data = this.getBricks().map((brick) => ({
        id: brick.id,
        color: brick.color,
        size: { ...brick.size },
        position: {
          x: brick.mesh.position.x,
          y: brick.mesh.position.y,
          z: brick.mesh.position.z,
        },
      }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('No se pudieron guardar las plataformas en localStorage', error);
    }
  }

  _update(dt) {
    if (this.editMode) {
      this.updateHud();
      return;
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_STEP) {
      this._fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    this._updateSideCamera();
    this.updateHud();
  }

  _fixedUpdate(dt) {
    const player = this.player;
    const input = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);

    player.velocity.x = input * this.moveSpeed;

    if (this.pendingJump && player.onGround) {
      player.velocity.y = this.jumpSpeed;
      player.onGround = false;
    }
    this.pendingJump = false;

    player.velocity.y += this.gravity * dt;
    player.velocity.y = clamp(player.velocity.y, this.maxFallSpeed, this.jumpSpeed * 2);

    this._integrateAxis('x', dt);
    this._integrateAxis('y', dt);

    if (player.mesh.position.y < -80) {
      copyVector3(player.mesh.position, this.spawnPoint);
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.onGround = false;
    }

    player.mesh.position.z = 0;
  }

  _integrateAxis(axis, dt) {
    const player = this.player;
    const mesh = player.mesh;
    const delta = player.velocity[axis] * dt;

    if (Math.abs(delta) < 1e-6) {
      return;
    }

    mesh.position[axis] += delta;

    let playerBounds = this._getPlayerBounds();

    let grounded = false;
    for (const brick of this.bricks.values()) {
      const brickBounds = this._getBrickBounds(brick);
      if (!this._boundsOverlap(playerBounds, brickBounds)) {
        continue;
      }

      if (axis === 'x') {
        if (delta > 0) {
          mesh.position.x = brickBounds.minX - player.half.x;
        } else {
          mesh.position.x = brickBounds.maxX + player.half.x;
        }
        player.velocity.x = 0;
        playerBounds = this._getPlayerBounds();
      } else if (axis === 'y') {
        if (delta > 0) {
          mesh.position.y = brickBounds.minY - player.half.y;
          player.velocity.y = 0;
        } else {
          mesh.position.y = brickBounds.maxY + player.half.y;
          player.velocity.y = 0;
          grounded = true;
        }
        playerBounds = this._getPlayerBounds();
      }
    }

    if (axis === 'y') {
      player.onGround = grounded;
    }
  }

  _getPlayerBounds() {
    const { mesh, half } = this.player;
    return {
      minX: mesh.position.x - half.x,
      maxX: mesh.position.x + half.x,
      minY: mesh.position.y - half.y,
      maxY: mesh.position.y + half.y,
    };
  }

  _getBrickBounds(brick) {
    const size = brick.size;
    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const pos = brick.mesh.position;
    return {
      minX: pos.x - halfX,
      maxX: pos.x + halfX,
      minY: pos.y - halfY,
      maxY: pos.y + halfY,
    };
  }

  _boundsOverlap(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }

  _updateSideCamera() {
    const pos = this.player.mesh.position;
    const halfHeight = this.orthoHeight / 2;
    const halfWidth = this.orthoWidth / 2;

    this.sideCamera.position.x = pos.x;
    this.sideCamera.position.y = pos.y;
    this.sideCamera.position.z = this.sideCameraDistance;

    this.sideCamera.orthoTop = pos.y + halfHeight;
    this.sideCamera.orthoBottom = pos.y - halfHeight;
    this.sideCamera.orthoLeft = pos.x - halfWidth;
    this.sideCamera.orthoRight = pos.x + halfWidth;
    this.sideCamera.setTarget(new BABYLON.Vector3(pos.x, pos.y, 0));
  }

  _loadBricks() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        return;
      }
      for (const entry of data) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const brick = this.createBrick({
          id: entry.id,
          size: entry.size,
          color: entry.color,
          position: entry.position,
        });
        if (brick) {
          brick.mesh.position.x = entry.position?.x ?? 0;
          brick.mesh.position.y = entry.position?.y ?? 0;
          brick.mesh.position.z = entry.position?.z ?? 0;
        }
      }
    } catch (error) {
      console.warn('No se pudieron cargar las plataformas guardadas', error);
      this.bricks.clear();
      this.brickCounter = 0;
    }
  }

  _createDefaultLevel() {
    this.bricks.clear();
    this.brickCounter = 0;

    this.createBrick({
      size: { x: 50, y: 3, z: 6 },
      position: { x: 0, y: -6, z: 0 },
      color: '#44546a',
    });
    this.createBrick({
      size: { x: 8, y: 2.5, z: 4 },
      position: { x: -12, y: 2, z: 0 },
      color: '#8ecae6',
    });
    this.createBrick({
      size: { x: 8, y: 2, z: 4 },
      position: { x: 8, y: 6, z: 0 },
      color: '#f9c74f',
    });
    this.createBrick({
      size: { x: 6, y: 2, z: 4 },
      position: { x: 20, y: 10, z: 0 },
      color: '#ff6b6b',
    });

    copyVector3(this.player.mesh.position, new BABYLON.Vector3(-20, 4, 0));
    copyVector3(this.spawnPoint, this.player.mesh.position);
    this.player.velocity.x = 0;
    this.player.velocity.y = 0;
  }

  _buildLighting() {
    const hemi = new BABYLON.HemisphericLight('hemi-light', new BABYLON.Vector3(0.3, 1, 0.3), this.scene);
    hemi.intensity = 0.9;
    hemi.groundColor = new BABYLON.Color3(0.1, 0.12, 0.16);

    const dir = new BABYLON.DirectionalLight('dir-light', new BABYLON.Vector3(-0.4, -1, -0.4), this.scene);
    dir.intensity = 0.6;
  }

  _createPlayer() {
    const mesh = BABYLON.MeshBuilder.CreateBox('player', {
      width: 1.2,
      height: 2.4,
      depth: 0.8,
    }, this.scene);
    mesh.position = new BABYLON.Vector3(-20, 4, 0);

    const material = new BABYLON.StandardMaterial('player-material', this.scene);
    material.diffuseColor = new BABYLON.Color3(0.3, 0.75, 1.0);
    material.emissiveColor = new BABYLON.Color3(0.1, 0.25, 0.4);
    material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    mesh.material = material;

    return {
      mesh,
      half: { x: 0.6, y: 1.2 },
      velocity: { x: 0, y: 0 },
      onGround: false,
    };
  }

  _getMaterial(color) {
    if (this.materials.has(color)) {
      return this.materials.get(color);
    }
    const mat = new BABYLON.StandardMaterial(`mat-${color}`, this.scene);
    const color3 = BABYLON.Color3.FromHexString(color);
    mat.diffuseColor = color3;
    mat.emissiveColor = color3.scale(0.2);
    mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    mat.backFaceCulling = true;
    this.materials.set(color, mat);
    return mat;
  }

  _computeSceneCenter() {
    if (this.bricks.size === 0) {
      return this.player.mesh.position.clone();
    }
    const accumulator = new BABYLON.Vector3(0, 0, 0);
    for (const brick of this.bricks.values()) {
      accumulator.addInPlace(brick.mesh.position);
    }
    accumulator.scaleInPlace(1 / this.bricks.size);
    return accumulator;
  }
}
