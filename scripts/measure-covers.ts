// Runs before every build. It never downloads anything: it only measures the
// covers already saved in content/covers, so the shelf can lay them out at
// the right shape. Whatever cover you saved is exactly what gets published.
import { RAW_BOOKS } from '../src/books';
import { imageSizeFromFile } from 'image-size/fromFile';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const COVERS_DIR = 'content/covers';
const MANIFEST_FILE = 'src/generated/cover-manifest.json';

interface BookCover {
  path: string | null;
  aspectRatio: number | null;
}

async function main() {
  await mkdir('src/generated', { recursive: true });
  const manifest: Record<string, BookCover> = {};
  let measured = 0;
  const problems: string[] = [];

  for (const book of RAW_BOOKS) {
    const key = book.isbn || book.id;
    // A local coverUrl (/covers/name.jpg) names its file; otherwise look for <isbn>.jpg.
    const local = book.coverUrl?.match(/^\/covers\/([a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp))$/)?.[1];
    const file = local || `${key}.jpg`;
    const dest = `${COVERS_DIR}/${file}`;

    if (book.coverUrl && !local) {
      problems.push(`${book.title}: cover is a web link (${book.coverUrl}), not a saved file`);
    }

    if (existsSync(dest)) {
      try {
        const dims = await imageSizeFromFile(dest);
        manifest[key] = { path: `/covers/${file}`, aspectRatio: dims.width / dims.height };
        measured++;
        continue;
      } catch (err: any) {
        problems.push(`${book.title}: couldn't read ${dest} (${err.message})`);
      }
    } else if (!book.coverUrl) {
      problems.push(`${book.title}: no cover saved (expected ${dest})`);
    }
    manifest[key] = { path: null, aspectRatio: null };
  }

  await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`Measured ${measured} of ${RAW_BOOKS.length} covers.`);
  for (const p of problems) console.warn(`  ! ${p}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
