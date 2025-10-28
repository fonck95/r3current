import { FLOOR_HEIGHT } from '../core/constants.js';

// Physics world with proper shape collisions, rotation, friction, gravity
const GRAVITY = 1800;
const FRICTION = 0.85;
const AIR_RESISTANCE = 0.995; // Damping in air
const MIN_VELOCITY = 0.1; // Threshold to stop small movements
const DEFAULT_DENSITY = 1.0; // Default density for mass calculation
const DEFAULT_RESTITUTION = 0.3; // Default bounciness (0 = no bounce, 1 = perfect bounce)
const ANGULAR_DAMPING = 0.98; // Rotational friction

export function createWorld(width, height) {
  return {
    width,
    height,
    bodies: [],
    bricks: [],
  };
}

// Calculate mass based on shape and dimensions
function calculateMass(shape, w, h, density = DEFAULT_DENSITY) {
  let area;
  switch (shape) {
    case 'circle':
      // Area of ellipse: π * (w/2) * (h/2)
      const rx = w / 2;
      const ry = h / 2;
      area = Math.PI * rx * ry;
      break;
    case 'triangle':
      // Area of triangle: (base * height) / 2
      area = (w * h) / 2;
      break;
    case 'rect':
    default:
      // Area of rectangle: width * height
      area = w * h;
      break;
  }
  return area * density;
}

export function brick(world, x, y, w, h, opts = {}) {
  const shape = opts.shape || 'rect';
  const density = opts.density || DEFAULT_DENSITY;
  const mass = opts.mass || calculateMass(shape, w, h, density);

  const body = {
    id: opts.id || `brick_${Date.now()}_${Math.random()}`,
    x, y, w, h,
    vx: 0, vy: 0,
    rotation: opts.rotation || 0,
    angularVelocity: opts.angularVelocity || 0, // Rotation speed in radians per second
    isStatic: true,
    onGround: false,
    shape: shape,
    color: opts.color || [0.8, 0.4, 0.2, 1.0],
    z: Number.isFinite(opts.z) ? Math.round(opts.z) : 0,
    mass: mass,
    invMass: mass > 0 ? 1 / mass : 0, // Inverse mass for calculations (0 for infinite mass)
    restitution: opts.restitution !== undefined ? opts.restitution : DEFAULT_RESTITUTION,
    density: density
  };
  world.bodies.push(body);
  world.bricks.push(body);
  return body;
}

export function removeBrick(world, brick) {
  world.bodies = world.bodies.filter(b => b !== brick);
  world.bricks = world.bricks.filter(b => b !== brick);
}

export function step(world, dt) {
  for (const body of world.bodies) {
    if (body.isStatic) continue;

    // Apply gravity
    body.vy += GRAVITY * dt;

    // Apply air resistance when not on ground
    if (!body.onGround) {
      body.vx *= AIR_RESISTANCE;
      body.vy *= AIR_RESISTANCE;
    }

    // Apply angular damping
    if (body.angularVelocity !== undefined) {
      body.angularVelocity *= ANGULAR_DAMPING;
      // Stop very small rotations
      if (Math.abs(body.angularVelocity) < 0.01) {
        body.angularVelocity = 0;
      }
    }

    // Store old position for collision resolution
    const oldX = body.x;
    const oldY = body.y;
    const oldRotation = body.rotation;

    // Integrate velocity
    body.x += body.vx * dt;
    body.y += body.vy * dt;

    // Integrate angular velocity
    if (body.angularVelocity !== undefined) {
      body.rotation += body.angularVelocity * dt;
      // Normalize rotation to [-PI, PI]
      while (body.rotation > Math.PI) body.rotation -= 2 * Math.PI;
      while (body.rotation < -Math.PI) body.rotation += 2 * Math.PI;
    }

    // Reset ground flag
    body.onGround = false;

    // World bounds with restitution
    if (body.x < 0) {
      body.x = 0;
      body.vx = -body.vx * body.restitution;
      if (Math.abs(body.vx) < MIN_VELOCITY) body.vx = 0;
    }
    if (body.x + body.w > world.width) {
      body.x = world.width - body.w;
      body.vx = -body.vx * body.restitution;
      if (Math.abs(body.vx) < MIN_VELOCITY) body.vx = 0;
    }

    // Floor collision with restitution
    const floorY = world.height - FLOOR_HEIGHT;
    if (body.y + body.h > floorY) {
      body.y = floorY - body.h;
      const bounceVelocity = -body.vy * body.restitution;
      // Only bounce if velocity is significant
      if (Math.abs(bounceVelocity) > MIN_VELOCITY * 2) {
        body.vy = bounceVelocity;
      } else {
        body.vy = 0;
        body.onGround = true;
        body.vx *= FRICTION;
      }
    }

    // Collision with static bodies (bricks) - increased iterations for better accuracy
    let collisionIterations = 0;
    const maxIterations = 5; // Increased from 3 to 5 for better precision

    while (collisionIterations < maxIterations) {
      let hadCollision = false;

      for (const other of world.bodies) {
        if (!other.isStatic || other === body) continue;

        const result = detectCollision(body, other);
        if (result.colliding) {
          resolveCollision(body, other, result);
          hadCollision = true;
        }
      }

      if (!hadCollision) break;
      collisionIterations++;
    }

    // Apply velocity threshold to stop jittering
    if (Math.abs(body.vx) < MIN_VELOCITY) body.vx = 0;
    if (Math.abs(body.vy) < MIN_VELOCITY && body.onGround) body.vy = 0;
  }
}

