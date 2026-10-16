// Main-thread side of the audio engine: context, worklet node, room reverb.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.ready = false;
  }

  async init() {
    if (this.ctx) return this.ready;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC({ latencyHint: 'interactive' });
    try {
      await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    } catch (e) {
      console.warn('AudioWorklet unavailable', e);
      return false;
    }
    const ctx = this.ctx;
    this.node = new AudioWorkletNode(ctx, 'modal-bank', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.out = ctx.createGain();
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeRoom(2.4);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    this.node.connect(this.dry);
    this.node.connect(this.verb);
    this.verb.connect(this.wet);
    this.dry.connect(this.out);
    this.wet.connect(this.out);
    this.out.connect(comp);
    comp.connect(ctx.destination);
    this.dry.gain.value = 0.9;
    this.wet.gain.value = 0.22;
    this.out.gain.value = 0.9;
    this.ready = true;
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  makeRoom(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const env = Math.exp(-t * 3.2) * (t < 0.012 ? t / 0.012 : 1);
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * Math.min(1, t / seconds));
        d[i] = lp * env * 0.6;
      }
    }
    return buf;
  }

  send(msg, transfer) {
    if (this.node) this.node.port.postMessage(msg, transfer || []);
  }

  setBank(id, freqs, taus, opts = {}) {
    this.send({ type: 'bank', id, freqs: Float32Array.from(freqs), taus: Float32Array.from(taus), reset: !!opts.reset, pan: opts.pan });
  }

  strike(id, weights, click, hard) {
    this.resume();
    this.send({ type: 'strike', id, w: Float32Array.from(weights), click, hard });
  }

  drive(id, weights, level) {
    this.send({ type: 'drive', id, w: weights ? Float32Array.from(weights) : null, level });
  }

  tone(id, k, level) {
    this.resume();
    this.send({ type: 'tone', id, k, level });
  }

  mute() {
    this.send({ type: 'mute' });
  }

  setReverb(v) {
    if (this.wet) this.wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
}
