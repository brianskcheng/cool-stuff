// Sound: maps eigenpairs to resonators in the worklet; reverb; microphone analysis.

export const MATERIALS = {
  // law 'sqrt': membrane, f = c·√λ / 2π.  law 'lin': plate dispersion, f = κ·λ.
  skin: { label: 'Skin', law: 'sqrt', k: 287, tau: 1.25, alpha: 0.7, tilt: -0.1, vol: 0.62 },
  steel: { label: 'Steel', law: 'lin', k: 31, tau: 5.5, alpha: 0.55, tilt: -0.3, vol: 0.3 },
  glass: { label: 'Glass', law: 'lin', k: 96, tau: 3.2, alpha: 0.3, tilt: -0.45, vol: 0.22 },
};

const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function noteName(f) {
  const m = 69 + 12 * Math.log2(f / 440);
  const r = Math.round(m);
  const cents = Math.round((m - r) * 100);
  return { name: NOTE[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1), cents };
}

/*
 * The voice of one drum: frequencies, decay times and how strongly each mode
 * reaches the left/right ear. `drum` supplies λ_k (physical, ascending), the
 * normalised mode shapes φ̂_k (RMS 1) and their mean V_k ("volume velocity").
 */
export function voiceModel(drum, materialKey, semitones, lam1Ref) {
  const m = MATERIALS[materialKey];
  const K = drum.K;
  const tune = Math.pow(2, semitones / 12);
  const freqs = new Float32Array(K), decays = new Float32Array(K);
  const gainL = new Float32Array(K), gainR = new Float32Array(K);
  const law = (lam) => (m.law === 'sqrt' ? (m.k * Math.sqrt(lam)) / (2 * Math.PI) : m.k * lam) * tune;
  const f1 = law(lam1Ref || drum.lam[0]);
  // each ear hears a handful of points on its side (a spread pickup, not one hot spot)
  const ear = (nodes, k) => nodes.reduce((s, t) => s + drum.phiAtNode(k, t), 0) / Math.sqrt(nodes.length);
  const [qL, qR] = drum.pickups;
  for (let k = 0; k < K; k++) {
    const f = law(drum.lam[k]);
    freqs[k] = f;
    decays[k] = m.tau * Math.pow(f1 / f, m.alpha);
    const tilt = Math.pow(f / f1, m.tilt);
    const pv = 1 - m.vol;
    gainL[k] = tilt * (m.vol * drum.V[k] + pv * 0.45 * ear(qL, k));
    gainR[k] = tilt * (m.vol * drum.V[k] + pv * 0.45 * ear(qR, k));
  }
  return { freqs, decays, gainL, gainR, f1 };
}

export function malletFilter(voice, hardness) {
  const fc = 260 * Math.pow(2, hardness * 5.8);
  const out = new Float32Array(voice.freqs.length);
  for (let k = 0; k < out.length; k++) out[k] = Math.exp(-((voice.freqs[k] / fc) ** 2));
  return out;
}

// Loudness proxy: energy of the ringing modes over roughly the first half second.
function loudness(voice, amps) {
  let e = 0;
  for (let k = 0; k < amps.length; k++) {
    const g = Math.max(Math.abs(voice.gainL[k]), Math.abs(voice.gainR[k]));
    e += (amps[k] * g) ** 2 * Math.min(voice.decays[k], 0.6);
  }
  return Math.sqrt(e);
}

// Scale a voice so a felt strike at `node` (normally the fundamental's antinode) has a fixed loudness.
export function normaliseVoice(drum, voice, node) {
  const mf = malletFilter(voice, 0.45);
  const amps = new Float32Array(drum.K).map((_, k) => drum.phiAtNode(k, node) * mf[k]);
  const scale = 0.2 / (loudness(voice, amps) + 1e-9);
  for (let k = 0; k < drum.K; k++) { voice.gainL[k] *= scale; voice.gainR[k] *= scale; }
  voice.ref = 0.2;
  return voice;
}

// Mode amplitudes for a strike, given each mode's value at the strike point. Loudness is
// only partly normalised: edges still sound thinner, hard mallets brighter, but nothing explodes.
export function strikeAmps(voice, phis, hardness, vel = 1) {
  const mf = malletFilter(voice, hardness);
  const amps = new Float32Array(phis.length).map((_, k) => phis[k] * mf[k]);
  const f = vel * Math.min(2, Math.max(0.3, Math.pow(voice.ref / (loudness(voice, amps) + 1e-9), 0.6)));
  for (let k = 0; k < amps.length; k++) amps[k] *= f;
  return amps;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.ready = null;
    this.analyser = null;
    this.micData = null;
  }

  ensure() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ready;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.ready = (async () => {
      await this.ctx.audioWorklet.addModule(new URL('./bank.js', import.meta.url));
      const ctx = this.ctx;
      this.node = new AudioWorkletNode(ctx, 'modal-bank', { numberOfInputs: 0, outputChannelCount: [2] });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5;
      comp.attack.value = 0.002; comp.release.value = 0.25;
      const master = ctx.createGain(); master.gain.value = 0.9;
      const dry = ctx.createGain(); dry.gain.value = 1;
      const wet = ctx.createGain(); wet.gain.value = 0.3;
      const verb = ctx.createConvolver();
      verb.buffer = this.impulse(2.8);
      this.node.connect(dry).connect(comp);
      this.node.connect(verb).connect(wet).connect(comp);
      comp.connect(master).connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
    })();
    return this.ready;
  }

  impulse(seconds) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const coef = 0.55 - 0.45 * Math.min(1, t / seconds); // the tail darkens
        lp += (Math.random() * 2 - 1 - lp) * coef;
        const early = t < 0.08 ? 0.6 * Math.exp(-t * 30) : 0;
        d[i] = lp * (Math.exp(-t / (seconds * 0.22)) + early) * (t < 0.006 ? t / 0.006 : 1);
      }
    }
    return buf;
  }

  send(msg, transfer) { if (this.node) this.node.port.postMessage(msg, transfer || []); }

  setVoice(slot, voice) {
    this.send({ type: 'modes', slot, freqs: voice.freqs, decays: voice.decays, gainL: voice.gainL, gainR: voice.gainR });
  }

  strike(slot, amps, hardness) {
    this.send({ type: 'strike', slot, amps, noise: 0.012 + 0.05 * hardness * hardness, tone: 0.15 + 0.5 * (1 - hardness) });
  }

  sustain(slot, k, gain) { this.send({ type: 'sustain', slot, k, gain }); }
  hush(hard = false) { this.send({ type: 'hush', hard }); }
  drop(slot) { this.send({ type: 'drop', slot }); }

  async enableMic() {
    await this.ensure();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 8192;
    an.smoothingTimeConstant = 0.55;
    src.connect(an);
    this.micStream = stream;
    this.analyser = an;
    this.micData = new Float32Array(an.frequencyBinCount);
    this.binHz = this.ctx.sampleRate / an.fftSize;
  }

  disableMic() {
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.analyser = null;
  }

  // dB spectrum of the microphone, or null
  micSpectrum() {
    if (!this.analyser) return null;
    this.analyser.getFloatFrequencyData(this.micData);
    return this.micData;
  }
}
