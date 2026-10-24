// Draws the share images: Instagram-ready pictures of books you pick.
// Everything is drawn on a canvas at full size (1080 px wide).

export type ShareSize = 'story' | 'post' | 'square';
export type ShareLayout = 'grid' | 'shelf' | 'feature';
export type ShareBg = 'paper' | 'white' | 'dark' | 'cover';

export interface ShareOptions {
  size: ShareSize;
  layout: ShareLayout;
  bg: ShareBg;
  align: 'left' | 'center';   // feature layout
  synopsis: boolean;          // feature layout
  titles: boolean;            // grid layout
  heading: string;
  footerOn: boolean;
  footer: string;
}

export interface ShareBook {
  title: string;
  author: string;
  year?: number;
  synopsis?: string;
  img: HTMLImageElement | null;
  // A decoration: its height next to a paperback (1 = as tall). It stands at
  // the bottom of its row, at that size, instead of filling the row.
  decor?: number;
}

export const SIZES: Record<ShareSize, { w: number; h: number; label: string; hint: string }> = {
  story: { w: 1080, h: 1920, label: 'Story', hint: '9:16' },
  post: { w: 1080, h: 1350, label: 'Post', hint: '4:5' },
  square: { w: 1080, h: 1080, label: 'Square', hint: '1:1' },
};

export const DEFAULT_OPTIONS: ShareOptions = {
  size: 'story', layout: 'grid', bg: 'paper', align: 'center',
  synopsis: false, titles: false, heading: '', footerOn: true, footer: '',
};

const SERIF = '"DM Serif Text", Georgia, serif';
const SANS = 'Manrope, "Helvetica Neue", Arial, sans-serif';

type Palette = { bg: string; text: string; sub: string; shadow: number; dark: boolean };

// --- Colors ---------------------------------------------------------------

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// A calm background color taken from a cover: the average of its more
// colorful pixels, softened so the cover still stands out against it.
export function coverColor(img: HTMLImageElement | null): [number, number, number] | null {
  if (!img) return null;
  try {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 36;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue; // see-through parts of a decoration
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 0.15 + (max - min) / 255; // favor colorful pixels
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; wsum += w;
    }
    if (!wsum) return null;
    r /= wsum; g /= wsum; b /= wsum;
    // Pull toward a muted middle so it's never neon or pure black.
    const l = luminance(r, g, b);
    const target = l > 0.5 ? 0.82 : 0.2;
    const mix = 0.45;
    const t = target * 255;
    return [r + (t - r) * mix, g + (t - g) * mix, b + (t - b) * mix];
  } catch { return null; }
}

function palette(o: ShareOptions, tint: [number, number, number] | null): Palette {
  if (o.bg === 'cover' && tint) {
    const light = luminance(...tint) > 0.55;
    return {
      bg: hex(...tint),
      text: light ? '#1c1b19' : '#fbfaf7',
      sub: light ? 'rgba(28,27,25,0.62)' : 'rgba(251,250,247,0.7)',
      shadow: light ? 0.28 : 0.45,
      dark: !light,
    };
  }
  if (o.bg === 'dark') return { bg: '#151515', text: '#f5f4f1', sub: '#a6a39d', shadow: 0.55, dark: true };
  if (o.bg === 'white') return { bg: '#ffffff', text: '#1a1a1a', sub: '#7a7a7a', shadow: 0.22, dark: false };
  return { bg: '#f3eee6', text: '#1f1d1a', sub: '#716a60', shadow: 0.26, dark: false };
}

// --- Text -----------------------------------------------------------------

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '\u2026';
}

// Wraps to at most `max` lines, ending with an ellipsis if it had to cut.
function clampLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number): string[] {
  const lines = wrap(ctx, text, maxW);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = ellipsize(ctx, kept[max - 1] + ' ' + lines[max], maxW);
  return kept;
}

const setFont = (ctx: CanvasRenderingContext2D, size: number, family: string, weight = 400) => {
  ctx.font = `${weight} ${size}px ${family}`;
};

// --- Drawing helpers --------------------------------------------------------