// Get vertices for any shape - MUST MATCH SHADER ROTATION EXACTLY
function getVertices(body) {
  const cos = Math.cos(body.rotation);
  const sin = Math.sin(body.rotation);
  
  // This function rotates a corner in normalized space (0-1)
  // then transforms to world space - matching the shader exactly
  const transformCorner = (cornerX, cornerY) => {
    // Rotate in normalized space around center (0.5, 0.5)
    const offsetX = cornerX - 0.5;
    const offsetY = cornerY - 0.5;
    const rotatedX = offsetX * cos - offsetY * sin;
    const rotatedY = offsetX * sin + offsetY * cos;
    const localX = rotatedX + 0.5;
    const localY = rotatedY + 0.5;
    
    // Transform to world space
    return {
      x: body.x + localX * body.w,
      y: body.y + localY * body.h
    };
  };
  
  if (body.shape === 'rect') {
    return [
      transformCorner(0, 0),
      transformCorner(1, 0),
      transformCorner(1, 1),
      transformCorner(0, 1)
    ];
  } else if (body.shape === 'triangle') {
    // Triangle with flat bottom - matches shader rendering
    return [
      transformCorner(0.5, 0),  // Top center
      transformCorner(1, 1),    // Bottom right
      transformCorner(0, 1)     // Bottom left
    ];
  }
  return [];
}

// SAT (Separating Axis Theorem) collision detection
function detectCollision(a, b) {
  // Circle-Circle
  if (a.shape === 'circle' && b.shape === 'circle') {
    return detectCircleCircle(a, b);
  }
  
  // Circle-Polygon
  if (a.shape === 'circle' && b.shape !== 'circle') {
    return detectCirclePolygon(a, b);
  }
  if (a.shape !== 'circle' && b.shape === 'circle') {
    const result = detectCirclePolygon(b, a);
    if (result.colliding) {
      // Flip normal to point toward A
      result.normal = { x: -result.normal.x, y: -result.normal.y };
    }
    return result;
  }
  
  // Polygon-Polygon (includes rect and triangle)
  return detectPolygonPolygon(a, b);
}

function detectCircleCircle(a, b) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  
  const ra = Math.min(a.w, a.h) / 2;
  const rb = Math.min(b.w, b.h) / 2;
  
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const overlap = ra + rb - dist;
  
  if (overlap > 0) {
    return {
      colliding: true,
      overlap: overlap,
      normal: dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 }
    };
  }
  
  return { colliding: false };
}

function detectCirclePolygon(circle, poly) {
  const cx = circle.x + circle.w / 2;
  const cy = circle.y + circle.h / 2;
  const r = Math.min(circle.w, circle.h) / 2;
  
  const vertices = getVertices(poly);
  if (vertices.length === 0) return { colliding: false };
  
  let minOverlap = Infinity;
  let collisionNormal = { x: 0, y: 0 };
  
  // Test polygon edges
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    
    const edgeX = v2.x - v1.x;
    const edgeY = v2.y - v1.y;
    const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
    
    const normalX = -edgeY / len;
    const normalY = edgeX / len;
    
    const result = projectCircleAndPolygon(cx, cy, r, normalX, normalY, vertices);
    
    if (!result.overlapping) {
      return { colliding: false };
    }
    
    if (result.overlap < minOverlap) {
      minOverlap = result.overlap;
      collisionNormal = { x: normalX, y: normalY };
    }
  }
  
  // Test axis from circle center to closest vertex
  let closestDist = Infinity;
  let closestVertex = null;
  
  for (const v of vertices) {
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dist = dx * dx + dy * dy;
    if (dist < closestDist) {
      closestDist = dist;
      closestVertex = v;
    }
  }
  
  if (closestVertex) {
    const dx = cx - closestVertex.x;
    const dy = cy - closestVertex.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len > 0) {
      const normalX = dx / len;
      const normalY = dy / len;
      
      const result = projectCircleAndPolygon(cx, cy, r, normalX, normalY, vertices);
      
      if (!result.overlapping) {
        return { colliding: false };
      }
      
      if (result.overlap < minOverlap) {
        minOverlap = result.overlap;
        collisionNormal = { x: normalX, y: normalY };
      }
    }
  }
  
  return {
    colliding: true,
    overlap: minOverlap,
    normal: collisionNormal
  };
}

