import { Wear, isWear } from './wear';
// Your books live in content/books.json. This file just reads them in
// (or the copy inside index.html on a site made with Create Static Site).
import { SHELF_CONTENT as content } from './shelfData';
import { decorById, customDecor, CustomDecor, CUSTOM_DECOR } from './decor';

export interface Book {
  id: string; isbn: string; title: string; author: string;
  year: number; synopsis: string; gr: string; mult: number;
  coverUrl?: string;
  coverLocked?: boolean;
  // A decoration (a cactus, a camera…) standing in a slot instead of a book.
  // In books.json it's just { "id", "type": "decor", "decor": "cactus" }.
  // One you uploaded yourself has "decor": "custom" and also carries its
  // label, image (src), height, aspect and base (see src/decor.ts).
  type?: 'decor';
  decor?: string;
  label?: string;
  src?: string;
  height?: number;
  aspect?: number;
  base?: [number, number];
}

export type RawBook = Omit<Book, 'mult'>;

export const isDecor = (b: { type?: string } | null | undefined): boolean => b?.type === 'decor';

// A decoration as a shelf item, named after its catalogue entry (or, for
// your own, after the label you gave it).
export const decorBook = (id: string, decor: string, custom?: CustomDecor): Book => ({
  id, isbn: '', title: custom?.label ?? decorById(decor)?.label ?? 'Decoration', author: '', year: 0, synopsis: '', gr: '', mult: 1,
  type: 'decor', decor, ...(decor === CUSTOM_DECOR && custom ? custom : {}),
});

// A decoration from books.json (or a draft) as a shelf item.
export const decorFromRaw = (raw: any): Book =>
  decorBook(String(raw?.id ?? ''), String(raw?.decor ?? ''), customDecor(raw));

// A decoration as it's written in books.json.
export const decorEntry = (id: string, b: Book): Record<string, unknown> => {
  const c = b.decor === CUSTOM_DECOR ? customDecor(b) : undefined;
  return c ? { id, type: 'decor', decor: CUSTOM_DECOR, ...c } : { id, type: 'decor', decor: b.decor || '' };
};

const toItem = (raw: any): RawBook => {
  if (raw?.type !== 'decor') return raw;
  const { mult: _m, ...item } = decorFromRaw(raw);
  return item;
};

// Everything on the shelf, in order: books and decorations.
export const RAW_ITEMS: RawBook[] = (content.books as any[]).map(toItem);

// Just the books.
export const RAW_BOOKS: RawBook[] = RAW_ITEMS.filter(b => !isDecor(b));

// Billy (IKEA's classic bookcase) shares the Vitsoe layout: books stand on
// shelves, only the furniture around them changes.
export type ShelfStyle = 'minimal' | 'vitsoe' | 'billy';
const shelfSetting = (content as { shelf?: string }).shelf;
export const SHELF_STYLE: ShelfStyle = shelfSetting === 'billy' ? 'billy' : content.useVitsoeShelf ? 'vitsoe' : 'minimal';
export const USE_VITSOE_SHELF: boolean = SHELF_STYLE !== 'minimal';

// Worn covers: off, light, or heavy (Well-loved).
const wearSetting = (content as { wear?: string }).wear;
export const WEAR: Wear = isWear(wearSetting) ? wearSetting : 'off';

// Light, dark, or auto (follows each visitor's device setting).
export type ColorMode = 'light' | 'dark' | 'auto';
const mode = (content as { colorMode?: string }).colorMode;
export const COLOR_MODE: ColorMode = mode === 'dark' || mode === 'auto' ? mode : 'light';

// Footer line for share images, once you've set one in the editor.
export const SHARE_FOOTER: string | undefined = (content as { share?: { footer?: string } }).share?.footer;

