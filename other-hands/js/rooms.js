// The rooms of the museum, and the code that turns a room description into geometry.
import { L, Space, apply } from './group.js';
import { MeshBuilder, Atlas, C, TETRO, drawFloor, drawPlacard, drawHandPlate, drawLockPlate, drawBlob, drawMural } from './mesh.js';

const H = 3.2;     // wall height
const T = 0.24;    // wall thickness
const HALF = L / 2;

const FACES = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
// the viewer's right when looking at a face from its front
const rightOf = ([nx, nz]) => [nz, -nx];

function frameBox(cx, cz, n, t0, t1, n0, n1, y0, y1) {
  const t = rightOf(n);
  const xs = [cx + t[0] * t0 + n[0] * n0, cx + t[0] * t1 + n[0] * n1];
  const zs = [cz + t[1] * t0 + n[1] * n0, cz + t[1] * t1 + n[1] * n1];
  return { min: [Math.min(...xs), y0, Math.min(...zs)], max: [Math.max(...xs), y1, Math.max(...zs)] };
}

class RoomBuild {
  constructor(def, atlas) {
    this.def = def;
    this.atlas = atlas;
    this.mesh = new MeshBuilder();
    this.colliders = [];
    this.occluders = [];
    this.portals = [];
    this.keys = [];
    this.locks = [];
  }

  solid(min, max, col = C.wall, { collide = true, occlude = true, lines = true, skip } = {}) {
    this.mesh.box(min, max, col, { lines, skip });
    if (collide) this.colliders.push({ x0: min[0], z0: min[2], x1: max[0], z1: max[2] });
    if (occlude) this.occluders.push({ min, max });
  }

  boundaryWalls() {
    const { gx, gz } = this.def;
    if (gz === 'wall') {
      this.solid([-HALF, 0, -HALF], [HALF, H, -HALF + T]);
      this.solid([-HALF, 0, HALF - T], [HALF, H, HALF]);
    }
    if (gx === 'wall') {
      const z0 = gz === 'wall' ? -HALF + T : -HALF, z1 = gz === 'wall' ? HALF - T : HALF;
      this.solid([-HALF, 0, z0], [-HALF + T, H, z1]);
      this.solid([HALF - T, 0, z0], [HALF, H, z1]);
    }
  }

  // a straight wall with a long window; axis 'x' means the wall runs along z at x = at
  partition(axis, at, from, to, { window = true, th = 0.22 } = {}) {
    const lo = at - th / 2, hi = at + th / 2;
    const B = (a0, a1, y0, y1, col = C.wall, opts) =>
      axis === 'x' ? this.solid([lo, y0, a0], [hi, y1, a1], col, opts) : this.solid([a0, y0, lo], [a1, y1, hi], col, opts);
    if (!window) { B(from, to, 0, H); return; }
    const w0 = 0.95, w1 = 2.3;
    B(from, to, 0, w0, C.wall, { collide: false });
    B(from, to, w1, H, C.wall, { collide: false, occlude: true });
    const n = Math.max(2, Math.round((to - from) / 1.6));
    for (let k = 0; k <= n; k++) {
      const c = from + ((to - from) * k) / n;
      B(Math.max(from, c - 0.05), Math.min(to, c + 0.05), w0, w1, C.graphite, { collide: false, occlude: false });
    }
    // one collider for the whole wall: you can see through, not walk through
    if (axis === 'x') this.colliders.push({ x0: lo, z0: from, x1: hi, z1: to });
    else this.colliders.push({ x0: from, z0: lo, x1: to, z1: hi });
  }

  plinth(x, z, w = 0.56, h = 0.92) {
    this.solid([x - w / 2, 0, z - w / 2], [x + w / 2, h, z + w / 2], C.plinth);
  }

