// Sistema de animación para personaje humanoide 2D con fluidez estilo Hollow Knight

// ============================================================================
// CONFIGURACIÓN AJUSTABLE
// ============================================================================

export const ANIMATION_CONFIG = {
  // Velocidades de animación (mayor = más rápido)
  speeds: {
    idle: 2.0,      // Respiración sutil
    walk: 10.0,     // Ciclo de caminata
    jump: 1.0,      // Transiciones de salto
    land: 15.0,     // Aterrizaje rápido
    turn: 12.0      // Giro rápido
  },
  
  // Intensidad de efectos
  squashStretch: 0.2,      // 20% de deformación máxima
  breathingAmount: 0.03,   // 3% de movimiento en idle
  walkBounce: 0.15,        // Rebote al caminar
  armSwing: 0.4,           // Balanceo de brazos
  
  // Suavizado de interpolación (mayor = más suave pero más lento)
  interpolationSpeed: 15.0,
  visualLag: 8.0,          // Lag visual para follow-through
  
  // Colores del personaje
  colors: {
    head: [0.95, 0.85, 0.75, 1.0],      // Piel clara
    torso: [0.3, 0.5, 0.8, 1.0],        // Azul (cuerpo)
    limbs: [0.25, 0.45, 0.75, 1.0],     // Azul oscuro (extremidades)
    accent: [0.9, 0.7, 0.3, 1.0]        // Dorado (detalles)
  }
};

// ============================================================================
// ESQUELETO - Define la estructura del personaje
// ============================================================================

export class Skeleton {
  constructor() {
    // Proporciones del personaje (en píxeles relativos)
    this.proportions = {
      headRadius: 7,
      torsoWidth: 14,
      torsoHeight: 18,
      armLength: 12,
      legLength: 16,
      limbThickness: 4
    };
    
    // Posiciones actuales de cada parte (se actualizan con animación)
    this.parts = {
      head: { x: 0, y: 0, rotation: 0 },
      torso: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      leftArm: { upper: 0, lower: 0 },   // Ángulos de rotación
      rightArm: { upper: 0, lower: 0 },
      leftLeg: { upper: 0, lower: 0 },
      rightLeg: { upper: 0, lower: 0 }
    };
  }
  
  // Actualizar todas las partes basándose en una pose objetivo
  updateFromPose(pose, dt, speed) {
    const factor = Math.min(1, dt * speed);
    
    // Interpolar cabeza
    this.parts.head.x = lerp(this.parts.head.x, pose.head.x, factor);
    this.parts.head.y = lerp(this.parts.head.y, pose.head.y, factor);
    this.parts.head.rotation = lerpAngle(this.parts.head.rotation, pose.head.rotation, factor);
    
    // Interpolar torso
    this.parts.torso.x = lerp(this.parts.torso.x, pose.torso.x, factor);
    this.parts.torso.y = lerp(this.parts.torso.y, pose.torso.y, factor);
    this.parts.torso.rotation = lerpAngle(this.parts.torso.rotation, pose.torso.rotation, factor);
    this.parts.torso.scaleX = lerp(this.parts.torso.scaleX, pose.torso.scaleX, factor);
    this.parts.torso.scaleY = lerp(this.parts.torso.scaleY, pose.torso.scaleY, factor);
    
    // Interpolar extremidades
    ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].forEach(limb => {
      this.parts[limb].upper = lerpAngle(this.parts[limb].upper, pose[limb].upper, factor);
      this.parts[limb].lower = lerpAngle(this.parts[limb].lower, pose[limb].lower, factor);
    });
  }
}

// ============================================================================
// POSES - Define las poses para cada estado de animación
// ============================================================================

export class PoseLibrary {
  // Pose neutral de referencia
  static getNeutralPose() {
    return {
      head: { x: 0, y: -10, rotation: 0 },
      torso: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      leftArm: { upper: Math.PI * 0.25, lower: -Math.PI * 0.1 },
      rightArm: { upper: Math.PI * 0.25, lower: -Math.PI * 0.1 },
      leftLeg: { upper: Math.PI * 0.5, lower: Math.PI * 0.1 },
      rightLeg: { upper: Math.PI * 0.5, lower: Math.PI * 0.1 }
    };
  }
  
