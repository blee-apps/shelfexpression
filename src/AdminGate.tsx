// Opens the editor. On the live site it first asks for a GitHub key that can
// write to this site's repo, so visitors who find the 5-tap trick can't use it.
// When running locally (npm run dev) it opens straight away.
import { useState, useEffect, lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { Book } from './books';
import { SITE, IS_STATIC_SITE } from './shelfData';
import { getToken, saveToken, forgetToken, checkToken } from './github';

const UpdateTool = lazy(() => import('./UpdateTool'));

interface Props { onClose: () => void; books: Book[] }

export default function AdminGate({ onClose, books }: Props) {
  const [state, setState] = useState<'checking' | 'locked' | 'open' | 'guest'>(
    // A static site has nothing to publish to, so its editor opens as a guest.
    IS_STATIC_SITE ? 'guest' : import.meta.env.DEV ? 'open' : 'checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A key saved on this device is checked again, in case it expired.
  useEffect(() => {
    if (import.meta.env.DEV || IS_STATIC_SITE) return;
    const saved = getToken();
    if (!saved) { setState('locked'); return; }
    checkToken(saved).then(res => {
      if (res.ok) setState('open');
      else { setError(res.error); setState('locked'); }
    });
  }, []);

  const unlock = async () => {
    setBusy(true);
    setError('');
    const res = await checkToken(token);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    saveToken(token.trim());
    setToken('');
    setState('open');
  };

  if (state === 'guest') {
    return (
      <Suspense fallback={null}>
        <UpdateTool books={books} onClose={onClose} guest />
      </Suspense>
    );
  }

  if (state === 'open') {
    return (
      <Suspense fallback={null}>
        <UpdateTool books={books} onClose={onClose}
          onForgetKey={import.meta.env.DEV ? undefined : () => { forgetToken(); onClose(); }} />
      </Suspense>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(253,253,253,0.97)', color: '#1a1a1a',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Manrope", sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 22, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', position: 'relative' }}>
        <button onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: 12, right: 12, border: 'none', background: 'none', cursor: 'pointer', color: '#999', padding: 4 }}>
          <X size={16} />
        </button>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 6px' }}>Bookshelf Editor</h2>
        {state === 'checking' ? (
          <p style={{ fontSize: '0.82rem', color: '#888', margin: 0 }}>Checking your GitHub key…</p>
        ) : (
          <>
            <p style={{ fontSize: '0.82rem', color: '#666', lineHeight: 1.5, margin: '0 0 14px' }}>
              {SITE.github.repo
                ? <>Paste a GitHub fine-grained key with access to <b>{SITE.github.repo}</b>. It stays on this device.</>
                : <>To edit on the live site, first set <b>github.repo</b> in <code>content/site.ts</code> to this site’s GitHub repo.</>}
            </p>
            {SITE.github.repo && <form onSubmit={e => { e.preventDefault(); unlock(); }}>
              <input type="password" value={token} onChange={e => setToken(e.target.value)} autoFocus
                placeholder="github_pat_…" autoComplete="off" autoCapitalize="off" spellCheck={false}
                style={{ width: '100%', padding: '9px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: '16px', fontFamily: 'ui-monospace, Menlo, monospace', boxSizing: 'border-box' }} />
              {error && <p style={{ fontSize: '0.78rem', color: '#b42318', margin: '8px 0 0', lineHeight: 1.4 }}>{error}</p>}
              <button type="submit" disabled={busy}
                style={{ marginTop: 12, width: '100%', padding: '9px 14px', border: 'none', borderRadius: 6, background: '#1a1a1a', color: '#fff', fontSize: '0.85rem', fontWeight: 500, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </form>}
            {SITE.github.repo && <p style={{ fontSize: '0.72rem', color: '#999', lineHeight: 1.5, margin: '12px 0 0' }}>
              Make one at github.com → Settings → Developer settings → Fine-grained tokens. Choose only this repo, and give it Contents: Read and write.
            </p>}
            {SITE.guestMode && <div style={{ borderTop: '1px solid #eee', margin: '16px 0 0', paddingTop: 14 }}>
              <button onClick={() => setState('guest')}
                style={{ width: '100%', padding: '9px 14px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', color: '#1a1a1a', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}>
                Continue as guest
              </button>
              <p style={{ fontSize: '0.72rem', color: '#999', lineHeight: 1.5, margin: '8px 0 0', textAlign: 'center' }}>
                Try the editor, make share images or a static site. Nothing is published.
              </p>
            </div>}
          </>
        )}
      </div>
    </div>
  );
}