  // a double helix: two strands of opposite colour winding the same way (chiral)
  helix(x, z, { y0 = 0.92, y1 = 2.75, R = 0.24, turns = 2.25, hand = 1 } = {}) {
    this.plinth(x, z);
    for (let s = 0; s < 2; s++) {
      const pts = [];
      for (let k = 0; k <= 140; k++) {
        const t = k / 140, a = t * turns * Math.PI * 2 + s * Math.PI;
        pts.push([x + R * Math.cos(a), y0 + 0.08 + t * (y1 - y0), z + hand * R * Math.sin(a)]);
      }
      this.mesh.tube(pts, 0.035, s ? C.red : C.cobalt, 10);
    }
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, a = t * turns * Math.PI * 2, y = y0 + 0.08 + t * (y1 - y0);
      this.mesh.tube([[x + R * Math.cos(a), y, z + hand * R * Math.sin(a)], [x - R * Math.cos(a), y, z - hand * R * Math.sin(a)]], 0.012, C.graphite, 6);
    }
    this.occluders.push({ min: [x - R, y0, z - R], max: [x + R, y1, z + R] });
  }

  // a museum label; mounted flat on a wall, or on its own stand
  placard(x, z, face, p, { y = 1.55, w = 1.36, stand = false } = {}) {
    const n = FACES[face], t = rightOf(n), h = w * 0.64;
    if (stand) {
      const b = frameBox(x, z, n, -w / 2 - 0.06, w / 2 + 0.06, -0.06, 0, 0, y + h / 2 + 0.06);
      this.solid(b.min, b.max, C.wall);
    }
    const r = this.atlas.alloc(1024, Math.round(1024 * 0.64));
    drawPlacard(this.atlas.ctx, r, p);
    const c = [x + n[0] * 0.012, y, z + n[1] * 0.012];
    const P = (u, v) => [c[0] + t[0] * u * w / 2, c[1] + v * h / 2, c[2] + t[1] * u * w / 2];
    this.mesh.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [n[0], 0, n[1]], [1, 1, 1], this.atlas.quadUV(r), false);
  }

  // a large hand print painted on a wall, labelled; its copies read as mirror writing
  mural(x, z, face, thumb, word, { y = 1.65, w = 1.5 } = {}) {
    const n = FACES[face], t = rightOf(n), h = w * 1.2;
    const r = this.atlas.alloc(512, 614);
    drawMural(this.atlas.ctx, r, thumb, word);
    const c = [x + n[0] * 0.012, y, z + n[1] * 0.012];
    const P = (u, v) => [c[0] + t[0] * u * w / 2, c[1] + v * h / 2, c[2] + t[1] * u * w / 2];
    this.mesh.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [n[0], 0, n[1]], [1, 1, 1], this.atlas.quadUV(r), false);
  }

  // a free-standing doorway to the next room, optionally locked by a hand plate or a key
  portal(x, z, face, lock = null) {
    const n = FACES[face], t = rightOf(n);
    const post = (a) => { const b = frameBox(x, z, n, a - 0.08, a + 0.08, -0.16, 0.16, 0, 2.62); this.solid(b.min, b.max, C.graphite); };
    post(-0.78); post(0.78);
    const lin = frameBox(x, z, n, -0.86, 0.86, -0.16, 0.16, 2.5, 2.72);
    this.solid(lin.min, lin.max, C.graphite, { collide: false });

    const panel = new MeshBuilder();
    const pb = frameBox(x, z, n, -0.7, 0.7, -0.045, 0.045, 0, 2.5);
    panel.box(pb.min, pb.max, C.cobalt);
    const glow = new MeshBuilder();
    const G = (u, v, o) => [x + t[0] * u + n[0] * o, v, z + t[1] * u + n[1] * o];
    glow.quad(G(-0.7, 0, 0.002), G(0.7, 0, 0.002), G(0.7, 2.5, 0.002), G(-0.7, 2.5, 0.002), [n[0], 0, n[1]], [1, 1, 1], null, false);
    glow.quad(G(0.7, 0, -0.002), G(-0.7, 0, -0.002), G(-0.7, 2.5, -0.002), G(0.7, 2.5, -0.002), [-n[0], 0, -n[1]], [1, 1, 1], null, false);

    const portal = {
      x, z, face, lock: lock ? lock.kind : null, open: !lock, anim: lock ? 0 : 1,
      panel: panel.data(), glow: glow.data(),
      panelBox: { x0: pb.min[0], z0: pb.min[2], x1: pb.max[0], z1: pb.max[2] },
      trigger: (() => { const b = frameBox(x, z, n, -0.62, 0.62, -0.12, 0.12, 0, 2.4); return { x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] }; })(),
      pick: { min: pb.min, max: pb.max },
    };
    if (lock) {
      // a plate on a slim post beside the door
      const a = 1.42, hs = 0.3, cy = 1.32;
      const pp = frameBox(x, z, n, a - 0.045, a + 0.045, -0.045, 0.045, 0, cy - hs + 0.02);
      this.solid(pp.min, pp.max, C.graphite);
      const back = frameBox(x, z, n, a - hs - 0.03, a + hs + 0.03, -0.035, 0.02, cy - hs - 0.03, cy + hs + 0.03);
      this.solid(back.min, back.max, C.graphite, { collide: false });
      const r = this.atlas.alloc(256, 256);
      if (lock.kind === 'hand') drawHandPlate(this.atlas.ctx, r, lock.thumb);
      else drawLockPlate(this.atlas.ctx, r, lock.shape);
      const Q = (u, v) => [x + t[0] * (a + u * hs) + n[0] * 0.026, cy + v * hs, z + t[1] * (a + u * hs) + n[1] * 0.026];
      this.mesh.quad(Q(-1, -1), Q(1, -1), Q(1, 1), Q(-1, 1), [n[0], 0, n[1]], [1, 1, 1], this.atlas.quadUV(r), false);
      const pk = frameBox(x, z, n, a - hs - 0.03, a + hs + 0.03, -0.05, 0.07, cy - hs - 0.03, cy + hs + 0.03);
      this.locks.push({ portal, kind: lock.kind, thumb: lock.thumb, shape: lock.shape, pick: pk });
    }
    this.colliders.push(portal.panelBox);
    portal.panelCollider = this.colliders[this.colliders.length - 1];
    this.portals.push(portal);
    return portal;
  }

  // a chiral key, standing upright on a plinth so its shape reads from the front
  key(x, z, face, shape) {
    this.plinth(x, z, 0.5, 0.95);
    const n = FACES[face], u = 0.13;
    const m = new MeshBuilder();
    for (const [cx, cy] of TETRO[shape]) {
      const b = frameBox(x, z, n, (cx - 1) * u, cx * u, -0.035, 0.035, 1.02 + cy * u, 1.02 + (cy + 1) * u);
      m.box(b.min, b.max, C.cobalt);
    }
    const key = { x, z, face, shape, mesh: m.data(), taken: false, pick: { min: [x - 0.3, 0.95, z - 0.3], max: [x + 0.3, 1.5, z + 0.3] } };
    this.keys.push(key);
    return key;
  }

  floor(space) {
    const r = { x: 0, y: 0, w: 1024, h: 1024 };
    const ao = this.bakeAO(space, 100);
    drawFloor(this.atlas.ctx, 1024, this.def, ao, 100, L);
    const P = (x, z) => [x, 0, z];
    const uv = (x, z) => this.atlas.uv(r, (x + HALF) / L, (z + HALF) / L);
    this.mesh.quad(P(-HALF, HALF), P(HALF, HALF), P(HALF, -HALF), P(-HALF, -HALF), [0, 1, 0], C.floor,
      [uv(-HALF, HALF), uv(HALF, HALF), uv(HALF, -HALF), uv(-HALF, -HALF)], false);
  }

  // floor ambient occlusion + a soft key-light shadow, including whatever leans across the seams
  bakeAO(space, res) {
    const boxes = [];
    for (const { g } of space.window(0, 0, 1)) for (const o of this.occluders) {
      const [ax, az] = apply(g, o.min[0], o.min[2]), [bx, bz] = apply(g, o.max[0], o.max[2]);
      boxes.push([Math.min(ax, bx), o.min[1], Math.min(az, bz), Math.max(ax, bx), o.max[1], Math.max(az, bz)]);
    }
    const out = new Float32Array(res * res);
    const dirs = [];
    const N = 26;
    for (let k = 0; k < N; k++) {
      const u = (k + 0.5) / N, phi = k * 2.399963;
      const r = Math.sqrt(u);
      dirs.push([r * Math.cos(phi), Math.sqrt(1 - u), r * Math.sin(phi)]);
    }
    const light = [0.36, 0.86, 0.36];
    const sh = [];
    for (let k = 0; k < 6; k++) { const a = k * 1.047; sh.push(normalize([light[0] + 0.07 * Math.cos(a), light[1], light[2] + 0.07 * Math.sin(a)])); }
    const R = 2.7;
    const near = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = -HALF + ((i + 0.5) / res) * L, z = -HALF + ((j + 0.5) / res) * L;
      near.length = 0;
      for (const b of boxes) if (b[3] > x - R && b[0] < x + R && b[5] > z - R && b[2] < z + R) near.push(b);
      let occ = 0, lit = 0;
      if (near.length) {
        for (const d of dirs) {
          const tmax = Math.min(2.6, 3.4 / d[1]);
          const t = hitBoxes(near, x, 0.002, z, d, tmax);
          if (t < tmax) occ += 1 - t / 2.6;
        }
        for (const d of sh) if (hitBoxes(near, x, 0.002, z, d, 3.4 / d[1]) >= 3.4 / d[1]) lit++;
      } else lit = sh.length;
      out[j * res + i] = (1 - 0.62 * (occ / N)) * (0.8 + 0.2 * (lit / sh.length));
    }
    return out;
  }
}

