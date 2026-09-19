import { clamp, lerp } from './world.js';

// Two-bone joints keep feet on opposite pedals and hands on the grips.
export function jointBetween(root, tip, upper, lower, bend = 1) {
  const dx = tip[0] - root[0], dy = tip[1] - root[1];
  const distance = Math.max(.001, Math.hypot(dx, dy));
  const reach = clamp(distance, Math.abs(upper - lower) + .001, upper + lower - .001);
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  return [root[0] + dx / distance * along + dy / distance * height * bend,
    root[1] + dy / distance * along - dx / distance * height * bend];
}

export class RiderRig {
  constructor() { this.phase = 0; this.cadence = 0; this.crouch = 0; this.lean = 0; }
  update(s, dt, intro = false) {
    dt = clamp(dt || 0, 0, .1);
    if (!dt && this.lastPose) return this.lastPose;
    const pedaling = s.grounded && s.pedaling && !s.crashed && !intro;
    const ease = 1 - Math.exp(-dt * 12);
    this.cadence = lerp(this.cadence, pedaling ? clamp(Math.abs(s.vx) * .026, 2.8, 10) : 0, ease);
    if (pedaling) this.phase += this.cadence * dt;
    else if (!s.crashed) this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, ease * .65);
    const landing = clamp(s.compression || 0, 0, 9) * .45;
    const crouch = s.crashed ? 4 : s.grounded ? landing + (s.pumping ? 4 : 0) : 2.8;
    this.crouch = lerp(this.crouch, crouch, ease);
    this.lean = lerp(this.lean, s.braking ? -2.6 : s.pumping ? 1.8 : pedaling ? 1.1 : s.grounded ? 0 : -.8, ease);
    const bob = pedaling ? Math.sin(this.phase * 2) * .65 : 0;
    const slump = s.crashed ? clamp((s.crashTime || 0) * 2, 0, 1) : 0;
    const compression = clamp(s.compression || 0, 0, 9) * .45;
    const crank = [-2, 6], pedal = [Math.cos(this.phase) * 5, Math.sin(this.phase) * 5];
    const hip = [-10 + this.lean, -20 + this.crouch + bob];
    const shoulder = [2 + this.lean * 1.1 + slump * 3, -33 + this.crouch + bob * .55 + slump * 2];
    const hand = [16 + slump * 5, -16 + compression - slump * 4];
    const nearAnkle = [crank[0] + pedal[0] - 2, crank[1] + pedal[1] - 2 - slump * 5];
    const farAnkle = [crank[0] - pedal[0] - 2, crank[1] - pedal[1] - 2 - slump * 2];
    const farHip = [hip[0] - 1, hip[1]];
    return this.lastPose = { phase: this.phase, crank, pedal, compression, hip, shoulder, hand, nearAnkle, farAnkle, farHip,
      nearKnee: jointBetween(hip, nearAnkle, 16.5, 17.5), farKnee: jointBetween(farHip, farAnkle, 16.5, 17.5),
      elbow: jointBetween(shoulder, hand, 13, 16, -1),
      head: [shoulder[0] + 5.2, shoulder[1] - 7.4], headTilt: .08 + slump * .5,
      packSway: Math.sin(this.phase * 2) * (pedaling ? .35 : 0) };
  }
}
