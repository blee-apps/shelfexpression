import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile, readFile, cp, readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { resolve } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { goodreadsHandler, coverHandler } from './server/lookup.js'
import { updateSiteFile, SiteDetails } from './server/siteFile.js'

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
    if (process.env.SHELF_EXPORT_BUILD) return; // the export adds covers itself
    if (existsSync(COVERS_DIR)) await cp(COVERS_DIR, `${options.dir || 'dist'}/covers`, { recursive: true });
  },
};

// Lists the built files in site-files.json, so Export site in the
// editor knows what to put in the zip. Covers are added from the shelf itself.
let outDir = 'dist';
const siteFilesPlugin = {
  name: 'site-files',
  apply: 'build' as const,
  configResolved(config: { build: { outDir: string } }) { outDir = config.build.outDir; },
  async closeBundle() {
    const dir = outDir;
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => `${e.parentPath ?? (e as any).path}/${e.name}`.slice(dir.length + 1).split('\\').join('/'))
      .filter(f => !f.startsWith('covers/') && !f.startsWith('.') && !f.includes('/.') && !f.endsWith('.map') && f !== 'site-files.json' && f !== 'version.json')
      .sort();
    await writeFile(`${dir}/site-files.json`, JSON.stringify({ files }, null, 2) + '\n');
    await writeFile(`${dir}/version.json`, JSON.stringify({ commit: detectCommit() }) + '\n');
  },
};

// Export site from the local editor (npm run dev). The zip needs built files,
// so /api/export-build makes a fresh build in a hidden folder and serves it
// at /__export/. /api/save-shelf then keeps what you exported: your books,
// look and share footer in content/books.json, and the site details in
// content/site.ts. Those files are written without reloading the page.
const EXPORT_DIR = 'node_modules/.cache/shelf-export';
const readBody = (req: IncomingMessage, max = 5 * 1024 * 1024) => new Promise<string>((ok, fail) => {
  let size = 0; const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { size += c.length; if (size > max) { fail(new Error('Too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
  req.on('error', fail);
});
const MIME: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', jpg: 'image/jpeg', ico: 'image/x-icon', txt: 'text/plain' };
const exportPlugin = {
  name: 'local-export',
  apply: 'serve' as const,
  configureServer(server: any) {
    let building: Promise<void> | null = null;
    server.middlewares.use('/api/export-build', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!fromLocalhost(req)) return sendJson(res, 403, { error: 'Forbidden' });
      try {
        building ??= (async () => {
          const { build } = await import('vite');
          process.env.SHELF_EXPORT_BUILD = '1';
          try {
            await rm(EXPORT_DIR, { recursive: true, force: true });
            await build({ configFile: resolve('vite.config.ts'), mode: 'production', logLevel: 'warn', build: { outDir: EXPORT_DIR, emptyOutDir: true } });
          } finally { delete process.env.SHELF_EXPORT_BUILD; }
        })().finally(() => { building = null; });
        await building;
        sendJson(res, 200, { ok: true, base: '/__export/' });
      } catch (err: any) {
        sendJson(res, 500, { ok: false, error: `The build failed: ${err.message}` });
      }
    });
    server.middlewares.use('/__export', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
      if (!name || name.includes('..')) return next();
      try {
        const body = await readFile(`${EXPORT_DIR}/${name}`);
        res.setHeader('Content-Type', MIME[name.split('.').pop() || ''] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      } catch { next(); }
    });
    // Writes a file without the dev server reloading the page, then lets the
    // next page load read the new version.
    const quietWrite = async (file: string, text: string) => {
      const abs = resolve(file);
      server.watcher.unwatch(abs);
      await writeFile(abs, text);
      for (const m of server.moduleGraph.getModulesByFile(abs) ?? []) server.moduleGraph.invalidateModule(m);
      setTimeout(() => server.watcher.add(abs), 1000);
    };
    server.middlewares.use('/api/save-shelf', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!fromLocalhost(req)) return sendJson(res, 403, { error: 'Forbidden' });
      try {
        const { content, site } = JSON.parse(await readBody(req)) as { content: { books: unknown[] }; site: SiteDetails };
        if (!content || !Array.isArray(content.books)) throw new Error('No books to save');
        await quietWrite('content/books.json', JSON.stringify(content, null, 2) + '\n');
        let siteSaved = false;
        if (site) {
          const next = updateSiteFile(await readFile('content/site.ts', 'utf8'), site);
          if (next !== null) { await quietWrite('content/site.ts', next); siteSaved = true; }
        }
        sendJson(res, 200, { ok: true, siteSaved });
      } catch (err: any) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    });
    // Save in the Site details sheet: writes content/site.ts.
    server.middlewares.use('/api/save-site', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!fromLocalhost(req)) return sendJson(res, 403, { error: 'Forbidden' });
      try {
        const site = JSON.parse(await readBody(req)) as SiteDetails;
        const next = updateSiteFile(await readFile('content/site.ts', 'utf8'), site);
        if (next === null) return sendJson(res, 200, { ok: false, error: 'content/site.ts looks hand-edited, so it was left alone. Edit it there instead.' });
        await quietWrite('content/site.ts', next);
        sendJson(res, 200, { ok: true });
      } catch (err: any) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
    });
  },
};

// The GitHub repo this copy comes from, for when content/site.ts leaves
// github.repo empty. On Vercel or Netlify it's the repo being deployed; on
// your computer it's the repo you cloned. Anything else (or not GitHub) gives ''.
const githubRepoFromUrl = (url: string) =>
  url.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? '';
const detectRepo = (): string => {
  const { VERCEL_GIT_PROVIDER, VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG, NETLIFY, REPOSITORY_URL } = process.env;
  if (VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG)
    return !VERCEL_GIT_PROVIDER || VERCEL_GIT_PROVIDER === 'github' ? `${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}` : '';
  if (NETLIFY && REPOSITORY_URL) return githubRepoFromUrl(REPOSITORY_URL);
  try {
    return githubRepoFromUrl(execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  } catch { return ''; }
};

// The commit this build came from, written to dist/version.json. After you
// publish, the editor watches it to tell when the new version is live, on
// any host.
const detectCommit = (): string => {
  const { VERCEL_GIT_COMMIT_SHA, COMMIT_REF } = process.env;
  if (VERCEL_GIT_COMMIT_SHA || COMMIT_REF) return (VERCEL_GIT_COMMIT_SHA || COMMIT_REF)!;
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
};

export default defineConfig({
  define: { __SHELF_REPO__: JSON.stringify(detectRepo()), __SHELF_COMMIT__: JSON.stringify(detectCommit()) },
  plugins: [react(), coversPlugin, siteFilesPlugin, exportPlugin, {
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