function normalize(v) { const l = Math.hypot(...v); return v.map((c) => c / l); }

function hitBoxes(boxes, ox, oy, oz, d, tmax) {
  let best = tmax;
  for (const b of boxes) {
    let t0 = 0, t1 = best;
    const o = [ox, oy, oz];
    let miss = false;
    for (let a = 0; a < 3; a++) {
      const inv = 1 / d[a];
      let ta = (b[a] - o[a]) * inv, tb = (b[a + 3] - o[a]) * inv;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { miss = true; break; }
    }
    if (!miss && t0 < best) best = t0;
  }
  return best;
}

// ---------------------------------------------------------------- the collection
const LEFT = 1; // a hand print with its thumb on the right (as you face it) is a left hand

export const ROOMS = [
  {
    id: 'loop', numeral: 'I', title: 'The Loop', gx: 'straight', gz: 'wall',
    start: { x: -2.4, z: 0.7, yaw: -Math.PI / 2 },
    goal: 'Reach the doorway behind the glass.',
    build(b) {
      b.partition('x', 1.1, -HALF + T, HALF - T);
      b.portal(2.65, -2.2, 'e');
      b.helix(-1.5, 2.6);
      b.placard(-1.7, HALF - T, 's', {
        kicker: 'Room I · cylinder', title: 'The Loop', diagram: ['straight', 'wall'],
        body: 'The west wall and the east wall of this room are the same wall, so there is no wall. Walk west and you arrive from the east. The figure in the distance, holding a red balloon, is you.',
      });
    },
  },
  {
    id: 'torus', numeral: 'II', title: 'The Torus', gx: 'straight', gz: 'straight',
    start: { x: -2.3, z: -2.0, yaw: -Math.PI / 2 },
    goal: 'The doorway is in the far quarter.',
    build(b) {
      b.partition('x', 0, -HALF, HALF);
      b.partition('z', 0, -HALF, HALF);
      b.portal(2.0, 2.0, 'n');
      b.helix(-2.0, 2.2);
      b.placard(-2.3, -3.2, 'n', {
        kicker: 'Room II · torus', title: 'The Torus', diagram: ['straight', 'straight'],
        body: 'Now north meets south as well. Every direction leads back here. Those are not other rooms: they are this one, seen the long way round.',
      }, { stand: true });
    },
  },
  {
    id: 'twist', numeral: 'III', title: 'The Twist', gx: 'twisted', gz: 'wall',
    start: { x: -1.4, z: -1.6, yaw: Math.PI / 2 },
    goal: 'The door opens for a left hand. You have two right ones.',
    build(b) {
      b.portal(2.5, -1.7, 'w', { kind: 'hand', thumb: LEFT });
      b.helix(-2.3, 2.3);
      b.mural(1.3, -HALF + T, 'n', LEFT, 'LEFT');
      b.placard(-1.4, -HALF + T, 'n', {
        kicker: 'Room III · Möbius band', title: 'The Twist', diagram: ['twisted', 'wall'],
        body: 'This east–west seam is glued with a half-turn. Go through it and you come back as your own reflection. The room cannot tell that anything happened. Look at the hand print next door.',
      });
    },
  },
  {
    id: 'klein', numeral: 'IV', title: 'The Klein Bottle', gx: 'straight', gz: 'twisted',
    start: { x: -1.2, z: -1.6, yaw: 0.35 },
    goal: 'Take the key to the lock.',
    build(b) {
      b.key(-2.2, 1.9, 's', 'L');
      b.portal(2.6, 0.2, 'w', { kind: 'key', shape: 'J' });
      b.partition('z', -0.3, -HALF, -1.6);
      b.helix(1.2, 3.0, { hand: -1 });
      b.placard(-2.4, -2.9, 'n', {
        kicker: 'Room IV · Klein bottle', title: 'The Klein Bottle', diagram: ['straight', 'twisted'],
        body: 'East–west is straight here. North–south is twisted. The key is an L and the lock is a J. No turning will make an L into a J, but carrying it round might.',
      }, { stand: true });
    },
  },
];

export const FREE = {
  id: 'free', numeral: '∞', title: 'Free walk', start: { x: -1.5, z: -1.5, yaw: 0.6 },
  goal: 'Choose how the walls meet.',
  build(b) {
    b.helix(-1.6, 1.8);
    b.helix(1.9, -1.4, { hand: -1 });
    b.placard(1.6, 2.2, 's', {
      kicker: 'Free walk', title: 'Any way round', diagram: [b.def.gx, b.def.gz],
      body: 'Pick any gluing. With one pair twisted you get a Möbius band or a Klein bottle; with both twisted the square cannot be flat, so that one is not on offer.',
    }, { stand: true });
  },
};

export function buildRoom(def, gx = def.gx, gz = def.gz) {
  const atlas = new Atlas();
  const d = { ...def, gx, gz };
  const space = new Space(gx, gz);
  const b = new RoomBuild(d, atlas);
  b.boundaryWalls();
  def.build(b);
  b.floor(space);
  const blob = atlas.alloc(128, 128);
  drawBlob(atlas.ctx, blob);
  return {
    def: d, space, atlas, blobUV: atlas.quadUV(blob),
    mesh: b.mesh.data(), colliders: b.colliders, portals: b.portals, keys: b.keys, locks: b.locks,
  };
}
