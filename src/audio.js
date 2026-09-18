import { clamp } from './world.js';

export class Soundscape {
  constructor() { this.enabled = true; this.context = null; this.started = false; this.nextBell = 0; }
  async start() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        const ac = this.context;
        this.master = ac.createGain(); this.master.gain.value = .48; this.master.connect(ac.destination);
        this.filter = ac.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 6500; this.filter.connect(this.master);
        const buffer = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), data = buffer.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < data.length; i++) { brown = (brown + Math.random() * .04 - .02) / 1.015; data[i] = brown * 3; }
        this.wind = this.noise(buffer, 'lowpass', 800, .04);
        this.tyres = this.noise(buffer, 'bandpass', 1700, 0);
        this.rain = this.noise(buffer, 'highpass', 2300, 0);
        this.drone = ac.createGain(); this.drone.gain.value = .012; this.drone.connect(this.filter);
        [98, 146.83, 196, 246.94].forEach((frequency, i) => { const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = frequency; osc.detune.value = i % 2 ? 3 : -3; osc.connect(this.drone); osc.start(); });
      }
      await this.context.resume();
      this.started = true;
    } catch { this.started = false; }
  }
  noise(buffer, type, frequency, volume) {
    const ac = this.context, src = ac.createBufferSource(), filter = ac.createBiquadFilter(), gain = ac.createGain();
    src.buffer = buffer; src.loop = true; filter.type = type; filter.frequency.value = frequency; gain.gain.value = volume;
    src.connect(filter); filter.connect(gain); gain.connect(this.filter); src.start();
    return { gain, filter };
  }
  setEnabled(enabled) { this.enabled = enabled; if (enabled) this.start(); else if (this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, .15); }
  update(s, world, active) {
    if (!this.context || !this.started) return;
    const now = this.context.currentTime;
    const rain = world.chapterAt(s.x) === 5;
    const tunnel = world.inTunnel(s.x);
    this.master.gain.setTargetAtTime(this.enabled ? active ? .48 : .10 : 0, now, .3);
    this.filter.frequency.setTargetAtTime(s.crashed ? 320 : tunnel ? 1100 : 6500, now, .2);
    this.wind.gain.gain.setTargetAtTime(.035 + clamp(s.vx / 1800, 0, .2), now, .3);
    this.wind.filter.frequency.setTargetAtTime(250 + Math.max(0, s.vx) * 2.4, now, .15);
    this.tyres.gain.gain.setTargetAtTime(s.grounded && !s.crashed && active ? clamp(Math.abs(s.vx) / 1300, 0, .14) * (.75 + Math.sin(s.time * 67) * .25) : 0, now, .04);
    this.rain.gain.gain.setTargetAtTime(rain ? .16 : 0, now, 1.8);
    this.drone.gain.setTargetAtTime(tunnel ? .001 : .012, now, 1);
    if (active && !tunnel && now > this.nextBell) { this.nextBell = now + 9 + Math.random() * 10; this.tone([293.66, 392, 440, 587.33][Math.floor(Math.random() * 4)], .026, 4); }
  }
  tone(frequency, volume = .12, duration = .3, end = null) {
    if (!this.context || !this.enabled) return;
    const ac = this.context, now = ac.currentTime, osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, now);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(volume, now + .02); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain); gain.connect(this.filter); osc.start(); osc.stop(now + duration + .1);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  land(perfect) { this.tone(perfect ? 95 : 75, perfect ? .20 : .12, .25, 35); if (perfect) this.tone(587.33, .045, 1.5); }
  crash() { this.tone(90, .11, .5, 25); }
  rewind() { this.tone(160, .04, .45, 440); }
  thunder() { this.tone(38, .09, 3.5, 22); }
}
