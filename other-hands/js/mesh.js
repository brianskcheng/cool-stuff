// Geometry and texture building. Vertices: position 3, normal 3, colour 3, uv 2, face 2.
// "face" is a 0..1 coordinate across each flat face; the shader draws ink lines at its edges.

export const STRIDE = 13;
export const ATLAS = 2048;
const WHITE = [(ATLAS - 8) / ATLAS, (ATLAS - 8) / ATLAS];
const NOFACE = [-1, -1];

export const C = {
  paper: [0.965, 0.957, 0.94],
  wall: [0.955, 0.947, 0.93],
  floor: [1, 1, 1],
  ink: [0.12, 0.12, 0.14],
  graphite: [0.2, 0.2, 0.23],
  cobalt: [0.17, 0.27, 1.0],
  red: [1.0, 0.27, 0.2],
  plinth: [0.93, 0.92, 0.9],
  skin: [0.94, 0.93, 0.91],
};

export class MeshBuilder {
  constructor() { this.v = []; this.idx = []; this.n = 0; }

  vert(p, nrm, col, uv = WHITE, face = NOFACE) {
    this.v.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], col[0], col[1], col[2], uv[0], uv[1], face[0], face[1]);
    return this.n++;
  }

  // a, b, c, d counter-clockwise seen from the front; uvs/faces optional per corner
  quad(a, b, c, d, nrm, col, uvs, lines = true) {
    const F = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const i = [a, b, c, d].map((p, k) => this.vert(p, nrm, col, uvs ? uvs[k] : WHITE, lines ? F[k] : NOFACE));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }

  box(min, max, col, { lines = true, skip = '' } = {}) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const P = (x, y, z) => [x, y, z];
    if (!skip.includes('+x')) this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [1, 0, 0], col, null, lines);
    if (!skip.includes('-x')) this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [-1, 0, 0], col, null, lines);
    if (!skip.includes('+y')) this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [0, 1, 0], col, null, lines);
    if (!skip.includes('-y')) this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, -1, 0], col, null, lines);
    if (!skip.includes('+z')) this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1], col, null, lines);
    if (!skip.includes('-z')) this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [0, 0, -1], col, null, lines);
  }

  // smooth tube along a polyline of points
  tube(pts, r, col, sides = 8) {
    const base = this.n;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[Math.min(k + 1, pts.length - 1)], o = pts[Math.max(k - 1, 0)];
      let t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      t = norm(t);
      let a = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(t, a)), w = cross(t, u);
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
        const nn = [u[0] * c + w[0] * sn, u[1] * c + w[1] * sn, u[2] * c + w[2] * sn];
        this.vert([p[0] + nn[0] * r, p[1] + nn[1] * r, p[2] + nn[2] * r], nn, col);
      }
    }
    for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) {
      const a = base + k * sides + s, b = base + k * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
      this.idx.push(a, b, d, a, d, c);
    }
  }

  sphere(c, r, col, seg = 14, ry = r) {
    const base = this.n;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI;
      for (let j = 0; j <= seg * 2; j++) {
        const ph = (j / (seg * 2)) * Math.PI * 2;
        const nn = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        this.vert([c[0] + nn[0] * r, c[1] + nn[1] * ry, c[2] + nn[2] * r], nn, col);
      }
    }
    const row = seg * 2 + 1;
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg * 2; j++) {
      const a = base + i * row + j, b = a + 1, c2 = a + row, d = c2 + 1;
      this.idx.push(a, c2, d, a, d, b);
    }
  }

  cylinder(c, r0, r1, y0, y1, col, sides = 18) {
    const base = this.n;
    const slope = (r0 - r1) / (y1 - y0);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
      const nn = norm([x, slope, z]);
      this.vert([c[0] + x * r0, y0, c[2] + z * r0], nn, col);
      this.vert([c[0] + x * r1, y1, c[2] + z * r1], nn, col);
    }
    for (let k = 0; k < sides; k++) { const a = base + k * 2; this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    // cap
    const top = this.vert([c[0], y1, c[2]], [0, 1, 0], col);
    const ring = this.n;
    for (let k = 0; k <= sides; k++) { const a = (k / sides) * Math.PI * 2; this.vert([c[0] + Math.cos(a) * r1, y1, c[2] + Math.sin(a) * r1], [0, 1, 0], col); }
    for (let k = 0; k < sides; k++) this.idx.push(top, ring + k + 1, ring + k);
  }

  data() { return { verts: new Float32Array(this.v), index: new Uint32Array(this.idx), count: this.idx.length }; }
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ---------------------------------------------------------------- texture atlas
export class Atlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(ATLAS - 16, ATLAS - 16, 16, 16);
    this.shelfX = 1024; this.shelfY = 0; this.shelfH = 0;
  }
  // shelf packing: to the right of the 1024² floor first, then underneath it
  alloc(w, h) {
    if (this.shelfX + w > ATLAS) {
      this.shelfY += this.shelfH + 2;
      this.shelfX = this.shelfY >= 1024 ? 0 : 1024;
      this.shelfH = 0;
    }
    const r = { x: this.shelfX, y: this.shelfY, w, h };
    this.shelfX += w + 2;
    this.shelfH = Math.max(this.shelfH, h);
    return r;
  }
  uv(r, u, v) { return [(r.x + u * r.w) / ATLAS, (r.y + v * r.h) / ATLAS]; }
  // corners for a quad listed bottom-left, bottom-right, top-right, top-left
  quadUV(r) { return [this.uv(r, 0, 1), this.uv(r, 1, 1), this.uv(r, 1, 0), this.uv(r, 0, 0)]; }
}

