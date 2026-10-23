// Full-screen share studio: a live preview of the share image, with options
// for size, layout, background and text, and a button to share or save it.
import { useEffect, useRef, useState } from 'react';
import { X, Share2, Download, GripVertical, ChevronLeft } from 'lucide-react';
import type { Book } from '../books';
import { renderShare, coverColor, SIZES, DEFAULT_OPTIONS, ShareOptions, ShareBook, ShareLayout, ShareBg, ShareSize } from './render';

const OPTIONS_KEY = 'bookshelf.shareOptions';

const loadOptions = (): ShareOptions => {
  try { return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}'), heading: '' }; }
  catch { return { ...DEFAULT_OPTIONS }; }
};

interface Props {
  books: Book[];
  loadCover: (b: Book) => Promise<HTMLImageElement | null>;
  footer: string;
  onFooterChange: (text: string) => void;
  onClose: (order: Book[]) => void;
  toast: (msg: string) => void;
}

export default function ShareStudio({ books, loadCover, footer, onFooterChange, onClose, toast }: Props) {
  const [order, setOrder] = useState<Book[]>(books);
  const [opts, setOpts] = useState<ShareOptions>(loadOptions);
  const [imgs, setImgs] = useState<Map<string, HTMLImageElement | null>>(new Map());
  const [busy, setBusy] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  // Which book the Cover background takes its color from (the first, unless picked).
  const [tintId, setTintId] = useState<string | null>(null);

  const set = <K extends keyof ShareOptions>(k: K, v: ShareOptions[K]) =>
    setOpts(prev => {
      const next = { ...prev, [k]: v };
      const { heading: _h, footer: _f, ...keep } = next;
      try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(keep)); } catch {}
      return next;
    });

  // Fonts used on the image.
  useEffect(() => {
    Promise.race([
      Promise.all(['72px "DM Serif Text"', '400 30px Manrope', '500 30px Manrope', '600 30px Manrope'].map(f => document.fonts.load(f))),
      new Promise(r => setTimeout(r, 2500)),
    ]).finally(() => setFontsReady(true));
  }, []);

  // Cover images.
  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(books.map(async b => [b.id, await loadCover(b).catch(() => null)] as const));
      if (alive) { setImgs(new Map(entries)); setBusy(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareBooks: ShareBook[] = order.map(b => ({
    title: b.title, author: b.author, year: b.year, synopsis: b.synopsis, img: imgs.get(b.id) ?? null,
  }));
  const single = order.length === 1;
  const layout: ShareLayout = single && opts.layout === 'grid' ? 'feature' : !single && opts.layout === 'feature' ? 'grid' : opts.layout;

  const tintIndex = Math.max(0, order.findIndex(b => b.id === tintId));
  const tintBook = order[tintIndex];
  const tintImg = tintBook ? imgs.get(tintBook.id) ?? null : null;
  const stepTint = (d: number) => {
    if (!order.length) return;
    setTintId(order[(tintIndex + d + order.length) % order.length].id);
  };

  // Redraw whenever anything changes.
  useEffect(() => {
    if (busy || !fontsReady || !canvasRef.current) return;
    const tint = opts.bg === 'cover' ? coverColor(tintImg) : null;
    renderShare(canvasRef.current, shareBooks, { ...opts, layout, footer }, tint);
    blobRef.current = null;
    canvasRef.current.toBlob(b => { blobRef.current = b; }, 'image/jpeg', 0.92);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, fontsReady, order, opts, footer, imgs, tintImg]);

  const getBlob = async () => blobRef.current
    || await new Promise<Blob | null>(r => canvasRef.current ? canvasRef.current.toBlob(r, 'image/jpeg', 0.92) : r(null));

  const fileName = () => `bookshelf-${opts.size}.jpg`;

  const download = async () => {
    const blob = await getBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName(); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare
    && navigator.canShare({ files: [new File([new Blob()], 'x.jpg', { type: 'image/jpeg' })] });

  const share = async () => {
    const blob = await getBlob();
    if (!blob) return;
    const file = new File([blob], fileName(), { type: 'image/jpeg' });
    try { await navigator.share({ files: [file] }); }
    catch (e: any) { if (e?.name !== 'AbortError') { toast('Couldn\u2019t open sharing, so the image was downloaded.'); download(); } }
  };

  // Drag to reorder in the book strip.
  const dragIdx = useRef<number | null>(null);
  const onStripDown = (i: number) => (e: React.PointerEvent) => {
    dragIdx.current = i;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onStripMove = (e: React.PointerEvent) => {
    if (dragIdx.current === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-strip]') as HTMLElement | null;
    const to = el ? Number(el.dataset.strip) : -1;
    const from = dragIdx.current;
    if (to < 0 || to === from) return;
    setOrder(prev => { const next = [...prev]; const [m] = next.splice(from, 1); next.splice(to, 0, m); return next; });
    dragIdx.current = to;
  };
  const onStripUp = () => { dragIdx.current = null; };
  const removeBook = (id: string) => setOrder(prev => prev.length > 1 ? prev.filter(b => b.id !== id) : prev);

  const size = SIZES[opts.size];

  return (
    <div className="share-studio" style={{
      position: 'fixed', inset: 0, zIndex: 10001, background: '#efefef', display: 'flex', flexDirection: 'column',
      fontFamily: 'Manrope, system-ui, sans-serif', color: '#1a1a1a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', paddingTop: 'max(10px, env(safe-area-inset-top))', background: '#fff', borderBottom: '1px solid #e5e5e5' }}>
        <button onClick={() => onClose(order)} style={btn(true)} aria-label="Back to picking books"><ChevronLeft size={16} /></button>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Share Studio</span>
        <span style={{ fontSize: '0.75rem', color: '#999' }}>{order.length} {order.length === 1 ? 'book' : 'books'}</span>
        <div style={{ flex: 1 }} />
        {canShareFiles && <button onClick={download} style={btn(true)} title="Download"><Download size={15} /></button>}
        <button onClick={canShareFiles ? share : download} style={btn(false)} disabled={busy}>
          {canShareFiles ? <><Share2 size={14} /> Share</> : <><Download size={14} /> Download</>}
        </button>
      </div>

      <div className="share-body" style={{ flex: 1, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 20, padding: 16, justifyContent: 'center', alignItems: 'flex-start' }}>
        <div className="share-preview" style={{ flex: '1 1 360px', display: 'flex', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', height: '100%', minHeight: 0, position: 'sticky', top: 0 }}>
          <div style={{ position: 'relative', lineHeight: 0 }}>
            <canvas ref={canvasRef} width={size.w} height={size.h}
              style={{ maxWidth: '100%', maxHeight: 'min(74vh, 900px)', width: 'auto', height: 'auto', aspectRatio: `${size.w} / ${size.h}`, borderRadius: 6, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', background: '#fff' }} />
            {busy && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#999', lineHeight: 1.4 }}>Loading covers…</div>}
          </div>
        </div>

        <div className="share-controls" style={{ flex: '1 1 300px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <Section label="Books" hint={order.length > 1 ? 'Drag to reorder' : undefined}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 2px 6px' }}>
              {order.map((b, i) => (
                <div key={b.id} data-strip={i}
                  onPointerDown={onStripDown(i)} onPointerMove={onStripMove} onPointerUp={onStripUp} onPointerCancel={onStripUp}
                  style={{ position: 'relative', flexShrink: 0, width: 54, touchAction: 'none', cursor: order.length > 1 ? 'grab' : 'default', userSelect: 'none' }}>
                  <div style={{ width: 54, height: 80, borderRadius: 3, overflow: 'hidden', background: '#ddd', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                    {imgs.get(b.id) && <img src={imgs.get(b.id)!.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />}
                  </div>
                  {order.length > 1 && (
                    <button onPointerDown={e => e.stopPropagation()} onClick={() => removeBook(b.id)} aria-label={`Remove ${b.title}`}
                      style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
                      <X size={12} />
                    </button>
                  )}
                  {order.length > 1 && <GripVertical size={12} style={{ position: 'absolute', bottom: 3, left: 3, color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }} />}
                </div>
              ))}
            </div>
          </Section>

          <Section label="Size">
            <Segmented value={opts.size} onChange={v => set('size', v as ShareSize)}
              items={(Object.keys(SIZES) as ShareSize[]).map(k => ({ value: k, label: SIZES[k].label, sub: SIZES[k].hint }))} />
          </Section>

          <Section label="Layout">
            <Segmented value={layout} onChange={v => set('layout', v as ShareLayout)}
              items={[
                { value: 'grid', label: 'Grid', disabled: single },
                { value: 'shelf', label: 'Shelf' },
                { value: 'feature', label: 'Feature', disabled: !single },
              ]} />
            <div style={{ fontSize: 12, color: '#999', marginTop: 6, lineHeight: 1.4 }}>
              {single ? 'Feature shows one book with its details.' : 'Feature is for a single book.'}
            </div>
          </Section>

          {layout === 'feature' && (
            <Section label="Feature">
              <Segmented value={opts.align} onChange={v => set('align', v as 'left' | 'center')}
                items={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centered' }]} />
              <Toggle label="Show synopsis" checked={opts.synopsis} onChange={v => set('synopsis', v)} />
            </Section>
          )}
          {layout === 'grid' && (
            <Section label="Grid">
              <Toggle label="Show titles and authors" checked={opts.titles} onChange={v => set('titles', v)} />
            </Section>
          )}

          <Section label="Background">
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {([['paper', '#f3eee6', 'Paper'], ['white', '#ffffff', 'White'], ['dark', '#151515', 'Dark'], ['cover', 'conic-gradient(#d9a441, #b5523b, #3f6e8c, #6b8f5a, #d9a441)', 'Cover']] as [ShareBg, string, string][]).map(([v, color, label]) => (
                <button key={v} onClick={() => set('bg', v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'center' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 22, background: color, border: '1px solid #ddd', outline: opts.bg === v ? '2px solid #1a1a1a' : 'none', outlineOffset: 2 }} />
                  <div style={{ fontSize: 11, color: opts.bg === v ? '#1a1a1a' : '#888', marginTop: 5 }}>{label}</div>
                </button>
              ))}
              {opts.bg === 'cover' && order.length > 1 && (
                // Pages through the chosen books to pick which cover sets the color.
                <div className="share-tint-picker" style={{ display: 'flex', alignItems: 'center', height: 44, marginLeft: 4 }}>
                  <TintArrow dir={-1} onClick={() => stepTint(-1)} />
                  <div title={tintBook?.title} style={{ width: 30, height: 44, borderRadius: 3, overflow: 'hidden', background: '#e5e5e5', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}>
                    {tintImg && <img src={tintImg.src} alt={tintBook ? `Color from ${tintBook.title}` : ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </div>
                  <TintArrow dir={1} onClick={() => stepTint(1)} />
                </div>
              )}
            </div>
          </Section>

          <Section label="Heading" hint="Optional">
            <input value={opts.heading} onChange={e => setOpts(o => ({ ...o, heading: e.target.value }))}
              placeholder="e.g. My favorite books of 2026" style={input} />
          </Section>

          <Section label="Footer">
            <Toggle label="Show footer" checked={opts.footerOn} onChange={v => set('footerOn', v)} />
            {opts.footerOn && (
              <>
                <input value={footer} onChange={e => onFooterChange(e.target.value)} placeholder="Your site or @handle" style={{ ...input, marginTop: 8 }} />
                <div style={{ fontSize: 12, color: '#999', marginTop: 6, lineHeight: 1.4 }}>Remembered for next time, and saved with your books when you publish.</div>
              </>
            )}
          </Section>
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          /* Preview stays put at the top; the options scroll underneath it. */
          .share-body { flex-direction: column; flex-wrap: nowrap !important; align-items: stretch !important; padding: 0 !important; gap: 0 !important; overflow: hidden !important; }
          .share-preview { position: static !important; flex: none !important; height: auto !important; padding: 12px; border-bottom: 1px solid #e2e2e2; }
          .share-preview canvas { max-height: 42vh !important; }
          .share-controls { max-width: none !important; flex: 1 1 auto !important; min-height: 0; overflow-y: auto; padding: 12px 12px max(16px, env(safe-area-inset-bottom)) !important; gap: 12px !important; }
          .share-studio input { font-size: 16px !important; }
        }
      `}</style>
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', background: '#fff',
};

const btn = (secondary: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', minHeight: 34, borderRadius: 8,
  border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: secondary ? '#f0f0f0' : '#1a1a1a', color: secondary ? '#1a1a1a' : '#fff',
});

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        {hint && <span style={{ fontSize: 12, color: '#aaa' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TintArrow({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={dir < 0 ? 'Previous cover' : 'Next cover'}
      style={{ width: 32, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#555' }}>
      <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir < 0 ? 'M7 1 1 7l6 6' : 'M2 1l6 6-6 6'} />
      </svg>
    </button>
  );
}

function Segmented({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { value: string; label: string; sub?: string; disabled?: boolean }[] }) {
  return (
    <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: 9, padding: 3, gap: 3 }}>
      {items.map(it => (
        <button key={it.value} disabled={it.disabled} onClick={() => onChange(it.value)} style={{
          flex: 1, border: 'none', borderRadius: 7, padding: '7px 4px', minHeight: 36, cursor: it.disabled ? 'default' : 'pointer',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600, lineHeight: 1.2,
          background: value === it.value ? '#fff' : 'transparent', color: it.disabled ? '#bbb' : '#1a1a1a',
          boxShadow: value === it.value ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
        }}>
          {it.label}{it.sub && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: '#999' }}>{it.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, fontSize: 14, cursor: 'pointer' }}>
      {label}
      <span onClick={e => { e.preventDefault(); onChange(!checked); }} role="switch" aria-checked={checked}
        style={{ width: 44, height: 26, borderRadius: 13, background: checked ? '#1a1a1a' : '#d5d5d5', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
      </span>
    </label>
  );
}
