import { Player } from './player.js';
import { createWorld, brick, removeBrick, step, serializeBricks, loadBricks, pointInBrick } from './physics.js';

// WGSL Shaders with rotation support
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
  
  // Apply rotation around center
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
  // shape: 0=rect, 1=circle, 2=triangle
  
  if (shape > 0.5 && shape < 1.5) {
    // Circle
    let center = vec2f(0.5, 0.5);
    let dist = distance(uv, center);
    if (dist > 0.5) {
      discard;
    }
  } else if (shape > 1.5) {
    // Triangle (pointing UP with flat bottom)
    // Vertices: (0.5, 0) top, (0, 1) bottom-left, (1, 1) bottom-right
    let x = uv.x;
    let y = uv.y;
    
    // Left edge: from (0, 1) to (0.5, 0) -> y = 1 - 2x
    // Right edge: from (1, 1) to (0.5, 0) -> y = 2x - 1
    // Discard if outside these boundaries
    if (y < 1.0 - 2.0 * x || y < 2.0 * x - 1.0) {
      discard;
    }
  }
  
  return color;
}
`;

// Global state
let canvas, ctx2d, device, pipeline, uniformBuffer, uniformBindGroup;
let useWebGPU = false;
let world, player;
let keys = {};
let drawables = [];
let lastTime = 0;
let accumulator = 0;
const FIXED_DT = 1 / 60;
const MAX_DT = 0.02;

// Editor state
let editMode = false;
let selectedShape = 'rect';
let selectedColor = [0.8, 0.4, 0.2, 1.0];
let selectedRotation = 0; // In degrees
let ghostBrick = null;
let dragStart = null;
let draggedBrick = null;
let hoverBrick = null;
let selectedBrick = null;
let panelVisible = false;

// Virtual viewport
const VIRTUAL_WIDTH = 1920;
const VIRTUAL_HEIGHT = 1080;

// Color palette
const COLORS = [
  [0.9, 0.3, 0.3, 1.0], // Red
  [0.3, 0.9, 0.3, 1.0], // Green
  [0.3, 0.3, 0.9, 1.0], // Blue
  [0.9, 0.9, 0.3, 1.0], // Yellow
  [0.9, 0.3, 0.9, 1.0], // Magenta
  [0.3, 0.9, 0.9, 1.0], // Cyan
  [0.9, 0.6, 0.3, 1.0], // Orange
  [0.6, 0.3, 0.9, 1.0], // Purple
  [0.9, 0.9, 0.9, 1.0], // White
  [0.5, 0.5, 0.5, 1.0], // Gray
];

// Init
async function init() {
  canvas = document.getElementById('gfx');
  
  // Try WebGPU
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      device = await adapter.requestDevice();
      
      const context = canvas.getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'opaque' });
      
      const shaderModule = device.createShaderModule({ 
        code: VERTEX_SHADER_WITH_UNIFORM + '\n' + FRAGMENT_SHADER 
      });
      
      uniformBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' }
        }]
      });
      
      uniformBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer: uniformBuffer }
        }]
      });
      
      pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main',
          buffers: [{
            arrayStride: 40,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
              { shaderLocation: 3, offset: 32, format: 'float32' },
              { shaderLocation: 4, offset: 36, format: 'float32' },
            ]
          }]
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' }
      });
      
      useWebGPU = true;
      console.log('WebGPU initialized successfully');
    } catch (err) {
      console.warn('WebGPU init failed, using Canvas2D fallback:', err);
      initCanvas2D();
    }
  } else {
    console.log('WebGPU not available, using Canvas2D');
    initCanvas2D();
  }
  
  // Physics world
  world = createWorld(VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  player = new Player(100, 100);
  world.bodies.push(player);
  
  // Load persisted bricks
  const saved = localStorage.getItem('bricks');
  if (saved) {
    try {
      loadBricks(world, JSON.parse(saved));
      console.log('Loaded', world.bricks.length, 'bricks from storage');
    } catch (e) {
      console.error('Failed to load bricks:', e);
    }
  }
  
  // Setup UI
  setupUI();
  
  // Input
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space' && !editMode) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  
  // Pointer events
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  
  // Wheel for rotation
  canvas.addEventListener('wheel', onWheel, { passive: false });
  
  // Resize
  window.addEventListener('resize', resize);
  resize();
  
  // Start loop
  requestAnimationFrame(loop);
}

function initCanvas2D() {
  ctx2d = canvas.getContext('2d');
  useWebGPU = false;
}

function setupUI() {
  // Toggle panel button
  document.getElementById('toggle-panel-btn').addEventListener('click', () => {
    panelVisible = !panelVisible;
    const panel = document.getElementById('editor-panel');
    panel.classList.toggle('hidden', !panelVisible);
  });
  
  // Color palette
  const palette = document.getElementById('color-palette');
  COLORS.forEach((color, i) => {
    const btn = document.createElement('div');
    btn.className = 'color-btn' + (i === 0 ? ' active' : '');
    btn.style.background = `rgb(${color[0]*255}, ${color[1]*255}, ${color[2]*255})`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedColor = color;
    });
    palette.appendChild(btn);
  });
  
  // Shape buttons
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedShape = btn.dataset.shape;
    });
  });
  
  // Rotation slider
  const rotationSlider = document.getElementById('rotation-slider');
  const rotationValue = document.getElementById('rotation-value');
  rotationSlider.addEventListener('input', (e) => {
    selectedRotation = parseFloat(e.target.value);
    rotationValue.textContent = selectedRotation + '°';
  });
  
  // Rotation preset buttons
  document.querySelectorAll('.rotation-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const angle = parseFloat(btn.dataset.angle);
      selectedRotation = angle;
      rotationSlider.value = angle;
      rotationValue.textContent = angle + '°';
    });
  });
  
  // Toggle edit mode
  document.getElementById('toggle-edit').addEventListener('click', () => {
    editMode = !editMode;
    const btn = document.getElementById('toggle-edit');
    btn.textContent = editMode ? '✅ Edición Activa' : '🔧 Activar Edición';
    btn.classList.toggle('active', editMode);
    canvas.classList.toggle('edit-mode', editMode);
    
    // Clear selection when toggling edit mode
    if (!editMode) {
      selectedBrick = null;
      updateDeleteButton();
    }
  });
  
  // Clear all
  document.getElementById('clear-all').addEventListener('click', () => {
    if (confirm('¿Eliminar todos los bricks?')) {
      world.bricks.forEach(b => removeBrick(world, b));
      selectedBrick = null;
      updateDeleteButton();
      saveBricks();
    }
  });
  
  // Delete selected brick button
  document.getElementById('delete-selected').addEventListener('click', () => {
    if (selectedBrick) {
      removeBrick(world, selectedBrick);
      selectedBrick = null;
      updateDeleteButton();
      saveBricks();
    }
  });
}

function updateDeleteButton() {
  const deleteBtn = document.getElementById('delete-selected');
  if (selectedBrick) {
    deleteBtn.classList.add('visible');
    deleteBtn.style.opacity = '1';
  } else {
    deleteBtn.classList.remove('visible');
    deleteBtn.style.opacity = '0';
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  
  if (useWebGPU && uniformBuffer) {
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([VIRTUAL_WIDTH, VIRTUAL_HEIGHT]));
  }
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * VIRTUAL_WIDTH;
  const y = ((clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT;
  return { x, y };
}

function findBrickAtPoint(x, y) {
  for (let i = world.bricks.length - 1; i >= 0; i--) {
    if (pointInBrick(world.bricks[i], x, y)) {
      return world.bricks[i];
    }
  }
  return null;
}

function onWheel(e) {
  if (editMode && (draggedBrick || hoverBrick)) {
    e.preventDefault();
    const target = draggedBrick || hoverBrick;
    const delta = e.deltaY > 0 ? -15 : 15;
    target.rotation = (target.rotation + delta * Math.PI / 180) % (2 * Math.PI);
    if (target.rotation < 0) target.rotation += 2 * Math.PI;
    
    if (draggedBrick) {
      saveBricks();
    }
  }
}

function onPointerDown(e) {
  const pos = screenToWorld(e.clientX, e.clientY);
  const clickedBrick = findBrickAtPoint(pos.x, pos.y);
  
  if (editMode) {
    if (clickedBrick) {
      if (e.shiftKey) {
        // Change color
        clickedBrick.color = [...selectedColor];
        saveBricks();
      } else if (e.ctrlKey || e.metaKey) {
        // Copy rotation
        selectedRotation = clickedBrick.rotation * 180 / Math.PI;
        document.getElementById('rotation-slider').value = selectedRotation;
        document.getElementById('rotation-value').textContent = selectedRotation.toFixed(0) + '°';
      } else {
        // Select and start dragging
        selectedBrick = clickedBrick;
        draggedBrick = clickedBrick;
        dragStart = { x: pos.x - clickedBrick.x, y: pos.y - clickedBrick.y };
        updateDeleteButton();
      }
    } else {
      // Deselect when clicking empty space
      selectedBrick = null;
      updateDeleteButton();
      
      // Start creating new brick
      dragStart = pos;
      ghostBrick = { 
        x: pos.x, 
        y: pos.y, 
        w: 0, 
        h: 0, 
        shape: selectedShape, 
        color: selectedColor,
        rotation: selectedRotation * Math.PI / 180
      };
    }
  }
}

function onPointerMove(e) {
  const pos = screenToWorld(e.clientX, e.clientY);
  
  if (editMode) {
    hoverBrick = findBrickAtPoint(pos.x, pos.y);
    const hint = document.getElementById('delete-hint');
    if (hoverBrick) {
      hint.textContent = 'Click: Eliminar | Shift+Click: Color | Ctrl+Click: Copiar rotación | Rueda: Rotar';
      hint.classList.add('show');
    } else {
      hint.classList.remove('show');
    }
    
    if (draggedBrick && dragStart) {
      draggedBrick.x = pos.x - dragStart.x;
      draggedBrick.y = pos.y - dragStart.y;
    } else if (dragStart && ghostBrick) {
      const minX = Math.min(dragStart.x, pos.x);
      const minY = Math.min(dragStart.y, pos.y);
      const w = Math.abs(pos.x - dragStart.x);
      const h = Math.abs(pos.y - dragStart.y);
      ghostBrick = { 
        x: minX, 
        y: minY, 
        w, 
        h, 
        shape: selectedShape, 
        color: selectedColor,
        rotation: selectedRotation * Math.PI / 180
      };
    }
  }
}

function onPointerUp(e) {
  const pos = screenToWorld(e.clientX, e.clientY);
  
  if (editMode) {
    if (draggedBrick) {
      // Finish dragging
      saveBricks();
      draggedBrick = null;
      dragStart = null;
    } else if (dragStart && ghostBrick) {
      // Create new brick if dragged enough
      if (ghostBrick.w > 10 && ghostBrick.h > 10) {
        brick(world, ghostBrick.x, ghostBrick.y, ghostBrick.w, ghostBrick.h, {
          shape: selectedShape,
          color: [...selectedColor],
          rotation: selectedRotation * Math.PI / 180
        });
        saveBricks();
      }
      
      dragStart = null;
      ghostBrick = null;
    }
  }
}

function saveBricks() {
  try {
    localStorage.setItem('bricks', JSON.stringify(serializeBricks(world)));
  } catch (e) {
    console.error('Failed to save bricks:', e);
  }
}

function loop(time) {
  requestAnimationFrame(loop);
  
  const dt = Math.min((time - lastTime) / 1000, MAX_DT);
  lastTime = time;
  
  // Update
  if (!editMode) {
    player.input(keys);
    
    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      player.update(world, FIXED_DT);
      step(world, FIXED_DT);
      accumulator -= FIXED_DT;
    }
  }
  
  // Render
  drawables = world.bodies.map(b => {
    if (b === player) return player.toDrawable();
    return {
      x: b.x, y: b.y, w: b.w, h: b.h,
      shape: b.shape || 'rect',
      color: b.color || [0.8, 0.4, 0.2, 1.0],
      rotation: b.rotation || 0
    };
  });
  
  // Floor
  drawables.push({
    x: 0,
    y: VIRTUAL_HEIGHT - 60,
    w: VIRTUAL_WIDTH,
    h: 60,
    shape: 'rect',
    color: [0.3, 0.3, 0.3, 1.0],
    rotation: 0
  });
  
  // Ghost brick
  if (ghostBrick && ghostBrick.w > 0 && ghostBrick.h > 0) {
    drawables.push({
      x: ghostBrick.x,
      y: ghostBrick.y,
      w: ghostBrick.w,
      h: ghostBrick.h,
      shape: ghostBrick.shape,
      color: [...ghostBrick.color.slice(0, 3), 0.4],
      rotation: ghostBrick.rotation
    });
  }
  
  // Highlight hovered brick
  if (hoverBrick && editMode && !draggedBrick && hoverBrick !== selectedBrick) {
    drawables.push({
      x: hoverBrick.x - 2,
      y: hoverBrick.y - 2,
      w: hoverBrick.w + 4,
      h: hoverBrick.h + 4,
      shape: 'rect',
      color: [1, 1, 1, 0.3],
      rotation: hoverBrick.rotation
    });
  }
  
  // Highlight selected brick with thicker border
  if (selectedBrick && editMode) {
    drawables.push({
      x: selectedBrick.x - 4,
      y: selectedBrick.y - 4,
      w: selectedBrick.w + 8,
      h: selectedBrick.h + 8,
      shape: 'rect',
      color: [0.3, 0.8, 1.0, 0.6],
      rotation: 0
    });
  }
  
  if (useWebGPU) {
    renderWebGPU();
  } else {
    renderCanvas2D();
  }
  
  // HUD
  const fps = (1 / dt).toFixed(0);
  const mode = editMode ? 'EDICIÓN' : 'JUEGO';
  const renderer = useWebGPU ? 'WebGPU' : 'Canvas2D';
  const rotInfo = editMode ? ` | Rotación: ${selectedRotation.toFixed(0)}°` : '';
  document.getElementById('hud').textContent = 
    `${renderer} | FPS: ${fps} | Modo: ${mode}${rotInfo}\n` +
    (editMode ? `Forma: ${selectedShape} | Bricks: ${world.bricks.length}` : 
     `A/D: Mover | Space: Saltar | Bricks: ${world.bricks.length}`);
}

function renderWebGPU() {
  const context = canvas.getContext('webgpu');
  const commandEncoder = device.createCommandEncoder();
  const textureView = context.getCurrentTexture().createView();
  
  const instanceData = new Float32Array(drawables.length * 10);
  drawables.forEach((d, i) => {
    const offset = i * 10;
    const shapeId = d.shape === 'circle' ? 1 : (d.shape === 'triangle' ? 2 : 0);
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
  
  const instanceBuffer = device.createBuffer({
    size: instanceData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Float32Array(instanceBuffer.getMappedRange()).set(instanceData);
  instanceBuffer.unmap();
  
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: textureView,
      clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  });
  
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, uniformBindGroup);
  passEncoder.setVertexBuffer(0, instanceBuffer);
  passEncoder.draw(6, drawables.length);
  passEncoder.end();
  
  device.queue.submit([commandEncoder.finish()]);
  instanceBuffer.destroy();
}

function renderCanvas2D() {
  const scaleX = canvas.width / VIRTUAL_WIDTH;
  const scaleY = canvas.height / VIRTUAL_HEIGHT;
  
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillStyle = '#0d0d0d';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  
  drawables.forEach(d => {
    ctx2d.save();
    
    const x = d.x * scaleX;
    const y = d.y * scaleY;
    const w = d.w * scaleX;
    const h = d.h * scaleY;
    const cx = x + w / 2;
    const cy = y + h / 2;
    
    // Apply rotation
    ctx2d.translate(cx, cy);
    ctx2d.rotate(d.rotation || 0);
    ctx2d.translate(-cx, -cy);
    
    ctx2d.fillStyle = `rgba(${d.color[0]*255}, ${d.color[1]*255}, ${d.color[2]*255}, ${d.color[3]})`;
    
    if (d.shape === 'circle') {
      ctx2d.beginPath();
      ctx2d.ellipse(cx, cy, w/2, h/2, 0, 0, Math.PI * 2);
      ctx2d.fill();
    } else if (d.shape === 'triangle') {
      ctx2d.beginPath();
      ctx2d.moveTo(x + w/2, y);
      ctx2d.lineTo(x + w, y + h);
      ctx2d.lineTo(x, y + h);
      ctx2d.closePath();
      ctx2d.fill();
    } else {
      ctx2d.fillRect(x, y, w, h);
    }
    
    ctx2d.restore();
  });
}

init();