// For the layout morph: while capturing, each cover's place (and how to draw
// it) is recorded instead of drawn, so the rest of the image can be drawn
// on its own and the covers moved on top.
type CoverDraw = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
type Placed = { x: number; y: number; w: number; h: number; draw: CoverDraw };
let capture: Map<HTMLImageElement, Placed> | null = null;
const captured = (img: HTMLImageElement | null, x: number, y: number, w: number, h: number, draw: CoverDraw) => {
  if (!capture || !img) return false;
  capture.set(img, { x, y, w, h, draw });
  return true;
};

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, p: Palette, strength = 1) {
  if (captured(img, x, y, w, h, (c, x2, y2, w2, h2) => drawCover(c, img, x2, y2, w2, h2, p, strength))) return;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${p.shadow * strength})`;
  ctx.shadowBlur = Math.max(10, w * 0.09);
  ctx.shadowOffsetY = Math.max(4, w * 0.035);
  if (img) ctx.drawImage(img, x, y, w, h);
  else { ctx.fillStyle = 'rgba(128,128,128,0.25)'; ctx.fillRect(x, y, w, h); }
  ctx.restore();
}

const imgRatio = (b: ShareBook) => (b.img && b.img.naturalHeight ? b.img.naturalWidth / b.img.naturalHeight : 2 / 3);
// How wide an item is for each unit of row height. A decoration is shorter
// than the row, so it takes less width.
const ratio = (b: ShareBook) => imgRatio(b) * (b.decor ?? 1);

// A decoration standing with its base at y + h (h is the row's book height).
// Its shadows follow its outline: a soft one behind, and a tight one where it
// touches the surface.
function drawDecor(ctx: CanvasRenderingContext2D, b: ShareBook, x: number, y: number, rowH: number, p: Palette, wall: boolean) {
  const h = rowH * (b.decor ?? 1), w = h * imgRatio(b), top = y + rowH - h;
  const img = b.img;
  const draw: CoverDraw = (c, dx, dy, dw, dh) => {
    c.save();
    // Contact shadow: a flat soft ellipse under its base.
    const cx = dx + dw / 2, cy = dy + dh;
    const rx = dw * 0.42, ry = Math.max(3, dh * 0.025);
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, `rgba(0,0,0,${p.dark ? 0.55 : 0.28})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.translate(cx, cy);
    c.scale(1, ry / rx);
    c.translate(-cx, -cy);
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, rx, 0, Math.PI * 2); c.fill();
    c.restore();
    c.save();
    c.shadowColor = `rgba(0,0,0,${wall ? (p.dark ? 0.45 : 0.14) : p.shadow * 0.6})`;
    c.shadowBlur = Math.max(10, dw * 0.06);
    c.shadowOffsetX = wall ? 5 : 0;
    c.shadowOffsetY = wall ? -4 : Math.max(3, dh * 0.02);
    if (img) c.drawImage(img, dx, dy, dw, dh);
    c.restore();
  };
  if (!captured(img, x, top, w, h, draw)) draw(ctx, x, top, w, h);
}

// Splits covers into rows where every cover in a row is the same height and
// the row exactly fills the width, then picks the row count that makes the
// covers biggest within the box.
function justify(books: ShareBook[], boxW: number, boxH: number, gap: number, rowGap: number, extraPerRow: number, maxRowH: number) {
  let best: { rows: { items: number[]; h: number; w: number }[]; area: number } | null = null;
  const n = books.length;
  for (let r = 1; r <= Math.min(n, 6); r++) {
    const base = Math.floor(n / r), extra = n % r;
    const rows: { items: number[]; h: number; w: number }[] = [];
    let idx = 0;
    for (let i = 0; i < r; i++) {
      const count = base + (i < extra ? 1 : 0);
      const items = Array.from({ length: count }, () => idx++);
      const sumAr = items.reduce((s, k) => s + ratio(books[k]), 0);
      const h = Math.min((boxW - gap * (count - 1)) / sumAr, maxRowH);
      rows.push({ items, h, w: h * sumAr + gap * (count - 1) });
    }
    const totalH = rows.reduce((s, row) => s + row.h, 0);
    const fixed = (r - 1) * rowGap + r * extraPerRow;
    const scale = Math.min(1, (boxH - fixed) / totalH);
    if (scale <= 0) continue;
    rows.forEach(row => {
      const sumAr = row.items.reduce((s, k) => s + ratio(books[k]), 0);
      row.h *= scale;
      row.w = row.h * sumAr + gap * (row.items.length - 1);
    });
    // Score by cover area, nudged toward evenly sized rows.
    const area = rows.reduce((s, row) => s + row.h * (row.w - gap * (row.items.length - 1)), 0);
    const hs = rows.map(x => x.h);
    const evenness = Math.min(...hs) / Math.max(...hs);
    const score = area * (0.75 + 0.25 * evenness);
    if (!best || score > best.area) best = { rows, area: score };
  }
  return best!.rows;
}

