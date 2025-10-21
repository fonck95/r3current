// player.js
// Lógica específica del jugador: input, mecánicas de salto, etc.
// Hereda de Character para obtener física + animación de forma genérica

import { Character } from './character.js';

// Presets de personajes - fácilmente extensible
export const PLAYER_PRESETS = {
  default: {
    w: 40,
    h: 48,
    speed: 360,
    jumpImpulse: 720,
    appearance: {
      proportions: {
        headRadius: 0.18,
        torsoWidth: 0.36,
        torsoHeight: 0.46,
        armLength: 0.34,
        legLength: 0.48,
        limbThickness: 0.09
      },
      colors: {
        head: [0.95, 0.85, 0.75, 1.0],
        torso: [0.30, 0.50, 0.80, 1.0],
        limbs: [0.25, 0.45, 0.75, 1.0],
        accent: [0.90, 0.70, 0.30, 1.0]
      }
    },
    animation: {
      speeds: { idle: 2.0, walk: 10.0, jump: 1.0, land: 15.0, turn: 12.0 },
      squashStretch: 0.20,
      breathingAmount: 0.03,
      walkBounce: 0.15,
      armSwing: 0.40,
      interpolationSpeed: 15.0,
      visualLag: 8.0
    }
  },
  
  // Ejemplo: variante más grande y lenta
  tank: {
    w: 60,
    h: 70,
    speed: 240,
    jumpImpulse: 600,
    appearance: {
      proportions: {
        headRadius: 0.15,
        torsoWidth: 0.45,
        torsoHeight: 0.50,
        armLength: 0.30,
        legLength: 0.45,
        limbThickness: 0.12
      },
      colors: {
        head: [0.85, 0.75, 0.65, 1.0],
        torso: [0.50, 0.20, 0.20, 1.0],
        limbs: [0.45, 0.15, 0.15, 1.0],
        accent: [0.80, 0.60, 0.20, 1.0]
      }
    },
    animation: {
      speeds: { idle: 1.5, walk: 7.0, jump: 0.8, land: 12.0, turn: 8.0 },
      squashStretch: 0.25,
      breathingAmount: 0.04,
      walkBounce: 0.20,
      armSwing: 0.30,
      interpolationSpeed: 12.0,
      visualLag: 6.0
    }
  },
  
  // Ejemplo: variante ágil y pequeña
  ninja: {
    w: 30,
    h: 40,
    speed: 480,
    jumpImpulse: 840,
    appearance: {
      proportions: {
        headRadius: 0.20,
        torsoWidth: 0.32,
        torsoHeight: 0.42,
        armLength: 0.36,
        legLength: 0.50,
        limbThickness: 0.07
      },
      colors: {
        head: [0.95, 0.90, 0.80, 1.0],
        torso: [0.15, 0.15, 0.25, 1.0],
        limbs: [0.12, 0.12, 0.22, 1.0],
        accent: [0.80, 0.10, 0.10, 1.0]
      }
    },
    animation: {
      speeds: { idle: 2.5, walk: 12.0, jump: 1.2, land: 18.0, turn: 15.0 },
      squashStretch: 0.15,
      breathingAmount: 0.02,
      walkBounce: 0.10,
      armSwing: 0.50,
      interpolationSpeed: 18.0,
      visualLag: 10.0
    }
  }
};

export class Player extends Character {
  /**
   * @param {number} x - Posición inicial X
   * @param {number} y - Posición inicial Y
   * @param {string|object} preset - Nombre del preset o config custom
   */
  constructor(x, y, preset = 'default') {
    // Resolver preset
    const config = typeof preset === 'string' 
      ? PLAYER_PRESETS[preset] || PLAYER_PRESETS.default
      : preset;
    
    // Inicializar Character con la config
    super(x, y, {
      id: 'player',
      w: config.w,
      h: config.h,
      appearance: config.appearance,
      animation: config.animation
    });
    
    // Propiedades específicas del jugador
    this.speed = config.speed;
    this.jumpImpulse = config.jumpImpulse;
    
    // Mecánicas de salto mejoradas
    this.coyoteTime = 0;
    this.coyoteMax = 0.10;
    this.jumpBuffer = 0;
    this.jumpBufferMax = 0.10;
    this.spaceWasPressed = false;
  }
  
  /**
   * Procesa el input del jugador
   * @param {object} keys - Estado de las teclas
   */
  input(keys) {
    // Movimiento horizontal
    let dir = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) dir -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dir += 1;
    this.vx = dir * this.speed;
    
    // Salto con buffer
    const space = keys['Space'];
    if (space && !this.spaceWasPressed) {
      this.jumpBuffer = this.jumpBufferMax;
    }
    this.spaceWasPressed = space;
  }
  
  /**
   * Actualiza la lógica del jugador
   * @param {object} world - Mundo físico
   * @param {number} dt - Delta time
   */
  update(world, dt) {
    // Coyote time - permite saltar justo después de caer
    this.coyoteTime = this.onGround 
      ? this.coyoteMax 
      : Math.max(0, this.coyoteTime - dt);
    
    // Ejecutar salto con buffer
    if (this.jumpBuffer > 0) {
      if (this.coyoteTime > 0) {
        this.vy = -this.jumpImpulse;
        this.coyoteTime = 0;
        this.jumpBuffer = 0;
      }
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    
    // Actualizar animación (del Character base)
    super.update(world, dt);
  }
  
  /**
   * Cambia el preset del jugador en runtime
   * @param {string} presetName - Nombre del preset
   */
  changePreset(presetName) {
    const preset = PLAYER_PRESETS[presetName];
    if (!preset) {
      console.warn(`Preset '${presetName}' no encontrado`);
      return;
    }
    
    // Actualizar física
    this.w = preset.w;
    this.h = preset.h;
    this.speed = preset.speed;
    this.jumpImpulse = preset.jumpImpulse;
    
    // Actualizar apariencia
    this.setAppearance(preset.appearance);
    this.setAnimationConfig(preset.animation);
  }
  
  // Métodos de utilidad para añadir/quitar del mundo
  addToWorld(world) {
    const index = world.bodies.findIndex(b => b.id === this.id);
    if (index === -1) {
      world.bodies.push(this);
    }
  }
  
  removeFromWorld(world) {
    world.bodies = world.bodies.filter(b => b.id !== this.id);
  }
}