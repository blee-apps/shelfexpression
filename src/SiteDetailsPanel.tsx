// The Site details sheet: your site name, link, heading, subtitle and menu.
// Save puts them where the site reads them:
// - on your computer (npm run dev): into content/site.ts
// - on the live site: one commit to content/site.ts on GitHub
// - as a guest or on a static site: this device only, for Export site
import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { SITE, StaticSiteSettings } from './shelfData';
import { getToken } from './github';
import { publishSiteDetails } from './publish';
import { SiteFields, siteDefaults, cleanSite, sheetBtn as btn, fieldInput, fieldLabel, fieldHint } from './SiteFields';

export type SiteSaveTarget = 'local' | 'github' | 'device';

export default function SiteDetailsPanel({ target, toTest, bookCount, onClose }: {
  target: SiteSaveTarget;
  toTest: boolean; // live site: save to the test branch like Publish does
  bookCount: number;
  onClose: () => void;
}) {
  const [s, setS] = useState<StaticSiteSettings>(siteDefaults);
  const [repo, setRepo] = useState(SITE.github.repo);
  const [guestMode, setGuestMode] = useState(SITE.guestMode);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; done?: boolean } | null>(null);

  const save = async () => {
    if (target === 'device') { onClose(); return; }
    if (!s.title.trim()) { setStatus({ text: 'Give the page a heading first.', error: true }); return; }
    const r = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    if (target === 'local' && r && !/^[\w.-]+\/[\w.-]+$/.test(r)) { setStatus({ text: 'Write the repo as your-name/your-repo.', error: true }); return; }
    const { editor: _editor, ...details } = cleanSite(s);
    setBusy(true);
    setStatus({ text: 'Saving…' });
    try {
      if (target === 'local') {
        const res = await fetch('/api/save-site', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...details, repo: r, guestMode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setStatus({ text: 'Saved to content/site.ts. Reload the page to see it.', done: true });
      } else {
        const token = getToken();
        if (!token) throw new Error('No GitHub key on this device. Close the editor and open it again to add one.');
        await publishSiteDetails({ token, site: { ...details, guestMode }, toTest });
        setStatus({
          text: toTest
            ? `Saved to ${SITE.github.testBranch}. It shows on the test preview in a minute or two.`
            : 'Saved to GitHub. Your site shows it in a minute or two.',
          done: true,
        });
      }
    } catch (err: any) {
      setStatus({ text: err.message || String(err), error: true });
    }
    setBusy(false);
  };

  const note = target === 'local'
    ? 'Saved into content/site.ts.'
    : target === 'github'
      ? `Save updates your site right away${toTest ? ` (on ${SITE.github.testBranch}, like Publish)` : ''}. Books still go out with Publish.`
      : 'Kept on this device and used when you Export site.';

  return (
    <div className="admin-modal-wrap" style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={() => !busy && onClose()}>
      <div className="admin-modal site-details-panel" style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Site details</span>
          <button onClick={onClose} disabled={busy} style={btn({ secondary: true, small: true })} aria-label="Close"><X size={14} /></button>
        </div>

        <div style={{ padding: '6px 18px 16px', overflow: 'auto', flex: 1 }}>
          <p style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.5, margin: '8px 0 4px' }}>
            The name, heading and menu at the top of your shelf. {note}
          </p>

          <SiteFields value={s} onChange={v => { setS(v); setStatus(null); }} bookCount={bookCount} />

          {target !== 'device' && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, cursor: 'pointer' }}>
              <input type="checkbox" checked={guestMode} onChange={e => { setGuestMode(e.target.checked); setStatus(null); }}
                className="site-guest-toggle" style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
              <span style={{ fontSize: '0.8rem', lineHeight: 1.45 }}>
                <b style={{ fontWeight: 600 }}>Let visitors try the editor</b>
                <span style={{ display: 'block', color: '#888', fontSize: '0.75rem' }}>
                  Anyone who finds the editor on your site can tap Continue as guest to make share images or export a copy. They can never publish. Off means only your GitHub key gets in.
                </span>
              </span>
            </label>
          )}

          {target === 'local' && <>
            <label style={{ ...fieldLabel, marginTop: 18 }}>GitHub repo <span style={fieldHint}>(lets you edit on the live site)</span></label>
            <input value={repo} onChange={e => { setRepo(e.target.value); setStatus(null); }} style={fieldInput} placeholder="your-name/your-shelf"
              autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <div style={{ ...fieldHint, marginTop: 4, lineHeight: 1.45 }}>
              {SITE.github.repo ? 'Filled in from the repo you cloned. Change it only if your site publishes from another one.' : 'Your copy isn\u2019t on GitHub yet. You can add this later.'}
            </div>
          </>}
        </div>

        <div style={{ padding: '12px 18px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: status?.error ? '#b42318' : '#888', flex: '1 1 180px', lineHeight: 1.4 }}>
            {status ? status.text : target === 'device' ? 'Changes are kept as you type.' : ''}
          </span>
          <button onClick={status?.done ? onClose : save} disabled={busy}
            style={{ ...btn(), ...(busy ? { opacity: 0.5, cursor: 'wait' } : {}) }}>
            {busy ? <span className="admin-spinner" style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} /> : status?.done || target === 'device' ? <Check size={14} /> : null}
            {busy ? 'Saving…' : status?.done || target === 'device' ? 'Done' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
