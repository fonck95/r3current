// character.js
// Clase base para cualquier entidad animada en el juego
// Separa la física de la representación visual

import { AnimationController, DEFAULT_SPEC, DEFAULT_CONFIG } from './animation.js';

export class Character {
  /**
   * Clase base para entidades físicas con animación
   * @param {number} x - Posición X inicial
   * @param {number} y - Posición Y inicial  
   * @param {object} options - Configuración
   *   - w, h: Dimensiones del collision box
   *   - appearance: { proportions, colors } para AnimationController
   *   - animation: config de animación (speeds, squash, etc)
   */
  constructor(x, y, options = {}) {
    // Propiedades físicas (collision box / AABB)
    this.x = x;
    this.y = y;
    this.w = options.w || 40;
    this.h = options.h || 48;

    // Velocidad
    this.vx = 0;
    this.vy = 0;

    // Propiedades físicas para el motor
    this.isStatic = false;
    this.onGround = false;
    this.shape = 'rect';
    this.rotation = 0;
    this.angularVelocity = 0; // Velocidad angular en radianes/segundo
    this.id = options.id || `character_${Date.now()}`;

    // Propiedades físicas realistas
    const density = options.density !== undefined ? options.density : 1.0;
    const area = this.w * this.h; // Área del rectángulo de colisión
    this.mass = options.mass !== undefined ? options.mass : area * density;
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.restitution = options.restitution !== undefined ? options.restitution : 0.2; // Personajes rebotan poco
    this.density = density;

    // Sistema de animación (completamente desacoplado del tamaño físico)
    const animSpec = {
      proportions: { ...DEFAULT_SPEC.proportions, ...(options.appearance?.proportions || {}) },
      colors: { ...DEFAULT_SPEC.colors, ...(options.appearance?.colors || {}) }
    };
    const animConfig = { ...DEFAULT_CONFIG, ...(options.animation || {}) };

    this.animationController = new AnimationController({
      spec: animSpec,
      config: animConfig
    });

    // Inicializar posición visual
    this.animationController.visualX = x + this.w * 0.5;
    this.animationController.visualY = y + this.h * 0.5;
  }
  
  /**
   * Actualiza el estado físico y la animación
   * Las subclases deben llamar super.update() después de modificar vx/vy/onGround
   */
  update(world, dt) {
    // Actualizar animación basada en el estado físico actual
    this.animationController.update(this, dt);
  }
  
  /**
   * Retorna los drawables para renderizar
   * Este es el único método que la subclase necesita para rendering
   */
  toDrawable() {
    return this.animationController.toDrawables();
  }
  
  /**
   * Cambia la apariencia del personaje en runtime
   */
  setAppearance(appearance) {
    if (appearance.proportions || appearance.colors) {
      const newSpec = {
        proportions: { ...this.animationController.spec.proportions, ...(appearance.proportions || {}) },
        colors: { ...this.animationController.spec.colors, ...(appearance.colors || {}) }
      };
      this.animationController.spec = newSpec;
    }
  }
  
  /**
   * Cambia la configuración de animación en runtime
   */
  setAnimationConfig(config) {
    this.animationController.config = { ...this.animationController.config, ...config };
  }
  
  /**
   * Helper para debug - muestra el collision box
   */
  getCollisionBox() {
    return {
      x: this.x,
      y: this.y,
      w: this.w,
      h: this.h,
      shape: 'rect',
      color: [1, 0, 0, 0.3],
      rotation: 0
    };
  }
}