// How the books are ordered on the shelf. books.json always keeps your own
// order (Manual); the others only change what visitors see. Decorations stay
// in the slots you put them in and the books are sorted around them.
export type SortOrder = 'manual' | 'year-asc' | 'year-desc' | 'title' | 'author' | 'random';
export const SORT_ORDERS: SortOrder[] = ['manual', 'year-asc', 'year-desc', 'title', 'author', 'random'];
export const isSortOrder = (v: unknown): v is SortOrder => SORT_ORDERS.includes(v as SortOrder);
const sortSetting = (content as { sort?: string }).sort;
export const SORT_ORDER: SortOrder = isSortOrder(sortSetting) ? sortSetting : 'manual';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// "The Left Hand of Darkness" files under L.
const titleKey = (t: string) => (t || '').trim().replace(/^(the|a|an)\s+/i, '');

// Surname first, the way bookshops shelve: "Ursula K. Le Guin" files under
// Le Guin, "Emily St. John Mandel" under Mandel. Jr. and III are skipped.
const PARTICLES = new Set(['de', 'del', 'della', 'der', 'den', 'di', 'da', 'das', 'dos', 'du', 'la', 'le', 'van', 'von', 'ter', 'ten', 'al', 'el', 'bin', 'ibn', 'mac', 'st.', 'saint']);
const SUFFIXES = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
export const authorKey = (author: string) => {
  // Several authors: sort by the first.
  const first = (author || '').split(/\s*(?:,|&|\band\b)\s*/)[0].trim();
  const words = first.split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIXES.test(words[words.length - 1])) words.pop();
  if (words.length < 2) return first;
  let i = words.length - 1;
  // "St. John" is a middle name in "Emily St. John Mandel", so only take a
  // particle when it sits right before the last word.
  const p = words[i - 1];
  if (i - 1 >= 1 && PARTICLES.has(p.toLowerCase()) && p.toLowerCase() !== 'st.') {
    // A capitalized particle is part of the surname (Le Guin under L); a
    // lowercase one is skipped, like bookshops do (de Beauvoir under B).
    if (p[0] === p[0].toUpperCase()) i -= 1;
    else return [...words.slice(i), ...words.slice(0, i)].join(' ');
  }
  return [...words.slice(i), ...words.slice(0, i)].join(' ');
};

const shuffle = <T,>(list: T[]) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const byTitle = (a: RawBook, b: RawBook) => collator.compare(titleKey(a.title), titleKey(b.title));

export const sortBooks = <T extends RawBook>(books: T[], order: SortOrder): T[] => {
  switch (order) {
    case 'title': return [...books].sort(byTitle);
    case 'author': return [...books].sort((a, b) => collator.compare(authorKey(a.author), authorKey(b.author)) || byTitle(a, b));
    case 'year-asc':
    case 'year-desc': {
      const dir = order === 'year-asc' ? 1 : -1;
      // Books with no year go last either way.
      return [...books].sort((a, b) => (!a.year !== !b.year ? (a.year ? -1 : 1) : (a.year - b.year) * dir) || byTitle(a, b));
    }
    case 'random': return shuffle(books);
    default: return books;
  }
};

// The shelf in the given order, with decorations kept in their slots.
export const arrangeItems = <T extends RawBook>(items: T[], order: SortOrder): T[] => {
  if (order === 'manual') return items;
  const sorted = sortBooks(items.filter(b => !isDecor(b)), order);
  let next = 0;
  return items.map(item => (isDecor(item) ? item : sorted[next++]));
};

// Your own order, for the editor.
export const MANUAL_ITEMS: Book[] = RAW_ITEMS.map(book => ({
  ...book,
  mult: (() => {
    let hash = 0;
    for (let i = 0; i < book.title.length; i++) hash = book.title.charCodeAt(i) + ((hash << 5) - hash);
    return 1.0 + (Math.abs(hash) % 50) / 100;
  })(),
}));

// What visitors see, sorted (and shuffled once per visit for Random).
export const SHELF_ITEMS: Book[] = arrangeItems(MANUAL_ITEMS, SORT_ORDER);

export const BOOKS: Book[] = SHELF_ITEMS.filter(b => !isDecor(b));