  // IDLE - Respiración sutil
  static getIdlePose(time) {
    const breathe = Math.sin(time * ANIMATION_CONFIG.speeds.idle) * ANIMATION_CONFIG.breathingAmount;
    const headBob = Math.sin(time * ANIMATION_CONFIG.speeds.idle * 0.5) * 0.5;
    
    return {
      head: { x: 0, y: -10 + headBob, rotation: breathe * 0.1 },
      torso: { 
        x: 0, 
        y: breathe * 2, 
        rotation: breathe * 0.05, 
        scaleX: 1 - breathe * 0.02, 
        scaleY: 1 + breathe * 0.02 
      },
      leftArm: { upper: Math.PI * 0.25 + breathe * 0.1, lower: -Math.PI * 0.1 },
      rightArm: { upper: Math.PI * 0.25 + breathe * 0.1, lower: -Math.PI * 0.1 },
      leftLeg: { upper: Math.PI * 0.5, lower: Math.PI * 0.1 },
      rightLeg: { upper: Math.PI * 0.5, lower: Math.PI * 0.1 }
    };
  }
  
  // WALK - Ciclo de caminata
  static getWalkPose(time, direction) {
    const cycle = time * ANIMATION_CONFIG.speeds.walk;
    const leftPhase = Math.sin(cycle);
    const rightPhase = Math.sin(cycle + Math.PI);
    const bounce = Math.abs(Math.sin(cycle)) * ANIMATION_CONFIG.walkBounce;
    
    return {
      head: { 
        x: 0, 
        y: -10 - bounce * 2, 
        rotation: Math.sin(cycle * 0.5) * 0.05 
      },
      torso: { 
        x: 0, 
        y: -bounce * 3, 
        rotation: Math.sin(cycle * 0.5) * 0.08,
        scaleX: 1 - bounce * 0.05,
        scaleY: 1 + bounce * 0.05
      },
      leftArm: { 
        upper: Math.PI * 0.25 + leftPhase * ANIMATION_CONFIG.armSwing, 
        lower: -Math.PI * 0.1 - Math.max(0, leftPhase) * 0.3 
      },
      rightArm: { 
        upper: Math.PI * 0.25 + rightPhase * ANIMATION_CONFIG.armSwing, 
        lower: -Math.PI * 0.1 - Math.max(0, rightPhase) * 0.3 
      },
      leftLeg: { 
        upper: Math.PI * 0.5 - leftPhase * 0.4, 
        lower: Math.PI * 0.1 + Math.max(0, -leftPhase) * 0.6 
      },
      rightLeg: { 
        upper: Math.PI * 0.5 - rightPhase * 0.4, 
        lower: Math.PI * 0.1 + Math.max(0, -rightPhase) * 0.6 
      }
    };
  }
  
  // JUMP_UP - Despegue
  static getJumpUpPose() {
    return {
      head: { x: 0, y: -12, rotation: 0 },
      torso: { 
        x: 0, 
        y: -2, 
        rotation: 0,
        scaleX: 0.95,
        scaleY: 1.1
      },
      leftArm: { upper: Math.PI * 0.1, lower: -Math.PI * 0.2 },
      rightArm: { upper: Math.PI * 0.1, lower: -Math.PI * 0.2 },
      leftLeg: { upper: Math.PI * 0.4, lower: -Math.PI * 0.2 },
      rightLeg: { upper: Math.PI * 0.4, lower: -Math.PI * 0.2 }
    };
  }
  
  // JUMP_PEAK - Punto más alto
  static getJumpPeakPose() {
    return {
      head: { x: 0, y: -11, rotation: 0 },
      torso: { 
        x: 0, 
        y: 0, 
        rotation: 0,
        scaleX: 1,
        scaleY: 1
      },
      leftArm: { upper: Math.PI * 0.15, lower: -Math.PI * 0.15 },
      rightArm: { upper: Math.PI * 0.15, lower: -Math.PI * 0.15 },
      leftLeg: { upper: Math.PI * 0.45, lower: 0 },
      rightLeg: { upper: Math.PI * 0.45, lower: 0 }
    };
  }
  
  // FALL - Cayendo
  static getFallPose() {
    return {
      head: { x: 0, y: -9, rotation: 0.05 },
      torso: { 
        x: 0, 
        y: 1, 
        rotation: 0.05,
        scaleX: 1,
        scaleY: 1
      },
      leftArm: { upper: Math.PI * 0.3, lower: -Math.PI * 0.05 },
      rightArm: { upper: Math.PI * 0.3, lower: -Math.PI * 0.05 },
      leftLeg: { upper: Math.PI * 0.55, lower: Math.PI * 0.05 },
      rightLeg: { upper: Math.PI * 0.55, lower: Math.PI * 0.05 }
    };
  }
  
