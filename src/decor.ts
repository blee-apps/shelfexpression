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

export const DECOR_CATALOGUE: DecorDef[] = [
  { id: 'plant', label: 'Plant', src: '/decor/plant.webp', height: 0.95, aspect: 906 / 800, base: [0.27, 0.62] },
  { id: 'snowglobe', label: 'Snow globe', src: '/decor/snowglobe.webp', height: 0.7, aspect: 630 / 800, base: [0.05, 0.95] },
  { id: 'figurine', label: 'Figure', src: '/decor/figurine.webp', height: 0.6, aspect: 315 / 800, base: [0.15, 0.85] },
  { id: 'speaker', label: 'Speaker', src: '/decor/speaker.webp', height: 0.48, aspect: 902 / 800, base: [0.22, 0.78] },
  { id: 'camera', label: 'Film camera', src: '/decor/camera.webp', height: 0.4, aspect: 1275 / 800, base: [0.03, 0.97] },
];

export const decorById = (id?: string): DecorDef | undefined => DECOR_CATALOGUE.find(d => d.id === id);

// The shape of the paperback decorations are sized against.
export const BOOK_ASPECT = 2 / 3;
