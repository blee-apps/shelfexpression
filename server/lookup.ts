// Lookups the editor can't do from the browser, because those websites block
// direct requests from other sites. They run as Vercel functions on the live
// site (see api/) and inside the Vite dev server locally (vite.config.ts),
// so both behave the same.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export type GoodreadsMatch = { id: string; url: string; via: 'isbn' | 'search' };

// Finds a book's Goodreads page. Goodreads has no public API, but
// goodreads.com/book/isbn/<ISBN> redirects to the right book page, so we
// follow that (tries each ISBN in turn). If no ISBN works, falls back to the
// first result of a Goodreads search for title + author.
export async function findGoodreads(isbnList: string, title: string, author: string): Promise<GoodreadsMatch | null> {
  const isbns = isbnList.split(',').map(s => s.replace(/[^0-9Xx]/g, '')).filter(s => s.length === 10 || s.length === 13).slice(0, 6);
  const opts = { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) };
  for (const isbn of isbns) {
    try {
      const r = await fetch(`https://www.goodreads.com/book/isbn/${isbn}`, { ...opts, redirect: 'manual' });
      const loc = r.headers.get('location') || '';
      const m = loc.match(/\/book\/show\/(\d+)/);
      if (m) return { id: m[1], url: `https://www.goodreads.com/book/show/${m[1]}`, via: 'isbn' };
    } catch {}
  }
  if (title) {
    try {
      const q = encodeURIComponent(`${title} ${author}`.trim());
      const r = await fetch(`https://www.goodreads.com/search?q=${q}`, opts);
      const html = await r.text();
      // Among the top five results, take the one with the most ratings,
      // which skips odd reprints and study guides that sometimes rank first.
      let best: { id: string; ratings: number } | null = null;
      for (const row of (html.match(/<tr itemscope[\s\S]*?<\/tr>/g) || []).slice(0, 5)) {
        const id = row.match(/\/book\/show\/(\d+)/)?.[1];
        const ratings = parseInt((row.match(/([\d,]+) ratings?/)?.[1] || '0').replace(/,/g, ''), 10);
        if (id && (!best || ratings > best.ratings)) best = { id, ratings };
      }
      if (best) return { id: best.id, url: `https://www.goodreads.com/book/show/${best.id}`, via: 'search' };
    } catch {}
  }
  return null;
}

// Only fetch from the book cover sites the editor searches, so the function
// can't be used to fetch anything else on the internet.
const COVER_HOSTS = [
  'covers.openlibrary.org', 'archive.org',
  'books.google.com', 'books.googleusercontent.com',
  'mzstatic.com',
  'covers.goodreads.com', 'gr-assets.com',
  'images-na.ssl-images-amazon.com', 'm.media-amazon.com',
];
export const isCoverHost = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && COVER_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
};

const MAX_BYTES = 10 * 1024 * 1024;

export const imageType = (b: Uint8Array): string | null =>
  b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'image/png'
  : b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? 'image/webp'
  : null;

// Downloads a cover image, so the editor can resize it and publish it as a
// file in the repo instead of linking to another website.
export async function fetchCover(src: string): Promise<{ body: Uint8Array; type: string }> {
  if (!isCoverHost(src)) throw new Error('Not a known cover site');
  const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.url && !isCoverHost(r.url)) throw new Error('Redirected to an unknown site');
  const body = new Uint8Array(await r.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error('Image too large');
  const type = imageType(body);
  if (!type) throw new Error('Not an image');
  return { body, type };
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// Request handlers shared by the Vercel functions and the dev server.
export async function goodreadsHandler(request: Request): Promise<Response> {
  const p = new URL(request.url).searchParams;
  const match = await findGoodreads(p.get('isbn') || '', p.get('title') || '', p.get('author') || '');
  return match ? json(200, match) : json(404, { error: 'Not found' });
}

export async function coverHandler(request: Request): Promise<Response> {
  const src = new URL(request.url).searchParams.get('src') || '';
  try {
    const { body, type } = await fetchCover(src);
    return new Response(body as BodyInit, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
  } catch (err: any) {
    return json(502, { error: err.message });
  }
}
