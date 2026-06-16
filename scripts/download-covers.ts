import { RAW_BOOKS } from '../src/books';
import { imageSizeFromFile } from 'image-size/fromFile';
import { writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { readFileSync } from 'fs';

const COVERS_DIR = 'public/covers';
const MANIFEST_FILE = 'src/generated/cover-manifest.json';

// --- helpers ---

// Load .env so VITE_* vars are available when run locally
try {
  const envText = readFileSync('.env', 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([^=]+)=(.*)/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const gbKey = process.env.VITE_GOOGLE_BOOKS_API_KEY || '';
const gbUrl = (url: string) => gbKey ? `${url}&key=${gbKey}` : url;

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface BookCover {
  path: string | null;
  aspectRatio: number | null;
}

// --- main ---

async function main() {
  await mkdir('public', { recursive: true });
  await mkdir(COVERS_DIR, { recursive: true });
  await mkdir('src/generated', { recursive: true });

  const manifest: Record<string, BookCover> = {};
  let found = 0;
  let skipped = 0;

  for (const book of RAW_BOOKS) {
    const dest = `${COVERS_DIR}/${book.id}.jpg`;

    // Collect candidate URLs, try them in order
    const candidates: string[] = [];

    // 1. OpenLibrary search by title+author
    try {
      const data = await fetchJson(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}`
      );
      const coverI = data.docs?.[0]?.cover_i;
      if (coverI) candidates.push(`https://covers.openlibrary.org/b/id/${coverI}-L.jpg`);
    } catch {}

    // 2. OpenLibrary ISBN direct
    if (book.isbn) {
      candidates.push(`https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`);
    }

    // 3. Google Books fallback
    try {
      const data = await fetchJson(
        gbUrl(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}`)
      );
      const thumb = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
      if (thumb) candidates.push(thumb.replace('zoom=1', 'zoom=2').replace('http:', 'https:'));
    } catch {}

    let downloaded = false;
    for (const cand of candidates) {
      try {
        await download(cand, dest);
        const dims = await imageSizeFromFile(dest);
        if (!dims.width || !dims.height || dims.width <= 1 || dims.height <= 1) {
          await unlink(dest).catch(() => {});
          continue;
        }
        manifest[book.id] = { path: `/covers/${book.id}.jpg`, aspectRatio: dims.width / dims.height };
        found++;
        downloaded = true;
        console.log(`  ✓ ${book.title} — ${cand.split('/').pop()} (${dims.width}x${dims.height})`);
        break;
      } catch {}
    }

    if (!downloaded) {
      console.log(`  ✗ ${book.title} — all sources failed`);
      manifest[book.id] = { path: null, aspectRatio: null };
      skipped++;
    }
  }

  // Clean up old cover images not in the current book set
  const currentIds = new Set(RAW_BOOKS.map(b => b.id));
  try {
    const files = await readdir(COVERS_DIR);
    for (const f of files) {
      const id = f.replace(/\.jpg$/, '');
      if (!currentIds.has(id)) {
        await unlink(`${COVERS_DIR}/${f}`).catch(() => {});
        console.log(`  🗑 removed stale cover: ${f}`);
      }
    }
  } catch {}

  // Write manifest
  await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nDone. ${found} covers downloaded, ${skipped} skipped. Manifest written to ${MANIFEST_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
