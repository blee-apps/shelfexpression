import { useState, useEffect, useRef, useCallback, useSyncExternalStore, lazy, Suspense } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Book, BOOKS, USE_VITSOE_SHELF, COLOR_MODE } from './src/books';
import { SITE, coverInfo, EDITOR_AVAILABLE } from './src/shelfData';

const AdminGate = lazy(() => import('./src/AdminGate'));


// --- UTILITIES ---
const hashString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
};

const getColorForString = (str: string) => `hsl(${hashString(str) % 360}, 40%, 26%)`;

// Each book always tilts the same way when hovered (between -7° and 7°, never flat),
// so moving the mouse off and back on doesn't make it wobble to a new angle.
export const getTiltAngle = (book: Book) => {
  const h = hashString(book.title + book.id);
  const mag = 3 + (h % 5);           // 3..7 degrees
  return h % 2 === 0 ? mag : -mag;
};

// Shared motion presets, so every animation feels like part of the same system.
export const MOTION = {
  move: 'cubic-bezier(0.22, 1, 0.36, 1)',   // things travelling somewhere (ease-out)
  exit: 'cubic-bezier(0.4, 0, 1, 1)',       // things leaving (ease-in)
  openMs: 520,
  closeMs: 420,
  navMs: 450,
  hoverMs: 350,
  hover: 'cubic-bezier(0.4, 0, 0.2, 1)',     // the original gentle pick-up easing
};

// --- COVER CACHES (shared with the admin tool) ---
// coverCache: the image URL each book ended up using.
export const coverCache = new Map<string, string>();
export const aspectRatioCache = new Map<string, number>();
export const fetchingSet = new Set<string>();

// Tiny store so components re-render when a cover's size becomes known.
const coverStore = {
  version: 0,
  listeners: new Set<() => void>(),
  subscribe: (listener: () => void) => {
    coverStore.listeners.add(listener);
    return () => coverStore.listeners.delete(listener);
  },
  getSnapshot: () => coverStore.version,
  notify: () => {
    coverStore.version++;
    coverStore.listeners.forEach(fn => fn());
  },
};

const gbKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY || '';
const gbUrl = (path: string) => path + (gbKey ? `&key=${gbKey}` : '');
const MIN_COVER_HEIGHT = 300;
const LOOKUP_TIMEOUT_MS = 3000;

const manifestEntry = (book: Book) => coverInfo(book);

// Covers we already have a URL for: the book's own coverUrl, then the copy
// downloaded at build time. No network lookups needed.
const knownCoverUrls = (book: Book) => {
  const urls: string[] = [];
  if (book.coverUrl) urls.push(book.coverUrl);
  const local = manifestEntry(book)?.path;
  if (local && !urls.includes(local)) urls.push(local);
  return urls;
};