// --- Main -----------------------------------------------------------------

export function renderShare(canvas: HTMLCanvasElement, books: ShareBook[], o: ShareOptions, tint: [number, number, number] | null) {
  const { w: W, h: H } = SIZES[o.size];
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const p = palette(o, tint);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  if (!books.length) return;

  const pad = 84;
  const story = o.size === 'story';
  // One book in a grid is a feature; a feature with several books uses a grid.
  const layout: ShareLayout = books.length === 1 && o.layout === 'grid' ? 'feature' : books.length > 1 && o.layout === 'feature' ? 'grid' : o.layout;
  const featureLeft = layout === 'feature' && o.align === 'left';

  // Heading at the top.
  let top = pad + (story ? 60 : 0);
  const heading = o.heading.trim();
  if (heading) {
    const size = story ? 66 : 58;
    setFont(ctx, size, SERIF);
    ctx.fillStyle = p.text;
    ctx.textAlign = featureLeft ? 'left' : 'center';
    const lines = clampLines(ctx, heading, W - pad * 2, 2);
    lines.forEach((line, i) => ctx.fillText(line, featureLeft ? pad : W / 2, top + size * 0.82 + i * size * 1.12));
    top += lines.length * size * 1.12 + (story ? 70 : 48);
  }

  // Footer at the bottom.
  let bottom = H - pad - (story ? 60 : 0);
  const footer = o.footerOn ? o.footer.trim() : '';
  if (footer) {
    // Pinned near the bottom edge, well clear of the books and text.
    const size = 26;
    setFont(ctx, size, SANS, 500);
    ctx.fillStyle = p.sub;
    ctx.textAlign = featureLeft ? 'left' : 'center';
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '1.5px';
    ctx.fillText(ellipsize(ctx, footer, W - pad * 2), featureLeft ? pad : W / 2, H - 46);
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
    bottom = Math.min(bottom, H - 46 - size - 64);
  }

  const box = { x: pad, y: top, w: W - pad * 2, h: bottom - top };
  if (layout === 'feature') drawFeature(ctx, books[0], o, p, box, W);
  else if (layout === 'shelf') drawShelf(ctx, books, p, box, W, H);
  else drawGrid(ctx, books, o, p, box);
  ctx.textAlign = 'left';
}

type Box = { x: number; y: number; w: number; h: number };

function drawGrid(ctx: CanvasRenderingContext2D, books: ShareBook[], o: ShareOptions, p: Palette, box: Box) {
  const gap = books.length > 6 ? 22 : 30;
  const labels = o.titles;
  // Label size depends on how big the covers end up, so try once, then refine.
  const labelFor = (rowH: number) => {
    const t = Math.max(17, Math.min(32, rowH * 0.075));
    return { t, a: t * 0.82, h: labels ? t * 1.25 + t * 0.82 * 1.3 + 22 : 0 };
  };
  let rows = justify(books, box.w, box.h, gap, gap + 6, labelFor(400).h, box.h * 0.62);
  const lab = labelFor(rows[0].h);
  rows = justify(books, box.w, box.h, gap, gap + 6, lab.h, box.h * 0.62);
  const rowGap = gap + 6;
  const total = rows.reduce((s, r) => s + r.h + lab.h, 0) + rowGap * (rows.length - 1);
  let y = box.y + (box.h - total) / 2;
  for (const row of rows) {
    let x = box.x + (box.w - row.w) / 2;
    for (const k of row.items) {
      const b = books[k];
      const w = row.h * ratio(b);
      if (b.decor) drawDecor(ctx, b, x, y, row.h, p, false);
      else drawCover(ctx, b.img, x, y, w, row.h, p);
      if (labels && !b.decor) {
        ctx.textAlign = 'left';
        setFont(ctx, lab.t, SANS, 600);
        ctx.fillStyle = p.text;
        ctx.fillText(ellipsize(ctx, b.title, w), x, y + row.h + 20 + lab.t * 0.9);
        setFont(ctx, lab.a, SANS, 400);
        ctx.fillStyle = p.sub;
        ctx.fillText(ellipsize(ctx, b.author, w), x, y + row.h + 20 + lab.t * 1.25 + lab.a * 0.95);
      }
      x += w + gap;
    }
    y += row.h + lab.h + rowGap;
  }
}

