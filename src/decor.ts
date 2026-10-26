// Decorations: little things that stand on the shelf between the books.
// Each one takes a slot like a book. Add more by putting a transparent image
// in public/decor/ (trimmed so the bottom edge is where it stands) and a line
// below.

export interface DecorDef {
  id: string;
  label: string;
  // Served from public/decor, so it's in every build and exported site.
  src: string;
  // Height compared with a paperback standing next to it (1 = as tall).
  height: number;
  // The image's width / height.
  aspect: number;
  // Where it touches the shelf, as fractions of its width (for the shadow).
  base: [number, number];
}

// The shape of the paperback decorations are sized against.
export const BOOK_ASPECT = 2 / 3;

const CAMERA_ASPECT = 1275 / 800;

export const DECOR_CATALOGUE: DecorDef[] = [
  { id: 'cactus', label: 'Cactus', src: '/decor/cactus.webp', height: 0.75, aspect: 356 / 800, base: [0.24, 0.76] },
  { id: 'snowglobe', label: 'Snow globe', src: '/decor/snowglobe.webp', height: 0.7, aspect: 630 / 800, base: [0.05, 0.95] },
  { id: 'figurine', label: 'Figure', src: '/decor/figurine.webp', height: 0.6, aspect: 315 / 800, base: [0.15, 0.85] },
  { id: 'speaker', label: 'Speaker', src: '/decor/speaker.webp', height: 0.48, aspect: 902 / 800, base: [0.22, 0.78] },
  // No wider than 2/3 of a paperback (measured): width = 2/3 × the book's width.
  { id: 'camera', label: 'Film camera', src: '/decor/camera.webp', height: (2 / 3) * BOOK_ASPECT / CAMERA_ASPECT, aspect: CAMERA_ASPECT, base: [0.03, 0.97] },
  { id: 'trophy', label: 'Trophy', src: '/decor/trophy.webp', height: 0.62, aspect: 510 / 654, base: [0.24, 0.76] },
  // The reeds make it tall; the bottle itself is about a third of a paperback.
  { id: 'diffuser', label: 'Reed diffuser', src: '/decor/diffuser.webp', height: 0.8, aspect: 424 / 800, base: [0.3, 0.73] },
];

// Earlier names that now mean something else ("plant" became the cactus).
const RENAMED: Record<string, string> = { plant: 'cactus' };

export const decorById = (id?: string): DecorDef | undefined =>
  DECOR_CATALOGUE.find(d => d.id === (id && RENAMED[id] || id));

// --- Your own decorations ---------------------------------------------------
// One uploaded in the editor. Its image is kept with the covers
// (content/covers, served at /covers/), and books.json carries everything
// needed to stand it on the shelf:
//   { "id", "type": "decor", "decor": "custom", "label": "My speaker",
//     "src": "/covers/decor-abc.png", "height": 0.5, "aspect": 1.23, "base": [0.1, 0.9] }
export const CUSTOM_DECOR = 'custom';

// The photo frame: a square black frame with a white mat. Your photo is put
// into it in the editor and saved as one image, so it's just your own
// decoration from then on ("frame": true lets the editor offer a new photo
// instead of a new image).
export const PHOTO_FRAME = {
  src: '/decor/frame.webp',
  // The opening in the mat, as fractions of the frame (left, top, right, bottom).
  window: [0.17, 0.17, 0.83, 0.83] as const,
  height: 0.6,
  label: 'Photo frame',
};
export const CUSTOM_HEIGHT = { min: 0.15, max: 1, default: 0.5 };
export const CUSTOM_LABEL = 'My decoration';
const CUSTOM_SRC = /^\/covers\/[a-zA-Z0-9_-]+\.(png|webp)$/;

export type CustomDecor = { label: string; src: string; height: number; aspect: number; base: [number, number]; frame?: true };

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || fallback);
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

// A custom decoration's details from books.json, tidied up; undefined when
// there's no usable image.
// A photo frame never gets wider than a book, so it always fits one slot
// (a square frame tops out at two thirds of a paperback's height).
export const frameMaxHeight = (aspect: number) => Math.floor((BOOK_ASPECT / aspect) * 100) / 100;

export function customDecor(raw: any): CustomDecor | undefined {
  if (raw?.decor !== CUSTOM_DECOR || typeof raw.src !== 'string' || !CUSTOM_SRC.test(raw.src)) return undefined;
  const aspect = num(raw.aspect, 1) > 0 ? round(Math.min(10, num(raw.aspect, 1)), 4) : 1;
  const frame = raw.frame === true;
  const max = frame ? frameMaxHeight(aspect) : CUSTOM_HEIGHT.max;
  const height = round(Math.min(max, Math.max(0.05, num(raw.height, CUSTOM_HEIGHT.default))), 3);
  const b = Array.isArray(raw.base) ? raw.base.map((x: unknown) => num(x, NaN)) : [];
  const base: [number, number] = b.length === 2 && b[0] >= 0 && b[1] <= 1 && b[0] < b[1] ? [round(b[0], 3), round(b[1], 3)] : [0.1, 0.9];
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 40) : CUSTOM_LABEL;
  return { label, src: raw.src, height, aspect, base, ...(frame ? { frame: true as const } : {}) };
}

// What to draw for any decoration on the shelf, built-in or your own.
// Undefined for a name this version doesn't know: it's just left out.
export const decorDefOf = (item: { decor?: string } & Partial<CustomDecor> | null | undefined): DecorDef | undefined => {
  if (!item) return undefined;
  if (item.decor === CUSTOM_DECOR) {
    const c = customDecor(item);
    return c && { id: CUSTOM_DECOR, ...c };
  }
  return decorById(item.decor);
};
