// The plan of the city and the life of every lot in it.
// Lots come from a binary space partition with alleys left in the cuts;
// each lot then gets a history: hut -> low concrete -> tower -> rubble.

import { RNG, clamp, lerp } from './rng.js';
import { FLOOR_H, HEIGHT_CAP, DEMO_START, STREETS } from './history.js';

// Rough outline of the walled city, metres, x east / z south.
const OUTLINE = [[-104, -56], [-62, -61], [-8, -64], [48, -60], [101, -57], [108, -22], [106, 18],
  [103, 52], [58, 60], [4, 63], [-46, 59], [-99, 54], [-110, 22], [-109, -24]];

export const YAMEN = { x0: -13, x1: 15, z0: -2, z1: 12 };
const YAMEN_CLEAR = 3.2;

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToEdge(x, z, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

const PALETTE_HUT = [[0.40, 0.35, 0.29], [0.46, 0.40, 0.33], [0.36, 0.33, 0.30], [0.50, 0.38, 0.28]];
const PALETTE = [
  [0.80, 0.78, 0.72], [0.64, 0.76, 0.68], [0.84, 0.78, 0.60], [0.62, 0.70, 0.76], [0.82, 0.64, 0.58],
  [0.60, 0.60, 0.58], [0.86, 0.86, 0.82], [0.76, 0.64, 0.44], [0.70, 0.74, 0.62], [0.74, 0.70, 0.66],
];

function facade(rng, kind) {
  const base = rng.pick(kind === 0 ? PALETTE_HUT : PALETTE);
  const k = rng.range(0.82, 1.04);
  return {
    color: base.map((c) => clamp(c * k + rng.range(-0.03, 0.03), 0, 1)),
    spacing: kind === 0 ? rng.range(2.2, 3.4) : rng.range(1.45, 2.5),
    style: kind === 0 ? 0 : rng.weighted([[0, 4], [1, 4], [2, 2], [3, 1]]),
    seed: Math.floor(rng.next() * 65535),
  };
}

export function generateCity(seed) {
  const rng = new RNG(seed);
  const poly = OUTLINE.map(([x, z]) => [x + rng.range(-5, 5), z + rng.range(-4, 4)]);
  const raw = [];
  const alleys = [];

  const yz = { x0: YAMEN.x0 - YAMEN_CLEAR, x1: YAMEN.x1 + YAMEN_CLEAR, z0: YAMEN.z0 - YAMEN_CLEAR, z1: YAMEN.z1 + YAMEN_CLEAR };
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

  function split(r, depth) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const target = depth < 3 ? 0 : rng.range(45, 170);
    if (depth >= 3 && (w * d < target || Math.min(w, d) < 6.5)) return raw.push(r);
    let vertical = w > d;
    if (Math.max(w, d) / Math.min(w, d) < 1.35 && rng.chance(0.35)) vertical = !vertical;
    let gap;
    if (depth <= 1) gap = rng.range(2.6, 3.6);
    else if (depth <= 3) gap = rng.chance(0.78) ? rng.range(1.3, 2.3) : 0;
    else gap = rng.chance(0.28) ? rng.range(1.0, 1.7) : 0;
    const len = vertical ? w : d;
    if (len - gap < 9) return raw.push(r);
    const cut = (vertical ? r.x0 : r.z0) + len * rng.range(0.33, 0.67);
    let a, b;
    if (vertical) {
      a = { x0: r.x0, x1: cut - gap / 2, z0: r.z0, z1: r.z1 };
      b = { x0: cut + gap / 2, x1: r.x1, z0: r.z0, z1: r.z1 };
      if (gap > 0) alleys.push({ axis: 'z', c: cut, a0: r.z0, a1: r.z1, w: gap, depth });
    } else {
      a = { x0: r.x0, x1: r.x1, z0: r.z0, z1: cut - gap / 2 };
      b = { x0: r.x0, x1: r.x1, z0: cut + gap / 2, z1: r.z1 };
      if (gap > 0) alleys.push({ axis: 'x', c: cut, a0: r.x0, a1: r.x1, w: gap, depth });
    }
    split(a, depth + 1);
    split(b, depth + 1);
  }
  split({ x0: -116, x1: 114, z0: -68, z1: 68 }, 0);

  const lots = [];
  for (const r of raw) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    if (!pointInPoly(cx, cz, poly)) continue;
    if ((r.x1 - r.x0) * (r.z1 - r.z0) < 22) continue;
    if (overlaps(r, yz)) continue;
    lots.push({ ...r, cx, cz, id: lots.length });
  }

  // Which side faces what: party wall, alley (and how wide), or the street outside.
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // +x, -x, +z, -z
  for (const L of lots) {
    L.sides = SIDES.map(([sx, sz]) => {
      let best = { gap: 99, nbr: -1 };
      for (const M of lots) {
        if (M === L) continue;
        let gap, ov;
        if (sx) {
          gap = sx > 0 ? M.x0 - L.x1 : L.x0 - M.x1;
          ov = Math.min(L.z1, M.z1) - Math.max(L.z0, M.z0);
        } else {
          gap = sz > 0 ? M.z0 - L.z1 : L.z0 - M.z1;
          ov = Math.min(L.x1, M.x1) - Math.max(L.x0, M.x0);
        }
        if (gap > -0.05 && gap < best.gap && ov > 1.0) best = { gap: Math.max(gap, 0), nbr: M.id };
      }
      // overlap with the yamen clearing counts as open courtyard
      const probe = sx ? { x0: sx > 0 ? L.x1 : L.x0 - 1, x1: sx > 0 ? L.x1 + 1 : L.x0, z0: L.z0, z1: L.z1 }
        : { x0: L.x0, x1: L.x1, z0: sz > 0 ? L.z1 : L.z0 - 1, z1: sz > 0 ? L.z1 + 1 : L.z0 };
      const courtyard = overlaps(probe, yz);
      const street = best.nbr < 0 || best.gap > 7;
      return { gap: street ? 12 : best.gap, nbr: street ? -1 : best.nbr, street: street && !courtyard, courtyard };
    });
    L.edge = distToEdge(L.cx, L.cz, poly);
    L.perimeter = L.sides.some((s) => s.street);
  }

  // Lives of the lots.
  let xmin = Infinity, xmax = -Infinity;
  for (const L of lots) { xmin = Math.min(xmin, L.cx); xmax = Math.max(xmax, L.cx); }
  for (const L of lots) {
    const gens = [];
    const hutStart = rng.chance(0.18) ? 1947 : 1947 + rng.range(0.2, 9.5) * (0.6 + 0.4 * clamp(L.edge / 40, 0, 1));
    gens.push({ kind: 0, start: hutStart, build: 0.25, floors: rng.weighted([[1, 5], [2, 5], [3, 1]]) });
    let t = hutStart;
    if (rng.chance(0.68)) {
      const s = Math.max(t + 3, rng.range(1956, 1969.5));
      gens.push({ kind: 1, start: s, build: rng.range(0.5, 1.0), floors: rng.int(3, 7) });
      t = s;
    }
    if (rng.chance(0.94)) {
      const s = Math.max(t + 4.5, 1963.5 + (rng.next() + rng.next()) * 9.5);
      const fl = Math.min(HEIGHT_CAP, rng.weighted([[14, 30], [13, 22], [12, 16], [11, 10], [10, 8], [9, 5], [8, 4], [7, 3]]));
      gens.push({ kind: 2, start: s, build: 0.7 + fl * 0.06, floors: fl });
    }
    for (const g of gens) {
      Object.assign(g, facade(rng, g.kind));
      g.ovh = L.sides.map((sd) => {
        if (g.kind === 0) return 0;
        if (sd.street) return rng.chance(0.6) ? rng.range(0.2, 0.9) : 0;
        if (sd.courtyard) return rng.range(0, 0.6);
        if (sd.gap < 0.9) return 0;
        return clamp(Math.min(sd.gap / 2 - 0.22, rng.range(0.3, 1.4)), 0, 1.5) * (g.kind === 1 ? 0.5 : 1);
      });
      g.grimeRate = rng.range(0.6, 1.4);
      if (g.kind === 2 && g.floors < HEIGHT_CAP && rng.chance(0.4)) {
        const fx = rng.range(0.35, 0.7), fz = rng.range(0.35, 0.7);
        const w = L.x1 - L.x0, d = L.z1 - L.z0;
        const ox = rng.range(0, 1 - fx) * w, oz = rng.range(0, 1 - fz) * d;
        g.shack = { x0: L.x0 + ox, x1: L.x0 + ox + fx * w, z0: L.z0 + oz, z1: L.z0 + oz + fz * d, year: s0(g) + rng.range(2, 12) };
      }
    }
    L.gens = gens;
    L.last = gens[gens.length - 1];
    const sweep = (L.cx - xmin) / (xmax - xmin);
    L.demoStart = DEMO_START + 0.04 + sweep * 0.86 + rng.range(-0.04, 0.06);
    L.demoDur = 0.06 + L.last.floors * 0.006;
    L.evac = lerp(1989.8, 1992.6, rng.next());
    L.area = (L.x1 - L.x0) * (L.z1 - L.z0);
  }

  // Alleys clipped to the outline: these are the walkable centrelines.
  const segs = [];
  for (const a of alleys) {
    let run = null;
    for (let s = a.a0; s <= a.a1; s += 1) {
      const x = a.axis === 'z' ? a.c : s, z = a.axis === 'z' ? s : a.c;
      const ok = pointInPoly(x, z, poly) && !(x > yz.x0 && x < yz.x1 && z > yz.z0 && z < yz.z1);
      if (ok) { if (!run) run = { s0: s, s1: s }; else run.s1 = s; }
      if ((!ok || s + 1 > a.a1) && run) {
        if (run.s1 - run.s0 > 8) segs.push({ axis: a.axis, c: a.c, s0: run.s0, s1: run.s1, w: a.w, depth: a.depth });
        run = null;
      }
    }
  }
  segs.sort((p, q) => p.depth - q.depth || (q.s1 - q.s0) - (p.s1 - p.s0));
  segs.forEach((s, i) => { s.id = i; s.name = STREETS[i % STREETS.length]; });

  const city = { seed, poly, lots, segs, yamen: YAMEN };
  calibrate(city);
  return city;
}

