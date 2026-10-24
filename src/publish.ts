// Publishing from the editor on the live site: one commit to GitHub with the
// book list and any new cover files. Vercel sees the commit and redeploys.
import { SITE } from './shelfData';
import { githubHeaders } from './github';
import { updateSiteFile, SiteDetails } from '../server/siteFile';

// --- Covers waiting to be published -------------------------------------
// A cover picked or uploaded in the editor lives in the browser until you
// publish. Its future site path (/covers/name.jpg) maps to the image here.
// `published` marks one that's already on GitHub but not on the site yet.
export const pendingCovers = new Map<string, { blob: Blob; preview: string; published?: boolean }>();

// What the editor should show for a coverUrl: the waiting image if there is one.
export const coverSrc = (url?: string) => (url && pendingCovers.get(url)?.preview) || url || '';

const COVER_MAX_WIDTH = 600;

// Shrinks a cover to at most 600px wide and saves it as a JPEG.
export async function resizeCover(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Not an image the browser can read'));
      img.src = url;
    });
    const scale = Math.min(1, COVER_MAX_WIDTH / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; // PNGs with transparency get a white background
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/jpeg', 0.86));
    if (!out) throw new Error('Couldn\u2019t resize the image');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Adds a cover to the waiting list and returns its site path. Every new cover
// gets a new file name, so browsers never show an old cached image.
export function addPendingCover(key: string, blob: Blob): string {
  const safe = (key || 'cover').replace(/[^a-zA-Z0-9_-]/g, '') || 'cover';
  const path = `/covers/${safe}-${Date.now().toString(36)}.jpg`;
  pendingCovers.set(path, { blob, preview: URL.createObjectURL(blob) });
  return path;
}

// Downloads a cover from a book site (through /api/cover, since those sites
// don't let the browser read their images directly) and resizes it.
// On a static site there's no /api/cover, so it asks the book site directly,
// which works for the ones that allow it (like OpenLibrary).
export async function fetchCover(src: string): Promise<Blob> {
  let r: Response | null = null;
  try { r = await fetch(`/api/cover?src=${encodeURIComponent(src)}`); } catch {}
  const isImage = r?.ok && /^image\//.test(r.headers.get('content-type') || '');
  if (r && isImage) return resizeCover(await r.blob());
  try {
    const direct = await fetch(src, { mode: 'cors', signal: AbortSignal.timeout(15000) });
    if (direct.ok) return resizeCover(await direct.blob());
  } catch {}
  // No cover helper here (a static site): the page came back instead of JSON.
  const isJson = /json/.test(r?.headers.get('content-type') || '');
  if (!r || !isJson) throw new Error('this site can\u2019t download covers from that source. Upload a photo instead');
  let msg = `HTTP ${r.status}`;
  try { msg = (await r.json()).error || msg; } catch {}
  throw new Error(msg);
}

// --- Commit message -------------------------------------------------------
type BookLike = { title: string; author: string; isbn?: string; year?: number; synopsis?: string; gr?: string; coverUrl?: string };
type Shelf = { useVitsoeShelf: boolean; colorMode?: string; books: BookLike[]; share?: { footer?: string } };

const quote = (titles: string[]) => titles.map(t => `\u201c${t}\u201d`).join(', ');

// Describes what changed between two versions of the shelf, in plain words.
export function describeChanges(before: Shelf, after: Shelf): { summary: string; details: string[] } {
  const keyOf = (b: BookLike) => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`;
  const old = new Map(before.books.map(b => [keyOf(b), b]));
  const now = new Map(after.books.map(b => [keyOf(b), b]));
  const added = after.books.filter(b => !old.has(keyOf(b))).map(b => b.title);
  const removed = before.books.filter(b => !now.has(keyOf(b))).map(b => b.title);
  const updated: string[] = [];
  const details: string[] = [];
  for (const b of after.books) {
    const o = old.get(keyOf(b));
    if (!o) continue;
    const changed = (['isbn', 'year', 'synopsis', 'gr', 'coverUrl'] as const).filter(k => (o[k] ?? '') !== (b[k] ?? ''));
    if (changed.length) {
      updated.push(b.title);
      const words = changed.map(k => ({ isbn: 'ISBN', year: 'year', synopsis: 'synopsis', gr: 'Goodreads link', coverUrl: 'cover' }[k]));
      details.push(`Updated \u201c${b.title}\u201d: ${words.join(', ')}`);
    }
  }
  const keptBefore = before.books.filter(b => now.has(keyOf(b))).map(keyOf);
  const keptAfter = after.books.filter(b => old.has(keyOf(b))).map(keyOf);
  const reordered = keptBefore.join('\n') !== keptAfter.join('\n');

  if (added.length) details.unshift(`Added ${quote(added)}`);
  if (removed.length) details.splice(added.length ? 1 : 0, 0, `Removed ${quote(removed)}`);
  if (reordered) details.push('Changed the order');
  if (before.useVitsoeShelf !== after.useVitsoeShelf) details.push(after.useVitsoeShelf ? 'Turned on the Vitsoe shelf' : 'Turned off the Vitsoe shelf');
  const modeBefore = before.colorMode || 'light', modeAfter = after.colorMode || 'light';
  const modeChanged = modeBefore !== modeAfter;
  if (modeChanged) details.push(`Color mode: ${modeAfter}`);

  const parts: string[] = [];
  if (added.length) parts.push(added.length === 1 ? `add ${quote(added)}` : `add ${added.length} books`);
  if (removed.length) parts.push(removed.length === 1 ? `remove ${quote(removed)}` : `remove ${removed.length} books`);
  if (updated.length) parts.push(updated.length === 1 ? `update ${quote(updated)}` : `update ${updated.length} books`);
  if (reordered && !parts.length) parts.push('reorder books');
  if (!parts.length && before.useVitsoeShelf !== after.useVitsoeShelf) parts.push('change shelf style');
  if (!parts.length && modeChanged) parts.push(`switch to ${modeAfter} mode`);
  const footerChanged = (before.share?.footer ?? '') !== (after.share?.footer ?? '');
  if (footerChanged) details.push(`Share image footer: \u201c${after.share?.footer ?? ''}\u201d`);
  if (!parts.length && footerChanged) parts.push('change share footer');
  const summary = parts.length ? `Bookshelf: ${parts.join(', ')}` : 'Bookshelf: update';
  return { summary: summary.length > 72 ? summary.slice(0, 71) + '\u2026' : summary, details };
}

// --- GitHub ----------------------------------------------------------------
export class PublishError extends Error {
  constructor(message: string, public kind: 'auth' | 'stale' | 'other' = 'other') { super(message); }
}

// The shelf in a standard form, so two versions compare equal when only the
// ids, key order or spacing differ.
export const canonicalShelf = (json: string) => {
  try {
    const d = JSON.parse(json);
    const books = (d.books || []).map((b: any, i: number) => {
      const e: Record<string, unknown> = {
        id: String(i + 1), isbn: b.isbn || '', title: b.title || '', author: b.author || '',
        year: Number(b.year) || 0, synopsis: b.synopsis || '', gr: b.gr || '',
      };
      if (b.coverUrl) e.coverUrl = b.coverUrl;
      return e;
    });
    return JSON.stringify({ useVitsoeShelf: d.useVitsoeShelf !== false, colorMode: d.colorMode || 'light', books, footer: d.share?.footer ?? null });
  } catch { return json; }
};
const normalize = canonicalShelf;

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const fromBase64Utf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

const COVER_FILE = /^content\/covers\/[^/]+\.(jpg|jpeg|png|webp)$/i;

export type PublishResult = { commit: string; url: string; branch: string; added: number; deleted: number };

// Makes one commit with the new books.json, the new cover files, and with
// covers no book uses any more removed. `baseJson` is the books.json the
// editor started from: if the live branch has a different one (changed from
// another device, or a publish still deploying), it stops instead of
// overwriting it.
export async function publish(opts: {
  token: string; json: string; baseJson: string; message: string; toTest: boolean;
  onStep?: (text: string) => void;
}): Promise<PublishResult> {
  const { token, json, baseJson, message, toTest, onStep = () => {} } = opts;
  const { repo, branch: liveBranch, testBranch } = SITE.github;
  const target = toTest ? testBranch : liveBranch;

  const gh = async (path: string, init?: { method?: string; body?: unknown }) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method: init?.method || 'GET',
      headers: { ...githubHeaders(token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (r.status === 401) throw new PublishError('GitHub didn\u2019t accept your key. It may have expired. Forget the key and paste a new one.', 'auth');
    if (r.status === 403) throw new PublishError('Your key can\u2019t write to the repo. Give it Contents: Read and write.', 'auth');
    return r;
  };
  const ok = async (r: Response, what: string) => {
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch {}
      throw new PublishError(`Couldn\u2019t ${what} (${r.status}${detail ? `: ${detail}` : ''}).`);
    }
    return r.json();
  };

  // 1. Where the live branch is now.
  onStep('Checking GitHub…');
  const ref = await ok(await gh(`git/ref/heads/${liveBranch}`), 'read the live branch');
  const parent: string = ref.object.sha;
  const parentCommit = await ok(await gh(`git/commits/${parent}`), 'read the latest commit');
  const tree = await ok(await gh(`git/trees/${parentCommit.tree.sha}?recursive=1`), 'read the files');
  const files: { path: string; sha: string; type: string }[] = tree.tree;

  // 2. Stop if the shelf changed since the editor loaded it.
  const booksFile = files.find(f => f.path === 'content/books.json');
  if (booksFile) {
    const blob = await ok(await gh(`git/blobs/${booksFile.sha}`), 'read books.json');
    if (normalize(fromBase64Utf8(blob.content)) !== normalize(baseJson)) {
      throw new PublishError('The shelf on GitHub changed since this page loaded (maybe a publish is still deploying, or you edited elsewhere). Reload the page and make your changes again.', 'stale');
    }
  }

  // 3. Which covers to add and which to remove.
  const shelf = JSON.parse(json) as Shelf & { books: (BookLike & { id: string })[] };
  const used = new Set<string>();
  for (const b of shelf.books) {
    const local = b.coverUrl?.match(/^\/covers\/([^/?#]+)$/)?.[1];
    used.add(`content/covers/${local || `${b.isbn || b.id}.jpg`}`);
  }
  // A waiting cover that's already on GitHub (from an earlier publish) isn't uploaded again.
  const newCovers = [...pendingCovers.entries()].filter(([path]) => used.has(`content${path}`) && !files.some(f => f.path === `content${path}`));
  const orphans = files.filter(f => f.type === 'blob' && COVER_FILE.test(f.path) && !used.has(f.path));

  // 4. Upload the new cover images.
  const entries: { path: string; mode: string; type: string; sha?: string | null; content?: string }[] = [];
  let n = 0;
  for (const [path, { blob }] of newCovers) {
    onStep(`Uploading cover ${++n} of ${newCovers.length}…`);
    const made = await ok(await gh('git/blobs', { method: 'POST', body: { content: await toBase64(blob), encoding: 'base64' } }), 'upload a cover');
    entries.push({ path: `content${path}`, mode: '100644', type: 'blob', sha: made.sha });
  }
  entries.push({ path: 'content/books.json', mode: '100644', type: 'blob', content: json });
  for (const f of orphans) entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null });

  // 5. One commit with everything.
  onStep('Saving to GitHub…');
  const newTree = await ok(await gh('git/trees', { method: 'POST', body: { base_tree: parentCommit.tree.sha, tree: entries } }), 'prepare the commit');
  const commit = await ok(await gh('git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [parent] } }), 'make the commit');

  // 6. Move the branch to it. The live branch only moves forward, so if
  // something else was published meanwhile, GitHub refuses and nothing is lost.
  // The test branch is simply reset to "live + this change" each time.
  const update = await gh(`git/refs/heads/${target}`, { method: 'PATCH', body: { sha: commit.sha, force: toTest } });
  if (update.status === 422 && toTest) {
    await ok(await gh('git/refs', { method: 'POST', body: { ref: `refs/heads/${target}`, sha: commit.sha } }), 'create the test branch');
  } else if (update.status === 422) {
    throw new PublishError('Something else was published to GitHub just now. Reload the page and try again.', 'stale');
  } else {
    await ok(update, 'update the branch');
  }

  return { commit: commit.sha, url: commit.html_url, branch: target, added: newCovers.length, deleted: orphans.length };
}

// Save in the Site details sheet on the live site: one commit that changes
// only the site details in content/site.ts. Books publish separately.
export async function publishSiteDetails(opts: { token: string; site: SiteDetails; toTest: boolean }): Promise<PublishResult> {
  const { token, site, toTest } = opts;
  const { repo, branch: liveBranch, testBranch } = SITE.github;
  const target = toTest ? testBranch : liveBranch;
  const gh = async (path: string, init?: { method?: string; body?: unknown }, what = 'reach GitHub') => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method: init?.method || 'GET',
      headers: { ...githubHeaders(token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (r.status === 401) throw new PublishError('GitHub didn\u2019t accept your key. It may have expired. Forget the key and paste a new one.', 'auth');
    if (r.status === 403) throw new PublishError('Your key can\u2019t write to the repo. Give it Contents: Read and write.', 'auth');
    if (!r.ok && !(r.status === 422 && init?.method === 'PATCH')) throw new PublishError(`Couldn\u2019t ${what} (${r.status}).`);
    return r;
  };
  const ref = await (await gh(`git/ref/heads/${liveBranch}`, undefined, 'read the live branch')).json();
  const parent: string = ref.object.sha;
  const parentCommit = await (await gh(`git/commits/${parent}`, undefined, 'read the latest commit')).json();
  const file = await (await gh(`contents/content/site.ts?ref=${parent}`, undefined, 'read content/site.ts')).json();
  const next = updateSiteFile(fromBase64Utf8(file.content), site);
  if (next === null) throw new PublishError('content/site.ts in your repo looks hand-edited, so it was left alone. Edit it on GitHub instead.');
  const tree = await (await gh('git/trees', { method: 'POST', body: { base_tree: parentCommit.tree.sha, tree: [{ path: 'content/site.ts', mode: '100644', type: 'blob', content: next }] } }, 'prepare the commit')).json();
  const commit = await (await gh('git/commits', { method: 'POST', body: { message: 'Bookshelf: update site details', tree: tree.sha, parents: [parent] } }, 'make the commit')).json();
  const update = await gh(`git/refs/heads/${target}`, { method: 'PATCH', body: { sha: commit.sha, force: toTest } }, 'update the branch');
  if (update.status === 422 && toTest) await gh('git/refs', { method: 'POST', body: { ref: `refs/heads/${target}`, sha: commit.sha } }, 'create the test branch');
  else if (update.status === 422) throw new PublishError('Something else was published to GitHub just now. Try again.', 'stale');
  return { commit: commit.sha, url: commit.html_url, branch: target, added: 0, deleted: 0 };
}

// After publishing to the live branch, the waiting covers are on GitHub.
export const markCoversPublished = () => pendingCovers.forEach(c => { c.published = true; });

// --- Reading from GitHub --------------------------------------------------
const raw = (token: string, path: string) =>
  fetch(`https://api.github.com/repos/${SITE.github.repo}/contents/${path}?ref=${SITE.github.branch}`, {
    headers: { ...githubHeaders(token), Accept: 'application/vnd.github.raw+json' },
  });

