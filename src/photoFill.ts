// A photo filling a frame: where it sits (pan), how close (zoom) and how
// soft (blur). Shared by the Share Studio's photo background and the photo
// frame decoration, so both behave the same.

export type PhotoPlace = {
  x: number;     // 0 = left edge, 1 = right edge
  y: number;     // 0 = top, 1 = bottom
  zoom: number;  // 100 = just fills the frame
};

/** The photo's size and place in a W x H frame. */
export function fillRect(img: HTMLImageElement, W: number, H: number, p: PhotoPlace) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * Math.max(1, p.zoom / 100);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  return { dw, dh, x: (W - dw) * p.x, y: (H - dh) * p.y };
}

/** Dragging by (dx, dy) frame pixels: the photo's new position. */
export function panFill(img: HTMLImageElement, W: number, H: number, p: PhotoPlace, dx: number, dy: number): { x: number; y: number } {
  const r = fillRect(img, W, H, p);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x: r.dw - W > 0.5 ? clamp(p.x - dx / (r.dw - W)) : 0.5,
    y: r.dh - H > 0.5 ? clamp(p.y - dy / (r.dh - H)) : 0.5,
  };
}

/** The photo drawn into a new W x H canvas, blurred by sigma pixels. */
export function fillPhoto(img: HTMLImageElement, W: number, H: number, place: PhotoPlace, sigma: number): HTMLCanvasElement {
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const c = out.getContext('2d')!;
  const { dw, dh, x: px, y: py } = fillRect(img, W, H, place);
  // A true Gaussian blur (three box passes), done on a smaller copy and
  // enlarged, so even a strong blur stays fast and perfectly smooth.
  c.imageSmoothingQuality = 'high';
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
  return out;
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

