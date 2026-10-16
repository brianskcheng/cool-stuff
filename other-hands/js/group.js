/*
 * A room is a square F = [−L/2, L/2]² of floor. Each pair of opposite walls is either a
 * real wall, glued straight across, or glued with a twist (a reflection). The space you
 * walk in is the universal cover: the plane tiled by copies g·F, one per deck transformation g.
 *
 * Every deck transformation here has the form  (x, z) ↦ (sx·x + tx, sz·z + tz)  with sx, sz = ±1,
 * so it is stored as four numbers. det = sx·sz < 0 means that copy of the room is mirrored.
 */
export const L = 8;

export const iso = (sx, sz, tx, tz) => ({ sx, sz, tx, tz });
export const ID = iso(1, 1, 0, 0);
export const apply = (g, x, z) => [g.sx * x + g.tx, g.sz * z + g.tz];
export const applyDir = (g, x, z) => [g.sx * x, g.sz * z];
export const compose = (a, b) => iso(a.sx * b.sx, a.sz * b.sz, a.sx * b.tx + a.tx, a.sz * b.tz + a.tz);
export const inverse = (a) => iso(a.sx, a.sz, -a.sx * a.tx, -a.sz * a.tz);
export const mirrored = (g) => g.sx * g.sz < 0;
const parity = (k) => (Math.abs(k) % 2 ? -1 : 1);

// gx: how the west/east walls (x = ∓L/2) meet; gz: how the south/north walls (z = ∓L/2) meet
export const GLUES = ['wall', 'straight', 'twisted'];

export class Space {
  constructor(gx, gz) {
    if (gx === 'twisted' && gz === 'twisted') throw new Error('both pairs twisted is not a flat surface');
    this.gx = gx;
    this.gz = gz;
  }

  get name() {
    const { gx, gz } = this;
    const open = [gx, gz].filter((g) => g !== 'wall');
    if (!open.length) return 'Square';
    if (open.length === 1) return open[0] === 'straight' ? 'Cylinder' : 'Möbius band';
    return gx === 'twisted' || gz === 'twisted' ? 'Klein bottle' : 'Torus';
  }

  // the deck transformation carrying F onto cell (i, j)
  element(i, j) {
    return iso(this.gz === 'twisted' ? parity(j) : 1, this.gx === 'twisted' ? parity(i) : 1, i * L, j * L);
  }

  cellOf(x, z) {
    return [this.gx === 'wall' ? 0 : Math.round(x / L), this.gz === 'wall' ? 0 : Math.round(z / L)];
  }

  // where a point of the cover sits in the room, and which copy it is in
  reduce(x, z) {
    const [i, j] = this.cellOf(x, z);
    const g = this.element(i, j);
    const [fx, fz] = apply(inverse(g), x, z);
    return { i, j, g, x: fx, z: fz };
  }

  // the copies to draw around cell (ci, cj)
  window(ci, cj, R) {
    const out = [];
    const ri = this.gx === 'wall' ? 0 : R, rj = this.gz === 'wall' ? 0 : R;
    for (let j = cj - rj; j <= cj + rj; j++) for (let i = ci - ri; i <= ci + ri; i++) out.push({ i, j, g: this.element(i, j) });
    return out;
  }
}