// The newest books.json on the live branch, or null if it can't be read.
export async function fetchLatestShelf(token: string): Promise<string | null> {
  try {
    const r = await raw(token, 'content/books.json');
    if (!r.ok) return null;
    const text = await r.text();
    return Array.isArray(JSON.parse(text)?.books) ? text : null;
  } catch { return null; }
}

// A cover that's on GitHub but not on the site yet (its deploy isn't done).
export async function fetchPublishedCover(token: string, sitePath: string): Promise<boolean> {
  try {
    const r = await raw(token, `content${sitePath}`);
    if (!r.ok) return false;
    const blob = await r.blob();
    pendingCovers.set(sitePath, { blob, preview: URL.createObjectURL(blob), published: true });
    return true;
  } catch { return false; }
}

// --- Deploy status --------------------------------------------------------
export type Deploy = { state: 'waiting' | 'building' | 'ready' | 'failed' | 'no-access'; url?: string };

// Vercel (and Netlify, when it does) reports each build to GitHub as a
// "deployment". This reads the one for a commit. Needs the key to have
// Deployments: Read-only. For the live site there's also a check that needs
// no access at all: each build writes its commit into /version.json, so once
// that matches, the new version is live, whatever the host.
const liveCommit = async (): Promise<string> => {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()).commit || '') : '';
  } catch { return ''; }
};