  // LAND - Aterrizaje (con squash)
  static getLandPose(squashAmount) {
    return {
      head: { x: 0, y: -8, rotation: 0 },
      torso: { 
        x: 0, 
        y: 3, 
        rotation: 0,
        scaleX: 1 + squashAmount,
        scaleY: 1 - squashAmount
      },
      leftArm: { upper: Math.PI * 0.35, lower: Math.PI * 0.1 },
      rightArm: { upper: Math.PI * 0.35, lower: Math.PI * 0.1 },
      leftLeg: { upper: Math.PI * 0.6, lower: Math.PI * 0.3 },
      rightLeg: { upper: Math.PI * 0.6, lower: Math.PI * 0.3 }
    };
  }
}

// ============================================================================
// CONTROLADOR DE ANIMACIÓN - Maneja estados y transiciones
// ============================================================================

export class AnimationController {
  constructor() {
    this.currentState = 'idle';
    this.previousState = 'idle';
    this.stateTime = 0;
    this.totalTime = 0;
    this.skeleton = new Skeleton();
    
    // Para efectos de aterrizaje
    this.landSquash = 0;
    this.landSquashDecay = 0;
    
    // Para follow-through visual
    this.visualOffsetX = 0;
    this.visualOffsetY = 0;
    
    // Para dirección
    this.facingRight = true;
    this.turnProgress = 0;
  }
  
  // Determinar estado basándose en la física del player
  determineState(player) {
    const wasOnGround = this.previousState !== 'jump_up' && this.previousState !== 'peak' && this.previousState !== 'fall';
    
    // Detectar aterrizaje
    if (!wasOnGround && player.onGround && this.currentState !== 'land') {
      this.landSquash = ANIMATION_CONFIG.squashStretch;
      this.landSquashDecay = ANIMATION_CONFIG.speeds.land;
      return 'land';
    }
    
    // Animación de aterrizaje completa
    if (this.currentState === 'land' && this.stateTime < 0.15) {
      return 'land';
    }
    
    if (!player.onGround) {
      if (player.vy < -100) {
        return 'jump_up';
      } else if (player.vy < 100) {
        return 'peak';
      } else {
        return 'fall';
      }
    }
    
    if (Math.abs(player.vx) > 10) {
      return 'walk';
    }
    
    return 'idle';
  }
  
  // Actualizar animación
  update(player, dt) {
    this.totalTime += dt;
    
    // Determinar nuevo estado
    const newState = this.determineState(player);
    if (newState !== this.currentState) {
      this.previousState = this.currentState;
      this.currentState = newState;
      this.stateTime = 0;
    } else {
      this.stateTime += dt;
    }
    
    // Actualizar dirección con transición suave
    const targetFacing = player.vx > 0 ? true : (player.vx < 0 ? false : this.facingRight);
    if (targetFacing !== this.facingRight) {
      this.turnProgress = Math.min(1, this.turnProgress + dt * ANIMATION_CONFIG.speeds.turn);
      if (this.turnProgress >= 1) {
        this.facingRight = targetFacing;
        this.turnProgress = 0;
      }
    } else {
      this.turnProgress = 0;
    }
    
    // Decay del squash de aterrizaje
    if (this.landSquash > 0) {
      this.landSquash = Math.max(0, this.landSquash - dt * this.landSquashDecay);
    }
    
    // Obtener pose objetivo según el estado
    let targetPose;
    switch (this.currentState) {
      case 'idle':
        targetPose = PoseLibrary.getIdlePose(this.totalTime);
        break;
      case 'walk':
        targetPose = PoseLibrary.getWalkPose(this.totalTime, this.facingRight ? 1 : -1);
        break;
      case 'jump_up':
        targetPose = PoseLibrary.getJumpUpPose();
        break;
      case 'peak':
        targetPose = PoseLibrary.getJumpPeakPose();
        break;
      case 'fall':
        targetPose = PoseLibrary.getFallPose();
        break;
      case 'land':
        targetPose = PoseLibrary.getLandPose(this.landSquash);
        break;
      default:
        targetPose = PoseLibrary.getNeutralPose();
    }
    
    // Actualizar esqueleto hacia la pose objetivo
    this.skeleton.updateFromPose(targetPose, dt, ANIMATION_CONFIG.interpolationSpeed);
    
    // Follow-through: la posición visual sigue a la física con lag
    const targetOffsetX = player.x + player.w / 2;
    const targetOffsetY = player.y + player.h / 2;
    
    this.visualOffsetX = lerp(this.visualOffsetX, targetOffsetX, dt * ANIMATION_CONFIG.visualLag);
    this.visualOffsetY = lerp(this.visualOffsetY, targetOffsetY, dt * ANIMATION_CONFIG.visualLag);
  }
  
