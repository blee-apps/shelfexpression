import { BOOK_ASPECT } from '../decor';
// Draws the share images: Instagram-ready pictures of books you pick.
// Everything is drawn on a canvas at full size (1080 px wide).

import type { Wear } from '../wear';

export type ShareSize = 'story' | 'post' | 'square';
// 'shelf' is the Vitsoe 606 (its saved name from before Billy).
export type ShareLayout = 'grid' | 'shelf' | 'billy' | 'feature';
export type ShareBg = 'paper' | 'white' | 'dark' | 'cover' | 'custom' | 'photo';

export interface ShareOptions {
  size: ShareSize;
  layout: ShareLayout;
  bg: ShareBg;
  custom: string;             // the color for bg 'custom'
  wear: Wear;                 // worn covers (drawn into the images beforehand)
  align: 'left' | 'center';   // feature layout
  synopsis: boolean;          // feature layout
  titles: boolean;            // grid layout
  heading: string;
  headingFont: 'serif' | 'sans';  // heading and feature titles
  photoBlur: number;          // 0 to 100, for bg 'photo' (grid only)
  photoLight: number;         // -100 (darker) to 100 (lighter)
  photoKey: number;           // changes when a new photo is picked
  photoX: number;             // where the photo sits: 0 = left edge, 1 = right edge
  photoY: number;             // 0 = top, 1 = bottom
  photoZoom: number;          // 100 = just fills the frame
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
  size: 'story', layout: 'grid', bg: 'paper', custom: '#3d4a5c', wear: 'off', align: 'center',
  synopsis: false, titles: false, heading: '', headingFont: 'serif',
  photoBlur: 40, photoLight: -20, photoKey: 0, photoX: 0.5, photoY: 0.5, photoZoom: 100, footerOn: true, footer: '',
};

const SERIF = '"DM Serif Text", Georgia, serif';
const SANS = 'Manrope, "Helvetica Neue", Arial, sans-serif';

type Palette = { bg: string; text: string; sub: string; shadow: number; dark: boolean; photo?: HTMLCanvasElement; lumAt?: (x: number, y: number, w: number, h: number) => number };

// The heading font: DM Serif, or Manrope semibold.
const display = (o: ShareOptions) => o.headingFont === 'sans'
  ? { family: SANS, weight: 600, scale: 0.9 } : { family: SERIF, weight: 400, scale: 1 };

// --- Your own photo as the background (Grid only) --------------------------
// Kept in memory only, never saved or published.

let sharePhoto: HTMLImageElement | null = null;
export const setSharePhoto = (img: HTMLImageElement | null) => { sharePhoto = img; photoCache = null; };
export const hasSharePhoto = () => !!sharePhoto;
let photoCache: { key: string; canvas: HTMLCanvasElement; lum: number; lumAt: (x: number, y: number, w: number, h: number) => number } | null = null;

// The photo cropped to fill the frame, softened and lightened or darkened.
// Blur is done by shrinking and enlarging, which every browser supports.
// The photo's size and place in the frame, from your zoom and position.
function photoRect(img: HTMLImageElement, W: number, H: number, o: ShareOptions) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * Math.max(1, o.photoZoom / 100);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  return { dw, dh, x: (W - dw) * o.photoX, y: (H - dh) * o.photoY };
}

/** Dragging the preview by (dx, dy) canvas pixels: the new photo position. */
export function panPhoto(o: ShareOptions, dx: number, dy: number): { photoX: number; photoY: number } {
  if (!sharePhoto) return { photoX: o.photoX, photoY: o.photoY };
  const { w: W, h: H } = SIZES[o.size];
  const r = photoRect(sharePhoto, W, H, o);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    photoX: r.dw - W > 0.5 ? clamp(o.photoX - dx / (r.dw - W)) : 0.5,
    photoY: r.dh - H > 0.5 ? clamp(o.photoY - dy / (r.dh - H)) : 0.5,
  };
}

