import { Player } from './player.js';
import {
  createWorld,
  step,
  loadBricks,
  serializeBricks,
} from './physics.js';

export const VIRTUAL_WIDTH = 1920;
export const VIRTUAL_HEIGHT = 1080;
const FIXED_DT = 1 / 60;
const MAX_DT = 0.02;

const VERTEX_SHADER_WITH_UNIFORM = `
struct Uniforms {
  viewport: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) pos: vec2f,
  @location(1) size: vec2f,
  @location(2) color: vec4f,
  @location(3) shape: f32,
  @location(4) rotation: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
  @location(2) shape: f32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  input: VertexInput
) -> VertexOutput {
  var output: VertexOutput;

  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
  );

  let corner = corners[vertexIndex];

  let centerOffset = corner - vec2f(0.5, 0.5);
  let cosR = cos(input.rotation);
  let sinR = sin(input.rotation);
  let rotated = vec2f(
    centerOffset.x * cosR - centerOffset.y * sinR,
    centerOffset.x * sinR + centerOffset.y * cosR
  ) + vec2f(0.5, 0.5);

  let worldPos = input.pos + rotated * input.size;

  let ndc = vec2f(
    (worldPos.x / uniforms.viewport.x) * 2.0 - 1.0,
    1.0 - (worldPos.y / uniforms.viewport.y) * 2.0
  );

  output.position = vec4f(ndc, 0.0, 1.0);
  output.color = input.color;
  output.uv = corner;
  output.shape = input.shape;
  return output;
}
`;

const FRAGMENT_SHADER = `
@fragment
fn fs_main(
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
  @location(2) shape: f32
) -> @location(0) vec4f {
  if (shape > 0.5 && shape < 1.5) {
    let center = vec2f(0.5, 0.5);
    let dist = distance(uv, center);
    if (dist > 0.5) {
      discard;
    }
  } else if (shape > 1.5) {
    let x = uv.x;
    let y = uv.y;
    if (y < 1.0 - 2.0 * x || y < 2.0 * x - 1.0) {
      discard;
    }
  }

  return color;
}
`;

export class GameRuntime {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx2d = null;
    this.device = null;
    this.pipeline = null;
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.useWebGPU = false;

    this.world = createWorld(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    this.player = new Player(100, 100);
    this.world.bodies.push(this.player);

    this.keys = {};
    this.drawables = [];
    this.accumulator = 0;
  }

  getWorld() {
    return this.world;
  }

  getPlayer() {
    return this.player;
  }

  getCanvas() {
    return this.canvas;
  }

  isUsingWebGPU() {
    return this.useWebGPU;
  }

  getMaxDelta() {
    return MAX_DT;
  }

  async initialize() {
    await this.initializeGraphics();
    this.loadPersistedBricks();
  }

  async initializeGraphics() {
    if (!('gpu' in navigator)) {
      console.log('WebGPU not available, using Canvas2D');
      this.initCanvas2D();
      return;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      this.device = await adapter.requestDevice();

      const context = this.canvas.getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device: this.device, format, alphaMode: 'opaque' });

      const shaderModule = this.device.createShaderModule({
        code: VERTEX_SHADER_WITH_UNIFORM + '\n' + FRAGMENT_SHADER,
      });

