import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile, readFile, cp } from 'fs/promises'
import { existsSync } from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { goodreadsHandler, coverHandler } from './server/lookup.js'

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

// Covers live in content/covers but are served at /covers/ on the site.
// In dev they're read straight from that folder; on build they're copied
// into dist/covers.
const COVERS_DIR = 'content/covers';
const coversPlugin = {
  name: 'content-covers',
  configureServer(server: any) {
    server.middlewares.use('/covers', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, '');
      if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(name)) return next();
      try {
        const body = await readFile(`${COVERS_DIR}/${name}`);
        res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      } catch {
        next();
      }
    });
  },
  async writeBundle(options: { dir?: string }) {
    if (existsSync(COVERS_DIR)) await cp(COVERS_DIR, `${options.dir || 'dist'}/covers`, { recursive: true });
  },
};

export default defineConfig({
  plugins: [react(), coversPlugin, {
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
            const dest = `content/covers/${safeKey}.jpg`;
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

      // Same handlers as the Vercel functions in api/, so dev matches the live site.
      const useHandler = (path: string, handler: (r: Request) => Promise<Response>) =>
        server.middlewares.use(path, async (req, res) => {
          if (!fromLocalhost(req)) return sendJson(res, 403, { error: 'Forbidden' });
          const out = await handler(new Request(`http://localhost${req.originalUrl || req.url}`));
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        });
      useHandler('/api/goodreads', goodreadsHandler);
      useHandler('/api/cover', coverHandler);

      // Saves a cover picked in the admin tool into content/covers, so the site
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
          await writeFile(`content/covers/${safeKey}.jpg`, body);
          sendJson(res, 200, { ok: true, path: `/covers/${safeKey}.jpg` });
        } catch (err: any) {
          sendJson(res, 502, { ok: false, error: err.message });
        }
      });
    },
  }],
})
