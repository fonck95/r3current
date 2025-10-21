// animation.js
// Sistema de animación humanoide 2D GENÉRICO y completamente desacoplado.
// 
// CARACTERÍSTICAS:
// - Trabaja en proporciones normalizadas [0..1] relativas al AABB del actor
// - Deriva píxeles automáticamente del tamaño del collision box
// - NO requiere cambios si modificas el tamaño físico del personaje
// - Se puede aplicar a CUALQUIER entidad que tenga: x, y, w, h, vx, vy, onGround
// - Soporta múltiples "skins" mediante proporciones y colores configurables

export const DEFAULT_CONFIG = {
    // Velocidades de animación (ciclos por segundo o factores de interpolación)
    speeds: {
      idle: 2.0,        // Respiración en idle
      walk: 10.0,       // Ciclo de caminata
      jump: 1.0,        // (no usado actualmente)
      land: 15.0,       // Velocidad de recuperación del squash
      turn: 12.0        // Velocidad de giro
    },
    
    // Efectos de animación
    squashStretch: 0.20,      // Cantidad de squash al aterrizar
    breathingAmount: 0.03,    // Amplitud de respiración en idle
    walkBounce: 0.15,         // Rebote al caminar
    armSwing: 0.40,           // Amplitud del swing de brazos
    
    // Suavizado
    interpolationSpeed: 15.0, // Velocidad de interpolación entre poses
    visualLag: 8.0            // Follow-through visual (retraso de la representación vs física)
  };
  
  export const DEFAULT_SPEC = {
    // Proporciones relativas al alto del AABB (bodyHeight)
    // Todos los valores son fracciones del alto total
    proportions: {
      headRadius: 0.18,      // Radio de la cabeza (~18% del alto)
      torsoWidth: 0.36,      // Ancho del torso
      torsoHeight: 0.46,     // Alto del torso
      armLength: 0.34,       // Largo de los brazos
      legLength: 0.48,       // Largo de las piernas
      limbThickness: 0.09    // Grosor base de extremidades
    },
    
    // Colores (RGBA normalizado [0..1])
    colors: {
      head: [0.95, 0.85, 0.75, 1.0],   // Color piel
      torso: [0.30, 0.50, 0.80, 1.0],  // Color cuerpo
      limbs: [0.25, 0.45, 0.75, 1.0],  // Color extremidades
      accent: [0.90, 0.70, 0.30, 1.0]  // Color de acento (no usado actualmente)
    }
  };
  
  // ======================== UTILIDADES ========================
  
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  
  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  
  /**
   * Convierte proporciones normalizadas a métricas en píxeles
   * basándose en el AABB del actor
   */
  function metricsFromAABB(centerX, centerY, aabbW, aabbH, spec) {
    const P = spec.proportions;
    const H = Math.max(1, aabbH);
    const W = Math.max(1, aabbW);
    
    return {
      baseX: centerX,
      baseY: centerY,
      bodyH: H,
      bodyW: W,
      headR: P.headRadius * H,
      torsoW: P.torsoWidth * H,
      torsoH: P.torsoHeight * H,
      armLen: P.armLength * H,
      legLen: P.legLength * H,
      limbT: P.limbThickness * H
    };
  }
  
  // ======================== BIBLIOTECA DE POSES ========================
  // Todas las poses trabajan en espacio normalizado:
  // - Origen: centro del cuerpo (baseX, baseY)
  // - Offsets en fracciones del alto del cuerpo
  // - Ángulos en radianes
  // - Y apunta hacia abajo
  
  const PoseLibrary = {
    /**
     * Pose neutral base
     */
    neutral() {
      return {
        head: { x: 0, y: -0.33, rotation: 0 },
        torso: { x: 0, y: 0.00, rotation: 0, scaleX: 1, scaleY: 1 },
        leftArm: { upper: Math.PI * 0.25, lower: -Math.PI * 0.10 },
        rightArm: { upper: Math.PI * 0.25, lower: -Math.PI * 0.10 },
        leftLeg: { upper: Math.PI * 0.50, lower: Math.PI * 0.10 },
        rightLeg: { upper: Math.PI * 0.50, lower: Math.PI * 0.10 }
      };
    },
  
    /**
     * Pose de idle con respiración
     */
    idle(t, C) {
      const breathe = Math.sin(t * C.speeds.idle) * C.breathingAmount;
      const headBob = Math.sin(t * C.speeds.idle * 0.5) * 0.01;
      
      return {
        head: {
          x: 0,
          y: -0.33 + headBob,
          rotation: breathe * 0.10
        },
        torso: {
          x: 0,
          y: breathe * 0.03,
          rotation: breathe * 0.05,
          scaleX: 1 - breathe * 0.02,
          scaleY: 1 + breathe * 0.02
        },
        leftArm: {
          upper: Math.PI * 0.25 + breathe * 0.10,
          lower: -Math.PI * 0.10
        },
        rightArm: {
          upper: Math.PI * 0.25 + breathe * 0.10,
          lower: -Math.PI * 0.10
        },
        leftLeg: { upper: Math.PI * 0.50, lower: Math.PI * 0.10 },
        rightLeg: { upper: Math.PI * 0.50, lower: Math.PI * 0.10 }
      };
    },
  
    /**
     * Pose de caminata cíclica
     */
    walk(t, dir, C) {
      const cyc = t * C.speeds.walk;
      const L = Math.sin(cyc);
      const R = Math.sin(cyc + Math.PI);
      const bounce = Math.abs(Math.sin(cyc)) * C.walkBounce;
      
      return {
        head: {
          x: 0,
          y: -0.35 - bounce * 0.05,
          rotation: Math.sin(cyc * 0.5) * 0.05
        },
        torso: {
          x: 0,
          y: -bounce * 0.06,
          rotation: Math.sin(cyc * 0.5) * 0.08,
          scaleX: 1 - bounce * 0.05,
          scaleY: 1 + bounce * 0.05
        },
        leftArm: {
          upper: Math.PI * 0.25 + L * C.armSwing,
          lower: -Math.PI * 0.10 - Math.max(0, L) * 0.30
        },
        rightArm: {
          upper: Math.PI * 0.25 + R * C.armSwing,
          lower: -Math.PI * 0.10 - Math.max(0, R) * 0.30
        },
        leftLeg: {
          upper: Math.PI * 0.50 - L * 0.40,
          lower: Math.PI * 0.10 + Math.max(0, -L) * 0.60
        },
        rightLeg: {
          upper: Math.PI * 0.50 - R * 0.40,
          lower: Math.PI * 0.10 + Math.max(0, -R) * 0.60
        }
      };
    },
  
    /**
     * Pose de despegue (inicio del salto)
     */
    jumpUp() {
      return {
        head: { x: 0, y: -0.36, rotation: 0 },
        torso: { x: 0, y: -0.04, rotation: 0, scaleX: 0.95, scaleY: 1.10 },
        leftArm: { upper: Math.PI * 0.10, lower: -Math.PI * 0.20 },
        rightArm: { upper: Math.PI * 0.10, lower: -Math.PI * 0.20 },
        leftLeg: { upper: Math.PI * 0.40, lower: -Math.PI * 0.20 },
        rightLeg: { upper: Math.PI * 0.40, lower: -Math.PI * 0.20 }
      };
    },
  
    /**
     * Pose en el punto más alto del salto
     */
    peak() {
      return {
        head: { x: 0, y: -0.34, rotation: 0 },
        torso: { x: 0, y: 0.00, rotation: 0, scaleX: 1, scaleY: 1 },
        leftArm: { upper: Math.PI * 0.15, lower: -Math.PI * 0.15 },
        rightArm: { upper: Math.PI * 0.15, lower: -Math.PI * 0.15 },
        leftLeg: { upper: Math.PI * 0.45, lower: 0 },
        rightLeg: { upper: Math.PI * 0.45, lower: 0 }
      };
    },
  
    /**
     * Pose de caída
     */
    fall() {
      return {
        head: { x: 0, y: -0.30, rotation: 0.05 },
        torso: { x: 0, y: 0.02, rotation: 0.05, scaleX: 1, scaleY: 1 },
        leftArm: { upper: Math.PI * 0.30, lower: -Math.PI * 0.05 },
        rightArm: { upper: Math.PI * 0.30, lower: -Math.PI * 0.05 },
        leftLeg: { upper: Math.PI * 0.55, lower: Math.PI * 0.05 },
        rightLeg: { upper: Math.PI * 0.55, lower: Math.PI * 0.05 }
      };
    },
  
    /**
     * Pose de aterrizaje con squash
     */
    land(squash, C) {
      return {
        head: { x: 0, y: -0.28, rotation: 0 },
        torso: {
          x: 0,
          y: 0.06,
          rotation: 0,
          scaleX: 1 + squash,
          scaleY: 1 - squash
        },
        leftArm: { upper: Math.PI * 0.35, lower: Math.PI * 0.10 },
        rightArm: { upper: Math.PI * 0.35, lower: Math.PI * 0.10 },
        leftLeg: { upper: Math.PI * 0.60, lower: Math.PI * 0.30 },
        rightLeg: { upper: Math.PI * 0.60, lower: Math.PI * 0.30 }
      };
    }
  };
  
  // ======================== ESQUELETO ========================
  
  class Skeleton {
    constructor(spec) {
      this.spec = spec;
      this.parts = PoseLibrary.neutral();
    }
  
    /**
     * Interpola suavemente hacia una pose objetivo
     */
    updateTo(pose, dt, interpSpeed) {
      const t = Math.min(1, dt * interpSpeed);
  
      // Cabeza
      this.parts.head.x = lerp(this.parts.head.x, pose.head.x, t);
      this.parts.head.y = lerp(this.parts.head.y, pose.head.y, t);
      this.parts.head.rotation = lerpAngle(this.parts.head.rotation, pose.head.rotation, t);
  
      // Torso
      this.parts.torso.x = lerp(this.parts.torso.x, pose.torso.x, t);
      this.parts.torso.y = lerp(this.parts.torso.y, pose.torso.y, t);
      this.parts.torso.rotation = lerpAngle(this.parts.torso.rotation, pose.torso.rotation, t);
      this.parts.torso.scaleX = lerp(this.parts.torso.scaleX, pose.torso.scaleX, t);
      this.parts.torso.scaleY = lerp(this.parts.torso.scaleY, pose.torso.scaleY, t);
  
      // Extremidades
      ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].forEach(k => {
        this.parts[k].upper = lerpAngle(this.parts[k].upper, pose[k].upper, t);
        this.parts[k].lower = lerpAngle(this.parts[k].lower, pose[k].lower, t);
      });
    }
  
    /**
     * Convierte el esqueleto en primitivas dibujables
     * @returns {Array} Lista de shapes para renderizar
     */
    toDrawables(metrics, facingRight, colors) {
      const d = [];
      const flip = facingRight ? 1 : -1;
      const P = this.parts;
  
      const torsoW = metrics.torsoW * P.torso.scaleX;
      const torsoH = metrics.torsoH * P.torso.scaleY;
  
      // Helpers para añadir shapes
      const addRect = (x, y, w, h, rot, color) => 
        d.push({ x, y, w, h, rotation: rot, shape: 'rect', color });
      
      const addCircle = (x, y, w, h, rot, color) => 
        d.push({ x, y, w, h, rotation: rot, shape: 'circle', color });
  
      const addLimb = (sx, sy, lengthPx, upper, lower, thick, color) => {
        const ux = sx;
        const uy = sy;
        
        // Segmento superior
        addRect(ux - thick / 2, uy - thick / 2, thick, lengthPx * 0.6, upper, color);
        
        const midX = ux + Math.cos(upper) * lengthPx * 0.6 * flip;
        const midY = uy + Math.sin(upper) * lengthPx * 0.6;
        
        // Segmento inferior
        addRect(midX - thick / 2, midY - thick / 2, thick, lengthPx * 0.4, upper + lower, color);
      };
  
      const baseX = metrics.baseX;
      const baseY = metrics.baseY;
  
      // Torso
      const torsoX = baseX + (P.torso.x * metrics.bodyH) * flip - torsoW / 2;
      const torsoY = baseY + (P.torso.y * metrics.bodyH) - torsoH / 2;
      addRect(torsoX, torsoY, torsoW, torsoH, P.torso.rotation, colors.torso);
  
      // Piernas (se dibujan primero, detrás del torso)
      const legStartY = baseY + (P.torso.y * metrics.bodyH) + (torsoH * 0.5);
      addLimb(
        baseX - (metrics.torsoW * 0.25) * flip,
        legStartY,
        metrics.legLen,
        P.leftLeg.upper,
        P.leftLeg.lower,
        metrics.limbT,
        colors.limbs
      );
      addLimb(
        baseX + (metrics.torsoW * 0.25) * flip,
        legStartY,
        metrics.legLen,
        P.rightLeg.upper,
        P.rightLeg.lower,
        metrics.limbT,
        colors.limbs
      );
  
      // Brazos
      const armStartY = baseY + (P.torso.y * metrics.bodyH) - (torsoH * 0.30);
      addLimb(
        baseX - (metrics.torsoW * 0.40) * flip,
        armStartY,
        metrics.armLen,
        P.leftArm.upper,
        P.leftArm.lower,
        metrics.limbT * 0.8,
        colors.limbs
      );
      addLimb(
        baseX + (metrics.torsoW * 0.40) * flip,
        armStartY,
        metrics.armLen,
        P.rightArm.upper,
        P.rightArm.lower,
        metrics.limbT * 0.8,
        colors.limbs
      );
  
      // Cabeza
      const headX = baseX + (P.head.x * metrics.bodyH) * flip - metrics.headR;
      const headY = baseY + (P.head.y * metrics.bodyH) - metrics.torsoH * 0.5 - metrics.headR;
      addCircle(headX, headY, metrics.headR * 2, metrics.headR * 2, P.head.rotation, colors.head);
  
      // Ojos simples
      const eyeSize = Math.max(1, metrics.headR * 0.22);
      const eyeOffsetX = metrics.headR * 0.35;
      const eyeOffsetY = metrics.headR * 0.20;
      addCircle(
        headX + metrics.headR - eyeOffsetX * flip - eyeSize / 2,
        headY + eyeOffsetY,
        eyeSize,
        eyeSize,
        0,
        [0.1, 0.1, 0.1, 1.0]
      );
      addCircle(
        headX + metrics.headR + eyeOffsetX * flip - eyeSize / 2,
        headY + eyeOffsetY,
        eyeSize,
        eyeSize,
        0,
        [0.1, 0.1, 0.1, 1.0]
      );
  
      return d;
    }
  }
  
  // ======================== CONTROLADOR DE ANIMACIÓN ========================
  
  export class AnimationController {
    /**
     * Sistema de animación genérico que se puede aplicar a cualquier entidad
     * @param {object} options
     *   - spec: { proportions, colors }
     *   - config: { speeds, squashStretch, etc }
     */
    constructor({ spec = DEFAULT_SPEC, config = DEFAULT_CONFIG } = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.spec = {
        proportions: { ...DEFAULT_SPEC.proportions, ...(spec?.proportions || {}) },
        colors: { ...DEFAULT_SPEC.colors, ...(spec?.colors || {}) }
      };
  
      // Estado de la animación
      this.currentState = 'idle';
      this.previousState = 'idle';
      this.stateTime = 0;
      this.totalTime = 0;
      this.skeleton = new Skeleton(this.spec);
  
      // Efectos
      this.landSquash = 0;
      this.landDecay = this.config.speeds.land;
  
      // Dirección y giro
      this.facingRight = true;
      this.turnProgress = 0;
  
      // Follow-through visual (suaviza movimientos bruscos)
      this.visualX = 0;
      this.visualY = 0;
      this._lastMetrics = null;
    }
  
    /**
     * Determina el estado de animación basándose en el estado físico del actor
     * @private
     */
    _determineState(actor) {
      const airborne = !actor.onGround;
      const wasAir = ['jump_up', 'peak', 'fall'].includes(this.previousState);
  
      // Detectar aterrizaje
      if (wasAir && actor.onGround && this.currentState !== 'land') {
        this.landSquash = this.config.squashStretch;
        this.landDecay = this.config.speeds.land;
        return 'land';
      }
  
      // Mantener animación de aterrizaje brevemente
      if (this.currentState === 'land' && this.stateTime < 0.15) {
        return 'land';
      }
  
      // Estados en el aire
      if (airborne) {
        if (actor.vy < -100) return 'jump_up';
        if (actor.vy < 100) return 'peak';
        return 'fall';
      }
  
      // Estados en el suelo
      if (Math.abs(actor.vx) > 10) return 'walk';
      return 'idle';
    }
  
    /**
     * Actualiza el estado de la animación basándose en el actor
     * El actor debe tener: x, y, w, h, vx, vy, onGround
     */
    update(actor, dt) {
      this.totalTime += dt;
  
      // Transición de estados
      const nextState = this._determineState(actor);
      if (nextState !== this.currentState) {
        this.previousState = this.currentState;
        this.currentState = nextState;
        this.stateTime = 0;
      } else {
        this.stateTime += dt;
      }
  
      // Dirección con giro suave
      const targetFacing = actor.vx > 0 ? true : (actor.vx < 0 ? false : this.facingRight);
      if (targetFacing !== this.facingRight) {
        this.turnProgress = Math.min(1, this.turnProgress + dt * this.config.speeds.turn);
        if (this.turnProgress >= 1) {
          this.facingRight = targetFacing;
          this.turnProgress = 0;
        }
      } else {
        this.turnProgress = 0;
      }
  
      // Decaimiento del squash
      if (this.landSquash > 0) {
        this.landSquash = Math.max(0, this.landSquash - dt * this.landDecay);
      }
  
      // Seleccionar pose objetivo según el estado
      let targetPose;
      switch (this.currentState) {
        case 'idle':
          targetPose = PoseLibrary.idle(this.totalTime, this.config);
          break;
        case 'walk':
          targetPose = PoseLibrary.walk(this.totalTime, this.facingRight ? 1 : -1, this.config);
          break;
        case 'jump_up':
          targetPose = PoseLibrary.jumpUp();
          break;
        case 'peak':
          targetPose = PoseLibrary.peak();
          break;
        case 'fall':
          targetPose = PoseLibrary.fall();
          break;
        case 'land':
          targetPose = PoseLibrary.land(this.landSquash, this.config);
          break;
        default:
          targetPose = PoseLibrary.neutral();
      }
  
      // Interpolar hacia la pose objetivo
      this.skeleton.updateTo(targetPose, dt, this.config.interpolationSpeed);
  
      // Follow-through visual (centro del AABB del actor)
      const cx = actor.x + actor.w * 0.5;
      const cy = actor.y + actor.h * 0.5;
      this.visualX = lerp(this.visualX, cx, dt * this.config.visualLag);
      this.visualY = lerp(this.visualY, cy, dt * this.config.visualLag);
  
      // Calcular métricas en píxeles para este frame
      this._lastMetrics = metricsFromAABB(
        this.visualX,
        this.visualY,
        actor.w,
        actor.h,
        this.spec
      );
    }
  
    /**
     * Retorna los primitivos dibujables para renderizar
     * @returns {Array} Lista de shapes
     */
    toDrawables() {
      if (!this._lastMetrics) return [];
      return this.skeleton.toDrawables(
        this._lastMetrics,
        this.facingRight,
        this.spec.colors
      );
    }
  }