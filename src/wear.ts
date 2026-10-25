// Wear: an optional worn, read-many-times look for covers.
//
// The wear comes in parts (spine creases, edges, surface, corners, a ring
// stain), cut from photos of worn paperbacks: black where it darkens a crease,
// pale paper where ink has rubbed off. Each book gets its own mix of parts,
// picked from its title and author so it always looks the same, put together
// into one overlay and laid over the cover at the level's strength, with a
// slight fading of the cover's color.

export type Wear = 'off' | 'light' | 'heavy';
export const WEAR_OPTIONS: { value: Wear; label: string }[] = [
  { value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'heavy', label: 'Well-loved' },
];
export const isWear = (v: unknown): v is Wear => v === 'off' || v === 'light' || v === 'heavy';

const LEVEL: Record<Exclude<Wear, 'off'>, { strength: number; fade: number }> = {
  light: { strength: 0.5, fade: 0.1 },
  heavy: { strength: 1, fade: 0.25 },
};

export const wearLevel = (w: Wear) => (w === 'off' ? null : LEVEL[w]);

// The parts, each a piece of a 400 x 600 cover: [x, y, width, height].
// Corners are all drawn as the top-right one; turned upside down they're the
// bottom-right. The spine side (left) is never turned. Each corner has a
// matching cut (cut-N): the bit of cover that corner has worn away, which is
// cut out of the cover itself so no crisp printed corner shows past it.
const SIZE = { w: 400, h: 600 };
const BOX: Record<string, [number, number, number, number]> = {"cut-1": [352, 0, 48, 48], "cut-2": [352, 0, 48, 48], "cut-3": [352, 0, 48, 48], "cut-4": [352, 0, 48, 48], "cut-5": [352, 0, 48, 48], "cut-6": [352, 0, 48, 48], "spine-1": [0, 0, 85, 600], "spine-2": [0, 0, 85, 600], "spine-3": [0, 0, 85, 600], "spine-4": [0, 0, 84, 600], "edge-1": [60, 0, 340, 600], "corner-1": [266, 0, 134, 134], "corner-2": [265, 0, 135, 136], "surface-1": [52, 13, 337, 577], "edge-2": [60, 0, 340, 600], "corner-3": [264, 0, 136, 134], "corner-4": [264, 0, 136, 136], "surface-2": [52, 12, 337, 578], "edge-3": [60, 0, 340, 600], "corner-5": [268, 0, 132, 134], "corner-6": [264, 0, 136, 136], "surface-3": [51, 13, 338, 577], "stain-1": [128, 326, 250, 251]};
const COUNT = { spine: 4, edge: 3, surface: 3, corner: 6 };

// A small seeded random generator, so a book's wear never changes.
const rng = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

type Part = { name: string; flip: boolean };
// Which parts a book gets: a spine, edges, surface, a top and a bottom
// corner, and now and then a ring stain. About 15,000 combinations.
export function wearParts(title: string, author: string): Part[] {
  const r = rng(`${title.toLowerCase()}|${author.toLowerCase()}`);
  const pick = (n: number) => 1 + Math.floor(r() * n);
  const parts: Part[] = [
    { name: `surface-${pick(COUNT.surface)}`, flip: r() < 0.5 },
    { name: `edge-${pick(COUNT.edge)}`, flip: r() < 0.5 },
    { name: `spine-${pick(COUNT.spine)}`, flip: false },
    { name: `corner-${pick(COUNT.corner)}`, flip: false },
    { name: `corner-${pick(COUNT.corner)}`, flip: true },
  ];
  if (r() < 0.2) parts.push({ name: 'stain-1', flip: r() < 0.5 });
  return parts;
}

// --- Making the overlay ------------------------------------------------------

const images = new Map<string, Promise<HTMLImageElement | null>>();
const loadImg = (src: string) => {
  let p = images.get(src);
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
};

// One book's wear, put together for its cover's own shape: a transparent
// overlay (so the shelf only ever lays one layer over a cover) and a mask that
// cuts away the worn corners. Both are blob URLs.
//
// The parts are drawn for a 400 x 600 cover and then fitted, not stretched:
// corners and the ring stain keep their shape, the spine and edges keep their
// width, and only the open middle stretches to a taller or squatter cover.
export type WearArt = { overlay: string; mask: string };
const arts = new Map<string, Promise<WearArt | null>>();
const shapeOf = (aspect: number) => {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(1.25, Math.max(0.4, aspect)) : 2 / 3;
  return { w: SIZE.w, h: Math.round(SIZE.w / a) };
};
const toUrl = (c: HTMLCanvasElement) => new Promise<string | null>(r => c.toBlob(b => r(b ? URL.createObjectURL(b) : null), 'image/png'));