// Gaussian blur approximated by three box blurs (edges clamped), in place.
function gaussianBlur(px: Uint8ClampedArray, w: number, h: number, sigma: number) {
  if (sigma < 0.3) return;
  // Box sizes that together match the Gaussian (Kovesi's method).
  const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const radii = [0, 1, 2].map(i => ((i < m ? wl : wu) - 1) / 2);
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < w * h; i++) a[i] = px[i * 4 + ch];
    for (const r of radii) { boxH(a, b, w, h, r); boxV(b, a, w, h, r); }
    for (let i = 0; i < w * h; i++) px[i * 4 + ch] = a[i];
  }
}
function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w, first = src[row], last = src[row + w - 1];
    let val = (r + 1) * first;
    for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1)];
    for (let x = 0; x < w; x++) {
      val += src[row + Math.min(x + r, w - 1)] - (x - r - 1 >= 0 ? src[row + x - r - 1] : first);
      dst[row + x] = val * iarr;
    }
    void last;
  }
}
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x];
    let val = (r + 1) * first;
    for (let j = 0; j < r; j++) val += src[Math.min(j, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      val += src[Math.min(y + r, h - 1) * w + x] - (y - r - 1 >= 0 ? src[(y - r - 1) * w + x] : first);
      dst[y * w + x] = val * iarr;
    }
  }
}

function processedPhoto(img: HTMLImageElement, W: number, H: number, o: ShareOptions) {
  const blur = o.photoBlur, light = o.photoLight;
  const key = [img.src.length, img.naturalWidth, W, H, blur, light, o.photoX.toFixed(4), o.photoY.toFixed(4), o.photoZoom].join('|');
  if (photoCache && photoCache.key === key) return photoCache;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const c = out.getContext('2d')!;
  const { dw, dh, x: px, y: py } = photoRect(img, W, H, o);
  // A true Gaussian blur (three box passes), done on a smaller copy and
  // enlarged, so even a strong blur stays fast and perfectly smooth.
  const sigma = (blur / 100) * 48;    // in full-size pixels
  if (sigma < 0.5) c.drawImage(img, px, py, dw, dh);
  else {
    const k = Math.min(1, Math.max(1 / 8, 5 / sigma));   // keep about 5 px of blur in the small copy
    const sw = Math.max(8, Math.round(W * k)), sh = Math.max(8, Math.round(H * k));
    const small = document.createElement('canvas'); small.width = sw; small.height = sh;
    const sc = small.getContext('2d')!;
    sc.imageSmoothingQuality = 'high';
    // Halve first so the shrink itself is clean.
    if (k < 0.5) {
      let cur = document.createElement('canvas'); cur.width = Math.round(W / 2); cur.height = Math.round(H / 2);
      const cc = cur.getContext('2d')!; cc.imageSmoothingQuality = 'high';
      cc.drawImage(img, px / 2, py / 2, dw / 2, dh / 2);
      while (cur.width / 2 > sw) {
        const nxt = document.createElement('canvas'); nxt.width = Math.round(cur.width / 2); nxt.height = Math.round(cur.height / 2);
        const nc = nxt.getContext('2d')!; nc.imageSmoothingQuality = 'high';
        nc.drawImage(cur, 0, 0, nxt.width, nxt.height);
        cur = nxt;
      }
      sc.drawImage(cur, 0, 0, sw, sh);
    } else sc.drawImage(img, px * sw / W, py * sh / H, dw * sw / W, dh * sh / H);
    const id = sc.getImageData(0, 0, sw, sh);
    gaussianBlur(id.data, sw, sh, sigma * sw / W);
    sc.putImageData(id, 0, 0);
    c.imageSmoothingQuality = 'high';
    c.drawImage(small, 0, 0, W, H);
    // A whisper of grain, so smooth gradients don't show bands.
    const g = c.getImageData(0, 0, W, H), gd = g.data;
    for (let i = 0; i < gd.length; i += 4) {
      const n = (Math.random() - 0.5) * 3;
      gd[i] += n; gd[i + 1] += n; gd[i + 2] += n;
    }
    c.putImageData(g, 0, 0);
  }
  if (light) {
    c.fillStyle = light < 0 ? `rgba(0,0,0,${-light / 100 * 0.75})` : `rgba(255,255,255,${light / 100 * 0.75})`;
    c.fillRect(0, 0, W, H);
  }
  // How light it is, overall and patch by patch, from a small copy, so each
  // line of text can pick dark or light ink for what's right behind it.
  const GW = 54, GH = Math.max(1, Math.round(54 * H / W));
  const t = document.createElement('canvas'); t.width = GW; t.height = GH;
  const tc = t.getContext('2d')!; tc.drawImage(out, 0, 0, GW, GH);
  const d = tc.getImageData(0, 0, GW, GH).data;
  const grid = new Float32Array(GW * GH);
  let sum = 0;
  for (let i = 0; i < grid.length; i++) { grid[i] = luminanceOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); sum += grid[i]; }
  const lumAt = (x: number, y: number, w: number, h: number) => {
    const x0 = Math.max(0, Math.floor(x / W * GW)), x1 = Math.min(GW - 1, Math.ceil((x + w) / W * GW));
    const y0 = Math.max(0, Math.floor(y / H * GH)), y1 = Math.min(GH - 1, Math.ceil((y + h) / H * GH));
    let s2 = 0, n = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { s2 += grid[yy * GW + xx]; n++; }
    return n ? s2 / n : sum / grid.length;
  };
  photoCache = { key, canvas: out, lum: sum / grid.length, lumAt };
  return photoCache;
}
const luminanceOf = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// Text over a photo picks dark or light ink for the patch right behind it,
// with a soft halo so it stays readable on busy spots. (Off a photo, does nothing.)
const ink = (ctx: CanvasRenderingContext2D, p: Palette, role: 'text' | 'sub', x: number, y: number, w: number, h: number) => {
  if (!p.photo || !p.lumAt) return;
  const light = p.lumAt(x, y, w, h) > 0.58;
  ctx.fillStyle = role === 'text' ? (light ? '#161513' : '#ffffff') : (light ? 'rgba(22,21,19,0.78)' : 'rgba(255,255,255,0.88)');
  ctx.shadowColor = light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 16; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
};
const noInk = (ctx: CanvasRenderingContext2D) => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; };

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