function projectCircleAndPolygon(cx, cy, r, normalX, normalY, vertices) {
  const circleProj = cx * normalX + cy * normalY;
  const circleMin = circleProj - r;
  const circleMax = circleProj + r;
  
  let polyMin = Infinity;
  let polyMax = -Infinity;
  
  for (const v of vertices) {
    const proj = v.x * normalX + v.y * normalY;
    polyMin = Math.min(polyMin, proj);
    polyMax = Math.max(polyMax, proj);
  }
  
  if (circleMax < polyMin || polyMax < circleMin) {
    return { overlapping: false };
  }
  
  const overlap = Math.min(circleMax - polyMin, polyMax - circleMin);
  return { overlapping: true, overlap };
}

function detectPolygonPolygon(a, b) {
  const verticesA = getVertices(a);
  const verticesB = getVertices(b);
  
  if (verticesA.length === 0 || verticesB.length === 0) {
    return { colliding: false };
  }
  
  let minOverlap = Infinity;
  let collisionNormal = { x: 0, y: 0 };
  
  // Get center points to determine normal direction
  const centerA = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const centerB = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  
  // Test all axes from both polygons
  const axes = [];
  
  // Get normals from polygon A
  for (let i = 0; i < verticesA.length; i++) {
    const v1 = verticesA[i];
    const v2 = verticesA[(i + 1) % verticesA.length];
    const edgeX = v2.x - v1.x;
    const edgeY = v2.y - v1.y;
    const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
    axes.push({ x: -edgeY / len, y: edgeX / len });
  }
  
  // Get normals from polygon B
  for (let i = 0; i < verticesB.length; i++) {
    const v1 = verticesB[i];
    const v2 = verticesB[(i + 1) % verticesB.length];
    const edgeX = v2.x - v1.x;
    const edgeY = v2.y - v1.y;
    const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
    axes.push({ x: -edgeY / len, y: edgeX / len });
  }
  
  // Test each axis
  for (const axis of axes) {
    const projA = projectPolygon(verticesA, axis);
    const projB = projectPolygon(verticesB, axis);
    
    if (projA.max < projB.min || projB.max < projA.min) {
      return { colliding: false };
    }
    
    const overlap = Math.min(projA.max - projB.min, projB.max - projA.min);
    
    if (overlap < minOverlap) {
      minOverlap = overlap;
      collisionNormal = { ...axis };
    }
  }
  
  // Ensure normal points from B to A (from static to dynamic)
  const dx = centerA.x - centerB.x;
  const dy = centerA.y - centerB.y;
  const dot = dx * collisionNormal.x + dy * collisionNormal.y;
  
  if (dot < 0) {
    collisionNormal.x = -collisionNormal.x;
    collisionNormal.y = -collisionNormal.y;
  }
  
  return {
    colliding: true,
    overlap: minOverlap,
    normal: collisionNormal
  };
}

function projectPolygon(vertices, axis) {
  let min = Infinity;
  let max = -Infinity;
  
  for (const v of vertices) {
    const proj = v.x * axis.x + v.y * axis.y;
    min = Math.min(min, proj);
    max = Math.max(max, proj);
  }
  
  return { min, max };
}

