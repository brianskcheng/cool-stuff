// Small synthesised cues. Nothing is sampled.
export class Sound {
  constructor() { this.ctx = null; this.on = true; }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.55;
    const verb = this.ctx.createConvolver();
    verb.buffer = this.impulse(2.2);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.35;
    this.out.connect(this.ctx.destination);
    this.out.connect(verb).connect(wet).connect(this.ctx.destination);
  }

  impulse(sec) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * sec), b = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return b;
  }

  tone(f, t0, dur, gain, { type = 'sine', pan = 0, glide = 0 } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(f * glide, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  ready() { return this.on && this.ctx && this.ctx.state === 'running'; }

  step() {
    if (!this.ready()) return;
    const c = this.ctx, t = c.currentTime, n = Math.floor(c.sampleRate * 0.05);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 400; f.Q.value = 0.8; g.gain.value = 0.05;
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
  }

  // crossing a seam: straight is a plain ping; twisted plays it mirrored — falling, and swapping ears
  seam(twisted) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    if (!twisted) { this.tone(1046.5, t, 0.9, 0.06, { pan: 0 }); return; }
    this.tone(1318.5, t, 0.7, 0.07, { pan: -0.7, glide: 0.5 });
    this.tone(659.25, t + 0.12, 1.1, 0.06, { pan: 0.7, glide: 2 });
  }

  success() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.tone(f, t + k * 0.09, 1.6, 0.07, { pan: (k - 1.5) * 0.3 }));
  }

  fail() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.tone(196, t, 0.35, 0.12, { type: 'triangle', glide: 0.8 });
    this.tone(185, t + 0.08, 0.3, 0.08, { type: 'triangle', glide: 0.8 });
  }

  take() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.tone(880, t, 0.25, 0.06, { type: 'triangle' });
    this.tone(1320, t + 0.06, 0.35, 0.05);
  }

  portal() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [392, 523.25, 659.25, 987.77].forEach((f, k) => this.tone(f, t + k * 0.07, 2.2, 0.05, { glide: 1.01 }));
  }
}