function drawShelf(ctx: CanvasRenderingContext2D, books: ShareBook[], p: Palette, box: Box, W: number, H: number) {
  // A Vitsoe 606, matching the site: slim aluminium tracks up both sides and
  // thin powder-coated steel shelves with a folded front lip. The books stand
  // on the front of each shelf's top surface, so no cover is hidden.
  const gap = 18;
  const LIP_MAX = 40, below = 44; // deepest lip, then room for its shadow
  const inner = { ...box, x: box.x + 18, w: box.w - 36 };
  const reserve = LIP_MAX + below;
  const rows = justify(books, inner.w, inner.h, gap, reserve, 0, inner.h * 0.55);
  const total = rows.reduce((s, r) => s + r.h, 0) + reserve * rows.length - below;
  let y = inner.y + (inner.h - total) / 2;

  const dark = p.dark;
  const TRACK = 14;
  const xL = box.x - 32, xR = W - box.x + 32 - TRACK;

  // E-Track: satin aluminium with a column of slots.
  const track = (x: number) => {
    const g = ctx.createLinearGradient(x, 0, x + TRACK, 0);
    const stops = dark
      ? ['#4a4b4e', '#6d6f73', '#7a7c80', '#66686c', '#3e3f42']
      : ['#b9bbbe', '#d8dadd', '#e6e7e9', '#d4d6d9', '#b3b5b8'];
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, TRACK, H);
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(40,42,46,0.32)';
    for (let sy = 16; sy < H; sy += 22) ctx.fillRect(x + TRACK / 2 - 1.5, sy, 3, 10);
  };
  track(xL);
  track(xR);

  const sx = xL - 6, sw = xR + TRACK + 6 - sx;
  for (const row of rows) {
    const lip = Math.round(Math.min(LIP_MAX, Math.max(22, row.h * 0.08)));
    const surface = Math.round(lip * 0.4);
    const top = y + row.h - Math.round(surface * 0.55);
    const face = top + surface;

    // Soft shadow on the wall under the shelf.
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${dark ? 0.5 : 0.2})`;
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = dark ? '#2c2d30' : '#e4e2dc';
    ctx.fillRect(sx, face, sw, lip);
    ctx.restore();

    // Top surface, a touch darker toward the wall.
    const tg = ctx.createLinearGradient(0, top, 0, face);
    tg.addColorStop(0, dark ? '#3c3d41' : '#e9e7e2');
    tg.addColorStop(1, dark ? '#4a4b4f' : '#f6f5f1');
    ctx.fillStyle = tg;
    ctx.fillRect(sx, top, sw, surface);

    // Front lip: a bright folded edge, then shading down.
    const fg = ctx.createLinearGradient(0, face, 0, face + lip);
    if (dark) {
      fg.addColorStop(0, '#55575b'); fg.addColorStop(0.08, '#36373a');
      fg.addColorStop(0.6, '#2e2f32'); fg.addColorStop(1, '#202124');
    } else {
      fg.addColorStop(0, '#fcfbf9'); fg.addColorStop(0.08, '#ebe9e4');
      fg.addColorStop(0.6, '#e4e2dc'); fg.addColorStop(0.95, '#d9d7d0'); fg.addColorStop(1, '#c6c4bd');
    }
    ctx.fillStyle = fg;
    ctx.fillRect(sx, face, sw, lip);

    let x = inner.x + (inner.w - row.w) / 2;
    for (const k of row.items) {
      const w = row.h * ratio(books[k]);
      const img = books[k].img;
      if (books[k].decor) { drawDecor(ctx, books[k], x, y, row.h, p, true); x += w + gap; continue; }
      // A tight contact shadow where it stands, and a soft one on the wall
      // behind (up and to the side, so the book doesn't float over the lip).
      const standing: CoverDraw = (c, bx, by, bw, bh) => {
        c.fillStyle = `rgba(0,0,0,${dark ? 0.5 : 0.22})`;
        c.fillRect(bx + 1, by + bh - 1, bw - 2, 3);
        c.save();
        c.shadowColor = `rgba(0,0,0,${dark ? 0.45 : 0.14})`;
        c.shadowBlur = Math.max(12, bw * 0.07);
        c.shadowOffsetX = 5;
        c.shadowOffsetY = -4;
        if (img) c.drawImage(img, bx, by, bw, bh);
        else { c.fillStyle = 'rgba(128,128,128,0.25)'; c.fillRect(bx, by, bw, bh); }
        c.restore();
      };
      if (!captured(img, x, y, w, row.h, standing)) standing(ctx, x, y, w, row.h);
      x += w + gap;
    }
    y += row.h + reserve;
  }
}

function drawFeature(ctx: CanvasRenderingContext2D, book: ShareBook, o: ShareOptions, p: Palette, box: Box, W: number) {
  const ar = imgRatio(book);
  const left = o.align === 'left';
  const byline = [book.author, book.year ? String(book.year) : ''].filter(Boolean).join('  \u00b7  ');
  const synopsis = o.synopsis ? (book.synopsis || '').trim() : '';

  // Measures the text block for a given width and sizes.
  const measure = (tw: number, ts: number, ss: number, maxSynLines: number) => {
    setFont(ctx, ts, SERIF);
    const title = clampLines(ctx, book.title, tw, 3);
    setFont(ctx, ss, SANS);
    const syn = synopsis ? clampLines(ctx, synopsis, tw, maxSynLines) : [];
    const as = Math.round(ts * 0.42);
    const h = title.length * ts * 1.08 + 18 + as * 1.2 + (syn.length ? 44 + syn.length * ss * 1.5 : 0);
    return { title, syn, ts, ss, as, h };
  };

  const drawText = (t: ReturnType<typeof measure>, x: number, y: number, align: 'left' | 'center') => {
    ctx.textAlign = align;
    ctx.fillStyle = p.text;
    setFont(ctx, t.ts, SERIF);
    t.title.forEach((line, i) => ctx.fillText(line, x, y + t.ts * 0.85 + i * t.ts * 1.08));
    y += t.title.length * t.ts * 1.08 + 18;
    setFont(ctx, t.as, SANS, 500);
    ctx.fillStyle = p.sub;
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '1px';
    ctx.fillText(byline.toUpperCase(), x, y + t.as * 0.9);
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
    y += t.as * 1.2;
    if (t.syn.length) {
      y += 44;
      setFont(ctx, t.ss, SANS);
      ctx.fillStyle = p.text;
      t.syn.forEach((line, i) => ctx.fillText(line, x, y + t.ss * 1.0 + i * t.ss * 1.5));
    }
  };

  // Cover on top, text below, at every size. Left or centered.
  const tw = left ? box.w : box.w * 0.88;
  const steps = o.size === 'story' ? [[76, 34], [66, 31], [58, 28], [50, 26]] : [[60, 28], [52, 26], [46, 24], [40, 22]];
  const minCoverH = box.h * (synopsis ? 0.42 : 0.55);
  let t = measure(tw, steps[0][0], steps[0][1], 40);
  for (const [ts, ss] of steps) {
    t = measure(tw, ts, ss, 40);
    if (box.h - t.h - 64 >= minCoverH) break;
  }
  if (box.h - t.h - 64 < minCoverH && t.syn.length) {
    const [ts, ss] = steps[steps.length - 1];
    const room = box.h - 64 - minCoverH - (measure(tw, ts, ss, 0).h);
    t = measure(tw, ts, ss, Math.max(0, Math.floor((room - 44) / (ss * 1.5))));
  }
  let coverH = Math.min(box.h - t.h - 64, (o.size === 'story' ? box.w * 0.78 : box.w * 0.62) / ar);
  let cw = coverH * ar;
  if (cw > box.w) { cw = box.w; coverH = cw / ar; }
  const blockH = coverH + 64 + t.h;
  const y0 = box.y + (box.h - blockH) / 2;
  const cx = left ? box.x : box.x + (box.w - cw) / 2;
  if (book.decor) drawDecor(ctx, { ...book, decor: 1 }, cx, y0, coverH, p, false);
  else drawCover(ctx, book.img, cx, y0, cw, coverH, p);
  drawText(t, left ? box.x : W / 2, y0 + coverH + 64, left ? 'left' : 'center');
}


// --- Layout morph -------------------------------------------------------------
// Switching layout (or reordering, or turning titles on) glides each cover from
// where it was to where it goes, while everything else crossfades.

function layoutOnly(books: ShareBook[], o: ShareOptions, tint: [number, number, number] | null) {
  const canvas = document.createElement('canvas');
  capture = new Map();
  try {
    renderShare(canvas, books, o, tint);
    return { canvas, placed: capture };
  } finally {
    capture = null;
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Animates the canvas from one set of options to another. Returns a cancel function. */
export function morphShare(canvas: HTMLCanvasElement, fromBooks: ShareBook[], from: ShareOptions, books: ShareBook[], to: ShareOptions,
  tint: [number, number, number] | null, ms = 480, done?: () => void): () => void {
  const W2 = SIZES[to.size].w, H2 = SIZES[to.size].h;
  const finish = () => { canvas.style.aspectRatio = `${W2} / ${H2}`; renderShare(canvas, books, to, tint); done?.(); };
  if (typeof requestAnimationFrame === 'undefined') { finish(); return () => {}; }
  const a = layoutOnly(fromBooks, from, tint);
  const b = layoutOnly(books, to, tint);
  const W1 = a.canvas.width, H1 = a.canvas.height;
  const resizing = W1 !== W2 || H1 !== H2;
  // Edges that open up while the frame changes size take the new background.
  const px = b.canvas.getContext('2d')!.getImageData(1, 1, 1, 1).data;
  const bg = `rgb(${px[0]},${px[1]},${px[2]})`;
  const start = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    if (t >= 1) { finish(); return; }
    const e = easeInOut(t);
    const l = (u: number, v: number) => u + (v - u) * e;
    // When the size changes (Story, Post, Square) the frame itself grows or
    // shrinks; both layouts stay centered in it while the covers travel.
    const W = Math.round(l(W1, W2)), H = Math.round(l(H1, H2));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      canvas.style.aspectRatio = `${W} / ${H}`;
    }
    const ax = (W - W1) / 2, ay = (H - H1) / 2, bx = (W - W2) / 2, by = (H - H2) / 2;
    const ctx = canvas.getContext('2d')!;
    ctx.globalAlpha = 1;
    if (resizing) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    ctx.globalAlpha = resizing ? 1 - e : 1;
    ctx.drawImage(a.canvas, ax, ay);
    ctx.globalAlpha = e;
    ctx.drawImage(b.canvas, bx, by);
    // Covers leaving fade out; covers arriving fade in; the rest travel.
    a.placed.forEach((pa, img) => {
      if (b.placed.has(img)) return;
      ctx.globalAlpha = 1 - e; pa.draw(ctx, pa.x + ax, pa.y + ay, pa.w, pa.h);
    });
    b.placed.forEach((pb, img) => {
      const pa = a.placed.get(img);
      if (!pa) { ctx.globalAlpha = e; pb.draw(ctx, pb.x + bx, pb.y + by, pb.w, pb.h); return; }
      ctx.globalAlpha = 1;
      // Mid-way it takes on its new look (shadow style) as well as its new place.
      (e < 0.5 ? pa.draw : pb.draw)(ctx, l(pa.x + ax, pb.x + bx), l(pa.y + ay, pb.y + by), l(pa.w, pb.w), l(pa.h, pb.h));
    });
    ctx.globalAlpha = 1;
    frame = requestAnimationFrame(step);
  };
  // First frame now, so the browser never paints the canvas cleared.
  step(start);
  return () => cancelAnimationFrame(frame);
}