export async function deployStatus(token: string, sha: string, live = false): Promise<Deploy> {
  const d = await githubDeploy(token, sha);
  if (live && d.state !== 'ready' && d.state !== 'failed' && await liveCommit() === sha)
    return { state: 'ready', url: window.location.origin };
  return d;
}

async function githubDeploy(token: string, sha: string): Promise<Deploy> {
  const base = `https://api.github.com/repos/${SITE.github.repo}`;
  let r: Response;
  try { r = await fetch(`${base}/deployments?sha=${sha}`, { headers: githubHeaders(token) }); } catch { return { state: 'waiting' }; }
  if (r.status === 403 || r.status === 404) return { state: 'no-access' };
  if (!r.ok) return { state: 'waiting' };
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) return { state: 'waiting' };
  const s = await fetch(`${base}/deployments/${list[0].id}/statuses?per_page=1`, { headers: githubHeaders(token) });
  if (!s.ok) return { state: 'building' };
  const [latest] = await s.json();
  if (!latest) return { state: 'building' };
  if (latest.state === 'success') return { state: 'ready', url: latest.environment_url || latest.target_url };
  if (latest.state === 'failure' || latest.state === 'error') return { state: 'failed', url: latest.target_url || latest.log_url };
  return { state: 'building' };
}

// --- Drafts ---------------------------------------------------------------
// Unpublished changes are kept on this device: the book list in localStorage,
// new cover images in IndexedDB (they're too big for localStorage).
export type Draft = { json: string; baseJson: string; savedAt: number };
const DRAFT_KEY = 'bookshelf.draft';