// ---------------------------------------------------------------- drawings
const INK = '#1e1e23';
const COBALT = '#2b45ff';
const RED = '#ff4533';

// a hand outline; thumb = -1 puts the thumb on the left as seen
export function handPath(ctx, cx, cy, s, thumb) {
  const caps = (x, y, w, h, rot = 0) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath(); ctx.roundRect(-w / 2, -h, w, h, w / 2); ctx.fill(); ctx.restore();
  };
  ctx.beginPath(); ctx.roundRect(cx - 0.27 * s, cy - 0.3 * s, 0.54 * s, 0.6 * s, 0.14 * s); ctx.fill();
  const fingers = [[-0.19, 0.5], [-0.065, 0.6], [0.065, 0.57], [0.185, 0.44]];
  for (const [fx, fh] of fingers) caps(cx - fx * s * thumb, cy - 0.22 * s, 0.115 * s, fh * s);
  // the thumb leans outward from the lower side of the palm: it is what makes a hand left or right
  caps(cx + thumb * 0.2 * s, cy + 0.16 * s, 0.135 * s, 0.42 * s, thumb * 0.8);
}

export function drawHandPlate(ctx, r, thumb) {
  ctx.save();
  ctx.fillStyle = '#f7f5f0'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  ctx.fillStyle = RED;
  handPath(ctx, r.x + r.w / 2, r.y + r.h * 0.58, r.w * 0.78, thumb);
  ctx.restore();
}

export function drawMural(ctx, r, thumb, word) {
  ctx.save();
  ctx.fillStyle = '#f7f5f0'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = RED;
  handPath(ctx, r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.86, thumb);
  ctx.fillStyle = INK;
  ctx.font = `700 ${r.w * 0.17}px "Familjen Grotesk", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(word, r.x + r.w / 2, r.y + r.h * 0.94);
  ctx.restore();
}

export const TETRO = { L: [[0, 0], [0, 1], [0, 2], [1, 0]], J: [[1, 0], [1, 1], [1, 2], [0, 0]] };

export function drawLockPlate(ctx, r, shape) {
  ctx.save();
  ctx.fillStyle = '#f7f5f0'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  const u = r.w * 0.17, ox = r.x + r.w / 2 - u, oy = r.y + r.h * 0.5 + 1.5 * u;
  ctx.fillStyle = INK;
  for (const [cx, cy] of TETRO[shape]) ctx.fillRect(ox + cx * u, oy - (cy + 1) * u, u + 0.5, u + 0.5);
  ctx.restore();
}

// the gluing diagram: a square whose sides carry arrows (single for west/east, double for south/north)
export function drawDiagram(ctx, x, y, s, gx, gz, ink = INK, accent = COBALT) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const side = (ax, ay, bx, by, kind, dir, double) => {
    if (kind === 'wall') { ctx.strokeStyle = ink; ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); return; }
    ctx.strokeStyle = accent; ctx.lineWidth = s * 0.025;
    ctx.setLineDash([s * 0.05, s * 0.04]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = (bx - ax) * dir, dy = (by - ay) * dir, l = Math.hypot(dx, dy);
    const ux = dx / l, uy = dy / l, h = s * 0.09;
    ctx.lineWidth = s * 0.035; ctx.strokeStyle = accent;
    for (let k = 0; k < (double ? 2 : 1); k++) {
      const off = double ? (k - 0.5) * h * 0.9 : 0;
      const tx = mx + ux * (off + h * 0.4), ty = my + uy * (off + h * 0.4);
      ctx.beginPath();
      ctx.moveTo(tx - ux * h - uy * h * 0.75, ty - uy * h + ux * h * 0.75);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx - ux * h + uy * h * 0.75, ty - uy * h - ux * h * 0.75);
      ctx.stroke();
    }
  };
  const x0 = x, y0 = y, x1 = x + s, y1 = y + s; // screen: up is north (+z)
  side(x0, y1, x0, y0, gx, 1, false);                          // west edge, arrow pointing north
  side(x1, y1, x1, y0, gx, gx === 'twisted' ? -1 : 1, false);  // east edge
  side(x0, y1, x1, y1, gz, 1, true);                           // south edge, arrow pointing east
  side(x0, y0, x1, y0, gz, gz === 'twisted' ? -1 : 1, true);   // north edge
  ctx.restore();
}

export function drawPlacard(ctx, r, p) {
  ctx.save();
  ctx.fillStyle = '#fbfaf7'; ctx.fillRect(r.x, r.y, r.w, r.h);
  const pad = r.w * 0.07;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${r.w * 0.034}px "Fragment Mono", monospace`;
  ctx.fillText(p.kicker.toUpperCase(), r.x + pad, r.y + pad + r.w * 0.03);
  ctx.font = `700 ${r.w * 0.088}px "Familjen Grotesk", sans-serif`;
  ctx.fillText(p.title, r.x + pad, r.y + pad + r.w * 0.135);
  ctx.font = `400 ${r.w * 0.04}px "Familjen Grotesk", sans-serif`;
  const words = p.body.split(' ');
  let line = '', y = r.y + pad + r.w * 0.215;
  const maxW = r.w - pad * 2 - (p.diagram ? r.w * 0.26 : 0);
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW) { ctx.fillText(line, r.x + pad, y); line = w; y += r.w * 0.054; }
    else line = t;
  }
  if (line) ctx.fillText(line, r.x + pad, y);
  if (p.diagram) drawDiagram(ctx, r.x + r.w - pad - r.w * 0.2, r.y + pad + r.w * 0.19, r.w * 0.2, p.diagram[0], p.diagram[1]);
  ctx.restore();
}