      this.uniformBuffer = this.device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: 'uniform' },
          },
        ],
      });

      this.uniformBindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.uniformBuffer },
          },
        ],
      });

      this.pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main',
          buffers: [
            {
              arrayStride: 40,
              stepMode: 'instance',
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' },
                { shaderLocation: 1, offset: 8, format: 'float32x2' },
                { shaderLocation: 2, offset: 16, format: 'float32x4' },
                { shaderLocation: 3, offset: 32, format: 'float32' },
                { shaderLocation: 4, offset: 36, format: 'float32' },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      this.useWebGPU = true;
      console.log('WebGPU initialized successfully');
    } catch (err) {
      console.warn('WebGPU init failed, using Canvas2D fallback:', err);
      this.initCanvas2D();
    }
  }

  initCanvas2D() {
    this.ctx2d = this.canvas.getContext('2d');
    this.useWebGPU = false;
  }

  handleKeyDown(event, isEditMode) {
    this.keys[event.code] = true;
    if (event.code === 'Space' && !isEditMode) {
      event.preventDefault();
    }
  }

  handleKeyUp(event) {
    this.keys[event.code] = false;
  }

  update(dt, isEditMode) {
    if (isEditMode) {
      return;
    }

    this.player.input(this.keys);

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.player.update(this.world, FIXED_DT);
      step(this.world, FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
  }

  buildDrawables(overlays = []) {
    const drawables = [];

    this.world.bodies.forEach((body) => {
      if (body === this.player) return;
      drawables.push({
        x: body.x,
        y: body.y,
        w: body.w,
        h: body.h,
        shape: body.shape || 'rect',
        color: body.color || [0.8, 0.4, 0.2, 1.0],
        rotation: body.rotation || 0,
      });
    });

    const playerDrawables = this.player.toDrawable();
    drawables.push(...playerDrawables);

    drawables.push({
      x: 0,
      y: VIRTUAL_HEIGHT - 60,
      w: VIRTUAL_WIDTH,
      h: 60,
      shape: 'rect',
      color: [0.3, 0.3, 0.3, 1.0],
      rotation: 0,
    });

    if (overlays && overlays.length) {
      drawables.push(...overlays);
    }

    this.drawables = drawables;
    return drawables;
  }

  render() {
    if (this.useWebGPU) {
      this.renderWebGPU();
    } else {
      this.renderCanvas2D();
    }
  }

  renderWebGPU() {
    if (!this.device || !this.pipeline || !this.uniformBindGroup) {
      return;
    }

    const context = this.canvas.getContext('webgpu');
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const instanceData = new Float32Array(this.drawables.length * 10);
    this.drawables.forEach((d, i) => {
      const offset = i * 10;
      const shapeId = d.shape === 'circle' ? 1 : d.shape === 'triangle' ? 2 : 0;
      instanceData[offset + 0] = d.x;
      instanceData[offset + 1] = d.y;
      instanceData[offset + 2] = d.w;
      instanceData[offset + 3] = d.h;
      instanceData[offset + 4] = d.color[0];
      instanceData[offset + 5] = d.color[1];
      instanceData[offset + 6] = d.color[2];
      instanceData[offset + 7] = d.color[3];
      instanceData[offset + 8] = shapeId;
      instanceData[offset + 9] = d.rotation || 0;
    });

    const instanceBuffer = this.device.createBuffer({
      size: instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(instanceBuffer.getMappedRange()).set(instanceData);
    instanceBuffer.unmap();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.uniformBindGroup);
    passEncoder.setVertexBuffer(0, instanceBuffer);
    passEncoder.draw(6, this.drawables.length);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
    instanceBuffer.destroy();
  }

  renderCanvas2D() {
    if (!this.ctx2d) {
      return;
    }

    const scaleX = this.canvas.width / VIRTUAL_WIDTH;
    const scaleY = this.canvas.height / VIRTUAL_HEIGHT;

    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.fillStyle = '#0d0d0d';
    this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawables.forEach((d) => {
      this.ctx2d.save();

      const x = d.x * scaleX;
      const y = d.y * scaleY;
      const w = d.w * scaleX;
      const h = d.h * scaleY;
      const cx = x + w / 2;
      const cy = y + h / 2;

      this.ctx2d.translate(cx, cy);
      this.ctx2d.rotate(d.rotation || 0);
      this.ctx2d.translate(-cx, -cy);

      this.ctx2d.fillStyle = `rgba(${d.color[0] * 255}, ${d.color[1] * 255}, ${d.color[2] * 255}, ${d.color[3]})`;

      if (d.shape === 'circle') {
        this.ctx2d.beginPath();
        this.ctx2d.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
        this.ctx2d.fill();
      } else if (d.shape === 'triangle') {
        this.ctx2d.beginPath();
        this.ctx2d.moveTo(x + w / 2, y);
        this.ctx2d.lineTo(x + w, y + h);
        this.ctx2d.lineTo(x, y + h);
        this.ctx2d.closePath();
        this.ctx2d.fill();
      } else {
        this.ctx2d.fillRect(x, y, w, h);
      }

      this.ctx2d.restore();
    });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;

    if (this.useWebGPU && this.uniformBuffer && this.device) {
      this.device.queue.writeBuffer(
        this.uniformBuffer,
        0,
        new Float32Array([VIRTUAL_WIDTH, VIRTUAL_HEIGHT])
      );
    }
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * VIRTUAL_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT;
    return { x, y };
  }

  composeHud({ dt, editMode, selectedShape, selectedRotation }) {
    const fps = dt > 0 ? (1 / dt).toFixed(0) : '0';
    const mode = editMode ? 'EDICIÓN' : 'JUEGO';
    const renderer = this.useWebGPU ? 'WebGPU' : 'Canvas2D';
    const rotInfo = editMode ? ` | Rotación: ${selectedRotation.toFixed(0)}°` : '';
    const animState = !editMode ? ` | Anim: ${this.player.animationController.currentState}` : '';
    const bricks = this.world.bricks.length;

    const statusLine = `${renderer} | FPS: ${fps} | Modo: ${mode}${animState}${rotInfo}`;
    const helpLine = editMode
      ? `Forma: ${selectedShape} | Bricks: ${bricks}`
      : `A/D: Mover | Space: Saltar | Bricks: ${bricks}`;

    return `${statusLine}\n${helpLine}`;
  }

  loadPersistedBricks() {
    const saved = localStorage.getItem('bricks');
    if (!saved) return;

    try {
      loadBricks(this.world, JSON.parse(saved));
      console.log('Loaded', this.world.bricks.length, 'bricks from storage');
    } catch (e) {
      console.error('Failed to load bricks:', e);
    }
  }

  saveBricks() {
    try {
      localStorage.setItem('bricks', JSON.stringify(serializeBricks(this.world)));
    } catch (e) {
      console.error('Failed to save bricks:', e);
    }
  }
}
