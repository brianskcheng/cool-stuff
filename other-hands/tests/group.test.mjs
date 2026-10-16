// Checks the deck-group bookkeeping every room relies on.  Run: node tests/group.test.mjs
import { Space, apply, compose, mirrored, L } from '../js/group.js';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const same = (a, b) => a.sx === b.sx && a.sz === b.sz && Math.abs(a.tx - b.tx) < 1e-9 && Math.abs(a.tz - b.tz) < 1e-9;

const surfaces = { Cylinder: ['straight', 'wall'], Torus: ['straight', 'straight'], 'Möbius band': ['twisted', 'wall'], 'Klein bottle': ['straight', 'twisted'] };
for (const [name, [gx, gz]] of Object.entries(surfaces)) {
  const sp = new Space(gx, gz);
  check(`${name}: named correctly`, sp.name === name, sp.name);
  // the copies form a group: composing two lands exactly on the copy for that cell
  let bad = 0;
  const cells = sp.window(0, 0, 3);
  for (const a of cells) for (const b of cells) {
    const c = compose(a.g, b.g);
    const [i, j] = sp.cellOf(...apply(c, 0.3, -0.7));
    if (!same(c, sp.element(i, j))) bad++;
  }
  check(`${name}: copies close under composition`, bad === 0, `${cells.length ** 2} products`);
  // reduce() is consistent: the point in the room, carried by its copy, is the point you started with
  let drift = 0;
  for (let k = 0; k < 500; k++) {
    const x = (Math.random() - 0.5) * 6 * L * (gx === 'wall' ? 0.1 : 1), z = (Math.random() - 0.5) * 6 * L * (gz === 'wall' ? 0.1 : 1);
    const r = sp.reduce(x, z);
    const [bx, bz] = apply(r.g, r.x, r.z);
    drift = Math.max(drift, Math.hypot(bx - x, bz - z));
  }
  check(`${name}: reduce() round-trips`, drift < 1e-9);
}

// walking once round a twisted seam mirrors you; twice does not
const mob = new Space('twisted', 'wall');
check('Möbius: one lap mirrors', mirrored(mob.reduce(L, 0).g) && !mirrored(mob.reduce(2 * L, 0).g));
const kb = new Space('straight', 'twisted');
check('Klein: east–west keeps hands, north–south swaps them', !mirrored(kb.reduce(L, 0).g) && mirrored(kb.reduce(0, L).g));
let threw = false;
try { new Space('twisted', 'twisted'); } catch { threw = true; }
check('both pairs twisted is refused (not flat)', threw);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
