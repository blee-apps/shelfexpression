// Your books live in content/books.json. This file just reads them in.
import content from '../content/books.json';

export interface Book {
  id: string; isbn: string; title: string; author: string;
  year: number; synopsis: string; gr: string; mult: number;
  coverUrl?: string;
  coverLocked?: boolean;
}

export type RawBook = Omit<Book, 'mult'>;

export const RAW_BOOKS: RawBook[] = content.books;

export const USE_VITSOE_SHELF: boolean = content.useVitsoeShelf;

// Footer line for share images, once you've set one in the editor.
export const SHARE_FOOTER: string | undefined = (content as { share?: { footer?: string } }).share?.footer;

export const BOOKS: Book[] = RAW_BOOKS.map(book => ({
  ...book,
  mult: (() => {
    let hash = 0;
    for (let i = 0; i < book.title.length; i++) hash = book.title.charCodeAt(i) + ((hash << 5) - hash);
    return 1.0 + (Math.abs(hash) % 50) / 100;
  })(),
}));