const s0 = (g) => g.start + g.build;

// --- state at a given year -------------------------------------------------

export function lotState(L, t) {
  if (t >= L.demoStart) {
    const f = clamp(1 - (t - L.demoStart) / L.demoDur, 0, 1);
    return { gen: L.last, floors: Math.ceil(L.last.floors * f), building: false, demolishing: f < 1 && f > 0 };
  }
  let g = null;
  for (const x of L.gens) if (x.start <= t) g = x;
  if (!g) return { gen: null, floors: 0, building: false };
  const p = (t - g.start) / g.build;
  if (p < 1) return { gen: g, floors: Math.max(1, Math.ceil(g.floors * p)), building: true };
  return { gen: g, floors: g.floors, building: false };
}

export function occupancy(L, t) {
  if (t > L.evac) return clamp(1 - (t - L.evac) / 0.6, 0, 1);
  return 1;
}

// Footprint of the tower above the podium, grown by the overhangs.
export function upperRect(L, g) {
  const o = g.ovh;
  return { x0: L.x0 - o[1], x1: L.x1 + o[0], z0: L.z0 - o[3], z1: L.z1 + o[2] };
}

function gfa(L, st) {
  if (!st.gen || !st.floors) return 0;
  const u = upperRect(L, st.gen);
  const ua = (u.x1 - u.x0) * (u.z1 - u.z0);
  const fl = st.floors;
  const area = Math.min(fl, 2) * L.area + Math.max(0, fl - 2) * ua;
  return st.gen.kind === 0 ? area * 1.7 : area;
}

