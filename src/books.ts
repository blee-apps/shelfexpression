// Your books live in content/books.json. This file just reads them in
// (or the copy inside index.html on a site made with Create Static Site).
import { SHELF_CONTENT as content } from './shelfData';
import { decorById } from './decor';

export interface Book {
  id: string; isbn: string; title: string; author: string;
  year: number; synopsis: string; gr: string; mult: number;
  coverUrl?: string;
  coverLocked?: boolean;
  // A decoration (a plant, a camera…) standing in a slot instead of a book.
  // In books.json it's just { "id", "type": "decor", "decor": "plant" }.
  type?: 'decor';
  decor?: string;
}

export type RawBook = Omit<Book, 'mult'>;

export const isDecor = (b: { type?: string } | null | undefined): boolean => b?.type === 'decor';

// A decoration as a shelf item, named after its catalogue entry.
export const decorBook = (id: string, decor: string): Book => ({
  id, isbn: '', title: decorById(decor)?.label ?? 'Decoration', author: '', year: 0, synopsis: '', gr: '', mult: 1,
  type: 'decor', decor,
});

const toItem = (raw: any): RawBook => {
  if (raw?.type !== 'decor') return raw;
  const { mult: _m, ...item } = decorBook(String(raw.id ?? ''), String(raw.decor ?? ''));
  return item;
};

// Everything on the shelf, in order: books and decorations.
export const RAW_ITEMS: RawBook[] = (content.books as any[]).map(toItem);

// Just the books.
export const RAW_BOOKS: RawBook[] = RAW_ITEMS.filter(b => !isDecor(b));

export const USE_VITSOE_SHELF: boolean = content.useVitsoeShelf;

// Light, dark, or auto (follows each visitor's device setting).
export type ColorMode = 'light' | 'dark' | 'auto';
const mode = (content as { colorMode?: string }).colorMode;
export const COLOR_MODE: ColorMode = mode === 'dark' || mode === 'auto' ? mode : 'light';

// Footer line for share images, once you've set one in the editor.
export const SHARE_FOOTER: string | undefined = (content as { share?: { footer?: string } }).share?.footer;

export const SHELF_ITEMS: Book[] = RAW_ITEMS.map(book => ({
  ...book,
  mult: (() => {
    let hash = 0;
    for (let i = 0; i < book.title.length; i++) hash = book.title.charCodeAt(i) + ((hash << 5) - hash);
    return 1.0 + (Math.abs(hash) % 50) / 100;
  })(),
}));

export const BOOKS: Book[] = SHELF_ITEMS.filter(b => !isDecor(b));
