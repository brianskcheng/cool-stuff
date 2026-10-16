// The spectrum strip: every computed mode as a line on a log-frequency staff,
// with the harmonic series of the fundamental drawn as ghost ticks.

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function noteName(f) {
  const midi = 69 + 12 * Math.log2(f / 440);
  const r = Math.round(midi);
  const cents = Math.round((midi - r) * 100);
  return { name: NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1), cents, midi };
}

export function centsFromHarmonic(ratio) {
  const n = Math.max(1, Math.round(ratio));
  return 1200 * Math.log2(ratio / n);
}

export class Spectrum {
  constructor(canvas, onPick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.hover = null;
    this.bars = [];
    this.dpr = 1;
    canvas.addEventListener('pointermove', (e) => {
      this.hover = this.pick(e);
      canvas.style.cursor = this.hover ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('pointerdown', (e) => {
      const p = this.pick(e);
      if (p) this.onPick(p.drum, p.k);
    });
  }

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 9;
    for (const b of this.bars) {
      const d = Math.abs(b.x - x);
      const dy = b.drum === 1 ? (y > this.mid - 4 ? 0 : 99) : (this.iso ? (y < this.mid + 4 ? 0 : 99) : 0);
      if (d + dy < bd) { bd = d + dy; best = b; }
    }
    return best;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  draw(drums, selected) {
    const ctx = this.ctx, w = this.w, h = this.h, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const live = drums.filter((d) => d.freqs && d.freqs.length);
    this.bars = [];
    if (!live.length) return;
    const iso = drums.length > 1;
    this.iso = iso;
    let fmin = Infinity, fmax = 0;
    for (const d of live) {
      fmin = Math.min(fmin, d.freqs[0]);
      fmax = Math.max(fmax, d.freqs[d.freqs.length - 1]);
    }
    fmin /= 1.22; fmax *= 1.06;
    const padL = 14, padR = 14;
    const X = (f) => padL + (Math.log(f / fmin) / Math.log(fmax / fmin)) * (w - padL - padR);
    const base = iso ? h * 0.5 + 2 : h - 20;
    this.mid = base;

    // octave grid (C notes)
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'alphabetic';
    for (let oct = 0; oct < 10; oct++) {
      const f = 16.3516 * Math.pow(2, oct);
      if (f < fmin || f > fmax) continue;
      const x = X(f);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(Math.round(x), 6, 1, h - 26);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText('C' + oct, x + 3, h - 6);
    }

    // harmonic series of the first drum's fundamental
    const f1 = live[0].freqs[0];
    ctx.setLineDash([2, 3]);
    for (let n = 1; n < 64; n++) {
      const f = f1 * n;
      if (f > fmax) break;
      const x = X(f);
      ctx.strokeStyle = n === 1 ? 'rgba(255,214,140,0.5)' : 'rgba(255,214,140,0.16)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 4);
      ctx.lineTo(x + 0.5, h - 20);
      ctx.stroke();
      if (n <= 12 || n % 4 === 0) {
        ctx.fillStyle = 'rgba(255,214,140,0.42)';
        ctx.fillText('×' + n, x + 3, 13);
      }
    }
    ctx.setLineDash([]);

    if (iso) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(padL, base - 0.5, w - padL - padR, 1);
    }

    // mode lines
    for (let di = 0; di < drums.length; di++) {
      const d = drums[di];
      if (!d.freqs) continue;
      const dir = di === 1 ? 1 : -1;
      const maxLen = iso ? h * 0.5 - 22 : h - 44;
      for (let k = 0; k < d.freqs.length; k++) {
        const f = d.freqs[k];
        const x = X(f);
        const e = Math.min(1, d.energy ? d.energy[k] : 0);
        const dev = Math.abs(centsFromHarmonic(f / f1));
        const t = Math.min(1, dev / 45);
        const sel = selected && selected.k === k && (selected.drum === di || selected.drum === -1);
        const hov = this.hover && this.hover.k === k && this.hover.drum === di;
        const len = 7 + maxLen * Math.pow(e, 0.6) + (sel ? maxLen * 0.35 : 0);
        const r = Math.round(255 * (1 - t) + 120 * t), g = Math.round(205 * (1 - t) + 170 * t), b = Math.round(120 * (1 - t) + 255 * t);
        const alpha = 0.35 + 0.65 * Math.max(e, sel || hov ? 1 : 0);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        const y0 = base, y1 = base + dir * len;
        ctx.fillRect(Math.round(x) - (sel || hov ? 1 : 0.5), Math.min(y0, y1), sel || hov ? 2.5 : 1.5, Math.abs(y1 - y0));
        if (e > 0.05 || sel) {
          ctx.fillStyle = `rgba(${r},${g},${b},${0.25 * Math.max(e, sel ? 1 : 0)})`;
          ctx.fillRect(Math.round(x) - 3, Math.min(y0, y1), 7, Math.abs(y1 - y0));
        }
        this.bars.push({ x, k, drum: di, f });
      }
    }

    if (iso) {
      ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('A', 2, base - 6);
      ctx.fillText('B', 2, base + 14);
    }

    const tip = this.hover || (selected ? this.bars.find((b) => b.k === selected.k && (b.drum === selected.drum || selected.drum === -1)) : null);
    if (tip) {
      const nn = noteName(tip.f);
      const ratio = tip.f / f1;
      const txt = `mode ${tip.k + 1}  ${tip.f.toFixed(1)} Hz  ×${ratio.toFixed(3)}  ${nn.name} ${nn.cents >= 0 ? '+' : '−'}${Math.abs(nn.cents)}¢`;
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      const tw = ctx.measureText(txt).width + 14;
      let tx = tip.x - tw / 2;
      tx = Math.max(4, Math.min(w - tw - 4, tx));
      const ty = iso ? 2 : 18;
      ctx.fillStyle = 'rgba(14,16,20,0.92)';
      ctx.strokeStyle = 'rgba(255,214,140,0.35)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx, ty, tw, 19, 5); else ctx.rect(tx, ty, tw, 19);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f3e7d3';
      ctx.fillText(txt, tx + 7, ty + 13.5);
    }
  }
}
