// Everything you hear is synthesised: rain, the hum of 50 Hz transformers,
// mahjong tiles being washed upstairs, dripping pipes, hammers, jets.

export class Soundscape {
  constructor() { this.ctx = null; this.on = false; this.voices = new Map(); }

  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.5); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.on = true;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(comp);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.0);
    // reverb
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.35;
    this.verbIn.connect(this.verb); this.verb.connect(this.master);

    const len = ctx.sampleRate * 3;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0); for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }

    const loop = (buf, ...nodes) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      s.loopStart = Math.random(); s.start(0, Math.random() * 2);
      let n = s; for (const x of nodes) { n.connect(x); n = x; }
      return n;
    };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };

    this.rainG = gain(0); loop(this.white, filt('highpass', 500), filt('lowpass', 7000), this.rainG).connect(this.master);
    this.rainLow = gain(0); loop(this.brown, filt('lowpass', 400), this.rainLow).connect(this.master);
    this.cityG = gain(0); loop(this.brown, filt('lowpass', 260), this.cityG).connect(this.master);
    this.trafficG = gain(0);
    const tf = filt('bandpass', 700, 0.4);
    loop(this.white, tf, this.trafficG).connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = gain(250); lfo.connect(lg).connect(tf.frequency); lfo.start();
    this.humG = gain(0);
    for (const [f, a] of [[100, 1], [200, 0.35], [300, 0.15]]) { const o = ctx.createOscillator(); o.frequency.value = f; const g = gain(a); o.connect(g).connect(this.humG); o.start(); }
    this.humG.connect(this.master);
    this.windG = gain(0); loop(this.white, filt('bandpass', 380, 0.6), this.windG).connect(this.master);
    this.next = { tiles: 2, drip: 1, hammer: 3, bird: 2, demo: 1 };
  }

  stop() { if (!this.ctx) return; this.on = false; this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); }

  // one tile hitting another
  clack(t, gain = 0.25, pan = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400 + Math.random() * 1800; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(bp).connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); p.connect(this.verbIn); } else { g.connect(this.master); }
    s.start(t, Math.random() * 2, 0.08);
  }
  washTiles(intensity) {
    const t0 = this.ctx.currentTime + 0.05, pan = Math.random() * 1.6 - 0.8;
    const n = 25 + Math.floor(Math.random() * 40);
    for (let i = 0; i < n; i++) this.clack(t0 + Math.random() * 2.4, (0.05 + Math.random() * 0.12) * intensity, pan);
  }
  drip(intensity) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.04);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * intensity, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(this.verbIn); g.connect(this.master);
    o.start(t); o.stop(t + 0.15);
  }
  knock(intensity, freq = 700) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (let k = 0; k < 3; k++) {
      const tt = t + k * (0.28 + Math.random() * 0.1);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq * (0.9 + Math.random() * 0.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.2 * intensity, tt + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
      o.connect(g); g.connect(this.master); g.connect(this.verbIn); o.start(tt); o.stop(tt + 0.1);
    }
  }
  chirp(intensity) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 2000;
    for (let k = 0; k < n; k++) {
      const tt = t + k * 0.11;
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(base, tt); o.frequency.exponentialRampToValueAtTime(base * 1.5, tt + 0.07);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.05 * intensity, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.08);
      o.connect(g); g.connect(this.master); g.connect(this.verbIn); o.start(tt); o.stop(tt + 0.1);
    }
  }
  thud(intensity) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * intensity, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    s.connect(lp).connect(g); g.connect(this.master); g.connect(this.verbIn);
    s.start(t, Math.random() * 2, 1.5);
  }
  thunder(delay) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140 + Math.random() * 120;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.4, t + 0.15); g.gain.exponentialRampToValueAtTime(0.25, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    s.connect(lp).connect(g); g.connect(this.master); g.connect(this.verbIn);
    s.start(t, 0, 4.6);
  }

  planeVoice(id) {
    const ctx = this.ctx;
    const v = {};
    v.panner = ctx.createPanner();
    Object.assign(v.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 70, rolloffFactor: 1.1, maxDistance: 10000 });
    v.out = ctx.createGain(); v.out.gain.value = 0;
    v.out.connect(v.panner); v.panner.connect(this.master);
    const s = ctx.createBufferSource(); s.buffer = this.brown; s.loop = true; s.start();
    v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = 900;
    const roar = ctx.createGain(); roar.gain.value = 1.6;
    s.connect(v.lp).connect(roar).connect(v.out);
    const n = ctx.createBufferSource(); n.buffer = this.white; n.loop = true; n.start();
    v.hp = ctx.createBiquadFilter(); v.hp.type = 'bandpass'; v.hp.frequency.value = 1400; v.hp.Q.value = 0.8;
    const hiss = ctx.createGain(); hiss.gain.value = 0.35;
    n.connect(v.hp).connect(hiss).connect(v.out);
    v.whine = ctx.createOscillator(); v.whine.type = 'sawtooth'; v.whine.frequency.value = 2200;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 2400; wf.Q.value = 4;
    v.whineG = ctx.createGain(); v.whineG.gain.value = 0.05;
    v.whine.connect(wf).connect(v.whineG).connect(v.out); v.whine.start();
    v.srcs = [s, n, v.whine];
    this.voices.set(id, v);
    return v;
  }

  update(st) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, now = ctx.currentTime, dt = st.dt;
    const set = (p, v, tc = 0.4) => p.setTargetAtTime(v, now, tc);
    const close = st.mode === 'alley' ? 1 : st.mode === 'rooftop' ? 0.7 : 0.35;
    set(this.rainG.gain, st.rain * (0.18 + 0.1 * close));
    set(this.rainLow.gain, st.rain * 0.25);
    set(this.cityG.gain, st.density * 0.22 * close + 0.05);
    set(this.trafficG.gain, (1 - st.park * 0.6) * (0.03 + 0.03 * (1 - st.night)));
    set(this.humG.gain, st.density * (st.mode === 'alley' ? 0.035 : 0.006));
    set(this.windG.gain, st.mode === 'rooftop' || st.mode === 'ride' ? 0.05 : 0.015);

    const N = this.next;
    const tick = (k, rate, fn) => { N[k] -= dt; if (N[k] < 0) { N[k] = (0.4 + Math.random() * 1.2) / Math.max(rate, 0.01); if (rate > 0.005) fn(); } };
    tick('tiles', st.density * (0.12 + 0.25 * st.night) * close, () => this.washTiles(close));
    tick('drip', st.density * (st.mode === 'alley' ? 1.5 : 0.1) + st.rain * 0.3 * close, () => this.drip(close));
    tick('hammer', st.building * 0.6 * (1 - st.night), () => this.knock(0.5 + 0.5 * close, 500 + Math.random() * 500));
    tick('bird', st.park * (1 - st.night) * 0.9, () => this.chirp(1));
    tick('demo', st.demolishing * 1.2, () => (Math.random() < 0.6 ? this.thud(0.6) : this.knock(0.6, 180)));

    // listener
    const L = ctx.listener, p = st.camPos, f = st.camFwd, u = st.camUp;
    if (L.positionX) {
      set(L.positionX, p.x, 0.05); set(L.positionY, p.y, 0.05); set(L.positionZ, p.z, 0.05);
      set(L.forwardX, f.x, 0.05); set(L.forwardY, f.y, 0.05); set(L.forwardZ, f.z, 0.05);
      set(L.upX, u.x, 0.05); set(L.upY, u.y, 0.05); set(L.upZ, u.z, 0.05);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }

    const live = new Set();
    for (const pl of st.planes) {
      live.add(pl.id);
      const v = this.voices.get(pl.id) || this.planeVoice(pl.id);
      const P = v.panner;
      if (P.positionX) { set(P.positionX, pl.pos.x, 0.05); set(P.positionY, pl.pos.y, 0.05); set(P.positionZ, pl.pos.z, 0.05); }
      else P.setPosition(pl.pos.x, pl.pos.y, pl.pos.z);
      const dx = pl.pos.x - p.x, dy = pl.pos.y - p.y, dz = pl.pos.z - p.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const vr = -(pl.vel.x * dx + pl.vel.y * dy + pl.vel.z * dz) / dist; // closing speed
      const doppler = 343 / (343 - Math.max(-200, Math.min(200, vr)));
      set(v.whine.frequency, 2100 * doppler, 0.1);
      set(v.lp.frequency, Math.min(4000, 250 + 90000 / dist) * doppler, 0.1);
      set(v.out.gain, st.mode === 'ride' ? 0.55 : 1.0, 0.5);
    }
    for (const [id, v] of this.voices) {
      if (live.has(id)) continue;
      v.out.gain.setTargetAtTime(0, now, 0.4);
      for (const s of v.srcs) s.stop(now + 2);
      this.voices.delete(id);
    }
  }
}