// Last resort for a book with no known cover: ask OpenLibrary / Google Books.
// Each lookup gives up after a few seconds.
const lookupCoverUrls = async (book: Book): Promise<string[]> => {
  const urls: string[] = [];
  const signal = () => AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}&limit=1`, { signal: signal() });
    const coverI = (await res.json()).docs?.[0]?.cover_i;
    if (coverI) urls.push(`https://covers.openlibrary.org/b/id/${coverI}-L.jpg`);
  } catch {}
  if (book.isbn) {
    urls.push(`https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`);
    urls.push(`https://covers.goodreads.com/bisbn/${book.isbn}-L.jpg`);
  }
  try {
    const res = await fetch(gbUrl(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}`), { signal: signal() });
    if (res.status !== 429) {
      const thumb = (await res.json()).items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
      if (thumb) urls.push(thumb.replace('zoom=1', 'zoom=2').replace('http:', 'https:'));
    }
  } catch {}
  return urls;
};

// --- COVER HOOK ---
// Shows the gallery immediately: each cover is a normal lazy-loaded <img> that
// fades in when ready. If a URL fails (or is a tiny placeholder), try the next.
const useBookCover = (book: Book) => {
  const [candidates, setCandidates] = useState<string[]>(() => {
    const cached = coverCache.get(book.id);
    const known = knownCoverUrls(book);
    return cached && !cached.startsWith('blob:') && !known.includes(cached) ? [cached, ...known] : known;
  });
  const [index, setIndex] = useState(0);
  // Already shown elsewhere (e.g. on the shelf)? Then it's in the browser's
  // cache, so show it straight away instead of fading in again.
  const [loaded, setLoaded] = useState(() => !!coverCache.get(book.id) && coverCache.get(book.id) === candidates[0]);
  const [lookedUp, setLookedUp] = useState(false);

  const bookKey = `${book.id}|${book.coverUrl || ''}|${book.isbn || ''}`;
  const prevKey = useRef(bookKey);
  useEffect(() => {
    if (prevKey.current === bookKey) return;
    prevKey.current = bookKey;
    setCandidates(knownCoverUrls(book));
    setIndex(0);
    setLoaded(false);
    setLookedUp(false);
  }, [bookKey]);

  const exhausted = index >= candidates.length;

  // Ran out of known URLs: look further afield, once.
  useEffect(() => {
    if (!exhausted || lookedUp) return;
    let cancelled = false;
    setLookedUp(true);
    lookupCoverUrls(book).then(urls => {
      if (cancelled) return;
      const fresh = urls.filter(u => !candidates.includes(u));
      if (fresh.length) setCandidates(prev => [...prev, ...fresh]);
    });
    return () => { cancelled = true; };
  }, [exhausted, lookedUp]);

  const url = exhausted ? null : candidates[index];

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const isLast = index >= candidates.length - 1 && lookedUp;
    if (img.naturalHeight < MIN_COVER_HEIGHT && !isLast) { setIndex(i => i + 1); return; }
    coverCache.set(book.id, img.currentSrc || img.src);
    const ratio = img.naturalWidth / img.naturalHeight;
    if (!manifestEntry(book)?.aspectRatio && Math.abs((aspectRatioCache.get(book.id) || 0) - ratio) > 0.005) {
      aspectRatioCache.set(book.id, ratio);
      coverStore.notify();
    }
    setLoaded(true);
  };
  const onError = () => { setLoaded(false); setIndex(i => i + 1); };

  return { url, loaded, failed: exhausted && lookedUp, onLoad, onError };
};

const useBookAspectRatio = (book: Book) => {
  useSyncExternalStore(coverStore.subscribe, coverStore.getSnapshot);
  const local = manifestEntry(book);
  if (local?.aspectRatio) return local.aspectRatio;
  return aspectRatioCache.get(book.id) || 2/3;
};

// --- COMPONENTS ---
const DynamicCover = ({ book, eager = false }: { book: Book; eager?: boolean }) => {
  const { url, loaded, failed, onLoad, onError } = useBookCover(book);
  const aspectRatio = useBookAspectRatio(book);

  return (
    <div className="relative w-full" style={{ aspectRatio, backgroundColor: failed ? getColorForString(book.title) : 'transparent' }}>
      {/* Holding shape while the cover loads: a dotted outline of the book */}
      {!loaded && !failed && (
        <div aria-hidden className="absolute inset-0 rounded-xs border-2 border-dotted border-black/30 dark:border-white/30" />
      )}
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding={eager ? 'sync' : 'async'}
          onLoad={onLoad}
          onError={onError}
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col justify-between p-5 border border-white/10 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
          <span className="font-serif text-white text-2xl leading-tight drop-shadow-md z-10">{book.title}</span>
        </div>
      )}
    </div>
  );
};

// Tracks the window size so layouts switch between mobile and desktop on
// resize or rotation, not just on first load.
const useViewport = () => {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return vp;
};

// --- COLOR MODE ---
// True when the site should be dark: always, never, or following the
// visitor's device setting when the mode is 'auto'.
const useDarkMode = () => {
  const query = '(prefers-color-scheme: dark)';
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    if (COLOR_MODE !== 'auto') return;
    const mq = window.matchMedia(query);
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = COLOR_MODE === 'dark' || (COLOR_MODE === 'auto' && systemDark);
  // The page behind the app (seen when scrolling past the ends) and the browser chrome match.
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.style.background = dark ? '#121212' : '#FDFDFD';
  }, [dark]);
  return dark;
};

// --- SHELF STRUCTURE (Vitsoe 606-style, purely decorative) ---

// Measures the books grid rows and the grid's own offsetTop from its parent
const useShelfRows = (gridRef: React.RefObject<HTMLDivElement | null>, animState: string) => {
  const [state, setState] = useState<{
    rows: { top: number; bottom: number }[];
    gridOffsetTop: number;
    gridHeight: number;
  }>({ rows: [], gridOffsetTop: 0, gridHeight: 0 });

  useEffect(() => {
    const compute = () => {
      if (animState !== 'idle') return;
      const grid = gridRef.current;
      if (!grid) return;
      const children = Array.from(grid.children) as HTMLElement[];
      if (children.length === 0) return;

      // Position of the grid relative to its offsetParent (the relative wrapper)
      const gridOffsetTop = grid.offsetTop;
      const gridHeight = grid.offsetHeight;

      const ROW_TOLERANCE = 4; // px — handles sub-pixel rendering differences
      const seen: { top: number; bottom: number }[] = [];
      const containerTop = grid.getBoundingClientRect().top;

      children.forEach((child) => {
        const r = child.getBoundingClientRect();
        const rowTop = r.top - containerTop;
        const rowBottom = r.bottom - containerTop;

        // Find an existing row within tolerance, otherwise start a new one
        const existing = seen.find(s => Math.abs(s.top - rowTop) < ROW_TOLERANCE);
        if (existing) {
          existing.bottom = Math.max(existing.bottom, rowBottom);
        } else {
          seen.push({ top: rowTop, bottom: rowBottom });
        }
      });

      const next = { rows: seen.sort((a, b) => a.top - b.top), gridOffsetTop, gridHeight };
      // Only re-render when the shelf rows actually moved.
      setState(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };

    compute();
    const ro = new ResizeObserver(compute);
    if (gridRef.current) ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [gridRef, animState]);

  return state;
};

const ShelfStructure = ({ gridRef, animState }: { gridRef: React.RefObject<HTMLDivElement | null>; animState: string }) => {
  const { rows, gridOffsetTop } = useShelfRows(gridRef, animState);

  if (rows.length === 0) return null;

  // The wall sits behind the grid, a little wider than it. Aluminium tracks
  // run up each side (and down the middle on wider screens, making two bays),
  // and a thin steel shelf hangs in front of them under every row of books.
  const PAD = 24;

  return (
    <div
      className="shelf-wall"
      style={{ top: gridOffsetTop - PAD, left: -PAD, right: -PAD }}
      aria-hidden="true"
    >
      <div className="shelf-track" style={{ left: 10 }} />
      <div className="shelf-track shelf-track-mid" />
      <div className="shelf-track" style={{ right: 10 }} />

      {rows.map((row, i) => (
        // row.bottom is in grid coordinates; +PAD converts to wall coordinates.
        // The shelf's top edge tucks 2px behind the books so they sit on it.
        // A 606 shelf's front lip is about a tenth the height of a book. Above
        // the lip we see a strip of the shelf's top surface; the books stand
        // on its front half, so the back half shows behind them.
        (() => {
          const lip = Math.round(Math.min(34, Math.max(16, (row.bottom - row.top) * 0.08)));
          const surface = Math.round(lip * 0.4);
          return (
            <div
              key={`shelf-${i}`}
              className="shelf"
              style={{ top: row.bottom + PAD - Math.round(surface * 0.55), height: lip + surface, '--surface': `${surface}px` } as React.CSSProperties}
            />
          );
        })()
      ))}
    </div>
  );
};

type Pose = { x: number; y: number; rot: number; scale: number };
const poseTransform = (p: Pose) =>
  `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${p.rot}deg) scale(${p.scale})`;

// Forces the browser to register an element's starting position before we
// change it, so the transition always plays instead of jumping to the end.
const commitStyles = (el: Element | null) => { el?.getBoundingClientRect(); };

const HOVER_LIFT = 0.2;    // lift by 20% of the cover height
const HOVER_SCALE = 1.08;

export default function App() {
  const dark = useDarkMode();

  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const [animState, setAnimState] = useState<'idle' | 'opening' | 'open' | 'closing'>('idle');
  const [showAdmin, setShowAdmin] = useState(false);
  const [closingFade, setClosingFade] = useState(false);
  // Minimal layout: the cover under the mouse or trackpad grows gently.
  const [grownId, setGrownId] = useState<string | null>(null);
  const [navBook, setNavBook] = useState<Book | null>(null);
  const [navPhase, setNavPhase] = useState<'exit' | 'enter' | null>(null);
  const [navDir, setNavDir] = useState<'next' | 'prev'>('next');
  const [exitReady, setExitReady] = useState(false);
  const [enterReady, setEnterReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const vp = useViewport();
  const isMobile = vp.w < 768;
  const targetScale = isMobile ? 1.45 : 1.65;
  const shelfRefs = useRef<Record<string, HTMLElement | null>>({});
  const shadowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const bookElRef = useRef<HTMLDivElement | null>(null);
  const navElRef = useRef<HTMLDivElement | null>(null);
  const navTargetRef = useRef<Book | null>(null);
  const pendingNavRef = useRef<'prev' | 'next' | null>(null);
  const startPoseRef = useRef<Pose | null>(null);
  const titleTapRef = useRef({ count: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const navExitRectRef = useRef<DOMRect | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const hoverTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Accessibility: the book buttons (to return focus on close), the close
  // button (to move focus into the book view), and the page behind the view.
  const bookButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const returnFocusIdRef = useRef<string | null>(null);

  // Where a book sits on the shelf right now. The gallery is never scaled or
  // moved, so this is its true position.
  const getShelfRect = (id: string) =>
    (bookButtonRefs.current[id] ?? shelfRefs.current[id])?.getBoundingClientRect() ?? null;

  // Where the open book sits in the detail view, for a cover of height h.
  const centerFor = (h: number) => isMobile
    ? { x: vp.w * 0.5, y: Math.min((h * targetScale) / 2 + 80, vp.h * 0.38) }
    : { x: vp.w * 0.28, y: vp.h * 0.5 };

  const setHover = (id: string, on: boolean, book?: Book) => {
    const el = shelfRefs.current[id];
    const shadow = shadowRefs.current[id];
    const transform = on && book
      ? `translateY(-${HOVER_LIFT * 100}%) rotate(${getTiltAngle(book)}deg) scale(${HOVER_SCALE})`
      : '';
    if (el) {
      el.style.zIndex = on ? '99' : '';
      el.style.transform = transform;
    }
    if (shadow) {
      shadow.style.zIndex = on ? '98' : '';
      shadow.style.transform = transform;
      shadow.style.opacity = on ? '1' : '0';
    }
  };

  const handleSelect = (book: Book, e: React.MouseEvent) => {
    if (animState !== 'idle') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Start the flight from exactly where the cover is now, including the
    // hover lift and tilt, so it doesn't drop and straighten first.
    const lifted = !!shelfRefs.current[book.id]?.style.transform;
    if (lifted) {
      const h = rect.height;
      const rad = (getTiltAngle(book) * Math.PI) / 180;
      const arm = (h / 2) * HOVER_SCALE; // bottom edge → centre, after scaling
      startPoseRef.current = {
        x: cx + arm * Math.sin(rad),
        y: cy + h / 2 - HOVER_LIFT * h - arm * Math.cos(rad),
        rot: getTiltAngle(book),
        scale: HOVER_SCALE,
      };
    } else {
      startPoseRef.current = { x: cx, y: cy, rot: 0, scale: 1 };
    }
    setHover(book.id, false); // the shelf copy is hidden while the book is open
    setOriginRect(rect);
    setSelectedBook(book);
    setAnimState('opening');
  };

  const handleClose = useCallback(() => {
    // Ignore while opening, closing or sliding to another book.
    if (!selectedBook || animState !== 'open' || navPhase) return;
    pendingNavRef.current = null;
    setHover(selectedBook.id, false);
    // Measure the shelf again, so the cover flies back to where the book is now.
    const rect = getShelfRect(selectedBook.id);
    if (rect) setOriginRect(rect);
    returnFocusIdRef.current = selectedBook.id;
    setAnimState('closing');
  }, [selectedBook, animState, navPhase]);

  const finishClose = useCallback(() => {
    // Swap the flying cover for the real one on the shelf in the same frame.
    setClosingFade(true);
    setSelectedBook(null);
    setOriginRect(null);
    setAnimState('idle');
    requestAnimationFrame(() => requestAnimationFrame(() => setClosingFade(false)));
  }, []);

  // While a book is open, make the page behind it unreachable (Tab, screen
  // readers). When it closes, put keyboard focus back on that book.
  useEffect(() => {
    const els = [headerRef.current, galleryRef.current];
    if (selectedBook) {
      els.forEach(el => el?.setAttribute('inert', ''));
      return;
    }
    els.forEach(el => el?.removeAttribute('inert'));
    const id = returnFocusIdRef.current;
    returnFocusIdRef.current = null;
    if (id) bookButtonRefs.current[id]?.focus({ preventScroll: true });
  }, [selectedBook]);

  // When the book view finishes opening, move keyboard focus into it.
  useEffect(() => {
    if (animState !== 'open') return;
    const btn = closeButtonRef.current;
    if (btn && !btn.closest('[role="dialog"]')?.contains(document.activeElement)) {
      btn.focus({ preventScroll: true });
    }
  }, [animState]);

  const navigateBooks = useCallback((direction: 'prev' | 'next') => {
    if (animState !== 'open' || !selectedBook) return;
    // A press during a slide is remembered and runs as soon as it finishes.
    if (navPhase) { pendingNavRef.current = direction; return; }
    const idx = BOOKS.findIndex(b => b.id === selectedBook.id);
    let nextBook: Book | null = null;
    if (direction === 'next' && idx < BOOKS.length - 1) nextBook = BOOKS[idx + 1];
    else if (direction === 'prev' && idx > 0) nextBook = BOOKS[idx - 1];
    if (!nextBook) return;

    navTargetRef.current = nextBook;
    navExitRectRef.current = getShelfRect(selectedBook.id) ?? originRect;
    const nextRect = getShelfRect(nextBook.id);
    if (nextRect) setOriginRect(nextRect);
    setNavBook(selectedBook);
    setNavDir(direction);
    setExitReady(false);
    setNavPhase('exit');
  }, [animState, selectedBook, navPhase, originRect]);

  // Opening: render the cover at its start, make sure the browser has drawn
  // that, then move it to the centre.
  useEffect(() => {
    if (animState !== 'opening') return;
    commitStyles(bookElRef.current);
    const frame = requestAnimationFrame(() => setAnimState('open'));
    return () => cancelAnimationFrame(frame);
  }, [animState]);

  // Closing: finish when the cover actually lands (see onTransitionEnd), with
  // a safety net in case the transition event never fires.
  useEffect(() => {
    if (animState !== 'closing') return;
    const t = setTimeout(finishClose, MOTION.closeMs + 200);
    return () => clearTimeout(t);
  }, [animState, finishClose]);

  // Prev/next: the old cover slides out while the new one slides in.
  useEffect(() => {
    if (navPhase === 'exit') {
      if (!exitReady) {
        commitStyles(navElRef.current);
        const f = requestAnimationFrame(() => setExitReady(true));
        return () => cancelAnimationFrame(f);
      }
      const t = setTimeout(() => {
        setSelectedBook(navTargetRef.current!);
        setEnterReady(false);
        setNavPhase('enter');
      }, 90);
      return () => clearTimeout(t);
    }
    if (navPhase === 'enter') {
      if (!enterReady) {
        commitStyles(bookElRef.current);
        const f = requestAnimationFrame(() => setEnterReady(true));
        return () => cancelAnimationFrame(f);
      }
      const t = setTimeout(() => {
        setNavPhase(null);
        setExitReady(false);
        setEnterReady(false);
      }, MOTION.navMs + 30);
      return () => clearTimeout(t);
    }
  }, [navPhase, exitReady, enterReady]);

  useEffect(() => {
    if (!navBook) return;
    const t = setTimeout(() => setNavBook(null), MOTION.navMs + 120);
    return () => clearTimeout(t);
  }, [navBook]);

  // Run a prev/next press that came in during the last slide.
  const navigateBooksRef = useRef(navigateBooks);
  navigateBooksRef.current = navigateBooks;
  useEffect(() => {
    if (navPhase || !pendingNavRef.current) return;
    const dir = pendingNavRef.current;
    pendingNavRef.current = null;
    navigateBooksRef.current(dir);
  }, [navPhase]);

  // Window resized or phone rotated with a book open: re-measure so the
  // cover, arrows and text move to the right places.
  useEffect(() => {
    if (animState !== 'open' || navPhase || !selectedBook) return;
    const rect = getShelfRect(selectedBook.id);
    if (rect) setOriginRect(rect);
  }, [vp.w, vp.h]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (EDITOR_AVAILABLE && (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        setShowAdmin(v => !v);
        return;
      }
      // Leave keys alone while the admin tool is open or you're typing.
      if (showAdmin) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowRight') navigateBooks('next');
      if (e.key === 'ArrowLeft') navigateBooks('prev');
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleClose, navigateBooks, showAdmin]);

  // Swipe gestures on the flying book
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  useEffect(() => {
    const el = bookElRef.current;
    if (!el || animState !== 'open') return;

    let startX = 0, startY = 0;
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx > absDy && absDx > 50) {
        navigateBooksRef.current(dx > 0 ? 'prev' : 'next');
      } else if (dy > 80 && absDy > absDx) {
        handleCloseRef.current();
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [animState, navPhase]);

  useEffect(() => {
    return () => {
      Object.values(hoverTimers.current).forEach(clearTimeout);
      hoverTimers.current = {};
    };
  }, []);

  const getFlyingBookStyle = (): React.CSSProperties => {
    if (!originRect || !selectedBook) return {};
    const shelf: Pose = {
      x: originRect.left + originRect.width / 2,
      y: originRect.top + originRect.height / 2,
      rot: 0,
      scale: 1,
    };
    let pose: Pose;
    if (animState === 'open') pose = { ...centerFor(originRect.height), rot: 0, scale: targetScale };
    else if (animState === 'opening') pose = startPoseRef.current ?? shelf;
    else pose = shelf;
    return { width: originRect.width, height: originRect.height, transform: poseTransform(pose) };
  };

  const getExitInitStyle = (): React.CSSProperties => {
    const r = navExitRectRef.current;
    if (!r) return {};
    return { width: r.width, height: r.height, transform: poseTransform({ ...centerFor(r.height), rot: 0, scale: targetScale }) };
  };

  const getExitStyle = (): React.CSSProperties => {
    const r = navExitRectRef.current;
    if (!navBook || !r) return {};
    const c = centerFor(r.height);
    const dist = vp.w * 0.9;
    return {
      width: r.width,
      height: r.height,
      transform: poseTransform({ x: c.x + (navDir === 'next' ? -dist : dist), y: c.y, rot: 0, scale: targetScale * 0.9 }),
    };
  };

  const getEnterInitStyle = (): React.CSSProperties => {
    if (!originRect) return {};
    const c = centerFor(originRect.height);
    const dist = vp.w * 0.9;
    return {
      width: originRect.width,
      height: originRect.height,
      transform: poseTransform({ x: c.x + (navDir === 'next' ? dist : -dist), y: c.y, rot: 0, scale: targetScale }),
      transition: 'none',
    };
  };

  const getNavArrowStyle = (dir: 'prev' | 'next'): React.CSSProperties => {
    if (!originRect) return {};
    const c = centerFor(originRect.height);
    const bookHalfW = (originRect.width * targetScale) / 2;
    const gap = 16;
    const btnW = 44;
    return {
      position: 'fixed',
      left: dir === 'prev' ? c.x - bookHalfW - gap - btnW : c.x + bookHalfW + gap,
      top: c.y,
      transform: 'translateY(-50%)',
      zIndex: 60,
      transition: `left ${MOTION.navMs}ms ${MOTION.move}, top ${MOTION.navMs}ms ${MOTION.move}`,
    };
  };

  const textMarginTop = isMobile && originRect && selectedBook && animState === 'open'
    ? (() => {
        const halfH = (originRect.height * targetScale) / 2;
        const bottom = centerFor(originRect.height).y + halfH;
        const panelTop = vp.h * 0.48;
        return Math.max(48, Math.round(bottom - panelTop + 24));
      })()
    : (isMobile ? 48 : 0);

  const flyerTransition = navPhase === 'enter'
    ? `transform ${MOTION.navMs}ms ${MOTION.move}, opacity 0.08s ease-out`
    : `transform ${animState === 'closing' ? MOTION.closeMs : MOTION.openMs}ms ${MOTION.move}, opacity 0.08s ease-out`;

  return (
    <div
      className={`${dark ? 'dark ' : ''}h-screen w-screen bg-[#FDFDFD] dark:bg-[#121212] text-gray-900 dark:text-neutral-100 overflow-x-hidden ${selectedBook ? 'overflow-y-hidden' : 'overflow-y-auto'} font-sans relative selection:bg-gray-900 dark:selection:bg-neutral-100 selection:text-white dark:selection:text-neutral-900 flex flex-col`}
      style={{ scrollbarGutter: 'stable' }}
    >

      <style>{`
        .font-serif { font-family: 'DM Serif Text', serif; }
        .font-sans { font-family: 'Manrope', sans-serif; }

        @media (max-width: 768px) {
          :root {
            --cw: 160px;
            --ch: 240px;
          }
        }

        /* ── Vitsoe 606-style shelf system ───────────────────────────────── */

        /* Book hover effect — simulates picking a book off the shelf */
        .vitsoe-book-wrapper {
          position: relative;
        }
        .book-hover-vitsoe {
          will-change: transform;
          /* A tight contact shadow where the book meets the shelf, and a soft one on the wall behind */
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.18)) drop-shadow(3px -2px 10px rgba(0,0,0,0.10));
        }

        /* Text in the book view eases in when you move to another book */
        @keyframes bookTextIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: none; }
        }
        .book-text-in {
          animation: bookTextIn 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* Arrows fade in once the cover has nearly arrived */
        @keyframes fadeIn { from { opacity: 0; } }
        .book-arrow-in {
          animation: fadeIn 220ms ease-out 260ms backwards;
        }

        /* Wall: a plain, faintly warm plaster colour, square at the edges */
        .shelf-wall {
          position: absolute;
          bottom: 0;
          pointer-events: none;
          z-index: 0;
          background: #F4F2EE;
        }

        /* E-Track: a slim satin aluminium upright with a column of slots */
        .shelf-track {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 10px;
          background: linear-gradient(to right, #c3c5c8 0, #dcdee0 1px, #e6e7e9 50%, #d6d8db calc(100% - 1px), #b9bbbe 100%);
          box-shadow: 2px 0 3px rgba(0,0,0,0.05);
        }
        .shelf-track::before {
          content: '';
          position: absolute;
          top: 12px;
          bottom: 12px;
          left: 4px;
          width: 2px;
          border-radius: 1px;
          background: repeating-linear-gradient(to bottom, rgba(40,42,46,0.32) 0 7px, transparent 7px 16px);
        }
        .shelf-track-mid { left: calc(50% - 5px); display: none; }
        @media (min-width: 768px) { .shelf-track-mid { display: block; } }

        /* Shelf: thin powder-coated steel. A sliver of top surface, a
           crisp front lip, then a soft shadow on the wall underneath. */
        .shelf {
          position: absolute;
          left: 4px;
          right: 4px;
          z-index: 2;
          /* top surface (lit from above, a touch darker toward the wall),
             a bright folded edge, then the front face shading down */
          background: linear-gradient(to bottom,
            #e9e7e2 0, #f6f5f1 var(--surface),
            #fcfbf9 var(--surface), #ebe9e4 calc(var(--surface) + 2px), #e6e4de 55%, #dbd9d2 calc(100% - 2px), #c6c4bd 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,0.10),
            0 12px 16px -6px rgba(0,0,0,0.22),
            0 28px 36px -14px rgba(0,0,0,0.14);
        }
        /* Dark: a charcoal wall with graphite tracks and shelves, matching the share image's Dark shelf */
        .dark .shelf-wall { background: #1b1b1c; }
        .dark .shelf-track {
          background: linear-gradient(to right, #3e3f42 0, #6d6f73 1px, #7a7c80 50%, #66686c calc(100% - 1px), #3e3f42 100%);
          box-shadow: 2px 0 4px rgba(0,0,0,0.35);
        }
        .dark .shelf-track::before {
          background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.45) 0 7px, transparent 7px 16px);
        }
        .dark .shelf {
          background: linear-gradient(to bottom,
            #3c3d41 0, #4a4b4f var(--surface),
            #55575b var(--surface), #36373a calc(var(--surface) + 2px), #2e2f32 60%, #202124 100%);
          box-shadow:
            0 1px 1px rgba(0,0,0,0.4),
            0 12px 16px -6px rgba(0,0,0,0.55),
            0 28px 36px -14px rgba(0,0,0,0.45);
        }
        .dark .book-hover-vitsoe {
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5)) drop-shadow(3px -2px 10px rgba(0,0,0,0.35));
        }

        /* Seam where the two bays' shelves meet at the middle track */
        @media (min-width: 768px) {
          .shelf::after {
            content: '';
            position: absolute;
            top: 0; bottom: 0;
            left: calc(50% - 4px);
            width: 1px;
            background: rgba(0,0,0,0.10);
          }
          .dark .shelf::after { background: rgba(0,0,0,0.5); }
        }
      `}</style>

      <header ref={headerRef} className={`w-full py-6 px-6 md:px-12 flex items-center justify-between border-b border-gray-100 dark:border-white/10 transition-opacity duration-300 ${animState !== 'idle' && animState !== 'closing' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {SITE.url ? (
          <a href={SITE.url} className="font-semibold text-lg tracking-tight hover:text-gray-600 dark:hover:text-neutral-300 transition-colors">
            {SITE.name}
          </a>
        ) : (
          <span className="font-semibold text-lg tracking-tight">{SITE.name}</span>
        )}
        <nav className="hidden md:flex space-x-6 text-sm text-gray-600 dark:text-neutral-400">
          {SITE.nav.map(link => link.current
            ? <span key={link.label} className="text-gray-900 dark:text-neutral-100 font-medium">{link.label}</span>
            : <a key={link.label} href={link.href} className="hover:text-gray-900 dark:hover:text-white transition-colors">{link.label}</a>)}
        </nav>
        {SITE.nav.length > 0 && <button
          className="md:hidden p-2 text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => setMobileMenuOpen(v => !v)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 overflow-visible block" aria-hidden="true">
            {/* Lines move with CSS transforms (which can animate) to morph into an X */}
            <line
              x1={4} y1={9} x2={20} y2={9}
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{
                transformBox: 'fill-box', transformOrigin: 'center',
                transform: mobileMenuOpen ? 'translateY(3px) rotate(45deg)' : 'none',
                transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
            <line
              x1={4} y1={15} x2={20} y2={15}
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{
                transformBox: 'fill-box', transformOrigin: 'center',
                transform: mobileMenuOpen ? 'translateY(-3px) rotate(-45deg)' : 'none',
                transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          </svg>
        </button>}
        {/* Full-screen menu: always mounted so it can fade in and out */}
        <div
          className={`fixed inset-0 z-[80] bg-[#FDFDFD] dark:bg-[#121212] flex flex-col md:hidden ${mobileMenuOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}
          style={{ transition: mobileMenuOpen ? 'opacity 200ms ease-out' : 'opacity 180ms ease-in, visibility 0s linear 180ms' }}
          aria-hidden={!mobileMenuOpen}
        >
            <div className="py-6 px-6 border-b border-gray-100 dark:border-white/10 flex justify-end">
              <button
                className="p-2 text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex flex-col items-end px-6 pt-8 space-y-6 text-base text-gray-600 dark:text-neutral-400">
              {SITE.nav.map(link => link.current
                ? <span key={link.label} className="text-gray-900 dark:text-neutral-100 font-medium">{link.label}</span>
                : <a key={link.label} href={link.href} className="hover:text-gray-900 dark:hover:text-white transition-colors" onClick={() => setMobileMenuOpen(false)}>{link.label}</a>)}
            </nav>
        </div>
      </header>

      {/* The gallery only fades while a book is open. It is never scaled or
          moved, so measured book positions always match the real ones. */}
      <div ref={galleryRef} className={`flex-1 flex flex-col w-full max-w-6xl mx-auto px-6 md:px-12 md:pt-6 transition-opacity duration-300 ease-out
        ${animState !== 'idle' && animState !== 'closing' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        <div className="mb-6 md:mb-6">
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900 dark:text-neutral-100 mb-4 select-none"
            onClick={() => {
              if (!EDITOR_AVAILABLE) return;
              const t = titleTapRef.current;
              t.count++;
              if (t.timer) clearTimeout(t.timer);
              if (t.count >= 5) { t.count = 0; setShowAdmin(v => !v); }
              else t.timer = setTimeout(() => { t.count = 0; }, 2000);
            }}>
            {SITE.title}
          </h1>
          <p className="text-lg text-gray-600 dark:text-neutral-400">{SITE.subtitle(BOOKS.length)}</p>
        </div>

        {/* ── Vitsoe-style physical bookshelf ───────────────────────────── */}
        <div className="flex-1 flex flex-col w-full relative pt-4 md:pt-6 pb-10 md:pb-12">
          {/* Wall + shelf structure layer (purely decorative, pointer-events-none) */}
          {USE_VITSOE_SHELF && <ShelfStructure gridRef={gridRef} animState={animState} />}

          {/* Books grid — untouched logic, added px/gap-y for shelf breathing room */}
          <div ref={gridRef} className={USE_VITSOE_SHELF ? "grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-14 md:gap-x-6 md:gap-y-20 items-end px-4 md:px-8 w-full relative" : "grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 items-center w-full relative"} style={{ zIndex: 4 }}>
            {BOOKS.map((book) => {
              const isHidden = selectedBook?.id === book.id && animState !== 'idle' && !closingFade;
              return USE_VITSOE_SHELF ? (
                <button
                  type="button"
                  key={book.id}
                  ref={el => { bookButtonRefs.current[book.id] = el; }}
                  aria-label={`${book.title} by ${book.author}`}
                  className="vitsoe-book-wrapper block w-full p-0 bg-transparent border-0 text-left cursor-pointer rounded-xs focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-900 dark:focus-visible:outline-neutral-100"
                  onClick={(e) => handleSelect(book, e)}
                  onPointerEnter={(e) => {
                    // Lift for a mouse or trackpad (or pen), not for a finger: on phones a tap would leave it stuck.
                    if (animState !== 'idle' || e.pointerType === 'touch') return;
                    const timer = hoverTimers.current[book.id];
                    if (timer) { clearTimeout(timer); delete hoverTimers.current[book.id]; }
                    setHover(book.id, true, book);
                  }}
                  onPointerLeave={() => {
                    const id = book.id;
                    hoverTimers.current[id] = setTimeout(() => {
                      setHover(id, false);
                      delete hoverTimers.current[id];
                    }, 150);
                  }}
                >
                  {/* Hover shadow: always there, only its opacity changes (cheap to animate) */}
                  <div
                    ref={el => { shadowRefs.current[book.id] = el; }}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-xs pointer-events-none origin-bottom"
                    style={{
                      boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
                      opacity: 0,
                      transition: closingFade || isHidden
                        ? 'none'
                        : `transform ${MOTION.hoverMs}ms ${MOTION.hover}, opacity ${MOTION.hoverMs}ms ease-out`,
                    }}
                  />
                  <div
                    ref={el => { shelfRefs.current[book.id] = el; }}
                    className={`relative overflow-hidden rounded-xs pointer-events-none ${isHidden ? 'opacity-0' : 'opacity-100'} origin-bottom book-hover-vitsoe`}
                    style={{
                      transition: closingFade || isHidden
                        ? 'opacity 0s'
                        : `transform ${MOTION.hoverMs}ms ${MOTION.hover}, opacity 0.3s ease-out`,
                    } as React.CSSProperties}
                  >
                    <DynamicCover book={book} />
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  key={book.id}
                  ref={el => { shelfRefs.current[book.id] = el; bookButtonRefs.current[book.id] = el; }}
                  aria-label={`${book.title} by ${book.author}`}
                  onClick={(e) => handleSelect(book, e)}
                  className={`block w-full p-0 bg-transparent border-0 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-900 dark:focus-visible:outline-neutral-100 relative overflow-hidden rounded-xs cursor-pointer ${isHidden ? 'opacity-0' : 'opacity-100'} origin-bottom ${grownId === book.id && animState === 'idle' ? 'scale-[1.03] drop-shadow-[0_10px_24px_rgba(0,0,0,0.22)]' : 'drop-shadow-[0_4px_12px_rgba(0,0,0,0.12)]'}`}
                  // Pointer events rather than CSS :hover, so it also works with an iPad trackpad.
                  onPointerEnter={(e) => { if (e.pointerType !== 'touch') setGrownId(book.id); }}
                  onPointerLeave={() => setGrownId(id => (id === book.id ? null : id))}
                  style={{ transition: closingFade ? 'opacity 0s' : `scale ${MOTION.hoverMs}ms ${MOTION.hover}, filter ${MOTION.hoverMs}ms ${MOTION.hover}, opacity 0.3s ease-out` } as React.CSSProperties}
                >
                  <DynamicCover book={book} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedBook && (
        <div
          className="fixed inset-0 pointer-events-none z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-dialog-title"
        >
          {/* White backdrop: starts transparent and fades in, so the gallery is
              seen fading away behind it; fades out a little faster on close. */}
          <div
            className={`absolute inset-0 bg-[#FDFDFD] dark:bg-[#121212] ${animState === 'open' ? 'opacity-100' : 'opacity-0'}`}
            style={{ transition: animState === 'open' ? 'opacity 380ms ease-out' : 'opacity 340ms ease-in' }}
          />

          {navBook && (
            <div
              ref={navElRef}
              className="fixed top-0 left-0 z-[70] pointer-events-none"
              style={{
                ...(exitReady ? getExitStyle() : getExitInitStyle()),
                opacity: exitReady ? 0 : 1,
                transition: `transform ${MOTION.navMs}ms ${MOTION.exit}, opacity ${MOTION.navMs}ms ${MOTION.exit}`,
              } as React.CSSProperties}
            >
              <div className="absolute inset-0 shadow-[0_20px_40px_rgba(0,0,0,0.3)] rounded-xs overflow-hidden">
                <DynamicCover book={navBook} eager />
              </div>
            </div>
          )}

          {navPhase !== 'exit' && (
            <div
              ref={bookElRef}
              className="fixed top-0 left-0 z-50 pointer-events-auto"
              style={{
                ...(navPhase === 'enter' && !enterReady ? getEnterInitStyle() : getFlyingBookStyle()),
                opacity: closingFade ? 0 : 1,
                ...(navPhase === 'enter' && !enterReady ? {} : { transition: flyerTransition }),
              } as React.CSSProperties}
              onTransitionEnd={(e) => {
                // Close is finished when the cover has actually landed on the shelf.
                if (animState === 'closing' && e.target === e.currentTarget && e.propertyName === 'transform') finishClose();
              }}
            >
              <div className="absolute inset-0 shadow-[0_20px_40px_rgba(0,0,0,0.3)] rounded-xs overflow-hidden">
                <DynamicCover book={selectedBook} eager />
              </div>
            </div>
          )}

          <div
            className={`absolute right-0 bottom-0 w-full md:w-[55%] h-[52%] md:h-full flex flex-col justify-start md:justify-center p-8 md:p-16 z-40 bg-gradient-to-t from-[#FDFDFD] dark:from-[#121212] via-[#FDFDFD] dark:via-[#121212] to-transparent md:to-[#FDFDFD]/90 dark:md:to-[#121212]/90 md:bg-[#FDFDFD] dark:md:bg-[#121212] pointer-events-auto overflow-y-auto
              ${animState === 'open' ? 'opacity-100 translate-x-0 md:translate-y-0 translate-y-0' : 'opacity-0 translate-y-12 md:translate-y-0 md:translate-x-8'}`}
            style={{
              top: isMobile ? 'auto' : '0',
              // Enter with a short delay; leave quickly with none, so it never pops out half-faded.
              transition: animState === 'open'
                ? `opacity 450ms ${MOTION.move} 120ms, translate 450ms ${MOTION.move} 120ms, transform 450ms ${MOTION.move} 120ms`
                : `opacity 200ms ${MOTION.exit}, translate 200ms ${MOTION.exit}, transform 200ms ${MOTION.exit}`,
            }}
          >
            <div key={selectedBook.id} className="max-w-md w-full mx-auto md:mx-0 book-text-in" style={{ marginTop: textMarginTop }}>
              <h2 id="book-dialog-title" className="font-serif text-3xl md:text-5xl text-gray-900 dark:text-neutral-100 mb-2 leading-tight drop-shadow-xs">
                {selectedBook.title}
              </h2>

              <div className="font-sans text-gray-500 dark:text-neutral-400 font-medium tracking-wide uppercase text-xs md:text-sm mb-6 flex items-center space-x-2">
                <span>{selectedBook.author}</span>
                <span className="w-1 h-1 bg-gray-400 rounded-full" />
                <span>{selectedBook.year}</span>
              </div>

              <div className="w-8 h-[2px] bg-gray-900 dark:bg-neutral-100 mb-6" />

              <p className="font-sans text-gray-700 dark:text-neutral-300 leading-relaxed text-base md:text-lg mb-8">
                {selectedBook.synopsis}
              </p>

              <a
                href={`https://www.goodreads.com/book/show/${selectedBook.gr}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-2 text-sm font-semibold text-gray-900 dark:text-neutral-100 border-b border-gray-900 dark:border-neutral-100 pb-1 hover:text-gray-500 dark:hover:text-neutral-400 hover:border-gray-500 dark:hover:border-neutral-400 transition-colors"
              >
                <span>View on Goodreads</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div className={`absolute top-6 right-6 md:top-10 md:right-10 z-[60] transition-opacity duration-300 pointer-events-auto ${animState === 'open' ? 'opacity-100' : 'opacity-0'}`}>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="p-3 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors text-gray-800 dark:text-neutral-200 bg-white/80 dark:bg-neutral-800/80 backdrop-blur-xs shadow-xs"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Nav arrows flanking the book cover */}
          {originRect && selectedBook && animState === 'open' && (
            <>
              <button
                type="button"
                aria-label="Previous book"
                onClick={() => navigateBooks('prev')}
                disabled={BOOKS.findIndex(b => b.id === selectedBook.id) === 0}
                style={getNavArrowStyle('prev')}
                className="book-arrow-in fixed z-[60] p-3 rounded-full pointer-events-auto disabled:opacity-30 text-gray-800 dark:text-neutral-200 bg-white/80 dark:bg-neutral-800/80 backdrop-blur-xs hover:bg-gray-100 dark:hover:bg-neutral-700 shadow-xs"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next book"
                onClick={() => navigateBooks('next')}
                disabled={BOOKS.findIndex(b => b.id === selectedBook.id) === BOOKS.length - 1}
                style={getNavArrowStyle('next')}
                className="book-arrow-in fixed z-[60] p-3 rounded-full pointer-events-auto disabled:opacity-30 text-gray-800 dark:text-neutral-200 bg-white/80 dark:bg-neutral-800/80 backdrop-blur-xs hover:bg-gray-100 dark:hover:bg-neutral-700 shadow-xs"
              >
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </>
          )}

        </div>
      )}
      <Suspense fallback={<div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center text-white text-xl">Loading admin…</div>}>
        {showAdmin && <AdminGate books={BOOKS} onClose={() => setShowAdmin(false)} />}
      </Suspense>
    </div>
  );
}
