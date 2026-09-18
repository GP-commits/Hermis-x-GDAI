import { clamp, angleDiff, JOURNEY_LENGTH } from './world.js';

export const STEP = 1 / 120;
export const WHEEL_RADIUS = 10;
export const WHEEL_BASE = 43;
const INERTIA = 390;

export class BikePhysics {
  constructor(world) { this.world = world; this.reset(); }
  reset(x = 80) {
    this.state = { x, y: this.world.height(x) - 17, vx: 135, vy: 0, angle: Math.atan(this.world.slope(x)), omega: 0, grounded: true, contact: 2, compression: 0, airtime: 0, rotation: 0, launchAngle: 0, time: 0, distance: x, score: 0, bestAir: 0, flips: 0, landings: 0, crashed: false, crashTime: 0, summit: false, day: Math.floor(x / JOURNEY_LENGTH) + 1 };
    this.history = [];
    this.events = [];
    this.rewinding = false;
    this.rewindSteps = 0;
    this.pumping = false;
    this.grace = .7;
    this.checkpoint = { ...this.state };
  }
  snapshot() { return { ...this.state }; }
  rewind() {
    if (!this.history.length) {
      this.state = { ...this.checkpoint, crashed: false, crashTime: 0 };
      this.grace = 1;
      return;
    }
    this.rewinding = true;
    this.rewindSteps = Math.min(240, this.history.length);
    this.events.length = 0;
  }
  update(input = {}) {
    if (this.rewinding) {
      for (let i = 0; i < 4 && this.rewindSteps > 0; i++, this.rewindSteps--) this.state = this.history.pop();
      if (this.rewindSteps <= 0) {
        this.rewinding = false;
        this.state.crashed = false;
        this.state.crashTime = 0;
        this.grace = .65;
        this.pumping = false;
      }
      return;
    }
    const s = this.state, dt = STEP;
    if (s.crashed) { s.crashTime += dt; return; }
    this.history.push(this.snapshot());
    if (this.history.length > 380) this.history.shift();
    s.time += dt;
    this.grace = Math.max(0, this.grace - dt);
    this.world.ensure(s.x + 2200);
    const wasGrounded = s.grounded;
    const lastAngle = s.angle;
    let fx = -s.vx * .08 - s.vx * Math.abs(s.vx) * .00035;
    let fy = 470;
    let torque = 0, contacts = 0, compression = 0, impact = 0;
    const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
    const wet = this.world.chapterAt(s.x) === 5;
    for (const offset of [-WHEEL_BASE / 2, WHEEL_BASE / 2]) {
      const rx = offset * cos - 7 * sin, ry = offset * sin + 7 * cos;
      const wx = s.x + rx, wy = s.y + ry;
      const slope = this.world.slope(wx), norm = Math.hypot(1, slope);
      const nx = slope / norm, ny = -1 / norm;
      const penetration = (wy + WHEEL_RADIUS * norm - this.world.height(wx)) / norm;
      if (penetration > -.5) {
        contacts++;
        const cvx = s.vx - s.omega * ry, cvy = s.vy + s.omega * rx;
        const vn = cvx * nx + cvy * ny;
        impact = Math.max(impact, -vn);
        const force = clamp(1350 * Math.max(0, penetration) - 36 * vn, 0, 12000);
        const nfx = nx * force, nfy = ny * force;
        fx += nfx; fy += nfy;
        torque += rx * nfy - ry * nfx;
        const pedal = input.right ? 165 + Math.max(0, 155 - s.vx) * 3.8 : 20;
        const brake = input.left ? s.vx * (wet ? 1.5 : 2.8) : 0;
        const pump = input.pump ? Math.max(0, slope) * 310 : 0;
        const drive = (pedal + pump - brake) * .5;
        fx += drive / norm; fy += drive * slope / norm;
        compression = Math.max(compression, penetration);
      }
    }
    s.grounded = contacts > 0;
    s.contact = contacts;
    if (contacts) {
      // Angular damping represents tire/suspension friction at contact.
      torque -= s.omega * INERTIA * 7;
      if (!wasGrounded && s.airtime > .18) {
        const landingAngle = Math.atan(this.world.slope(s.x));
        const alignment = Math.abs(angleDiff(s.angle - landingAngle));
        if (alignment > 1.05 && impact > 48 && this.grace === 0) {
          this.crash(); return;
        }
        const terrainRotation = angleDiff(landingAngle - s.launchAngle);
        const flips = Math.abs(Math.round((s.rotation - terrainRotation) / (Math.PI * 2)));
        const perfect = alignment < .26 && impact < 550 && s.airtime > .4;
        s.flips += flips;
        s.bestAir = Math.max(s.bestAir, s.airtime);
        if (perfect) { s.landings++; s.vx += 14; }
        s.score += flips * 250 + (perfect ? 100 : 0) + (s.airtime > 1.2 ? 75 : 0);
        this.events.push({ type: 'landing', perfect, flips, direction: s.rotation < 0 ? 'BACKFLIP' : 'FRONTFLIP', air: s.airtime, impact });
      }
      s.airtime = 0;
      s.rotation = 0;
      if (contacts === 2 && Math.abs(angleDiff(s.angle - Math.atan(this.world.slope(s.x)))) < .35) this.checkpoint = this.snapshot();
      if (this.pumping && !input.pump && this.world.slope(s.x) < -.08) { s.vy -= 45; s.vx += 18; }
    } else {
      s.airtime += dt;
      if (wasGrounded) { s.launchAngle = s.angle; this.events.push({ type: 'takeoff' }); }
      const control = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      torque += control * INERTIA * 10;
      torque -= s.omega * INERTIA * (control ? .9 : 1.2);
      if (!control) {
        // Releasing the controls softly aligns the wheels with the landing.
        // Predict the contact surface instead of chasing the slope below a gap.
        let landingX = s.x + s.vx * .25, landingTime = 1.8;
        for (let t = .08; t <= 1.8; t += .08) {
          const x = s.x + s.vx * t;
          if (s.y + s.vy * t + 235 * t * t >= this.world.height(x) - 17) { landingX = x; landingTime = t; break; }
        }
        const target = Math.atan(this.world.slope(landingX));
        const assist = landingTime < .4 ? 13 : 4;
        torque += angleDiff(target - s.angle) * INERTIA * assist;
        torque -= s.omega * INERTIA * 1.8;
      }
    }
    this.pumping = !!input.pump;
    s.vx = clamp(s.vx + fx * dt, -55, 620);
    s.vy = clamp(s.vy + fy * dt, -700, 800);
    s.omega = clamp(s.omega + torque / INERTIA * dt, -7.5, 7.5);
    s.x += s.vx * dt; s.y += s.vy * dt; s.angle += s.omega * dt;
    s.rotation += s.angle - lastAngle;
    s.compression += (clamp(compression, 0, 9) - s.compression) * .2;
    s.distance = Math.max(s.distance, s.x);
    s.day = Math.floor(s.x / JOURNEY_LENGTH) + 1;
    // Head strikes and falling below a trail also count, independently of wheels.
    const headX = s.x + 4 * cos + 37 * sin;
    const headY = s.y + 4 * sin - 37 * cos;
    if (this.grace === 0 && (headY > this.world.height(headX) - 3 || s.y > this.world.height(s.x) + 65)) this.crash();
    if (s.x < -200) { s.x = -200; s.vx = 20; }
    if (!Number.isFinite(s.x + s.y + s.angle)) { this.state = { ...this.checkpoint }; this.grace = 1; }
  }
  crash() {
    this.state.crashed = true;
    this.state.crashTime = 0;
    this.events.push({ type: 'crash' });
  }
  consumeEvents() { return this.events.splice(0); }
}
