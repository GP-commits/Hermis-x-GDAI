// Original reference-inspired artwork, generated as eight registered pedal poses.
// Keep the source PNG intact: source rectangles are selected only at draw time.
export class RiderSprite {
  constructor() {
    this.image = new Image();
    this.ready = false;
    this.image.onload = () => { this.ready = true; };
    this.image.src = new URL('../assets/rider/pedal-sheet-v2.png', import.meta.url).href;
  }

  draw(ctx, pose, state) {
    if (!this.ready) return false;
    const phase = ((pose.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const frame = Math.floor(phase / (Math.PI * 2) * 8 + 1e-8) % 8;
    const cellW = this.image.naturalWidth / 4;
    const cellH = this.image.naturalHeight / 2;
    const sx = (frame % 4) * cellW, sy = Math.floor(frame / 4) * cellH;
    // Register the wheelbase and tyre contact line rather than the varying head.
    const scale = 43 / 236;
    const width = cellW * scale, height = cellH * scale;
    const left = -21.5 - 109 * scale;
    const bottom = 17;
    const top = bottom - 421 * scale;
    // Flex the upper body about the saddle while keeping both tyres planted.
    // A continuous piecewise affine warp avoids a detached cutout at the seam.
    const waist = 236;
    const flex = Math.min(5, pose.crouch * .55);
    const splitY = top + waist * scale;
    const hubs = [[109, 338], [344, 346]];
    const spokeRadius = 59 * scale;
    // The sheet includes the fork and rear stays inside each wheel. Never rotate
    // those pixels: replace only the spokes, then restore the fixed connections.
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, width, height + 1);
    for (const [x, y] of hubs) {
      ctx.moveTo(left + x * scale + spokeRadius, top + y * scale);
      ctx.arc(left + x * scale, top + y * scale, spokeRadius, 0, Math.PI * 2);
    }
    ctx.clip('evenodd');
    ctx.save();
    const shear = -(pose.lean || 0) * .015;
    ctx.transform(1, 0, shear, 1, -shear * splitY, 0);
    ctx.drawImage(this.image, sx, sy, cellW, waist,
      left, top + flex, width, waist * scale - flex);
    ctx.restore();
    ctx.drawImage(this.image, sx, sy + waist, cellW, cellH - waist,
      left, splitY, width, height - waist * scale);
    ctx.restore();
    for (const [index, [x, y]] of hubs.entries()) {
      ctx.save();
      ctx.translate(left + x * scale, top + y * scale);
      ctx.beginPath(); ctx.arc(0, 0, spokeRadius + .05, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = '#101c23'; ctx.lineWidth = .15;
      const wheelAngle = state.x / (80 * scale);
      ctx.beginPath();
      for (let spoke = 0; spoke < 24; spoke++) {
        const angle = wheelAngle + spoke * Math.PI / 12;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * spokeRadius, Math.sin(angle) * spokeRadius);
      }
      ctx.stroke();
      // Clip the unrotated source to the fork / stays / hub silhouettes.
      ctx.beginPath();
      ctx.arc(0, 0, 17 * scale, 0, Math.PI * 2);
      const connections = index === 0
        ? [[211, 244, 20], [220, 347, 23]]
        : [[302, 232, 19]];
      for (const [endX, endY, thickness] of connections) {
        const dx = endX - x, dy = endY - y;
        const length = Math.hypot(dx, dy);
        const nx = -dy / length * thickness / 2, ny = dx / length * thickness / 2;
        ctx.moveTo(-nx * scale, -ny * scale);
        ctx.lineTo((dx - nx) * scale, (dy - ny) * scale);
        ctx.lineTo((dx + nx) * scale, (dy + ny) * scale);
        ctx.lineTo(nx * scale, ny * scale); ctx.closePath();
      }
      ctx.clip();
      ctx.drawImage(this.image, sx, sy, cellW, cellH,
        -x * scale, -y * scale, width, height);
      ctx.restore();
    }
    return true;
  }
}
