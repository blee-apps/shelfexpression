import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile } from 'fs/promises'
import type { IncomingMessage, ServerResponse } from 'http'

// Only the admin tool on this machine may use the dev endpoints, not other
// websites open in your browser while the dev server is running.
const fromLocalhost = (req: IncomingMessage) => {
  const origin = req.headers.origin || '';
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
};

const sendJson = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};

const isImage = (body: Buffer) =>
  (body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) || // JPEG
  (body.length > 4 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47); // PNG

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export default defineConfig({
  plugins: [react(), {
    name: 'cover-upload',
    configureServer(server) {
      server.middlewares.use('/api/upload-cover', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        if (!fromLocalhost(req)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        const url = new URL(req.url!, 'http://localhost');
        const key = url.searchParams.get('key');
        if (!key) {
          res.statusCode = 400;
          res.end('Missing key query parameter');
          return;
        }
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
        const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        req.on('data', (chunk: Buffer) => {
          if (aborted) return;
          size += chunk.length;
          if (size > MAX_BYTES) {
            aborted = true;
            res.statusCode = 413;
            res.end('File too large (max 10 MB)');
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', async () => {
          if (aborted) return;
          const body = Buffer.concat(chunks);
          // Must really be an image (JPEG or PNG).
          if (!isImage(body)) {
            res.statusCode = 415;
            res.end('Only JPEG or PNG images are accepted');
            return;
          }
          try {
            const dest = `public/covers/${safeKey}.jpg`;
            await writeFile(dest, body);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `/covers/${safeKey}.jpg` }));
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });

      // Finds a book's Goodreads page. Goodreads has no public API, but
      // goodreads.com/book/isbn/<ISBN> redirects to the right book page, so we
      // follow that (tries each ISBN in turn). If no ISBN works, falls back to
      // the first result of a Goodreads search for title + author.
      server.middlewares.use('/api/goodreads', async (req, res) => {
        if (!fromLocalhost(req)) return sendJson(res, 403, { error: 'Forbidden' });
        const url = new URL(req.url!, 'http://localhost');
        const isbns = (url.searchParams.get('isbn') || '').split(',').map(s => s.replace(/[^0-9Xx]/g, '')).filter(s => s.length === 10 || s.length === 13).slice(0, 6);
        const title = url.searchParams.get('title') || '';
        const author = url.searchParams.get('author') || '';
        const opts = { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) };
        for (const isbn of isbns) {
          try {
            const r = await fetch(`https://www.goodreads.com/book/isbn/${isbn}`, { ...opts, redirect: 'manual' });
            const loc = r.headers.get('location') || '';
            const m = loc.match(/\/book\/show\/(\d+)/);
            if (m) return sendJson(res, 200, { id: m[1], url: `https://www.goodreads.com/book/show/${m[1]}`, via: 'isbn' });
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
            if (best) return sendJson(res, 200, { id: best.id, url: `https://www.goodreads.com/book/show/${best.id}`, via: 'search' });
          } catch {}
        }
        sendJson(res, 404, { error: 'Not found' });
      });

      // Saves a cover picked in the admin tool into public/covers, so the site
      // serves its own copy instead of relying on another website.
      server.middlewares.use('/api/save-cover', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        if (!fromLocalhost(req)) return sendJson(res, 403, { error: 'Forbidden' });
        const url = new URL(req.url!, 'http://localhost');
        const safeKey = (url.searchParams.get('key') || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const src = url.searchParams.get('src') || '';
        if (!safeKey || !/^https:\/\//.test(src)) return sendJson(res, 400, { error: 'Missing key or https src' });
        try {
          const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const body = Buffer.from(await r.arrayBuffer());
          if (body.length > 10 * 1024 * 1024) throw new Error('Image too large');
          if (!isImage(body)) throw new Error('Not a JPEG or PNG');
          await writeFile(`public/covers/${safeKey}.jpg`, body);
          sendJson(res, 200, { ok: true, path: `/covers/${safeKey}.jpg` });
        } catch (err: any) {
          sendJson(res, 502, { ok: false, error: err.message });
        }
      });
    },
  }],
})
