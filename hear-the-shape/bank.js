/*
 * AudioWorklet: a bank of modal resonators — one per eigenmode of each drum.
 *
 * A strike is a velocity impulse: every mode k receives  i·a_k  in its complex
 * state, then rings as  a_k · e^(−t/τ_k) · sin(ω_k t). Output = Σ g_k · Re(z_k),
 * where g_k (per channel) is how strongly that mode radiates to the listener.
 */
class ModalBank extends AudioWorkletProcessor {
  constructor() {
    super();
    this.slots = [];
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === 'modes') {
      const K = m.freqs.length;
      const s = {
        K,
        cr: new Float64Array(K), ci: new Float64Array(K),
        zr: new Float64Array(K), zi: new Float64Array(K),
        gl: new Float32Array(K), gr: new Float32Array(K),
        inc: new Float64Array(K), ph: new Float64Array(K),
        sus: new Float32Array(K), susT: new Float32Array(K),
        noise: 0, nlp: 0, tone: 0.35,
      };
      for (let k = 0; k < K; k++) {
        const f = m.freqs[k];
        if (!(f > 0) || f > 0.45 * sampleRate) continue;
        const w = 2 * Math.PI * f / sampleRate;
        const r = Math.exp(-1 / (m.decays[k] * sampleRate));
        s.cr[k] = r * Math.cos(w);
        s.ci[k] = r * Math.sin(w);
        s.inc[k] = w;
        s.gl[k] = m.gainL[k];
        s.gr[k] = m.gainR[k];
      }
      this.slots[m.slot] = s;
    } else if (m.type === 'strike') {
      const s = this.slots[m.slot];
      if (!s) return;
      for (let k = 0; k < s.K; k++) s.zi[k] += m.amps[k];
      s.noise = Math.max(s.noise, m.noise || 0);
      s.tone = m.tone || 0.35;
    } else if (m.type === 'sustain') {
      const s = this.slots[m.slot];
      if (s && m.k < s.K) s.susT[m.k] = m.gain;
    } else if (m.type === 'hush') {
      for (const s of this.slots) {
        if (!s) continue;
        s.susT.fill(0);
        if (m.hard) { s.zr.fill(0); s.zi.fill(0); s.sus.fill(0); s.noise = 0; }
      }
    } else if (m.type === 'drop') {
      this.slots[m.slot] = null;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const N = L.length;
    for (let i = 0; i < N; i++) { L[i] = 0; if (R !== L) R[i] = 0; }
    for (const s of this.slots) {
      if (!s) continue;
      for (let k = 0; k < s.K; k++) {
        const gl = s.gl[k], gr = s.gr[k];
        let zr = s.zr[k], zi = s.zi[k];
        if (Math.abs(zr) + Math.abs(zi) > 1e-7) {
          const cr = s.cr[k], ci = s.ci[k];
          for (let i = 0; i < N; i++) {
            const nr = zr * cr - zi * ci;
            zi = zr * ci + zi * cr;
            zr = nr;
            L[i] += gl * zr;
            R[i] += gr * zr;
          }
          s.zr[k] = zr; s.zi[k] = zi;
        } else if (zr !== 0 || zi !== 0) {
          s.zr[k] = 0; s.zi[k] = 0;
        }
        // sustained (bowed / held) mode: a slowly enveloped sine at the mode frequency
        let a = s.sus[k];
        const t = s.susT[k];
        if (a !== 0 || t !== 0) {
          let ph = s.ph[k];
          const inc = s.inc[k];
          for (let i = 0; i < N; i++) {
            a += (t - a) * 0.0008;
            const v = a * Math.sin(ph);
            ph += inc;
            L[i] += gl * v;
            R[i] += gr * v;
          }
          if (t === 0 && Math.abs(a) < 1e-5) a = 0;
          s.sus[k] = a;
          s.ph[k] = ph % (2 * Math.PI);
        }
      }
      // the stick: a few milliseconds of high-passed noise
      if (s.noise > 1e-4) {
        let nlp = s.nlp, amp = s.noise;
        const tone = s.tone;
        for (let i = 0; i < N; i++) {
          const w = Math.random() * 2 - 1;
          nlp += (w - nlp) * tone;
          const v = (w - nlp) * amp;
          amp *= 0.9962;
          L[i] += v; R[i] += v;
        }
        s.nlp = nlp; s.noise = amp;
      }
    }
    return true;
  }
}

registerProcessor('modal-bank', ModalBank);
