// Create Static Site: zips this site's built files with the current shelf
// written into index.html, plus every cover, ready to upload to any host.
import { pendingCovers } from './publish';
import { COVER_MANIFEST, StaticShelf, StaticSiteSettings, CoverInfo } from './shelfData';

const SETTINGS_KEY = 'bookshelf.staticSite';

export const loadSiteSettings = (): Partial<StaticSiteSettings> | null => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch { return null; }
};
export const saveSiteSettings = (s: StaticSiteSettings) => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
};

const README = (s: StaticSiteSettings) => `${s.title} (made with Shelf Expression)
${'='.repeat(Math.min(60, s.title.length + 27))}

This folder is a complete website. Nothing needs installing.

To put it online:
1. Unzip it.
2. Upload everything in the folder to the top level of a website,
   for example a Netlify Drop, Cloudflare Pages or Neocities site,
   or any web host. Keep index.html, assets/ and covers/ together.
3. Open the site's address. That's it.

It must sit at the top of its address (like books.example.com),
not in a subfolder (like example.com/books).

${s.editor
  ? `To change it later: open the site, press Ctrl+Shift+U (Cmd+Shift+U on a Mac)
or tap the heading 5 times, edit your books, then Export site
again and upload the new folder over the old one.`
  : `This site has no editor. To change it, make a new one from the
editor you used before.`}

To try it on your computer first, run a local web server in this
folder (for example: python3 -m http.server) and open
http://localhost:8000. Opening index.html directly won't work.
`;

const escapeForScript = (json: string) =>
  json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Puts the shelf into index.html, replacing one from an earlier export.
export const patchIndexHtml = (html: string, shelf: StaticShelf): string => {
  const tag = `<script id="shelf-data">window.__SHELF__=${escapeForScript(JSON.stringify(shelf))};</script>`;
  let out = html.replace(/<script id="shelf-data">[\s\S]*?<\/script>\s*/, '');
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(shelf.site.title)}</title>`);
  const at = out.search(/<script type="module"/);
  return at >= 0 ? out.slice(0, at) + tag + '\n    ' + out.slice(at) : out.replace('</head>', `  ${tag}\n  </head>`);
};

const measureRatio = async (blob: Blob): Promise<number | null> => {
  try {
    const bmp = await createImageBitmap(blob);
    const r = bmp.width / bmp.height;
    bmp.close();
    return Math.round(r * 1000) / 1000;
  } catch { return null; }
};

const getFile = async (path: string): Promise<Uint8Array> => {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Couldn\u2019t get ${path} (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
};

export type ExportResult = { blob: Blob; fileName: string; books: number; covers: number; missingCovers: string[] };

export async function createStaticSite(opts: {
  content: { books: { id?: string; isbn?: string; title: string; coverUrl?: string }[]; [k: string]: unknown };
  site: StaticSiteSettings;
  onStep?: (text: string) => void;
}): Promise<ExportResult> {
  const { content, site, onStep } = opts;
  const { zipSync, strToU8 } = await import('fflate');

  onStep?.('Getting the site files\u2026');
  let list: string[];
  try {
    const r = await fetch('/site-files.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    list = (await r.json()).files;
  } catch {
    throw new Error(import.meta.env.DEV
      ? 'Export site needs a built site. Run npm run build, then npm run preview, and try there.'
      : 'This site is missing its file list (site-files.json). Rebuild it with the newest version.');
  }

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const add = (path: string, data: Uint8Array) => {
    const packed = /\.(jpe?g|png|webp|woff2?)$/i.test(path);
    files[path] = [data, { level: packed ? 0 : 6 }];
  };

  let indexHtml = '';
  await Promise.all(list.map(async path => {
    if (path === 'index.html') { indexHtml = new TextDecoder().decode(await getFile('/index.html')); return; }
    add(path, await getFile(`/${path}`));
  }));
  if (!indexHtml) indexHtml = new TextDecoder().decode(await getFile('/index.html'));
  add('site-files.json', strToU8(JSON.stringify({ files: list }, null, 2) + '\n'));

  // Covers: each book's own cover (waiting in the editor, or on this site),
  // or the one found at build time. Web links stay as links.
  onStep?.('Packing the covers\u2026');
  const covers: Record<string, CoverInfo> = {};
  const missingCovers: string[] = [];
  let coverCount = 0;
  const books = content.books.map(b => ({ ...b }));
  await Promise.all(books.map(async (book, i) => {
    const key = book.isbn || book.id || String(i + 1);
    const known = COVER_MANIFEST[key];
    const src = book.coverUrl || known?.path || '';
    if (!src) return;
    if (/^https?:\/\//.test(src)) { covers[key] = { path: null, aspectRatio: known?.aspectRatio ?? null }; return; }
    const name = src.replace(/^\/+/, '');
    if (!/^covers\/[^/]+$/.test(name)) return;
    try {
      const pending = pendingCovers.get(src);
      const data = pending ? new Uint8Array(await pending.blob.arrayBuffer()) : await getFile(src);
      if (!files[name]) { add(name, data); coverCount++; }
      const ratio = known?.path === src && known.aspectRatio ? known.aspectRatio : await measureRatio(new Blob([data as BlobPart]));
      covers[key] = { path: src, aspectRatio: ratio };
      if (!book.coverUrl) book.coverUrl = src;
    } catch {
      missingCovers.push(book.title);
    }
  }));

  onStep?.('Zipping\u2026');
  const shelf: StaticShelf = { version: 1, content: { ...content, books }, covers, site };
  add('index.html', strToU8(patchIndexHtml(indexHtml, shelf)));
  add('READ ME.txt', strToU8(README(site)));

  const folder = (site.title || 'bookshelf').toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bookshelf';
  const nested: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [path, entry] of Object.entries(files)) nested[`${folder}/${path}`] = entry;
  const zipped = zipSync(nested);
  return {
    blob: new Blob([zipped as BlobPart], { type: 'application/zip' }),
    fileName: `${folder}.zip`,
    books: books.length,
    covers: coverCount,
    missingCovers,
  };
}

// Saves the zip. On iPhone and iPad this opens the share sheet (Save to Files);
// elsewhere it downloads.
export async function saveZip(blob: Blob, fileName: string) {
  const file = new File([blob], fileName, { type: 'application/zip' });
  const touch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (touch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
