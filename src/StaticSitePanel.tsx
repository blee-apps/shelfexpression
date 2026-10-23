// The Create Static Site sheet: a few site details, then a zip to download.
import { useState } from 'react';
import { X, Plus, Trash2, Download } from 'lucide-react';
import { SITE, StaticSiteSettings, NavLink, subtitleTemplate } from './shelfData';
import { createStaticSite, saveZip, loadSiteSettings, saveSiteSettings } from './exportSite';

const MAX_LINKS = 5;

const defaults = (): StaticSiteSettings => {
  const saved = loadSiteSettings();
  return {
    name: saved?.name ?? SITE.name,
    url: saved?.url ?? SITE.url,
    title: saved?.title ?? SITE.title,
    subtitle: saved?.subtitle ?? subtitleTemplate(),
    nav: (saved?.nav ?? SITE.nav).map(l => ({ ...l })),
    // Off unless you turned it on before.
    editor: saved?.editor ?? false,
  };
};

export default function StaticSitePanel({ getContent, bookCount, onClose }: {
  getContent: () => any;
  bookCount: number;
  onClose: () => void;
}) {
  const [s, setS] = useState<StaticSiteSettings>(defaults);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const update = (patch: Partial<StaticSiteSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSiteSettings(next);
  };
  const setLink = (i: number, patch: Partial<NavLink>) =>
    update({ nav: s.nav.map((l, j) => j === i ? { ...l, ...patch } : l) });

  const create = async () => {
    if (!s.title.trim()) { setStatus({ text: 'Give the page a heading first.', error: true }); return; }
    setBusy(true);
    setStatus(null);
    try {
      const site: StaticSiteSettings = {
        ...s,
        name: s.name.trim(), url: s.url.trim(), title: s.title.trim(), subtitle: s.subtitle.trim(),
        nav: s.nav.filter(l => l.label.trim() && l.href.trim())
          .map(l => ({ label: l.label.trim(), href: l.href.trim(), ...(l.href.trim() === '/' ? { current: true } : {}) })),
      };
      const res = await createStaticSite({ content: getContent(), site, onStep: text => setStatus({ text }) });
      await saveZip(res.blob, res.fileName);
      setStatus({
        text: `Made ${res.fileName}: ${res.books} books and ${res.covers} covers.` +
          (res.missingCovers.length ? ` Couldn\u2019t include the cover for ${res.missingCovers.map(t => `\u201c${t}\u201d`).join(', ')}.` : ''),
        error: res.missingCovers.length > 0,
      });
    } catch (err: any) {
      setStatus({ text: err.message || String(err), error: true });
    }
    setBusy(false);
  };

  const preview = s.subtitle.split('{count}').join(String(bookCount));

  return (
    <div className="admin-modal-wrap" style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={() => !busy && onClose()}>
      <div className="admin-modal static-site-panel" style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Export site</span>
          <button onClick={onClose} disabled={busy} style={btn({ secondary: true, small: true })} aria-label="Close"><X size={14} /></button>
        </div>

        <div style={{ padding: '6px 18px 16px', overflow: 'auto', flex: 1 }}>
          <p style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.5, margin: '8px 0 4px' }}>
            Downloads your shelf as a website you can upload to any web host. No GitHub needed.
          </p>

          <label style={label}>Site name</label>
          <input value={s.name} onChange={e => update({ name: e.target.value })} style={input} placeholder="Your name or site" />

          <label style={label}>Site link <span style={hint}>(optional: where the site name goes)</span></label>
          <input value={s.url} onChange={e => update({ url: e.target.value })} style={input} placeholder="https://example.com"
            inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />

          <label style={label}>Heading</label>
          <input value={s.title} onChange={e => update({ title: e.target.value })} style={input} placeholder="Bookshelf" />

          <label style={label}>Line under the heading <span style={hint}>({'{count}'} is the number of books)</span></label>
          <input value={s.subtitle} onChange={e => update({ subtitle: e.target.value })} style={input} />
          {s.subtitle.includes('{count}') && <div style={{ ...hint, marginTop: 4 }}>{preview}</div>}

          <label style={label}>Menu links <span style={hint}>(up to {MAX_LINKS}; none hides the menu)</span></label>
          {s.nav.map((l, i) => (
            <div key={i} className="static-site-link" style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={l.label} onChange={e => setLink(i, { label: e.target.value })} style={{ ...input, flex: '0 0 32%' }} placeholder="Label" />
              <input value={l.href} onChange={e => setLink(i, { href: e.target.value })} style={{ ...input, flex: 1, minWidth: 0 }} placeholder="https://"
                inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <button onClick={() => update({ nav: s.nav.filter((_, j) => j !== i) })} style={btn({ secondary: true, small: true })} aria-label="Remove link"><Trash2 size={13} /></button>
            </div>
          ))}
          {s.nav.length < MAX_LINKS && (
            <button onClick={() => update({ nav: [...s.nav, { label: '', href: '' }] })} style={btn({ secondary: true, small: true })}>
              <Plus size={13} /> Add link
            </button>
          )}

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.editor} onChange={e => update({ editor: e.target.checked })} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', lineHeight: 1.45 }}>
              <b style={{ fontWeight: 600 }}>Include the editor</b>
              <span style={{ display: 'block', color: '#888', fontSize: '0.75rem' }}>
                Opens with Ctrl+Shift+U or 5 taps on the heading, so you can edit on the site and download it again. Visitors won’t see it.
              </span>
            </span>
          </label>

          <p style={{ ...hint, display: 'block', margin: '14px 0 0', lineHeight: 1.5 }}>
            Shelf style, mode and share footer come from the editor. Upload the folder to the top of a web address, not a subfolder.
          </p>
        </div>

        <div style={{ padding: '12px 18px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: status?.error ? '#b42318' : '#888', flex: '1 1 180px', lineHeight: 1.4 }}>
            {status ? status.text : `${bookCount} book${bookCount === 1 ? '' : 's'}, as they are in the editor now.`}
          </span>
          <button onClick={create} disabled={busy || bookCount === 0}
            style={{ ...btn(), ...(busy || bookCount === 0 ? { opacity: 0.5, cursor: busy ? 'wait' : 'default' } : {}) }}>
            {busy ? <span className="admin-spinner" style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} /> : <Download size={14} />}
            {busy ? 'Creating…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

const btn = ({ secondary, small }: { secondary?: boolean; small?: boolean } = {}): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: small ? '5px 10px' : '8px 16px',
  border: 'none', borderRadius: 5, fontSize: small ? '0.72rem' : '0.82rem', fontWeight: 500, cursor: 'pointer',
  background: secondary ? '#eee' : '#1a1a1a', color: secondary ? '#333' : '#fff', flexShrink: 0,
});
const input: React.CSSProperties = {
  width: '100%', padding: '7px 9px', border: '1px solid #ddd', borderRadius: 4,
  fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box',
};
const label: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#555', marginBottom: 4, marginTop: 12 };
const hint: React.CSSProperties = { fontSize: '0.72rem', color: '#999', fontWeight: 400 };