function drawPart(x: CanvasRenderingContext2D, img: HTMLImageElement, name: string, flip: boolean, h: number) {
  const b = BOX[name];
  if (!b) return;
  const [bx, by, bw, bh] = b;
  const k = h / SIZE.h;
  x.save();
  if (flip) { x.translate(0, h); x.scale(1, -1); }
  const kind = name.split('-')[0];
  if (kind === 'corner' || kind === 'cut') {
    x.drawImage(img, bx, by, bw, bh); // pinned to the corner, never resized
  } else if (kind === 'stain') {
    const cy = (by + bh / 2) * k;
    x.drawImage(img, bx, cy - bh / 2, bw, bh);
  } else if (kind === 'edge' && h >= 120) {
    // Top and bottom strips as they are; only the middle stretches.
    const sw = img.naturalWidth, sh = img.naturalHeight, s = sh / bh, e = 48;
    x.drawImage(img, 0, 0, sw, e * s, bx, by, bw, e);
    x.drawImage(img, 0, e * s, sw, sh - 2 * e * s, bx, by + e, bw, h - 2 * e);
    x.drawImage(img, 0, sh - e * s, sw, e * s, bx, h - e, bw, e);
  } else {
    x.drawImage(img, bx, by * k, bw, bh * k);
  }
  x.restore();
}

export function wearArt(title: string, author: string, aspect: number): Promise<WearArt | null> {
  const { w, h } = shapeOf(aspect);
  const key = `${title.toLowerCase()}|${author.toLowerCase()}|${h}`;
  let p = arts.get(key);
  if (!p) {
    p = (async () => {
      const parts = wearParts(title, author);
      const cuts = parts.filter(pt => pt.name.startsWith('corner-')).map(pt => ({ name: pt.name.replace('corner', 'cut'), flip: pt.flip }));
      const [imgs, cutImgs] = await Promise.all([
        Promise.all(parts.map(pt => loadImg(`/wear/${pt.name}.webp`))),
        Promise.all(cuts.map(pt => loadImg(`/wear/${pt.name}.webp`))),
      ]);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      if (!x) return null;
      parts.forEach((pt, i) => { const img = imgs[i]; if (img) drawPart(x, img, pt.name, pt.flip, h); });
      const m = document.createElement('canvas');
      m.width = w; m.height = h;
      const mx = m.getContext('2d');
      if (!mx) return null;
      mx.fillStyle = '#fff';
      mx.fillRect(0, 0, w, h);
      mx.globalCompositeOperation = 'destination-out';
      cuts.forEach((pt, i) => { const img = cutImgs[i]; if (img) drawPart(mx, img, pt.name, pt.flip, h); });
      const [overlay, mask] = await Promise.all([toUrl(c), toUrl(m)]);
      return overlay && mask ? { overlay, mask } : null;
    })();
    arts.set(key, p);
  }
  return p;
}

// --- Share images ----------------------------------------------------------

// A worn copy of a cover, as an image the share renderer can draw like any other.
const baked = new Map<string, Promise<HTMLImageElement>>();
export function wornCover(img: HTMLImageElement, title: string, author: string, wear: Wear): Promise<HTMLImageElement> {
  const lv = wearLevel(wear);
  if (!lv || !img.naturalWidth) return Promise.resolve(img);
  const key = `${img.src}|${title}|${author}|${wear}`;
  let p = baked.get(key);
  if (!p) {
    p = (async () => {
      const art = await wearArt(title, author, img.naturalWidth / img.naturalHeight);
      const [overlay, mask] = art ? await Promise.all([loadImg(art.overlay), loadImg(art.mask)]) : [null, null];
      try {
        const scale = Math.min(1, 1200 / img.naturalHeight);
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d')!;
        x.drawImage(img, 0, 0, w, h);
        // Faded color.
        x.globalCompositeOperation = 'saturation';
        x.globalAlpha = lv.fade;
        x.fillStyle = '#808080';
        x.fillRect(0, 0, w, h);
        x.globalCompositeOperation = 'source-over';
        x.globalAlpha = lv.strength;
        if (overlay) x.drawImage(overlay, 0, 0, w, h);
        // Cut the worn corners away (PNG, so they stay see-through).
        if (mask) {
          x.globalAlpha = 1;
          x.globalCompositeOperation = 'destination-in';
          x.drawImage(mask, 0, 0, w, h);
        }
        const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
        if (!blob) return img;
        const out = new Image();
        out.src = URL.createObjectURL(blob);
        await out.decode();
        return out;
      } catch {
        return img; // e.g. a cover from a site that doesn't allow it
      }
    })();
    baked.set(key, p);
  }
  return p;
}