const hexToRgb = (h: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function palette(o: ShareOptions, tint: [number, number, number] | null, layout: ShareLayout): Palette {
  if (o.bg === 'photo' && sharePhoto && layout === 'grid') {
    const { w, h } = SIZES[o.size];
    const ph = processedPhoto(sharePhoto, w, h, o);
    const light = ph.lum > 0.55;
    return {
      bg: light ? '#e8e4dd' : '#222',
      text: light ? '#161513' : '#ffffff',
      sub: light ? 'rgba(22,21,19,0.72)' : 'rgba(255,255,255,0.82)',
      shadow: light ? 0.3 : 0.5,
      dark: !light,
      photo: ph.canvas,
      lumAt: ph.lumAt,
    };
  }
  // A picked color is drawn like a cover color: the text turns light or
  // dark to suit it.
  if (o.bg === 'custom') tint = hexToRgb(o.custom);
  if ((o.bg === 'cover' || o.bg === 'custom') && tint) {
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

const imgRatio = (b: ShareBook) => (b.img && b.img.naturalHeight ? b.img.naturalWidth / b.img.naturalHeight : BOOK_ASPECT);

// A decoration drawn in the box x, y, w, h (its base at y + h).
// Its shadows follow its outline: a soft one behind, and a tight one where it
// touches the surface.
function drawDecor(ctx: CanvasRenderingContext2D, b: ShareBook, x: number, top: number, w: number, h: number, p: Palette, wall: boolean) {
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

// Every item stands in a slot the shape of a paperback (BOOK_ASPECT), and every
// slot in the image is the same size, so books keep their sizes relative to
// each other whatever is next to them: a decoration, or empty space at the end
// of a short row. A book fits inside its slot by its own shape (a wide cover
// fills the width and is shorter, a tall narrow one fills the height and is
// narrower) and stands at the bottom, centered. A decoration stands at its
// height next to a paperback; one wider than a slot takes two.
type Slotted = { k: number; span: number };
type SlotRow = { items: Slotted[]; cols: number };
type SlotLayout = { rows: SlotRow[]; slotW: number; slotH: number; cols: number };

const decorWidth = (b: ShareBook, slotH: number) => slotH * (b.decor ?? 1) * imgRatio(b);
// How many slots an item takes. Decided from slot proportions, so it doesn't
// depend on the final size.
const spanOf = (b: ShareBook, cols: number) => (b.decor && cols >= 2 && decorWidth(b, 1 / BOOK_ASPECT) > 1 ? 2 : 1);

function packRows(books: ShareBook[], cols: number): SlotRow[] {
  const rows: SlotRow[] = [];
  let row: SlotRow = { items: [], cols: 0 };
  books.forEach((b, k) => {
    const span = spanOf(b, cols);
    if (row.cols + span > cols && row.items.length) { rows.push(row); row = { items: [], cols: 0 }; }
    row.items.push({ k, span });
    row.cols += span;
  });
  if (row.items.length) rows.push(row);
  return rows;
}

// Picks the number of columns that makes the slots (and so the books) biggest
// within the box.
function slotLayout(books: ShareBook[], boxW: number, boxH: number, gap: number, rowGap: number, extraPerRow: number, maxSlotH: number): SlotLayout {
  let best: SlotLayout | null = null;
  const n = books.length;
  for (let cols = 1; cols <= n; cols++) {
    const rows = packRows(books, cols);
    const used = Math.max(...rows.map(r => r.cols));
    if (used < cols) break; // more columns than any row fills: no bigger
    const r = rows.length;
    const byWidth = (boxW - gap * (cols - 1)) / cols;
    const byHeight = ((boxH - (r - 1) * rowGap - r * extraPerRow) / r) * BOOK_ASPECT;
    const slotW = Math.min(byWidth, byHeight, maxSlotH * BOOK_ASPECT);
    if (slotW <= 0) continue;
    // Prefer bigger slots; between near-equal ones, the one with fewer empty slots.
    const empty = (l: SlotLayout) => l.rows.length * l.cols - l.rows.reduce((s, x) => s + x.cols, 0);
    const cand = { rows, slotW, slotH: slotW / BOOK_ASPECT, cols };
    if (!best || slotW > best.slotW * 1.02 || (slotW > best.slotW * 0.98 && empty(cand) < empty(best))) best = cand;
  }
  return best!;
}

// Where each item in a row goes: rows are centered, each item in its slot(s).
// Returns the item's slot box and the drawn box inside it.
function placeRow(books: ShareBook[], row: SlotRow, L: SlotLayout, boxX: number, boxW: number, y: number, gap: number) {
  const rowW = row.cols * L.slotW + (row.cols - 1) * gap;
  let x = boxX + (boxW - rowW) / 2;
  return row.items.map(({ k, span }) => {
    const b = books[k];
    const sw = span * L.slotW + (span - 1) * gap;
    let w: number, h: number;
    if (b.decor) {
      h = L.slotH * b.decor; w = h * imgRatio(b);
      if (w > sw) { h *= sw / w; w = sw; } // never wider than its slots
    } else {
      const ar = imgRatio(b);
      w = Math.min(L.slotW, L.slotH * ar); h = w / ar;
    }
    const item = { k, b, slotX: x, slotW: sw, x: x + (sw - w) / 2, y: y + L.slotH - h, w, h };
    x += sw + gap;
    return item;
  });
}

// --- Main -----------------------------------------------------------------

export function renderShare(canvas: HTMLCanvasElement, books: ShareBook[], o: ShareOptions, tint: [number, number, number] | null) {
  const { w: W, h: H } = SIZES[o.size];
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // One book in a grid is a feature; a feature with several books uses a grid.
  const layout: ShareLayout = books.length === 1 && o.layout === 'grid' ? 'feature' : books.length > 1 && o.layout === 'feature' ? 'grid' : o.layout;
  const p = palette(o, tint, layout);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  if (p.photo) ctx.drawImage(p.photo, 0, 0);
  ctx.textBaseline = 'alphabetic';
  if (!books.length) return;

  const pad = 84;
  const story = o.size === 'story';
  const featureLeft = layout === 'feature' && o.align === 'left';

  // Heading at the top.
  let top = pad + (story ? 60 : 0);
  const heading = o.heading.trim();
  if (heading) {
    const df = display(o);
    const size = Math.round((story ? 66 : 58) * df.scale);
    setFont(ctx, size, df.family, df.weight);
    if (df.family === SANS && 'letterSpacing' in ctx) (ctx as any).letterSpacing = '-0.5px';
    ctx.fillStyle = p.text;
    ctx.textAlign = featureLeft ? 'left' : 'center';
    const lines = clampLines(ctx, heading, W - pad * 2, 2);
    lines.forEach((line, i) => {
      const lw = ctx.measureText(line).width, x = featureLeft ? pad : W / 2, y = top + i * size * 1.12;
      ink(ctx, p, 'text', featureLeft ? x : x - lw / 2, y, lw, size);
      ctx.fillText(line, x, y + size * 0.82);
    });
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
    noInk(ctx);
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
    const ft = ellipsize(ctx, footer, W - pad * 2), fw = ctx.measureText(ft).width;
    ink(ctx, p, 'sub', featureLeft ? pad : W / 2 - fw / 2, H - 46 - size, fw, size);
    ctx.fillText(ft, featureLeft ? pad : W / 2, H - 46);
    noInk(ctx);
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
    bottom = Math.min(bottom, H - 46 - size - 64);
  }

  const box = { x: pad, y: top, w: W - pad * 2, h: bottom - top };
  if (layout === 'feature') drawFeature(ctx, books[0], o, p, box, W);
  else if (layout === 'shelf') drawShelf(ctx, books, p, box, W, H);
  else if (layout === 'billy') drawBilly(ctx, books, p, box, W);
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
  let L = slotLayout(books, box.w, box.h, gap, gap + 6, labelFor(400).h, box.h * 0.62);
  const lab = labelFor(L.slotH);
  L = slotLayout(books, box.w, box.h, gap, gap + 6, lab.h, box.h * 0.62);
  const rowGap = gap + 6;
  const total = L.rows.length * (L.slotH + lab.h) + rowGap * (L.rows.length - 1);
  let y = box.y + (box.h - total) / 2;
  for (const row of L.rows) {
    for (const it of placeRow(books, row, L, box.x, box.w, y, gap)) {
      const b = it.b;
      if (b.decor) { drawDecor(ctx, b, it.x, it.y, it.w, it.h, p, false); continue; }
      drawCover(ctx, b.img, it.x, it.y, it.w, it.h, p);
      if (labels) {
        // From the cover's left edge to its slot's right edge.
        const lw = it.slotX + it.slotW - it.x;
        ctx.textAlign = 'left';
        setFont(ctx, lab.t, SANS, 600);
        ctx.fillStyle = p.text;
        const ty = y + L.slotH + 20;
        ink(ctx, p, 'text', it.x, ty, lw, lab.t * 1.25 + lab.a * 1.3);
        ctx.fillText(ellipsize(ctx, b.title, lw), it.x, ty + lab.t * 0.9);
        setFont(ctx, lab.a, SANS, 400);
        ctx.fillStyle = p.sub;
        ink(ctx, p, 'sub', it.x, ty, lw, lab.t * 1.25 + lab.a * 1.3);
        ctx.fillText(ellipsize(ctx, b.author, lw), it.x, ty + lab.t * 1.25 + lab.a * 0.95);
        noInk(ctx);
      }
    }
    y += L.slotH + lab.h + rowGap;
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
  // Every shelf is the same height apart: a paperback's height plus the shelf.
  const L = slotLayout(books, inner.w, inner.h, gap, reserve, 0, inner.h * 0.55);
  const rows = L.rows;
  const total = (L.slotH + reserve) * rows.length - below;
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
    const lip = Math.round(Math.min(LIP_MAX, Math.max(22, L.slotH * 0.08)));
    const surface = Math.round(lip * 0.4);
    const top = y + L.slotH - Math.round(surface * 0.55);
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

    for (const it of placeRow(books, row, L, inner.x, inner.w, y, gap)) {
      if (it.b.decor) { drawDecor(ctx, it.b, it.x, it.y, it.w, it.h, p, true); continue; }
      drawStanding(ctx, it.b.img, it.x, it.y, it.w, it.h, dark);
    }
    y += L.slotH + reserve;
  }
}

// A book standing on a shelf: a tight contact shadow where it stands, and a
// soft one on the back behind it (up and to the side, so it doesn't float).
function drawStanding(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, dark: boolean) {
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
  if (!captured(img, x, y, w, h, standing)) standing(ctx, x, y, w, h);
}

function drawBilly(ctx: CanvasRenderingContext2D, books: ShareBook[], p: Palette, box: Box, W: number) {
  // An IKEA Billy, matching the site: a closed white box (black-brown when
  // dark) with thick sides, a back panel, inner walls seen as slivers with
  // their pin holes, shelves showing their top surface, and a plinth.
  const dark = p.dark;
  const C = dark
    ? { front: '#3a332e', edge: '#241f1b', topBack: '#2a2521', topFront: '#362f2a', lip: '#4a423b', back: '#1e1b18', wall: '#2b2622', hole: 'rgba(0,0,0,0.75)' }
    : { front: '#f8f7f3', edge: '#d9d6cf', topBack: '#e9e6df', topFront: '#f5f3ee', lip: '#fdfcfa', back: '#e7e4dd', wall: '#d8d4cb', hole: 'rgba(60,55,45,0.45)' };
  const SIDE = 24, BOARD = 20, SURFACE = 16, SLIVER = 11, PLINTH = 58, HEAD = 44;
  const ox = box.x - 40, ow = W - ox * 2;          // the cabinet
  const ix = ox + SIDE, iw = ow - SIDE * 2;         // inside it
  const margin = 56;                                // books keep clear of the walls
  const inner = { x: ix + SLIVER + margin, w: iw - (SLIVER + margin) * 2 };
  const gap = 40;
  const perRow = HEAD + SURFACE * 0.45 + BOARD;
  const avail = box.h - BOARD - PLINTH;
  const L = slotLayout(books, inner.w, avail, gap, 0, perRow, avail * 0.55);
  const rowH = L.slotH + perRow;
  const total = BOARD + rowH * L.rows.length + PLINTH;
  const y0 = box.y + (box.h - total) / 2;

  // The cabinet, with a soft shadow on the wall and floor.
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${dark ? 0.6 : 0.22})`;
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = C.front;
  ctx.fillRect(ox, y0, ow, total);
  ctx.restore();
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, y0 + 0.5, ow - 1, total - 1);

  // Each bay: back panel shaded under the shelf above, then the side slivers.
  const shelfTops: number[] = [];
  L.rows.forEach((_, i) => {
    const top = y0 + BOARD + rowH * i;
    const shelf = top + HEAD + L.slotH - SURFACE * 0.55;
    shelfTops.push(shelf);
    const bh = shelf - top;
    ctx.fillStyle = C.back;
    ctx.fillRect(ix, top, iw, bh);
    const g = ctx.createLinearGradient(0, top, 0, top + bh);
    g.addColorStop(0, 'rgba(0,0,0,0.20)');
    g.addColorStop(Math.min(0.3, 18 / bh), 'rgba(0,0,0,0.07)');
    g.addColorStop(Math.min(0.45, 60 / bh), 'rgba(0,0,0,0.02)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1 - Math.min(0.3, 30 / bh), 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(ix, top, iw, bh);
    for (const [sx, dir] of [[ix, 1], [ix + iw - SLIVER, -1]] as const) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.07)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 2 * dir;
      ctx.fillStyle = C.wall;
      ctx.fillRect(sx, top, SLIVER, bh);
      ctx.restore();
      ctx.fillStyle = C.hole;
      for (let hy = top + 10; hy < top + bh - 4; hy += 30) {
        ctx.beginPath(); ctx.arc(sx + SLIVER / 2, hy, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  });

  // Shelves: the top surface (darker toward the back), a bright edge, the front.
  shelfTops.forEach((t, i) => {
    const base = i === shelfTops.length - 1;
    const x = base ? ox : ix, w = base ? ow : iw;
    const tg = ctx.createLinearGradient(0, t, 0, t + SURFACE);
    tg.addColorStop(0, C.topBack);
    tg.addColorStop(1, C.topFront);
    ctx.fillStyle = tg;
    ctx.fillRect(x, t, w, SURFACE);
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(x, t, w, 1);
    ctx.fillStyle = C.lip;
    ctx.fillRect(x, t + SURFACE, w, 2);
    ctx.fillStyle = C.front;
    ctx.fillRect(x, t + SURFACE + 2, w, BOARD - 4);
    ctx.fillStyle = C.edge;
    ctx.fillRect(x, t + SURFACE + BOARD - 2, w, 2);
  });

  // Plinth: the sides run to the floor, the toe kick between them is set back.
  const py = shelfTops[shelfTops.length - 1] + SURFACE + BOARD;
  const pg = ctx.createLinearGradient(0, py, 0, py + PLINTH);
  pg.addColorStop(0, dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.16)');
  pg.addColorStop(Math.min(0.3, 8 / PLINTH), dark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.04)');
  pg.addColorStop(0.4, 'rgba(0,0,0,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(ox + SIDE / 2, py, ow - SIDE, PLINTH);

  // Books and decorations, standing on the front half of each surface.
  L.rows.forEach((row, i) => {
    const y = y0 + BOARD + rowH * i + HEAD;
    for (const it of placeRow(books, row, L, inner.x, inner.w, y, gap)) {
      if (it.b.decor) { drawDecor(ctx, it.b, it.x, it.y, it.w, it.h, p, true); continue; }
      drawStanding(ctx, it.b.img, it.x, it.y, it.w, it.h, dark);
    }
  });
}

function drawFeature(ctx: CanvasRenderingContext2D, book: ShareBook, o: ShareOptions, p: Palette, box: Box, W: number) {
  const ar = imgRatio(book);
  const left = o.align === 'left';
  const byline = [book.author, book.year ? String(book.year) : ''].filter(Boolean).join('  \u00b7  ');
  const synopsis = o.synopsis ? (book.synopsis || '').trim() : '';

  // Measures the text block for a given width and sizes.
  const measure = (tw: number, ts: number, ss: number, maxSynLines: number) => {
    { const df = display(o); setFont(ctx, Math.round(ts * df.scale), df.family, df.weight); }
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
    { const df = display(o); setFont(ctx, Math.round(t.ts * df.scale), df.family, df.weight); }
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
  if (book.decor) drawDecor(ctx, book, cx, y0, cw, coverH, p, false);
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
