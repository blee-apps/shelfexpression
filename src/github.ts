// The GitHub key the editor uses on the live site. It's a fine-grained
// personal access token limited to this one repo, kept only on this device.
import { SITE } from './shelfData';

const STORAGE_KEY = 'bookshelf.githubToken';

export const getToken = () => {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
};
export const saveToken = (token: string) => localStorage.setItem(STORAGE_KEY, token);
export const forgetToken = () => localStorage.removeItem(STORAGE_KEY);

export const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

export type TokenCheck = { ok: true; expires?: string } | { ok: false; error: string };

// Checks the key can write to this site's repo. Any GitHub key can read a
// public repo, so the check is for write access, which only the owner's key has.
export async function checkToken(token: string): Promise<TokenCheck> {
  if (!token.trim()) return { ok: false, error: 'Paste your GitHub key first.' };
  if (!SITE.github.repo) return { ok: false, error: 'Add your GitHub repo in Site details first.' };
  try {
    const r = await fetch(`https://api.github.com/repos/${SITE.github.repo}`, { headers: githubHeaders(token.trim()) });
    if (r.status === 401) return { ok: false, error: 'GitHub didn\u2019t accept this key. It may have expired or been deleted.' };
    if (r.status === 403 || r.status === 404) return { ok: false, error: `This key can\u2019t see ${SITE.github.repo}. Give it access to that repo.` };
    if (!r.ok) return { ok: false, error: `GitHub returned an error (${r.status}). Try again in a moment.` };
    const data = await r.json().catch(() => ({}));
    if (data.permissions && !data.permissions.push) return { ok: false, error: `This key can\u2019t write to ${SITE.github.repo}. Give it Contents: Read and write.` };
    const exp = r.headers.get('github-authentication-token-expiration') || undefined;
    return { ok: true, expires: exp };
  } catch {
    return { ok: false, error: 'Couldn\u2019t reach GitHub. Check your connection.' };
  }
}