function calibrate(city) {
  let peak = 0;
  for (let t = 1980; t <= 1989; t += 1) {
    let s = 0; for (const L of city.lots) s += gfa(L, lotState(L, t));
    peak = Math.max(peak, s);
  }
  city.popScale = 33500 / peak;
}

export function cityStats(city, t) {
  let pop = 0, built = 0, floors = 0, maxF = 0;
  for (const L of city.lots) {
    const st = lotState(L, t);
    if (st.floors > 0) { built++; floors += st.floors; maxF = Math.max(maxF, st.floors); }
    const ramp = clamp((t - 1946.5) / 4, 0.25, 1);
    pop += gfa(L, st) * occupancy(L, t) * ramp;
  }
  pop *= city.popScale;
  return { pop, built, avgFloors: built ? floors / built : 0, maxFloors: maxF };
}

// --- light -----------------------------------------------------------------

export const HF = { x0: -130, z0: -85, w: 260, d: 170, res: 1 };

export function heightfield(city, t, out) {
  const H = out || new Float32Array(HF.w * HF.d);
  H.fill(0);
  const fill = (r, h) => {
    const i0 = Math.max(0, Math.floor(r.x0 - HF.x0)), i1 = Math.min(HF.w - 1, Math.ceil(r.x1 - HF.x0) - 1);
    const j0 = Math.max(0, Math.floor(r.z0 - HF.z0)), j1 = Math.min(HF.d - 1, Math.ceil(r.z1 - HF.z0) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * HF.w + i; if (H[k] < h) H[k] = h; }
  };
  for (const L of city.lots) {
    const st = lotState(L, t);
    if (!st.floors) continue;
    fill(L, st.floors * FLOOR_H);
    if (st.floors > 2) fill(upperRect(L, st.gen), st.floors * FLOOR_H);
  }
  fill(YAMEN, 7);
  return H;
}

export function hfAt(H, x, z) {
  const i = Math.floor(x - HF.x0), j = Math.floor(z - HF.z0);
  if (i < 0 || j < 0 || i >= HF.w || j >= HF.d) return 0;
  return H[j * HF.w + i];
}

const LAT = (22.33 * Math.PI) / 180;
export function sunDir(doy, hour) {
  const dec = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const ha = ((hour - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)) + Math.PI;
  return { x: Math.sin(az) * Math.cos(el), y: sinEl, z: -Math.cos(az) * Math.cos(el), el, az };
}

// Hours of direct sun on a facade point over one day.
export function sunHours(H, p, n, doy) {
  let minutes = 0;
  for (let h = 5; h <= 19.5; h += 0.25) {
    const s = sunDir(doy, h);
    if (s.y < 0.03) continue;
    if (n.x * s.x + n.y * s.y + n.z * s.z < 0.04) continue;
    const horiz = Math.hypot(s.x, s.z) || 1e-6;
    const dx = s.x / horiz, dz = s.z / horiz, rise = s.y / horiz;
    let lit = true;
    for (let d = 0.6; d < 160; d += 0.8) {
      const y = p.y + d * rise;
      if (y > 45) break;
      if (hfAt(H, p.x + dx * d, p.z + dz * d) > y) { lit = false; break; }
    }
    if (lit) minutes += 15;
  }
  return minutes / 60;
}
