// Player with WASD movement, Space jump, coyote time, jump buffer
export class Player {
    constructor(x, y) {
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
      this.rotation = 0; // Player doesn't rotate, but needs property for collision system
      this.id = 'player';
      
      // Coyote time: grace period after leaving ground
      this.coyoteTime = 0;
      this.coyoteMax = 0.1;
      
      // Jump buffer: remember jump input briefly
      this.jumpBuffer = 0;
      this.jumpBufferMax = 0.1;
      
      // Track if space was pressed last frame (for single jump detection)
      this.spaceWasPressed = false;
    }
  
    input(keys) {
      // Horizontal movement
      let dir = 0;
      if (keys['KeyA'] || keys['ArrowLeft']) dir -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) dir += 1;
      this.vx = dir * this.speed;
      
      // Jump buffer: store jump intent only on NEW press
      const spacePressed = keys['Space'];
      if (spacePressed && !this.spaceWasPressed) {
        this.jumpBuffer = this.jumpBufferMax;
      }
      this.spaceWasPressed = spacePressed;
    }
  
    update(world, dt) {
      // Update coyote time
      if (this.onGround) {
        this.coyoteTime = this.coyoteMax;
      } else {
        this.coyoteTime = Math.max(0, this.coyoteTime - dt);
      }
      
      // Consume jump buffer if we can jump
      if (this.jumpBuffer > 0) {
        if (this.coyoteTime > 0) {
          this.vy = -this.jumpImpulse;
          this.coyoteTime = 0;
          this.jumpBuffer = 0;
        }
      }
      
      // Decay jump buffer
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    }
  
    toDrawable() {
      return {
        x: this.x,
        y: this.y,
        w: this.w,
        h: this.h,
        shape: 'rect',
        color: [0.2, 0.6, 1.0, 1.0],
        rotation: 0
      };
    }
    
    // Add player to physics world
    addToWorld(world) {
      // Check if player is already in world
      const existingIndex = world.bodies.findIndex(b => b.id === 'player');
      if (existingIndex === -1) {
        world.bodies.push(this);
      }
    }
    
    // Remove player from physics world
    removeFromWorld(world) {
      world.bodies = world.bodies.filter(b => b.id !== 'player');
    }
  }