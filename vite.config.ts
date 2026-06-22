import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile } from 'fs/promises'

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
        const url = new URL(req.url!, req.headers.origin || 'http://localhost');
        const key = url.searchParams.get('key');
        if (!key) {
          res.statusCode = 400;
          res.end('Missing key query parameter');
          return;
        }
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const dest = `public/covers/${safeKey}.jpg`;
            await writeFile(dest, Buffer.concat(chunks));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `/covers/${safeKey}.jpg` }));
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });
    },
  }],
})