function resolveCollision(body, other, result) {
  const { overlap, normal } = result;

  // Move body out of collision along normal (positional correction)
  body.x += normal.x * overlap;
  body.y += normal.y * overlap;

  // Calculate relative velocity
  const relVelX = body.vx - (other.vx || 0);
  const relVelY = body.vy - (other.vy || 0);

  // Calculate relative velocity in collision normal direction
  const velAlongNormal = relVelX * normal.x + relVelY * normal.y;

  // Do not resolve if velocities are separating
  if (velAlongNormal > 0) {
    return;
  }

  // Calculate restitution (use minimum of both bodies for more realistic behavior)
  const restitution = Math.min(body.restitution, other.restitution || body.restitution);

  // Calculate impulse scalar with mass consideration
  // For static objects (other), treat as infinite mass (invMass = 0)
  const bodyInvMass = body.invMass || 0;
  const otherInvMass = other.isStatic ? 0 : (other.invMass || 0);
  const invMassSum = bodyInvMass + otherInvMass;

  if (invMassSum === 0) {
    return; // Both objects have infinite mass
  }

  // Calculate impulse magnitude
  let impulseMagnitude = -(1 + restitution) * velAlongNormal;
  impulseMagnitude /= invMassSum;

  // Apply impulse to body
  const impulseX = impulseMagnitude * normal.x;
  const impulseY = impulseMagnitude * normal.y;

  body.vx += impulseX * bodyInvMass;
  body.vy += impulseY * bodyInvMass;

  // Apply impulse to other if not static
  if (!other.isStatic && otherInvMass > 0) {
    other.vx -= impulseX * otherInvMass;
    other.vy -= impulseY * otherInvMass;
  }

  // Determine collision type for special handling
  const isGroundCollision = normal.y < -0.3;
  const isCeilingCollision = normal.y > 0.3;
  const isWallCollision = Math.abs(normal.y) < 0.7;

  // Apply friction for ground collisions
  if (isGroundCollision) {
    body.onGround = true;

    // Tangent friction (perpendicular to normal)
    const tangentX = -normal.y;
    const tangentY = normal.x;

    const velAlongTangent = relVelX * tangentX + relVelY * tangentY;

    // Coulomb friction model
    const frictionCoefficient = FRICTION;
    const frictionMagnitude = Math.abs(velAlongTangent) * frictionCoefficient;

    const frictionImpulseX = -tangentX * frictionMagnitude * bodyInvMass;
    const frictionImpulseY = -tangentY * frictionMagnitude * bodyInvMass;

    body.vx += frictionImpulseX;
    body.vy += frictionImpulseY;

    // Clamp small velocities
    if (Math.abs(body.vx) < MIN_VELOCITY) body.vx = 0;
    if (Math.abs(body.vy) < MIN_VELOCITY) body.vy = 0;
  } else if (isCeilingCollision) {
    // Additional damping for ceiling hits
    if (body.vy < 0) {
      body.vy *= 0.5;
    }
  }

  // Calculate contact point for angular velocity effects (more advanced physics)
  if (body.angularVelocity !== undefined && !isGroundCollision) {
    // Simple torque calculation based on collision offset from center
    const centerX = body.x + body.w / 2;
    const centerY = body.y + body.h / 2;

    // Approximate contact point (center + normal * some offset)
    const contactOffsetX = normal.x * Math.min(body.w, body.h) * 0.5;
    const contactOffsetY = normal.y * Math.min(body.w, body.h) * 0.5;

    // Calculate torque (cross product of contact offset and impulse)
    const torque = contactOffsetX * impulseY - contactOffsetY * impulseX;

    // Apply angular impulse (simplified - proper implementation would use moment of inertia)
    const angularImpulse = torque / (body.mass * 100); // Scaled for gameplay
    body.angularVelocity += angularImpulse;
  }
}

export function pointInBrick(brick, px, py) {
  if (brick.shape === 'circle') {
    // For circles, transform point to local rotated space
    const localX = (px - brick.x) / brick.w;
    const localY = (py - brick.y) / brick.h;
    
    // Rotate point around center (0.5, 0.5) in opposite direction
    const cos = Math.cos(-brick.rotation);
    const sin = Math.sin(-brick.rotation);
    const offsetX = localX - 0.5;
    const offsetY = localY - 0.5;
    const rotatedX = offsetX * cos - offsetY * sin + 0.5;
    const rotatedY = offsetX * sin + offsetY * cos + 0.5;
    
    // Check if point is in unit circle
    const dx = rotatedX - 0.5;
    const dy = rotatedY - 0.5;
    return (dx * dx + dy * dy) <= 0.25; // 0.5^2
  } else if (brick.shape === 'triangle' || brick.shape === 'rect') {
    // Point-in-polygon test with rotated vertices
    const vertices = getVertices(brick);
    if (vertices.length === 0) return false;
    
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  
  return false;
}

export function serializeBricks(world) {
  return world.bricks.map(b => ({
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    shape: b.shape,
    color: b.color,
    rotation: b.rotation,
    z: typeof b.z === 'number' ? b.z : 0,
    // Include physics properties if they differ from defaults
    density: b.density !== DEFAULT_DENSITY ? b.density : undefined,
    restitution: b.restitution !== DEFAULT_RESTITUTION ? b.restitution : undefined
  }));
}

export function loadBricks(world, data) {
  if (!Array.isArray(data)) return;
  data.forEach(item => {
    if (typeof item.x === 'number' && typeof item.y === 'number' &&
        typeof item.w === 'number' && typeof item.h === 'number') {
      brick(world, item.x, item.y, item.w, item.h, {
        shape: item.shape || 'rect',
        color: item.color || [0.8, 0.4, 0.2, 1.0],
        rotation: item.rotation || 0,
        z: Number.isFinite(item.z) ? Math.round(item.z) : 0,
        density: item.density,
        restitution: item.restitution
      });
    }
  });
}