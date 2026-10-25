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
// bottom-right. The spine side (left) is never turned.
const SIZE = { w: 400, h: 600 };
const BOX: Record<string, [number, number, number, number]> = {"spine-1": [0, 0, 85, 600], "spine-2": [0, 0, 84, 600], "spine-3": [0, 0, 85, 600], "spine-4": [0, 0, 84, 600], "edge-1": [60, 0, 340, 600], "corner-1": [266, 0, 134, 134], "corner-2": [265, 0, 135, 136], "surface-1": [52, 13, 337, 577], "edge-2": [60, 0, 340, 600], "corner-3": [264, 0, 136, 136], "corner-4": [264, 0, 136, 137], "surface-2": [51, 12, 337, 578], "edge-3": [60, 0, 340, 600], "corner-5": [268, 0, 132, 134], "corner-6": [264, 0, 136, 135], "surface-3": [51, 13, 338, 577], "stain-1": [126, 326, 251, 251]};
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

// One book's wear, put together as a single transparent image (a blob URL),
// so the shelf only ever lays one layer over a cover.
const overlays = new Map<string, Promise<string | null>>();
export function wearOverlay(title: string, author: string): Promise<string | null> {
  const key = `${title.toLowerCase()}|${author.toLowerCase()}`;
  let p = overlays.get(key);
  if (!p) {
    p = (async () => {
      const parts = wearParts(title, author);
      const imgs = await Promise.all(parts.map(pt => loadImg(`/wear/${pt.name}.webp`)));
      const c = document.createElement('canvas');
      c.width = SIZE.w; c.height = SIZE.h;
      const x = c.getContext('2d');
      if (!x) return null;
      parts.forEach((pt, i) => {
        const img = imgs[i];
        const b = BOX[pt.name];
        if (!img || !b) return;
        const [bx, by, bw, bh] = b;
        x.save();
        if (pt.flip) { x.translate(0, SIZE.h); x.scale(1, -1); }
        x.drawImage(img, bx, by, bw, bh);
        x.restore();
      });
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
      return blob ? URL.createObjectURL(blob) : null;
    })();
    overlays.set(key, p);
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
      const url = await wearOverlay(title, author);
      const overlay = url ? await loadImg(url) : null;
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
        const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92));
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
