// Your own decoration: a transparent PNG (or WebP) picked in the editor.
// It's tidied up in the browser before it waits with the new covers:
// the see-through margins are cut off (so the bottom edge is where it
// stands), it's made at most 800px tall, and where it touches the shelf is
// measured for the shadow.

const MAX_HEIGHT = 800;
const MAX_WIDTH = 1600;

export type PreparedDecor = {
  blob: Blob;
  ext: 'png' | 'webp';
  preview: string;
  aspect: number;
  base: [number, number];
  // False when no part of the image is see-through (it still works, just
  // as a rectangle).
  transparent: boolean;
};

const loadImage = (blob: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image the browser can read')); };
  img.src = url;
});

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export async function prepareDecorImage(file: Blob): Promise<PreparedDecor> {
  if (!/^image\/(png|webp)$/.test(file.type) && file.type) throw new Error('Use a PNG or WebP image');
  const img = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error('That image is empty');

  // Read it at a size the browser handles comfortably.
  const readScale = Math.min(1, 3000 / Math.max(w, h));
  const rw = Math.max(1, Math.round(w * readScale)), rh = Math.max(1, Math.round(h * readScale));
  const src = document.createElement('canvas');
  src.width = rw; src.height = rh;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0, rw, rh);
  const data = sctx.getImageData(0, 0, rw, rh).data;

  // The box around everything that isn't fully see-through.
  let top = rh, bottom = -1, left = rw, right = -1, transparent = false;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const a = data[(y * rw + x) * 4 + 3];
      if (a < 250) transparent = true;
      if (a === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) throw new Error('That image is completely see-through');
  const cw = right - left + 1, ch = bottom - top + 1;

  // Where it touches the shelf: the solid part of its bottom few rows.
  const rows = Math.max(2, Math.round(ch * 0.03));
  let bl = cw, br = -1;
  for (let y = bottom - rows + 1; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (data[(y * rw + x) * 4 + 3] < 128) continue;
      if (x - left < bl) bl = x - left;
      if (x - left > br) br = x - left;
    }
  }
  const base: [number, number] = br >= bl && (br - bl + 1) / cw > 0.02
    ? [round(bl / cw, 3), round((br + 1) / cw, 3)]
    : [0.1, 0.9];

  // At most 800px tall (and 1600px wide), trimmed.
  const scale = Math.min(1, MAX_HEIGHT / ch, MAX_WIDTH / cw);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * scale));
  out.height = Math.max(1, Math.round(ch * scale));
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, left, top, cw, ch, 0, 0, out.width, out.height);

  // Keeps the format it came in. Browsers that can't write WebP give a PNG.
  const want = file.type === 'image/webp' ? 'image/webp' : 'image/png';
  const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, want, 0.92));
  if (!blob) throw new Error('Couldn\u2019t prepare the image');
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  return { blob, ext, preview: URL.createObjectURL(blob), aspect: round(out.width / out.height, 4), base, transparent };
}
