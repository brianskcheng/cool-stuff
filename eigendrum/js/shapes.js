// Shape helpers: presets, stroke smoothing and URL encoding.
// All coordinates are world metres, y up. A drum is a list of flat loops
// [x0, y0, x1, y1, ...], filled with the even-odd rule.

const TAU = Math.PI * 2;

export function loopArea(l) {
  let a = 0;
  const n = l.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += l[2 * i] * l[2 * j + 1] - l[2 * j] * l[2 * i + 1];
  }
  return a / 2;
}

export function loopsBBox(loops) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) {
    for (let i = 0; i < l.length; i += 2) {
      x0 = Math.min(x0, l[i]); x1 = Math.max(x1, l[i]);
      y0 = Math.min(y0, l[i + 1]); y1 = Math.max(y1, l[i + 1]);
    }
  }
  return { x0, y0, x1, y1 };
}

export function pointInLoops(x, y, loops) {
  let inside = false;
  for (const l of loops) {
    const n = l.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = l[2 * i], yi = l[2 * i + 1], xj = l[2 * j], yj = l[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function translate(loops, dx, dy) {
  return loops.map((l) => l.map((v, i) => v + (i % 2 ? dy : dx)));
}

function scaleLoops(loops, s) {
  return loops.map((l) => l.map((v) => v * s));
}

function poly(points) {
  const out = [];
  for (const [x, y] of points) out.push(x, y);
  return out;
}

function parametric(n, f) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = f((i / n) * TAU);
    out.push(x, y);
  }
  return out;
}

function koch(level, side) {
  const r = side / Math.sqrt(3);
  let pts = [0, 1, 2].map((k) => [r * Math.cos(Math.PI / 2 - (k * TAU) / 3), r * Math.sin(Math.PI / 2 - (k * TAU) / 3)]);
  for (let l = 0; l < level; l++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const dx = (bx - ax) / 3, dy = (by - ay) / 3;
      const p1 = [ax + dx, ay + dy], p2 = [ax + 2 * dx, ay + 2 * dy];
      // outward bump: the loop runs clockwise, so outward is a +60deg turn
      const c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3);
      const peak = [p1[0] + dx * c - dy * s, p1[1] + dx * s + dy * c];
      next.push([ax, ay], p1, peak, p2);
    }
    pts = next;
  }
  return poly(pts);
}

// Gordon-Webb-Wolpert isospectral pair, built from seven half-squares each.
export const GWW_A = [0, 0, 1, 0, 1, 1, 2, 1, 3, 2, 2, 2, 2, 3, 0, 1];
export const GWW_B = [0, 0, 1, 0, 0, 1, -1, 1, -1, -1, -2, -1, -1, -2, 0, -1];