const db = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open('bookshelf-editor', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('covers');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const store = async (mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void) => {
  const d = await db();
  return new Promise<any>((resolve, reject) => {
    const tx = d.transaction('covers', mode);
    const req = run(tx.objectStore('covers'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
};
const savedCovers = new Set<string>();

export const loadDraft = (): Draft | null => {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
};

export async function saveDraft(draft: Draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
  // Keep the new covers this draft uses.
  for (const [path, c] of pendingCovers) {
    if (c.published || savedCovers.has(path) || !draft.json.includes(`"${path}"`)) continue;
    savedCovers.add(path);
    try { await store('readwrite', s => s.put(c.blob, path)); } catch { savedCovers.delete(path); }
  }
}

export async function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  savedCovers.clear();
  try { await store('readwrite', s => s.clear()); } catch {}
}

// Puts a draft's saved covers back into the waiting list.
export async function restoreDraftCovers() {
  try {
    const keys: string[] = await store('readonly', s => s.getAllKeys()) as string[];
    for (const path of keys) {
      const blob: Blob = await store('readonly', s => s.get(path));
      if (blob && !pendingCovers.has(path)) pendingCovers.set(path, { blob, preview: URL.createObjectURL(blob) });
      savedCovers.add(path);
    }
  } catch {}
}
