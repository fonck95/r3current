// Player con sistema de animación humanoide completo
import { AnimationController } from './animation.js';

export class Player {
  constructor(x, y) {
    // Física del player (bounding box de colisión)
    this.x = x;
    this.y = y;
    this.w = 40;
    this.h = 48;
    this.vx = 0;
    this.vy = 0;
    this.speed = 360;
    this.jumpImpulse = 720;
    this.isStatic = false;
    this.onGround = false;
    this.shape = 'rect';
    this.rotation = 0; // El player no rota, pero necesita la propiedad para colisiones
    this.id = 'player';
    
    // Sistema de salto mejorado
    this.coyoteTime = 0;
    this.coyoteMax = 0.1;
    this.jumpBuffer = 0;
    this.jumpBufferMax = 0.1;
    this.spaceWasPressed = false;
    
    // Sistema de animación
    this.animationController = new AnimationController();
    
    // Inicializar posición visual
    this.animationController.visualOffsetX = x + this.w / 2;
    this.animationController.visualOffsetY = y + this.h / 2;
  }

  input(keys) {
    // Movimiento horizontal
    let dir = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) dir -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dir += 1;
    this.vx = dir * this.speed;
    
    // Jump buffer: guardar intención de salto solo en NUEVO press
    const spacePressed = keys['Space'];
    if (spacePressed && !this.spaceWasPressed) {
      this.jumpBuffer = this.jumpBufferMax;
    }
    this.spaceWasPressed = spacePressed;
  }

  update(world, dt) {
    // Actualizar coyote time
    if (this.onGround) {
      this.coyoteTime = this.coyoteMax;
    } else {
      this.coyoteTime = Math.max(0, this.coyoteTime - dt);
    }
    
    // Consumir jump buffer si podemos saltar
    if (this.jumpBuffer > 0) {
      if (this.coyoteTime > 0) {
        this.vy = -this.jumpImpulse;
        this.coyoteTime = 0;
        this.jumpBuffer = 0;
      }
    }
    
    // Decay del jump buffer
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    
    // Actualizar sistema de animación
    this.animationController.update(this, dt);
  }

  toDrawable() {
    // Ya no retornamos un simple rectángulo, sino múltiples drawables del humanoide
    return this.animationController.toDrawables();
  }
  
  // Método opcional para debug: dibujar el bounding box de colisión
  getCollisionBox() {
    return {
      x: this.x,
      y: this.y,
      w: this.w,
      h: this.h,
      shape: 'rect',
      color: [1.0, 0.0, 0.0, 0.3], // Rojo semi-transparente
      rotation: 0
    };
  }
  
  addToWorld(world) {
    const existingIndex = world.bodies.findIndex(b => b.id === 'player');
    if (existingIndex === -1) {
      world.bodies.push(this);
    }
  }
  
  removeFromWorld(world) {
    world.bodies = world.bodies.filter(b => b.id !== 'player');
  }
}