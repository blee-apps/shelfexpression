// Updates: brings a copy of Shelf Expression up to the latest release.
//
// A copy made with "Use this template" has no link back to the template, so
// GitHub can't sync it. Instead, the editor compares this site's files with
// the template's latest release and commits the new app code to the site's
// own repo, using the same GitHub key it publishes with. Your books, covers
// and site details (content/), README, LICENSE and .env are never touched.
import { SITE } from './shelfData';
import { githubHeaders } from './github';

export const UPSTREAM = 'blee-apps/shelfexpression';
export const UPDATE_BRANCH = 'shelf-update';
export const CURRENT_VERSION: string = typeof __SHELF_VERSION__ === 'string' ? __SHELF_VERSION__ : '0.0.0';

// Paths that belong to the site's owner, never replaced. src/generated is
// measured from your own covers.
const KEEP = [/^content\//, /^src\/generated\//, /^README\.md$/i, /^LICENSE/i, /^\.env/, /^\.github\//, /^\.vercel\//, /^\.netlify\//];
export const isAppPath = (p: string) => !KEEP.some(r => r.test(p));

export type Release = { version: string; name: string; notes: string; date: string; url: string };

const parseVersion = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
export const newer = (a: string, b: string) => {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// The template itself and copies outside GitHub don't update this way.
export const canUpdateHere = () => !!SITE.github.repo && SITE.github.repo.toLowerCase() !== UPSTREAM;

// Releases newer than this copy, newest first. Reading a public repo needs no key.
export async function checkForUpdates(token?: string): Promise<Release[]> {
  const r = await fetch(`https://api.github.com/repos/${UPSTREAM}/releases?per_page=20`, token ? { headers: githubHeaders(token) } : undefined);
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is busy. Try again in a few minutes.' : 'Couldn\u2019t check for updates.');
  const list = await r.json();
  return (Array.isArray(list) ? list : [])
    .filter((x: any) => !x.draft && !x.prerelease && /^v?\d+\.\d+\.\d+$/.test(x.tag_name) && newer(x.tag_name, CURRENT_VERSION))
    .map((x: any) => ({ version: x.tag_name.replace(/^v/, ''), name: (x.name || x.tag_name).replace(/^v?\d+\.\d+\.\d+\s*/, ''), notes: x.body || '', date: x.published_at, url: x.html_url }))
    .sort((a: Release, b: Release) => (newer(a.version, b.version) ? -1 : 1));
}

export type UpdatePlan = {
  version: string;
  head: string;            // the site's live commit the update builds on
  baseTree: string;
  change: string[];        // files added or replaced
  remove: string[];        // files the new version no longer has
  edited: string[];        // files the owner changed, which the update replaces
  kept: string[];          // removed upstream but edited here, so left alone
  known: boolean;          // false when this copy's own version isn't a release
};

type Tree = Map<string, { sha: string; mode: string }>;

class UpdateError extends Error {}

const api = (token: string) => async (repo: string, path: string, init?: { method?: string; body?: unknown }, what = 'reach GitHub') => {
  let r: Response;
  try {
    r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method: init?.method || 'GET',
      headers: { ...githubHeaders(token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch { throw new UpdateError(`Couldn\u2019t ${what}. Check your connection.`); }
  return r;
};

const readTree = async (gh: ReturnType<typeof api>, repo: string, ref: string): Promise<Tree | null> => {
  const r = await gh(repo, `git/trees/${encodeURIComponent(ref)}?recursive=1`, undefined, 'read the files');
  if (r.status === 404 || r.status === 422) return null;
  if (!r.ok) throw new UpdateError(`Couldn\u2019t read the files (${r.status}).`);
  const data = await r.json();
  if (data.truncated) throw new UpdateError('This repo has too many files to update automatically.');
  const map: Tree = new Map();
  for (const e of data.tree) if (e.type === 'blob') map.set(e.path, { sha: e.sha, mode: e.mode });
  return map;
};

// Works out what the update would change, without changing anything.
export async function planUpdate(token: string, version: string): Promise<UpdatePlan> {
  const gh = api(token);
  const repo = SITE.github.repo, branch = SITE.github.branch;
  const ref = await gh(repo, `git/ref/heads/${branch}`, undefined, 'read the live branch');
  if (!ref.ok) throw new UpdateError(`Couldn\u2019t read the ${branch} branch (${ref.status}).`);
  const head = (await ref.json()).object.sha;
  const commit = await (await gh(repo, `git/commits/${head}`, undefined, 'read the latest commit')).json();
  const [mine, next, old] = await Promise.all([
    readTree(gh, repo, commit.tree.sha),
    readTree(gh, UPSTREAM, `v${version}`),
    readTree(gh, UPSTREAM, `v${CURRENT_VERSION}`),
  ]);
  if (!mine) throw new UpdateError('Couldn\u2019t read your site\u2019s files.');
  if (!next) throw new UpdateError(`Couldn\u2019t find version ${version} of Shelf Expression.`);

  const change: string[] = [], remove: string[] = [], edited: string[] = [], kept: string[] = [];
  for (const [path, file] of next) {
    if (!isAppPath(path)) continue;
    const here = mine.get(path);
    if (here?.sha === file.sha && here.mode === file.mode) continue;
    change.push(path);
    // Different from the version they installed means they edited it.
    if (here && old && old.get(path)?.sha !== here.sha) edited.push(path);
  }
  if (old) for (const [path, file] of old) {
    if (!isAppPath(path) || next.has(path) || !mine.has(path)) continue;
    if (mine.get(path)!.sha === file.sha) remove.push(path); else kept.push(path);
  }
  return { version, head, baseTree: commit.tree.sha, change: change.sort(), remove: remove.sort(), edited: edited.sort(), kept: kept.sort(), known: !!old };
}

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// Commits the update to its own branch, so the host can build a preview first.
export async function prepareUpdate(token: string, plan: UpdatePlan, onStep?: (text: string) => void): Promise<string> {
  const gh = api(token);
  const repo = SITE.github.repo;
  const next = (await readTree(gh, UPSTREAM, `v${plan.version}`))!;
  const entries: any[] = [];
  let done = 0;
  // Copy each new file into this repo, a few at a time.
  const queue = [...plan.change];
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      const file = next.get(path)!;
      let raw: Response;
      try { raw = await fetch(`https://raw.githubusercontent.com/${UPSTREAM}/v${plan.version}/${path.split('/').map(encodeURIComponent).join('/')}`); }
      catch { throw new UpdateError('Couldn\u2019t download the new version. Check your connection.'); }
      if (!raw.ok) throw new UpdateError(`Couldn\u2019t download ${path}.`);
      const made = await gh(repo, 'git/blobs', { method: 'POST', body: { content: toBase64(await raw.arrayBuffer()), encoding: 'base64' } }, 'copy a file');
      if (!made.ok) throw new UpdateError(made.status === 403 || made.status === 404
        ? 'Your GitHub key can\u2019t write to this repo. Give it Contents: Read and write.'
        : `Couldn\u2019t copy ${path} (${made.status}).`);
      const sha = (await made.json()).sha;
      if (sha !== file.sha) throw new UpdateError(`${path} didn\u2019t copy correctly. Try again.`);
      entries.push({ path, mode: file.mode, type: 'blob', sha });
      onStep?.(`Copying files\u2026 ${++done} of ${plan.change.length}`);
    }
  };
  onStep?.('Copying files\u2026');
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const path of plan.remove) entries.push({ path, mode: '100644', type: 'blob', sha: null });

  onStep?.('Making the update\u2026');
  const tree = await gh(repo, 'git/trees', { method: 'POST', body: { base_tree: plan.baseTree, tree: entries } }, 'prepare the update');
  if (!tree.ok) throw new UpdateError(`Couldn\u2019t prepare the update (${tree.status}).`);
  const commit = await gh(repo, 'git/commits', { method: 'POST', body: {
    message: `Update Shelf Expression to v${plan.version}`, tree: (await tree.json()).sha, parents: [plan.head],
  } }, 'make the update');
  if (!commit.ok) throw new UpdateError(`Couldn\u2019t make the update (${commit.status}).`);
  const sha = (await commit.json()).sha;
  const moved = await gh(repo, `git/refs/heads/${UPDATE_BRANCH}`, { method: 'PATCH', body: { sha, force: true } }, 'save the update');
  if (moved.status === 422 || moved.status === 404) {
    const made = await gh(repo, 'git/refs', { method: 'POST', body: { ref: `refs/heads/${UPDATE_BRANCH}`, sha } }, 'save the update');
    if (!made.ok) throw new UpdateError(`Couldn\u2019t save the update (${made.status}).`);
  } else if (!moved.ok) throw new UpdateError(`Couldn\u2019t save the update (${moved.status}).`);
  return sha;
}

// Puts the update on the live branch. If books were published since the
// update was made, the two are merged (they never touch the same files).
export async function finishUpdate(token: string, sha: string, version: string): Promise<string> {
  const gh = api(token);
  const repo = SITE.github.repo, branch = SITE.github.branch;
  let live = sha;
  const ff = await gh(repo, `git/refs/heads/${branch}`, { method: 'PATCH', body: { sha, force: false } }, 'update the live site');
  if (ff.status === 422) {
    const merged = await gh(repo, 'merges', { method: 'POST', body: { base: branch, head: sha, commit_message: `Update Shelf Expression to v${version}` } }, 'update the live site');
    if (merged.status === 409) throw new UpdateError('The update clashes with changes on your site. Make the update again.');
    if (!merged.ok && merged.status !== 204) throw new UpdateError(`Couldn\u2019t update the live site (${merged.status}).`);
    if (merged.status === 201) live = (await merged.json()).sha;
  } else if (!ff.ok) throw new UpdateError(`Couldn\u2019t update the live site (${ff.status}).`);
  // The update branch has done its job.
  await gh(repo, `git/refs/heads/${UPDATE_BRANCH}`, { method: 'DELETE' }).catch(() => {});
  return live;
}

// Release notes are short Markdown: headings, bullets and bold.
export type NoteLine = { kind: 'h' | 'li' | 'p'; parts: { text: string; bold: boolean }[] };
export const parseNotes = (md: string): NoteLine[] => md.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const kind: NoteLine['kind'] = /^#{1,6}\s/.test(l) ? 'h' : /^[-*]\s/.test(l) ? 'li' : 'p';
  const text = l.replace(/^#{1,6}\s+|^[-*]\s+/, '');
  const parts = text.split(/\*\*/).map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter(p => p.text);
  return { kind, parts };
});