export const PRESETS = {
  circle: {
    label: 'Circle',
    note: 'Bessel-function modes. Its overtones are irrational multiples of the fundamental, which is why a drum sounds like a thud rather than a note.',
    make: () => [parametric(160, (t) => [0.25 * Math.cos(t), 0.25 * Math.sin(t)])],
  },
  square: {
    label: 'Square',
    note: 'Modes come in mirror pairs: (m,n) and (n,m) share a pitch exactly. Symmetry shows up as doubled spectral lines.',
    make: () => [poly([[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]])],
  },
  triangle: {
    label: 'Triangle',
    note: 'The equilateral triangle is one of the few shapes whose modes are known in closed form (Lamé, 1833).',
    make: () => {
      const r = 0.34;
      return [parametric(3, (t) => [r * Math.cos(t + Math.PI / 2), r * Math.sin(t + Math.PI / 2) - 0.04])];
    },
  },
  ell: {
    label: 'L-shape',
    note: 'The first mode of this L-shaped membrane is the MATLAB logo. The re-entrant corner makes the mode singular there: no closed form exists.',
    make: () => [scaleLoops([poly([[-1, -1], [0, -1], [0, 0], [1, 0], [1, 1], [-1, 1]])], 0.22)[0]],
  },
  star: {
    label: 'Star',
    note: 'Sharp inward corners pin the membrane down. The low modes hide in the core and the tips only wake up high in the spectrum.',
    make: () => {
      const out = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.13 : 0.31;
        const a = Math.PI / 2 + (i * Math.PI) / 5;
        out.push(r * Math.cos(a), r * Math.sin(a) - 0.02);
      }
      return [out];
    },
  },
  heart: {
    label: 'Heart',
    note: 'One axis of mirror symmetry splits the modes into two families: symmetric and antisymmetric.',
    make: () => [parametric(180, (t) => {
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return [x * 0.0165, y * 0.0165 + 0.03];
    })],
  },
  ring: {
    label: 'Ring',
    note: 'A drum with a hole. You can hear the hole: it shifts the constant term in Weyl’s law by 1/6.',
    make: () => [
      parametric(160, (t) => [0.27 * Math.cos(t), 0.27 * Math.sin(t)]),
      parametric(90, (t) => [0.1 * Math.cos(t) + 0.03, 0.1 * Math.sin(t) + 0.02]),
    ],
  },
  koch: {
    label: 'Snowflake',
    note: 'A fractal drum. Its rim has infinite length, so the Weyl perimeter term breaks down (the Weyl–Berry conjecture).',
    make: () => [koch(3, 0.48)],
  },
  stadium: {
    label: 'Stadium',
    note: 'Bunimovich’s stadium: a ball bouncing inside it is chaotic. Its modes scar and its pitches repel each other, the fingerprint of quantum chaos.',
    make: () => {
      const r = 0.15, L = 0.17, out = [];
      for (let i = 0; i <= 40; i++) { const t = -Math.PI / 2 + (i / 40) * Math.PI; out.push(L + r * Math.cos(t), r * Math.sin(t)); }
      for (let i = 0; i <= 40; i++) { const t = Math.PI / 2 + (i / 40) * Math.PI; out.push(-L + r * Math.cos(t), r * Math.sin(t)); }
      return [out];
    },
  },
};

export function randomBlob(seed = Math.random() * 1e9) {
  let s = seed >>> 0 || 7;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const terms = [];
  for (let k = 2; k <= 7; k++) terms.push([k, (rand() - 0.3) * 0.5 / k, rand() * TAU]);
  const R = 0.2 + rand() * 0.08;
  return [parametric(180, (t) => {
    let r = 1;
    for (const [k, a, p] of terms) r += a * Math.cos(k * t + p);
    r = Math.max(0.25, r) * R;
    return [r * Math.cos(t), r * Math.sin(t)];
  })];
}

// --- freehand strokes ------------------------------------------------------

function resample(pts, spacing) {
  // pts: [[x,y],...] closed polyline -> evenly spaced points
  const out = [];
  const n = pts.length;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    const seg = Math.hypot(bx - ax, by - ay);
    let d = carry;
    while (d < seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      d += spacing;
    }
    carry = d - seg;
  }
  return out;
}

function chaikin(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  return out;
}

// Turn a raw pointer trail into a clean closed loop (or null if too small).
export function strokeToLoop(raw, minArea) {
  if (raw.length < 6) return null;
  let perim = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let pts = resample(raw, perim / 200);
  pts = chaikin(chaikin(pts));
  let p2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    p2 += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const count = Math.max(40, Math.min(240, Math.round(p2 / 0.006)));
  pts = resample(pts, p2 / count);
  const flat = poly(pts);
  if (Math.abs(loopArea(flat)) < minArea) return null;
  return flat;
}

// --- URL encoding ------------------------------------------------------------

export function encodeLoops(loops) {
  const ints = [loops.length];
  for (const l of loops) {
    ints.push(l.length / 2);
    for (const v of l) ints.push(Math.round(v * 2000));
  }
  const buf = new Int16Array(ints);
  let bin = '';
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLoops(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ints = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    let k = 0;
    const nl = ints[k++];
    if (!(nl > 0 && nl < 20)) return null;
    const loops = [];
    for (let i = 0; i < nl; i++) {
      const np = ints[k++];
      if (!(np >= 3 && np <= 2000) || k + 2 * np > ints.length) return null;
      const l = [];
      for (let j = 0; j < 2 * np; j++) l.push(ints[k++] / 2000);
      loops.push(l);
    }
    return loops;
  } catch (e) {
    return null;
  }
}
