// AudioWorklet: a bank of damped complex resonators, one per membrane mode.
// Every strike, rub or sustained tone just injects energy into the resonators,
// so polyphony is free and the sound is exactly the superposition of modes.

class ModalBank extends AudioWorkletProcessor {
  constructor() {
    super();
    this.banks = new Map();
    this.fading = [];
    this.click = 0;
    this.clickLP = 0;
    this.clickCoef = 0.5;
    this.noiseLP = 0;
    this.noiseHP = 0;
    this.master = 1;
    this.seed = 22222;
    this.noiseBuf = new Float32Array(128);
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  makeBank(freqs, taus, old, pan) {
    const K = freqs.length;
    const b = old && old.K === K ? old : {
      K,
      zr: new Float64Array(K), zi: new Float64Array(K),
      cr: new Float64Array(K), ci: new Float64Array(K),
      pl: new Float32Array(K), pr: new Float32Array(K),
      drive: new Float32Array(K), driveLevel: 0, driveTarget: 0,
      tone: -1, toneLevel: 0, toneTarget: 0, tonePhase: 0, toneInc: 0,
      pan: 0, gain: 1,
    };
    b.pan = pan || 0;
    const nyq = sampleRate * 0.45;
    for (let k = 0; k < K; k++) {
      const f = freqs[k];
      const w = 2 * Math.PI * f / sampleRate;
      const r = f > 0 && f < nyq ? Math.exp(-1 / (Math.max(0.005, taus[k]) * sampleRate)) : 0;
      b.cr[k] = r * Math.cos(w);
      b.ci[k] = r * Math.sin(w);
      // spread modes gently across the stereo field (golden-ratio sequence)
      const p = (((k * 0.618034) % 1) - 0.5) * 0.7 + b.pan;
      const a = (Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4;
      b.pl[k] = Math.cos(a);
      b.pr[k] = Math.sin(a);
    }
    b.freqs = Float32Array.from(freqs);
    return b;
  }

  onMessage(m) {
    switch (m.type) {
      case 'bank': {
        const old = this.banks.get(m.id);
        const pan = m.pan !== undefined ? m.pan : (old ? old.pan : 0);
        const keep = old && !m.reset && old.K === m.freqs.length;
        if (old && !keep) { old.fade = 1; this.fading.push(old); }
        this.banks.set(m.id, this.makeBank(m.freqs, m.taus, keep ? old : null, pan));
        break;
      }
      case 'strike': {
        const b = this.banks.get(m.id);
        if (!b) break;
        const w = m.w;
        for (let k = 0; k < b.K && k < w.length; k++) b.zr[k] += w[k];
        this.click += m.click || 0;
        this.clickCoef = 0.08 + 0.85 * (m.hard || 0.5);
        break;
      }
      case 'drive': {
        const b = this.banks.get(m.id);
        if (!b) break;
        if (m.w) b.drive.set(m.w.subarray ? m.w.subarray(0, b.K) : m.w);
        b.driveTarget = m.level || 0;
        break;
      }
      case 'tone': {
        const b = this.banks.get(m.id);
        if (!b) break;
        if (m.k >= 0 && m.k < b.K) {
          if (b.tone !== m.k) b.tonePhase = 0;
          b.tone = m.k;
          b.toneInc = 2 * Math.PI * b.freqs[m.k] / sampleRate;
        }
        b.toneTarget = m.level || 0;
        break;
      }
      case 'mute': {
        for (const b of this.banks.values()) {
          this.fading.push(Object.assign({}, b, { zr: b.zr.slice(), zi: b.zi.slice(), fade: 1, tone: -1 }));
          b.zr.fill(0); b.zi.fill(0);
          b.driveTarget = 0; b.driveLevel = 0; b.toneTarget = 0; b.toneLevel = 0;
        }
        break;
      }
      case 'master':
        this.master = m.value;
        break;
    }
  }

  runBank(b, L, R, N, noise, gain) {
    const K = b.K;
    const { zr, zi, cr, ci, pl, pr, drive } = b;
    const dl0 = b.driveLevel;
    b.driveLevel += (b.driveTarget - b.driveLevel) * 0.25;
    const dl1 = b.driveLevel;
    const driving = dl0 > 1e-5 || dl1 > 1e-5;
    for (let k = 0; k < K; k++) {
      let r = zr[k], i = zi[k];
      const dw0 = driving ? drive[k] * dl0 : 0;
      const dw1 = driving ? drive[k] * dl1 : 0;
      if (!driving && Math.abs(r) + Math.abs(i) < 1e-7) { zr[k] = 0; zi[k] = 0; continue; }
      const a = cr[k], c = ci[k];
      const gl = pl[k] * gain, gr = pr[k] * gain;
      if (driving && (dw0 !== 0 || dw1 !== 0)) {
        const step = (dw1 - dw0) / N;
        let dw = dw0;
        for (let n = 0; n < N; n++) {
          const nr = r * a - i * c + dw * noise[n];
          i = r * c + i * a;
          r = nr;
          dw += step;
          L[n] += i * gl; R[n] += i * gr;
        }
      } else {
        for (let n = 0; n < N; n++) {
          const nr = r * a - i * c;
          i = r * c + i * a;
          r = nr;
          L[n] += i * gl; R[n] += i * gr;
        }
      }
      zr[k] = r; zi[k] = i;
    }
    // sustained pure tone for the mode explorer
    if (b.tone >= 0 && (b.toneLevel > 1e-5 || b.toneTarget > 0)) {
      let ph = b.tonePhase, lv = b.toneLevel;
      const tgt = b.toneTarget, inc = b.toneInc;
      const gl = pl[b.tone] * gain, gr = pr[b.tone] * gain;
      for (let n = 0; n < N; n++) {
        lv += (tgt - lv) * 0.0015;
        const s = Math.sin(ph) * lv;
        ph += inc;
        L[n] += s * gl; R[n] += s * gr;
      }
      b.tonePhase = ph % (2 * Math.PI);
      b.toneLevel = lv;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const N = L.length;
    // shared friction noise for rubbing (band-limited)
    const noise = this.noiseBuf;
    for (let n = 0; n < N; n++) {
      const w = this.rand();
      this.noiseLP += (w - this.noiseLP) * 0.35;
      this.noiseHP += (this.noiseLP - this.noiseHP) * 0.01;
      noise[n] = (this.noiseLP - this.noiseHP) * 0.02;
    }
    for (const b of this.banks.values()) this.runBank(b, L, R, N, noise, 1);
    for (let f = this.fading.length - 1; f >= 0; f--) {
      const b = this.fading[f];
      b.fade *= 0.9;
      b.driveTarget = 0;
      b.toneTarget = 0;
      this.runBank(b, L, R, N, noise, b.fade);
      if (b.fade < 1e-3) this.fading.splice(f, 1);
    }
    // stick click: a few ms of filtered noise
    if (this.click > 1e-4) {
      const decay = Math.exp(-1 / (0.0035 * sampleRate));
      for (let n = 0; n < N; n++) {
        this.clickLP += (this.rand() - this.clickLP) * this.clickCoef;
        const s = this.clickLP * this.click;
        this.click *= decay;
        L[n] += s; R[n] += s;
      }
    }
    const g = this.master;
    for (let n = 0; n < N; n++) {
      let x = L[n] * g;
      x = x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x);
      L[n] = x;
      if (R !== L) {
        let y = R[n] * g;
        y = y > 3 ? 1 : y < -3 ? -1 : y * (27 + y * y) / (27 + 9 * y * y);
        R[n] = y;
      }
    }
    return true;
  }
}

registerProcessor('modal-bank', ModalBank);
