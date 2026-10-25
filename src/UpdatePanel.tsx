// The Update sheet: what's new in Shelf Expression, and a way to install it.
import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, AlertTriangle, Check } from 'lucide-react';
import { getToken } from './github';
import { deployStatus } from './publish';
import { SITE } from './shelfData';
import { Release, UpdatePlan, CURRENT_VERSION, UPDATE_BRANCH, canUpdateHere, planUpdate, prepareUpdate, finishUpdate, parseNotes } from './updater';
import { sheetBtn as btn } from './SiteFields';

type Stage =
  | { kind: 'idle' }
  | { kind: 'working'; text: string }
  | { kind: 'preview'; sha: string; url?: string; note?: string }
  | { kind: 'live'; sha: string; ready: boolean; note?: string }
  | { kind: 'error'; text: string };

export default function UpdatePanel({ releases, guest, hasUnpublished, onClose }: {
  releases: Release[];
  guest: boolean;
  hasUnpublished: boolean;
  onClose: () => void;
}) {
  const latest = releases[0];
  const token = getToken();
  const canInstall = !!latest && !guest && !import.meta.env.DEV && !!token && canUpdateHere();
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [planError, setPlanError] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Look at what would change as soon as the sheet opens.
  useEffect(() => {
    if (!canInstall) return;
    planUpdate(token, latest.version).then(p => alive.current && setPlan(p)).catch(e => alive.current && setPlanError(e.message || String(e)));
  }, []);

  // Watch the host build a commit.
  const watch = async (sha: string, live: boolean, onUpdate: (d: { url?: string; ready: boolean; note?: string }) => void) => {
    const started = Date.now();
    while (alive.current && Date.now() - started < 10 * 60_000) {
      let d;
      try { d = await deployStatus(token, sha, live); } catch { d = { state: 'waiting' as const }; }
      if (d.state === 'ready') { onUpdate({ url: d.url, ready: true }); return; }
      if (d.state === 'failed') { onUpdate({ url: d.url, ready: false, note: 'The build failed. Open your host to see why.' }); return; }
      if (d.state === 'no-access' && !live) { onUpdate({ ready: false, note: `Your host is building a preview of the ${UPDATE_BRANCH} branch. You\u2019ll find it there.` }); return; }
      await new Promise(r => setTimeout(r, 5000));
    }
  };

  const busy = stage.kind === 'working';
  const run = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { if (alive.current) setStage({ kind: 'error', text: e.message || String(e) }); }
  };

  const preview = () => run(async () => {
    const sha = await prepareUpdate(token, plan!, text => setStage({ kind: 'working', text }));
    setStage({ kind: 'preview', sha });
    watch(sha, false, d => alive.current && setStage(s => s.kind === 'preview' ? { ...s, url: d.url, note: d.note } : s));
  });

  const goLive = (prepared?: string) => run(async () => {
    const sha = prepared || await prepareUpdate(token, plan!, text => setStage({ kind: 'working', text }), false);
    setStage({ kind: 'working', text: 'Updating your live site\u2026' });
    const live = await finishUpdate(token, sha, plan!.version);
    setStage({ kind: 'live', sha: live, ready: false });
    watch(live, true, d => alive.current && setStage(s => s.kind === 'live' ? { ...s, ready: d.ready, note: d.note } : s));
  });

  const small = { fontSize: '0.78rem', color: '#777', lineHeight: 1.5 } as const;
  const files = plan ? plan.change.length + plan.remove.length : 0;

  return (
    <div className="admin-modal-wrap" style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={() => !busy && onClose()}>
      <div className="admin-modal update-panel" style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{latest ? `Version ${latest.version} is ready` : 'You\u2019re up to date'}</div>
            <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 2 }}>You have version {CURRENT_VERSION}</div>
          </div>
          <button onClick={onClose} disabled={busy} style={btn({ secondary: true, small: true })} aria-label="Close"><X size={14} /></button>
        </div>

        <div style={{ padding: '8px 18px 16px', overflow: 'auto', flex: 1 }}>
          {!latest && <p style={small}>Your shelf has the latest Shelf Expression. New versions show up here.</p>}

          {/* What's new, in every version since yours */}
          {releases.map(r => (
            <div key={r.version} className="update-notes" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.version}</span>
                <span style={{ fontSize: '0.8rem', color: '#555' }}>{r.name}</span>
                <a href={r.url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: '#999' }} aria-label="Open on GitHub"><ExternalLink size={13} /></a>
              </div>
              {parseNotes(r.notes).map((l, i) => {
                const text = l.parts.map((p, j) => p.bold ? <b key={j} style={{ fontWeight: 600, color: '#1a1a1a' }}>{p.text}</b> : <span key={j}>{p.text}</span>);
                if (l.kind === 'h') return <div key={i} style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1a1a1a', margin: '10px 0 2px' }}>{text}</div>;
                if (l.kind === 'li') return <div key={i} style={{ ...small, color: '#555', paddingLeft: 12, position: 'relative', margin: '3px 0' }}><span style={{ position: 'absolute', left: 0 }}>{'\u2022'}</span>{text}</div>;
                return <p key={i} style={{ ...small, color: '#555', margin: '4px 0' }}>{text}</p>;
              })}
            </div>
          ))}

          {/* Why it can't install from here */}
          {latest && !canInstall && (
            <p style={{ ...small, background: '#fafafa', borderRadius: 8, padding: '10px 12px', marginTop: 16 }}>
              {import.meta.env.DEV
                ? 'You\u2019re running the editor on your computer. To update, open the editor on your live site, or pull the new version with git.'
                : guest || !token
                  ? 'To update, open the editor with your GitHub key.'
                  : !SITE.github.repo
                    ? 'To update, add your GitHub repo in Site details.'
                    : 'This copy can\u2019t update itself.'}
            </p>
          )}

          {/* What the update changes */}
          {canInstall && (
            <div style={{ marginTop: 16, background: '#fafafa', borderRadius: 8, padding: '10px 12px' }}>
              {!plan && !planError && <span style={small}>Checking what changes{'\u2026'}</span>}
              {planError && <span style={{ ...small, color: '#b42318' }}>{planError}</span>}
              {plan && (
                <>
                  <div style={{ ...small, color: '#333' }}>
                    {files ? `Updates ${files} file${files === 1 ? '' : 's'} of the app.` : 'Your files already match this version.'} Your books, covers and site details stay exactly as they are.
                  </div>
                  {plan.edited.length > 0 && (
                    <div style={{ ...small, color: '#8a5a00', marginTop: 8, display: 'flex', gap: 8 }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>You{'\u2019'}ve changed {plan.edited.length === 1 ? 'this file' : 'these files'} yourself, and the update replaces {plan.edited.length === 1 ? 'it' : 'them'}: {plan.edited.join(', ')}. You can get your version back from GitHub{'\u2019'}s history.</span>
                    </div>
                  )}
                  {!plan.known && <div style={{ ...small, marginTop: 8 }}>Couldn{'\u2019'}t tell whether you{'\u2019'}ve changed any app files yourself. If you have, the update replaces them.</div>}
                  {hasUnpublished && <div style={{ ...small, marginTop: 8 }}>Your unpublished changes stay in the editor. Publish them as usual, before or after.</div>}
                </>
              )}
            </div>
          )}

          {stage.kind === 'preview' && (
            <div style={{ ...small, marginTop: 12, color: '#333' }}>
              {stage.url
                ? <>Preview ready. <a href={stage.url} target="_blank" rel="noreferrer" style={{ color: '#1a1a1a', fontWeight: 600 }}>Open the preview</a>, then make it live when you{'\u2019'}re happy.</>
                : stage.note || <><span className="admin-spinner" style={{ marginRight: 6 }} />Building a preview{'\u2026'}</>}
            </div>
          )}
          {stage.kind === 'live' && (
            <div style={{ ...small, marginTop: 12, color: '#333', display: 'flex', alignItems: 'center', gap: 6 }}>
              {stage.ready
                ? <><Check size={14} style={{ color: '#1a7f37' }} /> Updated to {plan?.version}. Reload to use it.</>
                : stage.note || <><span className="admin-spinner" /> Updated on GitHub. Your site is rebuilding{'\u2026'}</>}
            </div>
          )}
          {stage.kind === 'error' && <div style={{ ...small, marginTop: 12, color: '#b42318' }}>{stage.text}</div>}
        </div>

        {canInstall && plan && files > 0 && stage.kind !== 'live' && (
          <div style={{ padding: '12px 18px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {stage.kind === 'working' && <span style={{ ...small, flex: '1 1 160px' }}>{stage.text}</span>}
            {stage.kind !== 'preview' && (
              <button onClick={preview} disabled={busy} style={{ ...btn({ secondary: true }), ...(busy ? { opacity: 0.5 } : {}) }}>Preview first</button>
            )}
            <button onClick={() => goLive(stage.kind === 'preview' ? stage.sha : undefined)} disabled={busy} style={{ ...btn(), ...(busy ? { opacity: 0.5, cursor: 'wait' } : {}) }}>
              {stage.kind === 'preview' ? 'Make it live' : 'Update'}
            </button>
          </div>
        )}
        {stage.kind === 'live' && stage.ready && (
          <div style={{ padding: '12px 18px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => window.location.reload()} style={btn()}>Reload</button>
          </div>
        )}
      </div>
    </div>
  );
}
