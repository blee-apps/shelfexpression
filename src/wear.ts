// Wear: an optional worn, read-many-times look for covers.
//
// Each texture is a pair of images made from a photo of a worn paperback:
//   shade-N: black, darkens creases and dents
//   rub-N:   pale paper, where ink has rubbed off at edges and creases
// They're laid over the cover at a strength set by the level, plus a slight
// fading of the cover's color. Every book gets its own texture and way up,
// picked from its title and author, so it always looks the same.

export type Wear = 'off' | 'light' | 'heavy';
export const WEAR_OPTIONS: { value: Wear; label: string }[] = [
  { value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'heavy', label: 'Well-loved' },
];
export const isWear = (v: unknown): v is Wear => v === 'off' || v === 'light' || v === 'heavy';

const TEXTURES = 3;
const LEVEL: Record<Exclude<Wear, 'off'>, { strength: number; fade: number }> = {
  light: { strength: 0.5, fade: 0.1 },
  heavy: { strength: 1, fade: 0.25 },
};

export const wearLevel = (w: Wear) => (w === 'off' ? null : LEVEL[w]);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// Which texture, and whether it's turned upside down (the spine creases stay
// on the left).
export function wearFor(title: string, author: string) {
  const h = hash(`${title.toLowerCase()}|${author.toLowerCase()}`);
  const n = (h % TEXTURES) + 1;
  return { shade: `/wear/shade-${n}.webp`, rub: `/wear/rub-${n}.webp`, flip: ((h >> 8) & 1) === 1 };
}

// --- Canvas (share images) -------------------------------------------------

const loaded = new Map<string, Promise<HTMLImageElement | null>>();
const loadImg = (src: string) => {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    loaded.set(src, p);
  }
  return p;
};

// A worn copy of a cover, as an image the share renderer can draw like any other.
const baked = new Map<string, Promise<HTMLImageElement>>();
export function wornCover(img: HTMLImageElement, title: string, author: string, wear: Wear): Promise<HTMLImageElement> {
  const lv = wearLevel(wear);
  if (!lv || !img.naturalWidth) return Promise.resolve(img);
  const key = `${img.src}|${title}|${author}|${wear}`;
  let p = baked.get(key);
  if (!p) {
    p = (async () => {
      const t = wearFor(title, author);
      const [shade, rub] = await Promise.all([loadImg(t.shade), loadImg(t.rub)]);
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
        if (t.flip) { x.translate(0, h); x.scale(1, -1); }
        if (shade) x.drawImage(shade, 0, 0, w, h);
        if (rub) x.drawImage(rub, 0, 0, w, h);
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
