// Full-screen share studio: a live preview of the share image, with options
// for size, layout, background and text, and a button to share or save it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Share2, Download, GripVertical, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { zipSync } from 'fflate';
import { isDecor, WEAR, type Book } from '../books';
import { wornCover, isWear, WEAR_OPTIONS, type Wear } from '../wear';
import { decorDefOf } from '../decor';
import { renderShare, morphShare, coverColor, SIZES, DEFAULT_OPTIONS, ShareOptions, ShareBook, ShareLayout, ShareBg, ShareSize } from './render';
import AddForShare, { isTemp } from './AddForShare';

const MAX_ITEMS = 12;

// Books and decorations added just for sharing. They last while the page is
// open (so going back to pick more books keeps them), and are never saved.
let sessionExtras: Book[] = [];
// Leaving Share Studio altogether lets them go.
export const clearShareExtras = () => { sessionExtras = []; };

// Carousel: after the main image, one feature slide for each book.
// Every feature slide shares one background: each book's own cover color,
// Paper, White, Dark, or a color you pick.
type FeatureBg = 'cover' | 'paper' | 'white' | 'dark' | 'custom';
type Carousel = { on: boolean; bg: FeatureBg; custom: string; synopsis: boolean };
const CAROUSEL_KEY = 'bookshelf.shareCarousel';
const loadCarousel = (): Carousel => {
  const d: Carousel = { on: false, bg: 'cover', custom: '#3d4a5c', synopsis: true };
  try {
    const c = { ...d, ...JSON.parse(localStorage.getItem(CAROUSEL_KEY) || '{}') };
    if (!['cover', 'paper', 'white', 'dark', 'custom'].includes(c.bg)) c.bg = 'cover';
    if (!/^#[0-9a-f]{6}$/i.test(c.custom)) c.custom = d.custom;
    return c;
  } catch { return d; }
};

const loadDirect = (url?: string): Promise<HTMLImageElement | null> => new Promise(resolve => {
  if (!url) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

// A decoration's height next to a paperback (one of yours added just for
// sharing carries it itself).
const decorHeight = (b: Book) => isDecor(b) ? decorDefOf(b)?.height ?? b.height ?? 0.5 : undefined;

const OPTIONS_KEY = 'bookshelf.shareOptions';

const loadOptions = (): ShareOptions => {
  // Wear starts as the shelf's own setting until you pick one here.
  const base = { ...DEFAULT_OPTIONS, wear: WEAR };
  try {
    const o = { ...base, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}'), heading: '' };
    if (!isWear(o.wear)) o.wear = WEAR;
    return o;
  }
  catch { return base; }
};

interface Props {
  books: Book[];
  loadCover: (b: Book) => Promise<HTMLImageElement | null>;
  footer: string;
  onFooterChange: (text: string) => void;
  onClose: (order: Book[]) => void;
  toast: (msg: string) => void;
  gbKey: string;
  summarize?: (text: string) => Promise<string>;
}

export default function ShareStudio({ books, loadCover, footer, onFooterChange, onClose, toast, gbKey, summarize }: Props) {
  const [order, setOrder] = useState<Book[]>(() => [...books, ...sessionExtras].slice(0, MAX_ITEMS));
  const [adding, setAdding] = useState(false);
  const [carousel, setCarouselState] = useState<Carousel>(loadCarousel);
  const setCarousel = (patch: Partial<Carousel>) => setCarouselState(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(CAROUSEL_KEY, JSON.stringify(next)); } catch {}
    return next;
  });
  const [slide, setSlide] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [outputs, setOutputs] = useState<{ file: File; url: string }[] | null>(null);
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

  // Cover images, loaded as items join the set.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const missing = order.filter(b => !requested.current.has(b.id));
    if (!missing.length) { setBusy(false); return; }
    missing.forEach(b => requested.current.add(b.id));
    (async () => {
      const entries = await Promise.all(missing.map(async b => [b.id,
        // Built-in decorations load like any other; your own temporary things
        // come from the picture you just picked.
        await (isTemp(b) && (isDecor(b) ? b.decor === 'custom' : true) ? loadDirect(isDecor(b) ? b.src : b.coverUrl) : loadCover(b)).catch(() => null)] as const));
      setImgs(prev => { const next = new Map(prev); entries.forEach(([id, img]) => next.set(id, img)); return next; });
      setBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // Worn copies of the covers, made when Wear is on.
  const [worn, setWorn] = useState<Map<string, HTMLImageElement>>(() => new Map());
  useEffect(() => {
    if (opts.wear === 'off') return;
    let cancelled = false;
    const todo = order.filter(b => !isDecor(b) && imgs.get(b.id) && !worn.has(`${b.id}|${opts.wear}`));
    if (!todo.length) return;
    Promise.all(todo.map(async b => [`${b.id}|${opts.wear}`, await wornCover(imgs.get(b.id)!, b.title, b.author, opts.wear)] as const)).then(entries => {
      if (cancelled) return;
      setWorn(prev => { const next = new Map(prev); entries.forEach(([k, v]) => next.set(k, v)); return next; });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, imgs, opts.wear]);
  const coverOf = (b: Book) => (opts.wear !== 'off' && !isDecor(b) && worn.get(`${b.id}|${opts.wear}`)) || imgs.get(b.id) || null;

  const shareBooks: ShareBook[] = order.map(b => ({
    title: b.title, author: b.author, year: b.year, synopsis: b.synopsis, img: coverOf(b),
    decor: decorHeight(b),
  }));
  // Carousel slides: the main image, then a feature for each book in it.
  const features = order.filter(b => !isDecor(b));
  const single = order.length === 1;
  // One book in a grid is a feature. Feature with several books is a set of
  // features, one slide per book (decorations left out); with only
  // decorations it falls back to a grid.
  const layout: ShareLayout = single && opts.layout === 'grid' ? 'feature' : !single && opts.layout === 'feature' && !features.length ? 'grid' : opts.layout;
  const featureSet = layout === 'feature' && !single;
  const carouselOn = featureSet || (carousel.on && order.length > 1 && features.length > 0);
  const slideCount = featureSet ? features.length : carouselOn ? 1 + features.length : 1;
  const current = Math.min(slide, slideCount - 1);

  const tintIndex = Math.max(0, order.findIndex(b => b.id === tintId));
  const tintBook = order[tintIndex];
  const tintImg = tintBook ? imgs.get(tintBook.id) ?? null : null;
  const stepTint = (d: number) => {
    if (!order.length) return;
    setTintId(order[(tintIndex + d + order.length) % order.length].id);
  };

  // Redraw whenever anything changes. A change of layout, order, alignment or
  // titles glides the covers to their new places; anything else redraws at once.
  const lastDrawn = useRef<{ books: ShareBook[]; opts: ShareOptions; tint: string } | null>(null);
  const stopMorph = useRef<(() => void) | null>(null);
  // A layout effect, so a size change never paints an empty canvas first.
  useLayoutEffect(() => {
    if (busy || !fontsReady || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const tint = opts.bg === 'cover' ? coverColor(tintImg) : null;
    const next = { ...opts, layout, footer };
    if (featureSet || current > 0) {
      // A feature slide: drawn straight away (no glide).
      stopMorph.current?.();
      stopMorph.current = null;
      lastDrawn.current = null;
      const s = slideAt(current);
      canvas.style.aspectRatio = `${SIZES[next.size].w} / ${SIZES[next.size].h}`;
      renderShare(canvas, s.books, s.opts, s.tint);
      blobRef.current = null;
      return;
    }
    const prev = lastDrawn.current;
    const same = (a: ShareBook[], b: ShareBook[]) => a.length === b.length && a.every((x, i) => x.img === b[i].img && x.title === b[i].title);
    // Nothing that shows has changed (a re-render): leave the canvas, and any
    // glide in progress, alone.
    if (prev && JSON.stringify(prev.opts) === JSON.stringify(next) && prev.tint === String(tint) && same(prev.books, shareBooks)) return;
    lastDrawn.current = { books: shareBooks, opts: next, tint: String(tint) };
    stopMorph.current?.();
    stopMorph.current = null;
    const saveBlob = () => { blobRef.current = null; canvas.toBlob(b => { blobRef.current = b; }, 'image/jpeg', 0.92); };
    const moved = prev && prev.opts.bg === next.bg && (
      prev.opts.size !== next.size || prev.opts.layout !== next.layout || prev.opts.align !== next.align || prev.opts.titles !== next.titles
      || !same(prev.books, shareBooks));
    if (!moved || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      canvas.style.aspectRatio = `${SIZES[next.size].w} / ${SIZES[next.size].h}`;
      renderShare(canvas, shareBooks, next, tint);
      saveBlob();
      return;
    }
    blobRef.current = null;
    stopMorph.current = morphShare(canvas, prev!.books, prev!.opts, shareBooks, next, tint, 480, () => { stopMorph.current = null; saveBlob(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, fontsReady, order, opts, footer, imgs, worn, tintImg, current, carouselOn, carousel]);
  useEffect(() => () => stopMorph.current?.(), []);

  // What slide i shows: 0 is the main image, then one feature per book.
  function slideAt(i: number): { books: ShareBook[]; opts: ShareOptions; tint: [number, number, number] | null } {
    const main = { ...opts, layout, footer };
    if (featureSet) {
      // Every slide is a feature with the main options. The heading goes on
      // the first; Cover takes each book's own color.
      const sb = shareBooks[order.indexOf(features[i])];
      return {
        books: [sb],
        opts: { ...main, layout: 'feature', heading: i === 0 ? opts.heading : '' },
        tint: opts.bg === 'cover' ? coverColor(sb.img) : null,
      };
    }
    const mainTint = opts.bg === 'cover' ? coverColor(tintImg) : null;
    if (i === 0) return { books: shareBooks, opts: main, tint: mainTint };
    const b = features[i - 1];
    const sb = shareBooks[order.indexOf(b)];
    // A picked color is drawn like a cover color: the text turns light or
    // dark to suit it.
    const fb = carousel.bg;
    const tint = fb === 'cover' ? coverColor(sb.img) : null;
    return {
      books: [sb],
      opts: { ...main, layout: 'feature', heading: '', synopsis: carousel.synopsis, bg: fb, custom: carousel.custom },
      tint,
    };
  }

  const slideBlob = (i: number) => new Promise<Blob | null>(resolve => {
    const c = document.createElement('canvas');
    const s = slideAt(i);
    renderShare(c, s.books, s.opts, s.tint);
    c.toBlob(resolve, 'image/jpeg', 0.92);
  });

  // Every slide, in order, as files.
  const allFiles = async (): Promise<File[]> => {
    const files: File[] = [];
    for (let i = 0; i < slideCount; i++) {
      const blob = await slideBlob(i);
      if (blob) files.push(new File([blob], `bookshelf-${opts.size}-${i + 1}.jpg`, { type: 'image/jpeg' }));
    }
    return files;
  };

  const downloadFile = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const getBlob = async () => blobRef.current
    || await new Promise<Blob | null>(r => canvasRef.current ? canvasRef.current.toBlob(r, 'image/jpeg', 0.92) : r(null));

  const fileName = () => `bookshelf-${opts.size}.jpg`;

  // A carousel opens a sheet with every image and a Save button for each.
  const openOutputs = async () => {
    setExporting(true);
    const files = await allFiles();
    setExporting(false);
    setOutputs(files.map(file => ({ file, url: URL.createObjectURL(file) })));
  };
  const closeOutputs = () => {
    outputs?.forEach(o => URL.revokeObjectURL(o.url));
    setOutputs(null);
  };
  // One image: the share sheet where there is one (Save Image on an
  // iPhone), otherwise a download.
  const saveOne = async (file: File) => {
    if (canShareFiles) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e: any) { if (e?.name === 'AbortError') return; }
    }
    downloadFile(file, file.name);
  };
  const shareAll = async () => {
    if (!outputs) return;
    try { await navigator.share({ files: outputs.map(o => o.file) }); }
    catch (e: any) { if (e?.name !== 'AbortError') toast('Couldn\u2019t open sharing. Save them one by one instead.'); }
  };
  // On a computer, all of them at once come as one zip, in slide order.
  const zipAll = () => {
    if (!outputs) return;
    Promise.all(outputs.map(async o => [o.file.name, new Uint8Array(await o.file.arrayBuffer())] as const)).then(list => {
      downloadFile(new Blob([zipSync(Object.fromEntries(list), { level: 0 })], { type: 'application/zip' }), `bookshelf-carousel-${opts.size}.zip`);
    });
  };

  const download = async () => {
    const blob = await getBlob();
    if (!blob) return;
    downloadFile(blob, fileName());
  };

  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare
    && navigator.canShare({ files: [new File([new Blob()], 'x.jpg', { type: 'image/jpeg' })] });

  const share = async () => {
    const blob = await getBlob();
    if (!blob) return;
    const files = [new File([blob], fileName(), { type: 'image/jpeg' })];
    try { await navigator.share({ files }); }
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
  const removeBook = (id: string) => setOrder(prev => prev.filter(b => b.id !== id));
  const addItem = (b: Book) => setOrder(prev => prev.length < MAX_ITEMS ? [...prev, b] : prev);
  const close = () => {
    sessionExtras = order.filter(isTemp);
    onClose(order.filter(b => !isTemp(b)));
  };

  const size = SIZES[opts.size];

  return (
    <div className="share-studio" style={{
      position: 'fixed', inset: 0, zIndex: 10001, background: '#efefef', display: 'flex', flexDirection: 'column',
      fontFamily: 'Manrope, system-ui, sans-serif', color: '#1a1a1a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', paddingTop: 'max(10px, env(safe-area-inset-top))', background: '#fff', borderBottom: '1px solid #e5e5e5' }}>
        <button onClick={close} style={btn(true)} aria-label="Back to picking books"><ChevronLeft size={16} /></button>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Share Studio</span>
        <span style={{ fontSize: '0.75rem', color: '#999' }}>{order.length} {order.length === 1 ? 'book' : 'books'}</span>
        <div style={{ flex: 1 }} />
        {canShareFiles && !carouselOn && <button onClick={download} style={btn(true)} title="Download"><Download size={15} /></button>}
        <button onClick={carouselOn ? openOutputs : canShareFiles ? share : download} style={{ ...btn(false), ...(busy || exporting || !order.length ? { opacity: 0.5 } : {}) }} disabled={busy || exporting || !order.length}>
          {carouselOn ? <><Download size={14} /> Save {slideCount} images</> : canShareFiles ? <><Share2 size={14} /> Share</> : <><Download size={14} /> Download</>}
        </button>
      </div>

      <div className="share-body" style={{ flex: 1, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 20, padding: 16, justifyContent: 'center', alignItems: 'flex-start' }}>
        <div className="share-preview" style={{ flex: '1 1 360px', display: 'flex', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', height: '100%', minHeight: 0, position: 'sticky', top: 0 }}>
          <div style={{ position: 'relative', lineHeight: 0 }}>
            <canvas ref={canvasRef} width={size.w} height={size.h}
              style={{ maxWidth: '100%', maxHeight: 'min(74vh, 900px)', width: 'auto', height: 'auto', aspectRatio: `${size.w} / ${size.h}`, borderRadius: 6, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', background: '#fff' }} />
            {busy && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#999', lineHeight: 1.4 }}>Loading covers…</div>}
            {!busy && !order.length && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#999', lineHeight: 1.4 }}>Add a book to begin</div>}
            {slideCount > 1 && (
              <div className="share-slides" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, lineHeight: 1 }}>
                <button onClick={() => setSlide((current - 1 + slideCount) % slideCount)} style={navBtn} aria-label="Previous slide"><ChevronLeft size={16} /></button>
                {Array.from({ length: slideCount }, (_, i) => (
                  <button key={i} onClick={() => setSlide(i)} aria-label={`Slide ${i + 1}`} style={{ width: 22, height: 32, border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: i === current ? '#1a1a1a' : '#c4c4c4' }} />
                  </button>
                ))}
                <button onClick={() => setSlide((current + 1) % slideCount)} style={navBtn} aria-label="Next slide"><ChevronRight size={16} /></button>
              </div>
            )}
          </div>
        </div>

        <div className="share-controls" style={{ flex: '1 1 300px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <Section label="Books" hint={order.some(isTemp) ? 'Dashed ones are just for sharing' : order.length > 1 ? 'Drag to reorder' : undefined}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 8px 6px 2px' }}>
              {order.map((b, i) => (
                <div key={b.id} data-strip={i}
                  onPointerDown={onStripDown(i)} onPointerMove={onStripMove} onPointerUp={onStripUp} onPointerCancel={onStripUp}
                  style={{ position: 'relative', flexShrink: 0, width: 54, touchAction: 'none', cursor: order.length > 1 ? 'grab' : 'default', userSelect: 'none',
                    ...(isTemp(b) ? { outline: '1.5px dashed #8a8a8a', outlineOffset: 3, borderRadius: 3 } : {}) }}>
                  {isDecor(b) ? (
                    // A decoration at its size next to a paperback, standing on the bottom.
                    <div style={{ width: 54, height: 80, borderRadius: 3, overflow: 'hidden', background: '#f6f5f2', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      {imgs.get(b.id) && <img src={imgs.get(b.id)!.src} alt="" draggable={false} style={{ height: `${(decorHeight(b) ?? 0.5) * 100}%`, maxWidth: '100%', objectFit: 'contain', objectPosition: 'bottom', display: 'block', pointerEvents: 'none' }} />}
                    </div>
                  ) : (
                    <div style={{ width: 54, height: 80, borderRadius: 3, overflow: 'hidden', background: '#ddd', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                      {imgs.get(b.id) && <img src={imgs.get(b.id)!.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />}
                    </div>
                  )}
                  {(order.length > 1 || isTemp(b)) && (
                    <button onPointerDown={e => e.stopPropagation()} onClick={() => removeBook(b.id)} aria-label={`Remove ${b.title}`}
                      style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
                      <X size={12} />
                    </button>
                  )}
                  {order.length > 1 && <GripVertical size={12} style={{ position: 'absolute', bottom: 3, left: 3, color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }} />}
                </div>
              ))}
              {order.length < MAX_ITEMS && (
                <button onClick={() => setAdding(true)} aria-label="Add just for sharing" title="Add just for sharing"
                  style={{ flexShrink: 0, width: 54, height: 80, borderRadius: 3, border: '1.5px dashed #bbb', background: '#fafafa', color: '#777', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit', fontSize: 10, fontWeight: 600, padding: 0 }}>
                  <Plus size={18} />Add
                </button>
              )}
            </div>
          </Section>

          <Section label="Size">
            <Segmented value={opts.size} onChange={v => set('size', v as ShareSize)}
              items={(Object.keys(SIZES) as ShareSize[]).map(k => ({ value: k, label: SIZES[k].label, sub: SIZES[k].hint }))} />
          </Section>

          <Section label="Layout">
            <Segmented value={layout} onChange={v => { set('layout', v as ShareLayout); setSlide(0); }}
              items={[
                { value: 'grid', label: 'Grid', disabled: single },
                { value: 'shelf', label: 'Vitsoe' },
                { value: 'billy', label: 'Billy' },
                { value: 'feature', label: 'Feature', disabled: !features.length },
              ]} />
            <div style={{ fontSize: 12, color: '#999', marginTop: 6, lineHeight: 1.4 }}>
              {single ? 'Feature shows one book with its details.'
                : featureSet ? `Each book gets its own slide, ${slideCount} in all.${features.length < order.length ? ' Decorations are left out.' : ''}`
                : 'Feature gives each book a slide of its own.'}
            </div>
          </Section>

          <Section label="Wear">
            <Segmented value={opts.wear} onChange={v => set('wear', v as Wear)} items={WEAR_OPTIONS} />
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

          <Section label="Background" hint={featureSet ? 'Every image' : carouselOn ? 'First image' : undefined}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {([['paper', '#f3eee6', 'Paper'], ['white', '#ffffff', 'White'], ['dark', '#151515', 'Dark'], ['cover', 'conic-gradient(#d9a441, #b5523b, #3f6e8c, #6b8f5a, #d9a441)', featureSet ? 'Each cover' : 'Cover']] as [ShareBg, string, string][]).map(([v, color, label]) => (
                <button key={v} onClick={() => set('bg', v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'center' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 22, background: color, border: '1px solid #ddd', outline: opts.bg === v ? '2px solid #1a1a1a' : 'none', outlineOffset: 2 }} />
                  <div style={{ fontSize: 11, color: opts.bg === v ? '#1a1a1a' : '#888', marginTop: 5 }}>{label}</div>
                </button>
              ))}
              {/* Your own color: tapping the swatch opens the color picker. */}
              <label style={{ cursor: 'pointer', textAlign: 'center', position: 'relative' }} onClick={() => set('bg', 'custom')}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: opts.custom, border: '1px solid #ddd', outline: opts.bg === 'custom' ? '2px solid #1a1a1a' : 'none', outlineOffset: 2 }} />
                <div style={{ fontSize: 11, color: opts.bg === 'custom' ? '#1a1a1a' : '#888', marginTop: 5 }}>Custom</div>
                <input type="color" value={opts.custom} aria-label="Custom background color"
                  onChange={e => { set('custom', e.target.value); set('bg', 'custom'); }}
                  style={{ position: 'absolute', top: 0, left: 0, width: 44, height: 44, opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }} />
              </label>
              {opts.bg === 'cover' && order.length > 1 && !featureSet && (
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

          {order.length > 1 && features.length > 0 && !featureSet && (
            <Section label="Carousel" hint={carouselOn ? `${slideCount} images` : undefined}>
              <Toggle label="Add a slide for each book" checked={carousel.on} onChange={v => { setCarousel({ on: v }); setSlide(0); }} />
              {carouselOn && (
                <>
                  <div style={{ fontSize: 12, color: '#999', margin: '8px 0 10px', lineHeight: 1.4 }}>
                    After this image, each book gets its own feature. Decorations stay in the first one.
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>Feature background</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {([['cover', 'conic-gradient(#d9a441, #b5523b, #3f6e8c, #6b8f5a, #d9a441)', 'Each cover'], ['paper', '#f3eee6', 'Paper'], ['white', '#ffffff', 'White'], ['dark', '#151515', 'Dark']] as [FeatureBg, string, string][]).map(([v, color, label]) => (
                      <button key={v} onClick={() => setCarousel({ bg: v })} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'center' }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: color, border: '1px solid #ddd', outline: carousel.bg === v ? '2px solid #1a1a1a' : 'none', outlineOffset: 2 }} />
                        <div style={{ fontSize: 11, color: carousel.bg === v ? '#1a1a1a' : '#888', marginTop: 5 }}>{label}</div>
                      </button>
                    ))}
                    {/* Your own color: tapping the swatch opens the color picker. */}
                    <label style={{ cursor: 'pointer', textAlign: 'center', position: 'relative' }} onClick={() => setCarousel({ bg: 'custom' })}>
                      <div style={{ width: 40, height: 40, borderRadius: 20, background: carousel.custom, border: '1px solid #ddd', outline: carousel.bg === 'custom' ? '2px solid #1a1a1a' : 'none', outlineOffset: 2 }} />
                      <div style={{ fontSize: 11, color: carousel.bg === 'custom' ? '#1a1a1a' : '#888', marginTop: 5 }}>Custom</div>
                      <input type="color" value={carousel.custom} aria-label="Custom feature background color"
                        onChange={e => setCarousel({ bg: 'custom', custom: e.target.value })}
                        style={{ position: 'absolute', top: 0, left: 0, width: 40, height: 40, opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }} />
                    </label>
                  </div>
                  <Toggle label="Show synopsis" checked={carousel.synopsis} onChange={v => setCarousel({ synopsis: v })} />
                  <div style={{ marginTop: 10 }}>
                    <Segmented value={opts.align} onChange={v => set('align', v as 'left' | 'center')}
                      items={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centered' }]} />
                  </div>
                </>
              )}
            </Section>
          )}

          <Section label="Heading" hint={featureSet ? 'Optional, on the first image' : 'Optional'}>
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

      {outputs && (
        <div className="share-outputs" style={{ position: 'fixed', inset: 0, zIndex: 10002, background: '#efefef', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', paddingTop: 'max(10px, env(safe-area-inset-top))', background: '#fff', borderBottom: '1px solid #e5e5e5' }}>
            <button onClick={closeOutputs} style={btn(true)} aria-label="Back to editing"><ChevronLeft size={16} /></button>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{outputs.length} images</span>
            <div style={{ flex: 1 }} />
            {canShareFiles
              ? <button onClick={shareAll} style={btn(false)}><Share2 size={14} /> Share all</button>
              : <button onClick={zipAll} style={btn(false)}><Download size={14} /> Download all (zip)</button>}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
            <div style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 14, lineHeight: 1.4 }}>
              In carousel order. {canShareFiles ? 'Save opens the share sheet, where you can tap Save Image.' : 'Save downloads that image.'}
            </div>
            <div className="share-outputs-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, maxWidth: 1100, margin: '0 auto' }}>
              {outputs.map((o, i) => (
                <div key={o.url} style={{ background: '#fff', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <img src={o.url} alt={`Image ${i + 1}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: '#888' }}>{i + 1} of {outputs.length}</span>
                    <button onClick={() => saveOne(o.file)} style={btn(false)}><Download size={14} /> Save</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {adding && <AddForShare gbKey={gbKey} summarize={summarize} onAdd={addItem} onClose={() => setAdding(false)} toast={toast} />}

      <style>{`
        @media (max-width: 700px) {
          /* Preview stays put at the top; the options scroll underneath it. */
          .share-body { flex-direction: column; flex-wrap: nowrap !important; align-items: stretch !important; padding: 0 !important; gap: 0 !important; overflow: hidden !important; }
          .share-preview { position: static !important; flex: none !important; height: auto !important; align-self: stretch !important; padding: 12px; }
          .share-preview canvas { max-height: 42vh !important; }
          .share-controls { max-width: none !important; flex: 1 1 auto !important; min-height: 0; overflow-y: auto; padding: 12px 12px max(16px, env(safe-area-inset-bottom)) !important; gap: 12px !important; }
          .share-studio input, .share-add input, .share-add textarea { font-size: 16px !important; }
          .share-slides { margin-top: 6px !important; }
          .share-outputs-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
        }
      `}</style>
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', background: '#fff',
};

const navBtn: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none',
  borderRadius: 8, cursor: 'pointer', padding: 0, color: '#555',
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
