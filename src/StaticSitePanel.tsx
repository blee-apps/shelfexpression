// The Export site sheet: a few site details, then a zip to download.
import { useState } from 'react';
import { X, Download } from 'lucide-react';
import { StaticSiteSettings } from './shelfData';
import { createStaticSite, saveZip, saveLocally, saveSiteSettings } from './exportSite';
import { SiteFields, siteDefaults, cleanSite, sheetBtn as btn, fieldHint as hint } from './SiteFields';

export default function StaticSitePanel({ getContent, bookCount, onClose }: {
  getContent: () => any;
  bookCount: number;
  onClose: () => void;
}) {
  const [s, setS] = useState<StaticSiteSettings>(siteDefaults);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const update = (patch: Partial<StaticSiteSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSiteSettings(next);
  };

  const create = async () => {
    if (!s.title.trim()) { setStatus({ text: 'Give the page a heading first.', error: true }); return; }
    setBusy(true);
    setStatus(null);
    try {
      const site = cleanSite(s);
      const content = getContent();
      const res = await createStaticSite({ content, site, onStep: text => setStatus({ text }) });
      await saveZip(res.blob, res.fileName);
      const saved = import.meta.env.DEV ? await saveLocally(content, site) : '';
      setStatus({
        text: `Made ${res.fileName}: ${res.books} books and ${res.covers} covers.` + saved +
          (res.missingCovers.length ? ` Couldn\u2019t include the cover for ${res.missingCovers.map(t => `\u201c${t}\u201d`).join(', ')}.` : ''),
        error: res.missingCovers.length > 0,
      });
    } catch (err: any) {
      setStatus({ text: err.message || String(err), error: true });
    }
    setBusy(false);
  };

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

          <SiteFields value={s} onChange={setS} bookCount={bookCount} />

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

        <div className="sheet-footer" style={{ padding: '12px 18px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