  // Convertir esqueleto a drawables para el renderer
  toDrawables() {
    const drawables = [];
    const baseX = this.visualOffsetX;
    const baseY = this.visualOffsetY;
    const flip = this.facingRight ? 1 : -1;
    const props = this.skeleton.proportions;
    const parts = this.skeleton.parts;
    
    // Helper para crear un segmento de extremidad
    const addLimb = (startX, startY, length, upperAngle, lowerAngle, color, thickness) => {
      // Segmento superior
      const midX = startX + Math.cos(upperAngle) * length * 0.6 * flip;
      const midY = startY + Math.sin(upperAngle) * length * 0.6;
      
      drawables.push({
        x: startX - thickness / 2,
        y: startY - thickness / 2,
        w: thickness,
        h: length * 0.6,
        shape: 'rect',
        color: color,
        rotation: upperAngle
      });
      
      // Segmento inferior
      drawables.push({
        x: midX - thickness / 2,
        y: midY - thickness / 2,
        w: thickness,
        h: length * 0.4,
        shape: 'rect',
        color: color,
        rotation: upperAngle + lowerAngle
      });
    };
    
    // Torso
    const torsoX = baseX + parts.torso.x * flip - (props.torsoWidth * parts.torso.scaleX) / 2;
    const torsoY = baseY + parts.torso.y - (props.torsoHeight * parts.torso.scaleY) / 2;
    drawables.push({
      x: torsoX,
      y: torsoY,
      w: props.torsoWidth * parts.torso.scaleX,
      h: props.torsoHeight * parts.torso.scaleY,
      shape: 'rect',
      color: ANIMATION_CONFIG.colors.torso,
      rotation: parts.torso.rotation
    });
    
    // Piernas (dibujar primero para que queden atrás)
    const legStartY = baseY + parts.torso.y + props.torsoHeight / 2;
    addLimb(
      baseX - props.torsoWidth * 0.25 * flip,
      legStartY,
      props.legLength,
      parts.leftLeg.upper,
      parts.leftLeg.lower,
      ANIMATION_CONFIG.colors.limbs,
      props.limbThickness
    );
    addLimb(
      baseX + props.torsoWidth * 0.25 * flip,
      legStartY,
      props.legLength,
      parts.rightLeg.upper,
      parts.rightLeg.lower,
      ANIMATION_CONFIG.colors.limbs,
      props.limbThickness
    );
    
    // Brazos
    const armStartY = baseY + parts.torso.y - props.torsoHeight * 0.3;
    addLimb(
      baseX - props.torsoWidth * 0.4 * flip,
      armStartY,
      props.armLength,
      parts.leftArm.upper,
      parts.leftArm.lower,
      ANIMATION_CONFIG.colors.limbs,
      props.limbThickness * 0.8
    );
    addLimb(
      baseX + props.torsoWidth * 0.4 * flip,
      armStartY,
      props.armLength,
      parts.rightArm.upper,
      parts.rightArm.lower,
      ANIMATION_CONFIG.colors.limbs,
      props.limbThickness * 0.8
    );
    
    // Cabeza (encima de todo)
    const headX = baseX + parts.head.x * flip - props.headRadius;
    const headY = baseY + parts.head.y - props.torsoHeight / 2 - props.headRadius;
    drawables.push({
      x: headX,
      y: headY,
      w: props.headRadius * 2,
      h: props.headRadius * 2,
      shape: 'circle',
      color: ANIMATION_CONFIG.colors.head,
      rotation: parts.head.rotation
    });
    
    // Detalles faciales simples (ojos)
    const eyeSize = 1.5;
    const eyeOffsetX = props.headRadius * 0.3;
    const eyeOffsetY = props.headRadius * 0.2;
    drawables.push({
      x: headX + props.headRadius - eyeOffsetX * flip - eyeSize / 2,
      y: headY + eyeOffsetY,
      w: eyeSize,
      h: eyeSize,
      shape: 'circle',
      color: [0.1, 0.1, 0.1, 1.0],
      rotation: 0
    });
    drawables.push({
      x: headX + props.headRadius + eyeOffsetX * flip - eyeSize / 2,
      y: headY + eyeOffsetY,
      w: eyeSize,
      h: eyeSize,
      shape: 'circle',
      color: [0.1, 0.1, 0.1, 1.0],
      rotation: 0
    });
    
    return drawables;
  }
}

// ============================================================================
// UTILIDADES MATEMÁTICAS
// ============================================================================

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  // Interpolar ángulos por el camino más corto
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}