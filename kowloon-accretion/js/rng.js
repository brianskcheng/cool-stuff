// Small deterministic helpers. Every city is a pure function of its seed.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) { this.r = mulberry32(seed >>> 0); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.r()); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
  gauss() {
    let u = 0, v = 0;
    while (u === 0) u = this.r();
    while (v === 0) v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  weighted(items) { // [[value, weight], ...]
    let total = 0; for (const [, w] of items) total += w;
    let x = this.r() * total;
    for (const [v, w] of items) { if ((x -= w) <= 0) return v; }
    return items[items.length - 1][0];
  }
}

export function hash(...n) {
  let h = 2166136261 >>> 0;
  for (const v of n) {
    h ^= (v * 2654435761) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  }
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const fract = (x) => x - Math.floor(x);
