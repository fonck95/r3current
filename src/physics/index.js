import { FLOOR_HEIGHT } from '../core/constants.js';

// Physics world with proper shape collisions, rotation, friction, gravity
const GRAVITY = 1800;
const FRICTION = 0.85;
const MIN_VELOCITY = 0.1; // Threshold to stop small movements

export function createWorld(width, height) {
  return {
    width,
    height,
    bodies: [],
    bricks: [],
  };
}

export function brick(world, x, y, w, h, opts = {}) {
  const body = {
    id: opts.id || `brick_${Date.now()}_${Math.random()}`,
    x, y, w, h,
    vx: 0, vy: 0,
    rotation: opts.rotation || 0,
    isStatic: true,
    onGround: false,
    shape: opts.shape || 'rect',
    color: opts.color || [0.8, 0.4, 0.2, 1.0],
    z: Number.isFinite(opts.z) ? Math.round(opts.z) : 0
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

    // Store old position for collision resolution
    const oldX = body.x;
    const oldY = body.y;

    // Integrate velocity
    body.x += body.vx * dt;
    body.y += body.vy * dt;

    // Reset ground flag
    body.onGround = false;

    // World bounds
    if (body.x < 0) {
      body.x = 0;
      body.vx = 0;
    }
    if (body.x + body.w > world.width) {
      body.x = world.width - body.w;
      body.vx = 0;
    }

    // Floor collision
    const floorY = world.height - FLOOR_HEIGHT;
    if (body.y + body.h > floorY) {
      body.y = floorY - body.h;
      body.vy = 0;
      body.onGround = true;
      body.vx *= FRICTION;
    }

    // Collision with static bodies (bricks) - check multiple times for better resolution
    let collisionIterations = 0;
    const maxIterations = 3;
    
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
  
  // Move body out of collision along normal
  body.x += normal.x * overlap;
  body.y += normal.y * overlap;
  
  // Determine if this is a ground collision
  // Normal pointing up means we're on top of something
  const isGroundCollision = normal.y < -0.3;
  const isCeilingCollision = normal.y > 0.3;
  const isWallCollision = Math.abs(normal.y) < 0.7;
  
  if (isGroundCollision) {
    // Landing on top of platform
    body.onGround = true;
    body.vy = 0;
    body.vx *= FRICTION;
  } else if (isCeilingCollision) {
    // Hitting head on ceiling
    if (body.vy < 0) {
      body.vy = 0;
    }
  } else if (isWallCollision) {
    // Hitting a wall
    const velDot = body.vx * normal.x + body.vy * normal.y;
    if (velDot < 0) {
      body.vx -= normal.x * velDot;
      body.vy -= normal.y * velDot;
    }
  } else {
    // General collision - stop velocity in direction of normal
    const velDot = body.vx * normal.x + body.vy * normal.y;
    if (velDot < 0) {
      body.vx -= normal.x * velDot * 0.8;
      body.vy -= normal.y * velDot * 0.8;
    }
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
    z: typeof b.z === 'number' ? b.z : 0
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
        z: Number.isFinite(item.z) ? Math.round(item.z) : 0
      });
    }
  });
}