import { RiderRig } from './rider.js';
import { RiderSprite } from './rider-sprite.js';
import { CHAPTERS, CHAPTER_LENGTH, clamp, lerp, smooth, random, hashSeed } from './world.js';
import { WHEEL_BASE, WHEEL_RADIUS } from './physics.js';

const TAU = Math.PI * 2;
const INK = '#0c1911';
const rgb = hex => [1, 3, 5].map(n => parseInt(hex.slice(n, n + 2), 16));
const blend = (a, b, t) => { const aa = rgb(a), bb = rgb(b); return `rgb(${aa.map((v, i) => Math.round(lerp(v, bb[i], t))).join(',')})`; };
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function noise(x) { const i = Math.floor(x), t = smooth(x - i); return lerp(hash(i), hash(i + 1), t); }

export class Scene {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.camera = { x: 0, y: 0, scale: 1 };
    this.initialized = false;
    this.particles = [];
    this.time = 0;
    this.flash = 0;
    this.bikeStyle = 'mountain';
    this.riderRig = new RiderRig();
    this.riderSprite = new RiderSprite();
    this.pedalAngle = 0;
    this.lastBikeX = null;
    this.mobile = matchMedia('(pointer: coarse)').matches;
    this.renderScale = this.mobile ? 1.25 : 2;
    this.mountainCache = [];
    this.skyCache = null;
    this.sunCache = null;
    this.pendingRenderScale = null;
    this.renderCost = 0;
    this.renderSamples = 0;
    this.sampleTime = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.rng = random(hashSeed(world.seed));
    this.stars = Array.from({ length: 90 }, () => ({ x: this.rng(), y: this.rng() * .57, r: this.rng() * 1.1 + .25, a: this.rng() }));
    // Bake grain once. A live SVG turbulence filter over the entire animated
    // canvas forces expensive repaint/compositing work in some browsers.
    const grain = document.createElement('canvas'); grain.width = grain.height = 96;
    const grainContext = grain.getContext('2d'), pixels = grainContext.createImageData(96, 96);
    const grainRandom = random(741);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = Math.floor(grainRandom() * 256);
      pixels.data[i + 3] = 150;
    }
    grainContext.putImageData(pixels, 0, 0);
    document.querySelector('.grain')?.style.setProperty('background-image', `url(${grain.toDataURL()})`);
    this.resize();
  }
  resize() {
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.renderScale, Math.sqrt(1800000 / (this.w * this.h)));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.initialized = false;
    this.mountainCache = [];
    this.skyCache = null;
    this.sunCache = null;
  }
  setWorld(world) { this.world = world; this.initialized = false; this.particles.length = 0; this.mountainCache = []; this.skyCache = null; this.lastBikeX = null; this.pedalAngle = 0; this.riderRig = new RiderRig(); }
  palette(x) {
    const i = this.world.chapterAt(x);
    const t = smooth(clamp((x % CHAPTER_LENGTH) / CHAPTER_LENGTH * 5 - 4, 0, 1));
    const a = CHAPTERS[i], b = CHAPTERS[(i + 1) % 8];
    return { sky: a.sky.map((c, j) => blend(c, b.sky[j], t)), layers: a.layers.map((c, j) => blend(c, b.layers[j], t)), sun: blend(a.sun, b.sun, t), fog: lerp(a.fog, b.fog, t), rain: lerp(a.rain, b.rain, t), trees: lerp(a.trees, b.trees, t), night: lerp(i >= 3 && i <= 6 ? 1 : 0, i + 1 >= 3 && i + 1 <= 6 ? 1 : 0, t), chapter: i, cacheKey: `${i}:${Math.round(t * 32)}` };
  }
  screen(x, y) { return { x: (x - this.camera.x) * this.camera.scale, y: (y - this.camera.y) * this.camera.scale }; }
  updateCamera(s, dt, intro) {
    const { w, h } = this;
    const base = clamp(w / 1000, .79, 1.42);
    const speed = clamp((s.vx - 180) / 430, 0, 1);
    const altitude = Math.max(0, this.world.height(s.x) - s.y - 18);
    const zoom = (this.reducedMotion ? 0 : speed * .17 + clamp(altitude / 1200, 0, .18));
    const targetScale = base * (1 - zoom);
    const riderX = w < 650 ? .32 : .36;
    const targetX = s.x + (intro ? 0 : s.vx * .20) - w * (riderX - speed * .035) / targetScale;
    const groundY = h * (w < 650 ? .73 : .755);
    const targetY = s.y - groundY / targetScale + clamp(altitude * .24, 0, h * .14 / targetScale);
    const t = this.initialized ? 1 - Math.exp(-dt * (intro ? 2 : 3.8)) : 1;
    this.camera.scale = lerp(this.camera.scale, targetScale, t * .65 + (this.initialized ? 0 : .35));
    this.camera.x = lerp(this.camera.x, targetX, t);
    this.camera.y = lerp(this.camera.y, targetY, t);
    this.initialized = true;
  }
  draw(s, dt, { intro = false, paused = false, rewinding = false } = {}) {
    if (this.pendingRenderScale !== null) {
      const cameraReady = this.initialized;
      this.renderScale = this.pendingRenderScale; this.pendingRenderScale = null;
      this.resize(); this.initialized = cameraReady;
    }
    const renderStart = performance.now();
    this.frameDelta = paused || intro ? 0 : dt;
    this.time += paused ? dt * .1 : dt;
    this.updateCamera(s, dt, intro);
    const c = this.ctx, { w, h } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const p = this.palette(s.x);
    this.drawCachedSky(p, s);
    this.drawMountains(p, s);
    this.drawAtmosphere(p, s);
    c.save();
    c.scale(this.camera.scale, this.camera.scale);
    c.translate(-this.camera.x, -this.camera.y);
    this.drawStructures(false);
    this.drawTrail(p);
    this.drawBike(s, intro);
    this.drawParticles(dt, s, paused || intro || rewinding, p);
    this.drawStructures(true);
    c.restore();
    this.drawForeground(p, s);
    if (p.rain > .01) this.drawRain(p.rain, s);
    if (this.world.inTunnel(s.x)) {
      const vignette = c.createRadialGradient(w * .4, h * .6, 30, w * .4, h * .6, Math.max(w, h) * .7);
      vignette.addColorStop(0, '#0d1b1310'); vignette.addColorStop(1, '#07140cd9');
      c.fillStyle = vignette; c.fillRect(0, 0, w, h);
    }
    const shade = c.createLinearGradient(0, h * .82, 0, h);
    shade.addColorStop(0, '#0e1c1300'); shade.addColorStop(1, '#0e1c1370');
    c.fillStyle = shade; c.fillRect(0, h * .82, w, h * .18);
    if (rewinding) { c.fillStyle = '#d3eadb13'; c.fillRect(0, 0, w, h); }
    if (this.flash > 0) { c.globalAlpha = this.flash; c.fillStyle = '#f3f7f4'; c.fillRect(0, 0, w, h); c.globalAlpha = 1; this.flash = Math.max(0, this.flash - dt * 2); }
    this.renderCost += performance.now() - renderStart;
    this.renderSamples++; this.sampleTime += dt;
    if (this.sampleTime >= 1 && this.renderSamples >= 12) {
      const average = this.renderCost / this.renderSamples;
      if (average > 14) {
        const density = Math.max(.5, this.dpr * Math.sqrt(10 / average));
        if (density < this.dpr - .04) this.pendingRenderScale = density;
      }
      this.renderCost = this.renderSamples = this.sampleTime = 0;
    }
  }
  drawCachedSky(p, s) {
    this.drawSky(p, s);
    if (p.night < .5) this.drawBirds(this.w * .28, this.h * .25, 1 - p.fog);
  }
  drawSky(p, s) {
    const c = this.ctx, { w, h } = this;
    if (!this.skyCache || this.skyCache.key !== p.cacheKey) {
      const canvas = this.skyCache?.canvas || document.createElement('canvas');
      const density = Math.min(this.dpr, 1);
      const width = Math.ceil(w * density), height = Math.ceil(h * density);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext('2d', { alpha: false });
      context.setTransform(density, 0, 0, density, 0, 0);
      const grad = context.createLinearGradient(0, 0, 0, h * .85);
      p.sky.forEach((color, i) => grad.addColorStop(i / 3, color));
      context.fillStyle = grad; context.fillRect(0, 0, w, h);
      this.skyCache = { canvas, key: p.cacheKey };
    }
    c.drawImage(this.skyCache.canvas, 0, 0, w, h);
    if (p.night > .01) {
      for (const star of this.stars) {
        c.globalAlpha = p.night * (.25 + .35 * star.a + Math.sin(this.time * .5 + star.x * 40) * .12);
        c.fillStyle = '#f4f8f5'; c.beginPath(); c.arc(star.x * w, star.y * h, star.r, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
    }
    const sunX = w * (w < 650 ? .79 : .84) - Math.sin(s.x * .00003) * w * .05;
    const sunY = h * (w < 650 ? .17 : p.night > .5 ? .24 : .345);
    const r = clamp(w * .053, 37, 80) * (p.night > .5 ? 1.2 : 1);
    const sunKey = `${p.cacheKey}:${p.night > .5}`;
    if (!this.sunCache || this.sunCache.key !== sunKey) {
      const canvas = this.sunCache?.canvas || document.createElement('canvas');
      const size = Math.ceil(r * 8);
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d'), center = size / 2;
      const glow = context.createRadialGradient(center, center, r * .7, center, center, r * 3.8);
      glow.addColorStop(0, p.night > .5 ? '#c6edcf24' : '#b3eac43c'); glow.addColorStop(1, '#b3eac400');
      context.fillStyle = glow; context.fillRect(0, 0, size, size);
      context.fillStyle = p.sun; context.globalAlpha = .9 - p.fog * .45;
      context.beginPath(); context.arc(center, center, r, 0, TAU); context.fill();
      { // A pale textured moon keeps every chapter in the campaign's forest palette.
        context.fillStyle = '#57756112';
        for (let i = 0; i < 9; i++) { context.beginPath(); context.arc(center + (hash(i + 90) - .5) * r * 1.3, center + (hash(i + 10) - .5) * r * 1.3, 3 + hash(i + 44) * r * .19, 0, TAU); context.fill(); }
      }
      this.sunCache = { canvas, key: sunKey, size };
    }
    const size = this.sunCache.size;
    c.drawImage(this.sunCache.canvas, sunX - size / 2, sunY - size / 2);
  }
  mountainHeight(x, layer, base, height) {
    const offset = this.camera.x * (.012 + layer * .012);
    const u = (x + offset) / this.h;
    const ridges = noise(u * 2.8 + layer * 31) * .59 + noise(u * 7.5 + layer * 29) * .27 + noise(u * 24 + layer * 17) * .10 + noise(u * 70 + layer * 23) * .04;
    return base - ridges * height;
  }
  drawMountains(p, s) {
    const c = this.ctx, { w, h } = this;
    const margin = 96;
    for (let i = 0; i < 5; i++) {
      const factor = .012 + i * .012;
      let cache = this.mountainCache[i];
      let shift = cache ? (this.camera.x - cache.anchor) * factor : 0;
      if (!cache || cache.key !== p.cacheKey || Math.abs(shift) > margin - 24) {
        const canvas = cache?.canvas || document.createElement('canvas');
        const density = Math.min(this.dpr, 1.25);
        const top = Math.floor(h * (.64 + i * .065 - (.34 - i * .017)) - 24);
        const height = h - top;
        const width = Math.ceil((w + margin * 2) * density), pixelHeight = Math.ceil(height * density);
        if (canvas.width !== width || canvas.height !== pixelHeight) { canvas.width = width; canvas.height = pixelHeight; }
        const context = canvas.getContext('2d');
        context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, pixelHeight);
        context.setTransform(density, 0, 0, density, margin * density, -top * density);
        this.ctx = context;
        this.drawMountainLayer(p, i, -margin, w + margin);
        this.ctx = c;
        cache = { canvas, key: p.cacheKey, anchor: this.camera.x, top, height };
        this.mountainCache[i] = cache;
        shift = 0;
      }
      // Each cached layer still moves every frame at its own parallax speed.
      c.drawImage(cache.canvas, -margin - shift, cache.top, w + margin * 2, cache.height);
    }
    // A thin river glimmers far below; its bends emphasize the valley depth.
    c.save(); c.globalAlpha = .11; c.fillStyle = p.sun;
    c.beginPath(); c.moveTo(w * .62, h * .66); c.bezierCurveTo(w * .61, h * .7, w * .47, h * .69, w * .52, h * .75); c.bezierCurveTo(w * .59, h * .81, w * .27, h * .80, w * .33, h * .9); c.lineTo(w * .39, h * .91); c.bezierCurveTo(w * .32, h * .81, w * .63, h * .83, w * .55, h * .75); c.bezierCurveTo(w * .49, h * .70, w * .64, h * .69, w * .62, h * .66); c.fill(); c.restore();
  }
  drawMountainLayer(p, i, left, right) {
    const c = this.ctx, h = this.h;
    const base = h * (.64 + i * .065), height = h * (.34 - i * .017);
    const offset = this.camera.x * (.012 + i * .012);
    c.fillStyle = p.layers[i]; c.beginPath(); c.moveTo(left, h);
    for (let index = Math.floor((left + offset) / 7); index <= Math.ceil((right + offset) / 7); index++) {
      const x = index * 7 - offset; c.lineTo(x, this.mountainHeight(x, i, base, height));
    }
    c.lineTo(right, h); c.closePath(); c.fill();
    if (i < 3) {
      c.fillStyle = p.sky[2]; c.globalAlpha = .055;
      const step = 94 + i * 17;
      for (let index = Math.floor((left + offset - 40) / step); index <= Math.ceil((right + offset) / step); index++) {
        const x = index * step - offset, y = this.mountainHeight(x, i, base, height);
        c.beginPath(); c.moveTo(x, y + 1); c.lineTo(x + 38, y + 65); c.lineTo(x + 13, y + 37); c.lineTo(x - 25, y + 115); c.closePath(); c.fill();
      }
      c.globalAlpha = 1;
    }
    if (i >= 2 && p.trees > .25) {
      const step = i === 4 ? 13 : 8;
      for (let index = Math.floor((left + offset - 15) / step); index <= Math.ceil((right + offset + 15) / step); index++) {
        const x = index * step - offset, y = this.mountainHeight(x, i, base, height);
        this.pine(x, y + 2, (4 + hash(index + i * 999) * 11) * p.trees, p.layers[i]);
      }
    }
    const haze = c.createLinearGradient(0, base - h * .12, 0, base + h * .055);
    haze.addColorStop(0, '#c4d8ca00'); haze.addColorStop(1, `rgba(190,213,196,${.12 + p.fog * .10})`);
    c.fillStyle = haze; c.fillRect(left, base - h * .12, right - left, h * .2);
  }
  drawAtmosphere(p, s) {
    const c = this.ctx, { w, h } = this;
    if (p.fog > .05) {
      for (let i = 0; i < 3; i++) {
        const y = h * (.54 + i * .105) + Math.sin(this.time * .05 + i) * 10;
        const fog = c.createLinearGradient(0, y - 38, 0, y + 38);
        fog.addColorStop(0, '#cbd9cf00'); fog.addColorStop(.5, `rgba(203,217,207,${p.fog * .20})`); fog.addColorStop(1, '#cbd9cf00');
        c.fillStyle = fog; c.fillRect(0, y - 38, w, 76);
      }
    }
    const n = p.fog > .3 ? 35 : 12;
    c.fillStyle = p.sun;
    for (let i = 0; i < n; i++) {
      const x = ((hash(i + 302) * w - this.camera.x * .13 + this.time * (2 + hash(i) * 5)) % w + w) % w;
      const y = h * .4 + ((hash(i + 913) * h * .5 + Math.sin(this.time * .2 + i) * 15) % (h * .52));
      c.globalAlpha = .08 + hash(i + 111) * .22;
      c.beginPath(); c.arc(x, y, .5 + hash(i + 675) * 1.1, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }
  drawBirds(cx, cy, alpha) {
    const c = this.ctx;
    c.strokeStyle = '#46574c'; c.lineWidth = 1.15; c.globalAlpha = .5 * alpha;
    for (let i = 0; i < 5; i++) {
      const x = cx + i * 21 + Math.sin(this.time * .08) * 24, y = cy + Math.sin(i * 1.9) * 15;
      const flap = Math.sin(this.time * 2 + i) * 2;
      c.beginPath(); c.moveTo(x - 4, y - 1 - flap); c.quadraticCurveTo(x - 1, y - 2, x, y + 1); c.quadraticCurveTo(x + 2, y - 2, x + 5, y - 1 - flap); c.stroke();
    }
    c.globalAlpha = 1;
  }
  pine(x, y, height, color) {
    const c = this.ctx;
    c.fillStyle = color;
    c.fillRect(x - height * .014, y - height * .82, height * .028, height * .87);
    for (let j = 0; j < 6; j++) {
      const top = y - height + j * height * .115;
      const width = height * (.07 + j * .033);
      c.beginPath(); c.moveTo(x, top); c.lineTo(x + width * .79, top + height * .22); c.lineTo(x + width * .60, top + height * .19); c.lineTo(x + width, top + height * .285); c.lineTo(x + width * .18, top + height * .255); c.lineTo(x - width * 1.07, top + height * .28); c.lineTo(x - width * .69, top + height * .20); c.lineTo(x - width * .9, top + height * .22); c.closePath(); c.fill();
    }
  }
  drawTrail(p) {
    const c = this.ctx, cam = this.camera;
    const left = cam.x - 30, right = cam.x + this.w / cam.scale + 30, bottom = cam.y + this.h / cam.scale + 60;
    // Sparse trees and boulders share the actual collision surface.
    for (let index = Math.floor(left / 105); index <= Math.ceil(right / 105); index++) {
      const x = index * 105 + hash(index + 71) * 65;
      const y = this.world.height(x);
      if (x < 165 && x > -60) continue;
      if (hash(index + 933) < p.trees * .37) this.pine(x, y + 4, 45 + hash(index + 45) * 100, '#14281b');
      else if (hash(index + 440) > .53) {
        const size = 4 + hash(index + 941) * 8;
        c.fillStyle = INK; c.beginPath(); c.moveTo(x - size, y + 2); c.lineTo(x - size * .65, y - size * .44); c.lineTo(x + size * .14, y - size * .65); c.lineTo(x + size * .75, y - size * .3); c.lineTo(x + size, y + 3); c.fill();
      }
    }
    c.fillStyle = INK;
    c.beginPath(); c.moveTo(left, bottom);
    for (let x = left; x <= right; x += 5) c.lineTo(x, this.world.height(x));
    c.lineTo(right, this.world.height(right)); c.lineTo(right, bottom); c.closePath(); c.fill();
    c.beginPath();
    for (let x = left; x <= right; x += 5) { const y = this.world.height(x); if (x === left) c.moveTo(x, y); else c.lineTo(x, y); }
    c.strokeStyle = '#b6d7c135'; c.lineWidth = .85 / cam.scale; c.stroke();
    c.strokeStyle = INK; c.lineWidth = 1;
    for (let i = Math.floor(left / 13); i < right / 13; i++) {
      if (hash(i + 430) < .27) continue;
      const x = i * 13 + hash(i) * 9, y = this.world.height(x) + 2, size = 2 + hash(i + 511) * 9;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 1, y - size * .8, x - 2 + Math.sin(this.time * 1.4 + i) * 2, y - size); c.moveTo(x, y); c.lineTo(x + 4, y - size * .65); c.stroke();
    }
    // Subtle strata keep the foreground from feeling like a flat black panel.
    c.strokeStyle = '#64766a0b'; c.lineWidth = 1;
    for (let j = 1; j <= 3; j++) {
      c.beginPath();
      for (let x = left; x <= right; x += 20) {
        const y = this.world.height(x) + 45 * j + noise(x / 70 + j) * 24;
        if (x === left) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  drawBike(s, intro) {
    const c = this.ctx;
    c.save(); c.translate(s.x, s.y); c.rotate(s.angle);
    const tiny = this.bikeStyle === 'tiny';
    if (tiny) { c.translate(0, 17 * .16); c.scale(.84, .84); }
    const wheel = WHEEL_RADIUS, half = WHEEL_BASE / 2;
    this.riderRig ??= new RiderRig();
    const pose = this.riderRig.update(s, this.frameDelta, intro);
    const { phase, crank, pedal, compression, hip, farHip, shoulder, hand, nearAnkle, farAnkle } = pose;
    this.pedalAngle = phase;
    const wheelPhase = s.x / WHEEL_RADIUS;
    c.strokeStyle = '#101c23'; c.fillStyle = '#101c23'; c.lineCap = 'round'; c.lineJoin = 'round';
    if (s.crashed) { c.rotate(Math.min(s.crashTime * 1.5, 1)); }
    if (this.riderSprite?.draw(c, pose, s)) { c.restore(); return; }
    for (const x of [-half, half]) {
      c.lineWidth = 2.4; c.beginPath(); c.arc(x, 7, wheel, 0, TAU); c.stroke();
      c.lineWidth = .55; c.globalAlpha = .7;
      for (let j = 0; j < 6; j++) { const a = wheelPhase + j * TAU / 6; c.beginPath(); c.moveTo(x, 7); c.lineTo(x + Math.cos(a) * 8.4, 7 + Math.sin(a) * 8.4); c.stroke(); }
      c.globalAlpha = 1; c.beginPath(); c.arc(x, 7, 1.5, 0, TAU); c.fill();
    }
    const seat = [-9, -9 + compression], stem = [13, -12 + compression];
    const path = (points, width) => { c.lineWidth = width; c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); };
    const [pedalX, pedalY] = pedal;
    const shoe = ankle => path([[ankle[0] - 1, ankle[1] + 1], [ankle[0] + 4, ankle[1] + 1]], 2.5);
    // Paint the far leg behind the frame, with the near leg in front of it.
    c.globalAlpha = .72;
    path([farHip, pose.farKnee, farAnkle], 3.8); shoe(farAnkle);
    c.globalAlpha = 1;
    path([[-half, 7], seat, crank, [-half, 7]], 2.1);
    path([seat, stem, crank, seat], 2.3);
    path([[half, 7], stem, [12, -16 + compression], [18, -16 + compression]], 2);
    path([seat, [-10, -13 + compression], [-15, -13 + compression], [-6, -13 + compression]], 2);
    if (this.bikeStyle !== 'hardtail') path([[-8, 1], [4, -4]], 2.5);
    path([[crank[0] - pedalX, crank[1] - pedalY], [crank[0] + pedalX, crank[1] + pedalY]], 1.6);
    // Far arm, then a filled shirt/shorts silhouette, small pack and near limbs.
    c.globalAlpha = .78;
    path([[shoulder[0] - 2, shoulder[1]], [pose.elbow[0] - 2, pose.elbow[1]], [hand[0] - 1, hand[1]]], 3);
    c.globalAlpha = 1;
    c.beginPath(); c.moveTo(hip[0] - 3, hip[1] + 1);
    c.bezierCurveTo(hip[0] - 6, hip[1] - 8, shoulder[0] - 7, shoulder[1] - 3, shoulder[0], shoulder[1] - 3);
    c.quadraticCurveTo(shoulder[0] + 5, shoulder[1] - 1, shoulder[0] + 3, shoulder[1] + 4);
    c.lineTo(hip[0] + 5, hip[1] + 3); c.closePath(); c.fill();
    // Compact backpack follows the spine rather than floating behind the rider.
    c.save(); c.translate((hip[0] + shoulder[0]) * .5 - 4, (hip[1] + shoulder[1]) * .5 - 3 + pose.packSway); c.rotate(.62);
    c.beginPath(); c.roundRect(-4, -7, 7.8, 13, 3); c.fill(); c.restore();
    path([hip, pose.nearKnee], 5.8); // shorts taper into the exposed lower leg
    path([pose.nearKnee, nearAnkle], 3.5); shoe(nearAnkle);
    path([shoulder, pose.elbow], 4.6); path([pose.elbow, hand], 3); c.beginPath(); c.arc(hand[0], hand[1], 1.9, 0, TAU); c.fill();
    path([shoulder, [pose.head[0] - 1, pose.head[1] + 3]], 3.6);
    c.save(); c.translate(...pose.head); c.rotate(pose.headTilt);
    c.beginPath(); c.ellipse(0, 0, 4.4, 5.1, -.12, 0, TAU); c.fill();
    // Profile, nose and a short forward cap brim, matching the supplied silhouette.
    c.beginPath(); c.moveTo(3, -1); c.lineTo(5.7, 1); c.lineTo(3.3, 2); c.lineTo(2, 4); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(-.5, -3.1, 5.8, 3.1, -.1, Math.PI, TAU); c.lineTo(5.1, -2.7); c.closePath(); c.fill();
    path([[1, -3.6], [8, -2.5]], 1.8); c.restore();
    c.restore();
  }
  drawParticles(dt, s, stopped, p) {
    const c = this.ctx;
    if (!stopped && s.grounded && s.vx > 120 && this.rng() < .6) this.particles.push({ x: s.x - 22, y: s.y + 15, vx: -25 - this.rng() * 35, vy: -5 - this.rng() * 35, life: .6, max: .6, size: .5 + this.rng() * 1.6 });
    this.particles = this.particles.filter(particle => particle.life > 0);
    for (const particle of this.particles) {
      if (!stopped) { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 55 * dt; particle.life -= dt; }
      c.globalAlpha = particle.life / particle.max * .4; c.fillStyle = p.rain > .5 ? '#d6e8dc' : '#a9c7b3'; c.beginPath(); c.arc(particle.x, particle.y, particle.size, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }
  burst(s) {
    for (let i = 0; i < 14; i++) this.particles.push({ x: s.x + (this.rng() - .5) * 45, y: s.y + 16, vx: (this.rng() - .5) * 80, vy: -this.rng() * 70, life: .7, max: .7, size: .5 + this.rng() * 1.8 });
  }
  drawForeground(p, s) {
    const c = this.ctx, { w, h } = this;
    // Close grass moves faster than the distant ridgelines.
    c.fillStyle = '#0b1810';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w + 15; x += 15) c.lineTo(x, h * .97 + noise((x + s.x * .6) / 160) * h * .04);
    c.lineTo(w + 15, h); c.closePath(); c.fill();
    const shift = ((s.x * .9) % 260 + 260) % 260;
    for (let i = -1; i < w / 260 + 1; i++) {
      const x = i * 260 - shift, y = h + 3;
      c.strokeStyle = '#09160e'; c.lineWidth = 1.5;
      for (let j = 0; j < 6; j++) {
        const size = 13 + hash(i * 6 + j) * 25;
        c.beginPath(); c.moveTo(x + j * 3, y); c.quadraticCurveTo(x + j * 4 + s.vx * .025, y - size * .6, x + j * 6 + s.vx * .04, y - size); c.stroke();
      }
    }
  }
  drawRain(amount, s) {
    const c = this.ctx, { w, h } = this;
    c.strokeStyle = '#e0ece4'; c.globalAlpha = amount * .2; c.lineWidth = .65;
    for (let i = 0; i < 100 * amount; i++) {
      const x = ((hash(i + 713) * w - this.time * (90 + s.vx * .25)) % w + w) % w;
      const y = (hash(i + 816) * h + this.time * (280 + hash(i) * 150)) % h;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 3 - s.vx * .018, y + 14); c.stroke();
    }
    c.globalAlpha = 1;
  }
  drawStructures(front) {
    const c = this.ctx, cam = this.camera;
    const left = cam.x - 300, right = cam.x + this.w / cam.scale + 300;
    for (const structure of this.world.structures) {
      const { x, type, width } = structure;
      if (x < left || x > right) continue;
      const y = this.world.height(x);
      c.fillStyle = INK; c.strokeStyle = INK; c.lineWidth = 3;
      if (type === 'cabin' && !front) {
        c.fillRect(x, y - 42, 65, 44); c.beginPath(); c.moveTo(x - 10, y - 39); c.lineTo(x + 29, y - 68); c.lineTo(x + 73, y - 39); c.fill();
        c.fillRect(x + 48, y - 67, 8, 25); c.fillStyle = '#b5d9bf'; c.globalAlpha = .22; c.fillRect(x + 11, y - 30, 11, 14); c.globalAlpha = 1;
      }
      if (type === 'bridge' && !front) {
        c.lineWidth = 2; c.beginPath();
        for (let bx = x; bx < x + width; bx += 22) { const by = this.world.height(bx); c.moveTo(bx, by); c.lineTo(bx, by - 30); }
        c.stroke(); c.beginPath(); c.moveTo(x, y - 26);
        for (let bx = x; bx <= x + width; bx += 10) c.lineTo(bx, this.world.height(bx) - 26);
        c.stroke();
      }
      if (type === 'tunnel' && front) {
        const endY = this.world.height(x + width);
        c.beginPath(); c.moveTo(x - 30, y - 180); c.quadraticCurveTo(x + width * .5, y - 240, x + width + 30, endY - 175); c.lineTo(x + width, endY - 80); c.quadraticCurveTo(x + width * .5, y - 100, x, y - 78); c.closePath(); c.fill();
        c.globalAlpha = .22; c.fillRect(x - 5, y - 80, 7, 85); c.fillRect(x + width - 3, endY - 80, 7, 85); c.globalAlpha = 1;
      }
      if (type === 'waterfall' && !front) {
        c.fillStyle = '#c9dfd03b'; c.fillRect(x + 50, y - 230, 17, 200); c.fillStyle = '#e2ece529'; c.fillRect(x + 57, y - 225, 4, 196);
        for (let i = 0; i < 9; i++) { c.globalAlpha = .07; c.beginPath(); c.ellipse(x + 55 + Math.sin(i) * 18, y - 20 + Math.cos(i) * 7, 13, 8, 0, 0, TAU); c.fill(); } c.globalAlpha = 1;
      }
    }
  }
}