// floor: pale tiles, seam arrows along glued edges, and the baked ambient occlusion
export function drawFloor(ctx, size, room, ao, aoRes, Lsize) {
  ctx.save();
  ctx.fillStyle = '#e9e5de'; ctx.fillRect(0, 0, size, size);
  const px = size / Lsize;
  ctx.strokeStyle = 'rgba(30,30,35,0.09)'; ctx.lineWidth = 2;
  for (let k = 0; k <= Lsize; k++) {
    ctx.beginPath(); ctx.moveTo(k * px, 0); ctx.lineTo(k * px, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k * px); ctx.lineTo(size, k * px); ctx.stroke();
  }
  // seams: canvas x ↔ +x, canvas y ↔ +z
  const arrows = (x0, y0, x1, y1, dir, double) => {
    ctx.strokeStyle = COBALT; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const dx = (x1 - x0), dy = (y1 - y0), l = Math.hypot(dx, dy), ux = (dx / l) * dir, uy = (dy / l) * dir;
    const nx = -dy / l, ny = dx / l;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, cx = x0 + dx * t, cy = y0 + dy * t;
      for (let d = 0; d < (double ? 2 : 1); d++) {
        const o = double ? (d - 0.5) * 34 : 0, tx = cx + ux * (o + 14), ty = cy + uy * (o + 14), h = 26;
        ctx.beginPath();
        ctx.moveTo(tx - ux * h + nx * h * 0.8, ty - uy * h + ny * h * 0.8);
        ctx.lineTo(tx, ty);
        ctx.lineTo(tx - ux * h - nx * h * 0.8, ty - uy * h - ny * h * 0.8);
        ctx.stroke();
      }
    }
    ctx.setLineDash([18, 16]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(43,69,255,0.55)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
  };
  const e = 30;
  if (room.gx !== 'wall') {
    arrows(e, 0, e, size, 1, false);
    arrows(size - e, 0, size - e, size, room.gx === 'twisted' ? -1 : 1, false);
  }
  if (room.gz !== 'wall') {
    arrows(0, e, size, e, 1, true);
    arrows(0, size - e, size, size - e, room.gz === 'twisted' ? -1 : 1, true);
  }
  // ambient occlusion, multiplied in
  if (ao) {
    const c = document.createElement('canvas');
    c.width = c.height = aoRes;
    const g = c.getContext('2d'), img = g.createImageData(aoRes, aoRes);
    for (let k = 0; k < aoRes * aoRes; k++) {
      const v = Math.round(255 * ao[k]);
      img.data[k * 4] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = Math.min(255, v + 3); img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

export function drawBlob(ctx, r) {
  const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 0, r.x + r.w / 2, r.y + r.h / 2, r.w / 2);
  g.addColorStop(0, 'rgb(150,148,145)'); g.addColorStop(0.55, 'rgb(205,203,200)'); g.addColorStop(1, 'rgb(255,255,255)');
  ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
}
