// The site detail fields (name, link, heading, subtitle, menu). Shared by the
// Site details sheet and the Export site sheet, and remembered on this device,
// so they're only typed once.
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { SITE, StaticSiteSettings, NavLink, subtitleTemplate } from './shelfData';
import { loadSiteSettings, saveSiteSettings } from './exportSite';

export const MAX_LINKS = 5;

export const siteDefaults = (): StaticSiteSettings => {
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

// Trims everything and drops half-filled menu links. A link to "/" is this page.
export const cleanSite = (s: StaticSiteSettings): StaticSiteSettings => ({
  ...s,
  name: s.name.trim(), url: s.url.trim(), title: s.title.trim(), subtitle: s.subtitle.trim(),
  nav: s.nav.filter(l => l.label.trim() && l.href.trim())
    .map(l => ({ label: l.label.trim(), href: l.href.trim(), ...(l.href.trim() === '/' ? { current: true } : {}) })),
});

export function SiteFields({ value: s, onChange, bookCount }: {
  value: StaticSiteSettings;
  onChange: (next: StaticSiteSettings) => void;
  bookCount: number;
}) {
  const update = (patch: Partial<StaticSiteSettings>) => {
    const next = { ...s, ...patch };
    onChange(next);
    saveSiteSettings(next);
  };
  const setLink = (i: number, patch: Partial<NavLink>) =>
    update({ nav: s.nav.map((l, j) => j === i ? { ...l, ...patch } : l) });
  // Swaps a link with its neighbor above (-1) or below (+1).
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.nav.length) return;
    const nav = [...s.nav];
    [nav[i], nav[j]] = [nav[j], nav[i]];
    update({ nav });
  };
  const preview = s.subtitle.split('{count}').join(String(bookCount));

  return <>
    <label style={fieldLabel}>Site name</label>
    <input value={s.name} onChange={e => update({ name: e.target.value })} style={fieldInput} placeholder="Your name or site" />

    <label style={fieldLabel}>Site link <span style={fieldHint}>(optional: where the site name goes)</span></label>
    <input value={s.url} onChange={e => update({ url: e.target.value })} style={fieldInput} placeholder="https://example.com"
      inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />

    <label style={fieldLabel}>Heading</label>
    <input value={s.title} onChange={e => update({ title: e.target.value })} style={fieldInput} placeholder="Bookshelf" />

    <label style={fieldLabel}>Line under the heading <span style={fieldHint}>({'{count}'} is the number of books)</span></label>
    <input value={s.subtitle} onChange={e => update({ subtitle: e.target.value })} style={fieldInput} />
    {s.subtitle.includes('{count}') && <div style={{ ...fieldHint, marginTop: 4 }}>{preview}</div>}

    <label style={fieldLabel}>Menu links <span style={fieldHint}>(up to {MAX_LINKS}; none hides the menu)</span></label>
    {s.nav.map((l, i) => (
      <div key={i} className="static-site-link" style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'stretch' }}>
        {s.nav.length > 1 && (
          <div className="static-site-link-order" style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move link up" style={arrowBtn(i === 0)}><ChevronUp size={13} /></button>
            <button onClick={() => move(i, 1)} disabled={i === s.nav.length - 1} aria-label="Move link down" style={arrowBtn(i === s.nav.length - 1)}><ChevronDown size={13} /></button>
          </div>
        )}
        <input value={l.label} onChange={e => setLink(i, { label: e.target.value })} style={{ ...fieldInput, flex: '0 0 30%', minWidth: 0 }} placeholder="Label" />
        <input value={l.href} onChange={e => setLink(i, { href: e.target.value })} style={{ ...fieldInput, flex: 1, minWidth: 0 }} placeholder="https://"
          inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button onClick={() => update({ nav: s.nav.filter((_, j) => j !== i) })} style={sheetBtn({ secondary: true, small: true })} aria-label="Remove link"><Trash2 size={13} /></button>
      </div>
    ))}
    {s.nav.length < MAX_LINKS && (
      <button onClick={() => update({ nav: [...s.nav, { label: '', href: '' }] })} style={sheetBtn({ secondary: true, small: true })}>
        <Plus size={13} /> Add link
      </button>
    )}
  </>;
}

export const sheetBtn = ({ secondary, small }: { secondary?: boolean; small?: boolean } = {}): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: small ? '5px 10px' : '8px 16px',
  border: 'none', borderRadius: 5, fontSize: small ? '0.72rem' : '0.82rem', fontWeight: 500, cursor: 'pointer',
  background: secondary ? '#eee' : '#1a1a1a', color: secondary ? '#333' : '#fff', flexShrink: 0,
});
const arrowBtn = (off: boolean): React.CSSProperties => ({
  flex: 1, width: 28, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  border: 'none', borderRadius: 4, background: '#eee', color: '#333', cursor: off ? 'default' : 'pointer', opacity: off ? 0.35 : 1,
});
export const fieldInput: React.CSSProperties = {
  width: '100%', padding: '7px 9px', border: '1px solid #ddd', borderRadius: 4,
  fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box',
};
export const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 500, color: '#555', marginBottom: 4, marginTop: 12 };
export const fieldHint: React.CSSProperties = { fontSize: '0.72rem', color: '#999', fontWeight: 400 };
