import { useState, useEffect, useRef, useCallback, useSyncExternalStore, lazy, Suspense } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Book, BOOKS, RAW_BOOKS, USE_VITSOE_SHELF } from './src/books';
import coverManifest from './src/generated/cover-manifest.json';

const UpdateTool = lazy(() => import('./src/UpdateTool'));


// --- UTILITIES ---
const getColorForString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 40%, 26%)`;
};

// --- COVER ART CACHE & COLOR CACHE ---
export const coverCache = new Map<string, string>();
const colorCache = new Map<string, string>();
export const aspectRatioCache = new Map<string, number>();
export const fetchingSet = new Set<string>();

const colorStore = {
  version: 0,
  listeners: new Set<() => void>(),
  subscribe: (listener: () => void) => {
    colorStore.listeners.add(listener);
    return () => colorStore.listeners.delete(listener);
  },
  getSnapshot: () => colorStore.version,
  notify: () => {
    colorStore.version++;
    colorStore.listeners.forEach(fn => fn());
  },
};

const extractDominantColor = (url: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const buckets = new Map<string, number>();
        let maxSatCount = 0;
        let dominantKey: string | null = null;
        let maxDesatCount = 0;
        let fallbackKey: string | null = null;

        for (let i = 0; i < data.length; i += 8) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);

          if (max < 25 || min > 230) continue;

          const saturation = max === 0 ? 0 : (max - min) / max;

          const qr = Math.round(r / 48) * 48;
          const qg = Math.round(g / 48) * 48;
          const qb = Math.round(b / 48) * 48;
          const key = `${qr},${qg},${qb}`;
          const count = (buckets.get(key) || 0) + 1;
          buckets.set(key, count);

          if (saturation >= 0.2) {
            if (count > maxSatCount) { maxSatCount = count; dominantKey = key; }
          } else {
            if (count > maxDesatCount) { maxDesatCount = count; fallbackKey = key; }
          }
        }

        resolve(dominantKey ? `rgb(${dominantKey})` : fallbackKey ? `rgb(${fallbackKey})` : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
};

const gbKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY || '';
const gbUrl = (path: string) => path + (gbKey ? `&key=${gbKey}` : '');
const MIN_COVER_HEIGHT = 300;

const loadImage = (url: string, crossOrigin = 'anonymous'): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

const fetchCover = async (book: Book): Promise<{ url: string | null; color: string | null }> => {
  fetchingSet.add(book.id);
  try {
    // Check local cover manifest first (pre-downloaded at build time)
    const local = coverManifest[(book.isbn || book.id) as keyof typeof coverManifest];
    const manifestPath = local ? (local as { path: string | null; aspectRatio: number | null }).path : null;

    // If a coverUrl override is set, try it first
    let overrideImg: HTMLImageElement | null = null;
    if (book.coverUrl) {
      try {
        overrideImg = await loadImage(book.coverUrl);
        if (overrideImg && overrideImg.naturalHeight < MIN_COVER_HEIGHT) overrideImg = null;
      } catch { overrideImg = null; }
    }
    if (overrideImg) {
      aspectRatioCache.set(book.id, overrideImg.naturalWidth / overrideImg.naturalHeight);
      const c = document.createElement('canvas');
      c.width = overrideImg.naturalWidth;
      c.height = overrideImg.naturalHeight;
      c.getContext('2d')!.drawImage(overrideImg, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/jpeg', 0.9));
      const objectUrl = blob ? URL.createObjectURL(blob) : overrideImg.src;
      coverCache.set(book.id, objectUrl);
      fetchingSet.delete(book.id);
      colorStore.notify();
      return { url: objectUrl, color: null };
    }

    // Collect candidate URLs (only when no manifest — avoids unnecessary API calls)
    const candidates: { url: string }[] = [];

    if (!manifestPath) {
      // OpenLibrary search by title+author
      try {
        let res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}`);
        const olData = await res.json();
        const coverI = olData.docs?.[0]?.cover_i;
        if (coverI) candidates.push({ url: `https://covers.openlibrary.org/b/id/${coverI}-L.jpg` });
      } catch {}

      // OpenLibrary ISBN direct
      if (book.isbn) {
        candidates.push({ url: `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg` });
      }

      // Goodreads (via ISBN)
      if (book.isbn) {
        candidates.push({ url: `https://covers.goodreads.com/bisbn/${book.isbn}-L.jpg` });
      }

      // Google Books fallback
      try {
        let res = await fetch(gbUrl(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}`));
        if (res.status !== 429) {
          const gData = await res.json();
          const thumb = gData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
          if (thumb) candidates.push({ url: thumb.replace('zoom=1', 'zoom=2').replace('http:', 'https:') });
        }
      } catch {}
    }

    // Try manifest path first (pre-validated at build time), then candidates with size check
    let loadedImg: HTMLImageElement | null = null;

    if (manifestPath) {
      try { loadedImg = await loadImage(manifestPath); } catch {}
    }

    if (!loadedImg) {
      let fallback: HTMLImageElement | null = null;

      for (const cand of candidates) {
        let img: HTMLImageElement;
        try { img = await loadImage(cand.url); } catch { continue; }

        if (img.naturalHeight >= MIN_COVER_HEIGHT) {
          loadedImg = img;
          break;
        }

        if (!fallback) fallback = img;
      }

      if (!loadedImg && fallback) loadedImg = fallback;
    }

    if (!loadedImg) {
      fetchingSet.delete(book.id);
      colorStore.notify();
      return { url: null, color: null };
    }

    aspectRatioCache.set(book.id, loadedImg.naturalWidth / loadedImg.naturalHeight);

    // Convert to an object URL so new img elements resolve from memory instantly
    const c = document.createElement('canvas');
    c.width = loadedImg.naturalWidth;
    c.height = loadedImg.naturalHeight;
    c.getContext('2d')!.drawImage(loadedImg, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/jpeg', 0.9));
    const objectUrl = blob ? URL.createObjectURL(blob) : loadedImg.src;
    coverCache.set(book.id, objectUrl);

    colorCache.set(book.id, getColorForString(book.title));
    let color = await extractDominantColor(loadedImg.src);
    if (color) {
      colorCache.set(book.id, color);
    }
    fetchingSet.delete(book.id);
    colorStore.notify();

    return { url: objectUrl, color: colorCache.get(book.id)! };
  } catch {
    fetchingSet.delete(book.id);
    if (!colorCache.has(book.id)) {
      colorCache.set(book.id, getColorForString(book.title));
    }
    colorStore.notify();
    return { url: null, color: colorCache.get(book.id)! };
  }
};

// --- PRELOAD ALL COVERS ---
const usePreloader = () => {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let completed = 0;
    const total = BOOKS.length;

    BOOKS.forEach((book, index) => {
      if (coverCache.has(book.id) && colorCache.has(book.id)) {
        completed++;
        setProgress(Math.round((completed / total) * 100));
        if (completed === total) { setReady(true); }
        return;
      }

      (async () => {
        await fetchCover(book);
        completed++;
        setProgress(Math.round((completed / total) * 100));
        if (completed === total) { setReady(true); }
      })();
    });
  }, []);

  return { ready, progress };
};

// --- COVER HOOK (for DynamicCover, syncs with cache on book change) ---
const useBookCover = (book: Book) => {
  const [coverState, setCoverState] = useState<{ url: string | null; status: string }>(() => ({
    url: coverCache.get(book.id) || null,
    status: coverCache.has(book.id) ? 'loaded' : 'loading'
  }));
  const cacheVersion = useSyncExternalStore(colorStore.subscribe, colorStore.getSnapshot);

  useEffect(() => {
    if (coverCache.has(book.id)) {
      setCoverState({ url: coverCache.get(book.id)!, status: 'loaded' });
      return;
    }
    setCoverState({ url: null, status: 'loading' });
  }, [book.id, cacheVersion]);

  useEffect(() => {
    if (coverCache.has(book.id) || fetchingSet.has(book.id)) return;

    (async () => {
      await fetchCover(book);
      setCoverState({ url: coverCache.get(book.id) || null, status: coverCache.has(book.id) ? 'loaded' : 'error' });
    })();
  }, [book.id, book.title, book.author, book.isbn]);

  return coverState;
};

const useBookColor = (book: Book) => {
  useSyncExternalStore(colorStore.subscribe, colorStore.getSnapshot);
  return colorCache.get(book.id) || getColorForString(book.title);
};

const useBookAspectRatio = (book: Book) => {
  useSyncExternalStore(colorStore.subscribe, colorStore.getSnapshot);
  const cached = aspectRatioCache.get(book.id);
  if (cached) return cached;
  const local = coverManifest[(book.isbn || book.id) as keyof typeof coverManifest];
  if (local) return (local as { aspectRatio: number | null }).aspectRatio || 2/3;
  return 2/3;
};

// --- COMPONENTS ---
const LoadingScreen = () => {
  const { ready, progress } = usePreloader();
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (ready) {
      const t = setTimeout(() => setFadeOut(true), 400);
      return () => clearTimeout(t);
    }
  }, [ready]);

  if (fadeOut) return null;

  return (
    <div className={`fixed inset-0 z-[100] bg-[#FDFDFD] flex flex-col items-center justify-center transition-opacity duration-500 ${ready ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <div className="w-48 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-gray-900 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-sm text-gray-400 mt-4 font-sans tracking-wide">Loading bookshelf&hellip;</p>
    </div>
  );
};

const DynamicCover = ({ book }: { book: Book }) => {
  const { url, status } = useBookCover(book);
  const fallbackColor = useBookColor(book);
  const aspectRatio = useBookAspectRatio(book);

  return (
    <div className="relative w-full" style={{ aspectRatio, backgroundColor: fallbackColor }}>
      {url && (
        <img
          src={url}
          alt={`Cover of ${book.title}`}
          className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {status !== 'loaded' && (
        <div className="absolute inset-0 flex flex-col justify-between p-5 border border-white/10 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
          <h2 className="font-serif text-white text-2xl leading-tight drop-shadow-md z-10">{book.title}</h2>
        </div>
      )}
    </div>
  );
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
      const containerTop = grid.getBoundingClientRect().top + window.scrollY;

      children.forEach((child) => {
        const r = child.getBoundingClientRect();
        const rowTop = r.top + window.scrollY - containerTop;
        const rowBottom = r.bottom + window.scrollY - containerTop;

        // Find an existing row within tolerance, otherwise start a new one
        const existing = seen.find(s => Math.abs(s.top - rowTop) < ROW_TOLERANCE);
        if (existing) {
          existing.bottom = Math.max(existing.bottom, rowBottom);
        } else {
          seen.push({ top: rowTop, bottom: rowBottom });
        }
      });

      setState({
        rows: seen.sort((a, b) => a.top - b.top),
        gridOffsetTop,
        gridHeight,
      });
    };

    compute();
    const ro = new ResizeObserver(compute);
    if (gridRef.current) ro.observe(gridRef.current);
    window.addEventListener('scroll', compute, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', compute);
    };
  }, [gridRef, animState]);

  return state;
};

const ShelfStructure = ({ gridRef, animState }: { gridRef: React.RefObject<HTMLDivElement | null>; animState: string }) => {
  const { rows, gridOffsetTop, gridHeight } = useShelfRows(gridRef, animState);

  if (rows.length === 0) return null;

  // The shelf-wall is absolutely positioned within the same relative parent as the grid.
  // We align it precisely to the grid's position (gridOffsetTop) with extra padding around it.
  const PAD = 16; // extra breathing room on each side

  const uprightPositions = [
    { left: 0 },
    { right: 0 },
  ];

  return (
    <div
      className="shelf-wall"
      style={{
        position: 'absolute',
        top: gridOffsetTop - PAD,
        left: -PAD,
        right: -PAD,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'clip',
      }}
      aria-hidden="true"
    >
      {/* Vertical uprights */}
      {uprightPositions.map((pos, i) => (
        <div
          key={`upright-${i}`}
          className="shelf-upright"
          style={{ ...pos }}
        />
      ))}

      {/* One shelf board + brackets per row */}
      {rows.map((row, i) => {
        // row.bottom is in grid coordinates; +PAD converts to shelf-wall coordinate space.
        // No extra gap — books sit directly on the board surface.
        const boardTop = row.bottom + PAD;
        return (
          <div key={`shelf-${i}`}>
            {/* Soft shadow cast by books down onto the shelf surface */}
            <div
              style={{
                position: 'absolute',
                left: PAD,
                right: PAD,
                top: boardTop - 12,
                height: 12,
                background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.09))',
                zIndex: 3,
                pointerEvents: 'none',
              }}
            />
            {/* Shelf board — spans full upright-to-upright width */}
            <div
              className="shelf-board"
              style={{ top: boardTop, left: 4, right: 4 }}
            />
            {/* Left bracket */}
            <div
              className="shelf-bracket"
              style={{
                position: 'absolute',
                top: boardTop,
                left: 16,
                width: 12,
                height: 24,
              }}
            />
            {/* Right bracket */}
            <div
              className="shelf-bracket"
              style={{
                position: 'absolute',
                top: boardTop,
                right: 16,
                width: 12,
                height: 24,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default function App() {

  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const [animState, setAnimState] = useState<'idle' | 'opening' | 'open' | 'closing'>('idle');
  const [showAdmin, setShowAdmin] = useState(false);
  const [closingFade, setClosingFade] = useState(false);
  const [navBook, setNavBook] = useState<Book | null>(null);
  const [navPhase, setNavPhase] = useState<'exit' | 'enter' | null>(null);
  const [navDir, setNavDir] = useState<'next' | 'prev'>('next');
  const [exitReady, setExitReady] = useState(false);
  const [enterReady, setEnterReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const shelfRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const bookElRef = useRef<HTMLDivElement | null>(null);
  const navTargetRef = useRef<Book | null>(null);
  const navExitYRef = useRef(0);
  const navExitRectRef = useRef<DOMRect | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const hoverTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleSelect = (book: Book, e: React.MouseEvent) => {
    if (animState !== 'idle') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setOriginRect(rect);
    setSelectedBook(book);
    setAnimState('opening');
  };

  const handleClose = useCallback(() => {
    if (!selectedBook) return;
    const shelfEl = shelfRefs.current[selectedBook.id];
    if (shelfEl) {
      shelfEl.style.removeProperty('--tilt-angle');
      shelfEl.style.zIndex = '';
      shelfEl.style.transform = '';
      shelfEl.style.boxShadow = '';
    }
    setAnimState('closing');
  }, [selectedBook]);

  const navigateBooks = useCallback((direction: 'prev' | 'next') => {
    if (animState !== 'open' || !selectedBook || navPhase) return;
    const idx = BOOKS.findIndex(b => b.id === selectedBook.id);
    let nextBook: Book | null = null;
    if (direction === 'next' && idx < BOOKS.length - 1) nextBook = BOOKS[idx + 1];
    else if (direction === 'prev' && idx > 0) nextBook = BOOKS[idx - 1];
    if (!nextBook) return;

    if (originRect) {
      const isM = window.innerWidth < 768;
      if (isM) {
        navExitYRef.current = Math.min((originRect.height * 1.45) / 2 + 80, window.innerHeight * 0.38);
      } else {
        navExitYRef.current = window.innerHeight * 0.5;
      }
    }

    navTargetRef.current = nextBook;
    navExitRectRef.current = shelfRefs.current[selectedBook.id]!.getBoundingClientRect();
    setOriginRect(shelfRefs.current[nextBook.id]!.getBoundingClientRect());
    setNavBook(selectedBook);
    setNavDir(direction);
    setNavPhase('exit');
  }, [animState, selectedBook, navPhase, originRect]);

  useEffect(() => {
    if (animState === 'opening') {
      const timer = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(timer);
    }
    if (animState === 'closing') {
      setClosingFade(false);
      const swapTimer = setTimeout(() => setClosingFade(true), 560);
      const cleanupTimer = setTimeout(() => {
        setSelectedBook(null);
        setOriginRect(null);
        setAnimState('idle');
        setClosingFade(false);
      }, 660);
      return () => { clearTimeout(swapTimer); clearTimeout(cleanupTimer); };
    }
  }, [animState]);

  useEffect(() => {
    if (!navBook) return;
    const t = setTimeout(() => setNavBook(null), 1250);
    return () => clearTimeout(t);
  }, [navBook]);

  useEffect(() => {
    if (navPhase === 'exit') {
      if (!exitReady) {
        const t = requestAnimationFrame(() => setExitReady(true));
        return () => cancelAnimationFrame(t);
      }
      const t = setTimeout(() => {
        setSelectedBook(navTargetRef.current!);
        setNavPhase('enter');
        setEnterReady(false);
      }, 400);
      return () => clearTimeout(t);
    }
    if (navPhase === 'enter') {
      if (!enterReady) {
        const t = requestAnimationFrame(() => setEnterReady(true));
        return () => cancelAnimationFrame(t);
      }
      const t = setTimeout(() => {
        setNavPhase(null);
        setNavDir('next');
        setExitReady(false);
        setEnterReady(false);
      }, 1250);
      return () => clearTimeout(t);
    }
  }, [navPhase, exitReady, enterReady]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'U') {
        e.preventDefault();
        setShowAdmin(v => !v);
        return;
      }
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowRight') navigateBooks('next');
      if (e.key === 'ArrowLeft') navigateBooks('prev');
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleClose, navigateBooks]);

  // Swipe gestures on the flying book
  const navigateBooksRef = useRef(navigateBooks);
  navigateBooksRef.current = navigateBooks;
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

  const getFlyingBookStyle = () => {
    if (!originRect || !selectedBook) return {};

    const isMobile = window.innerWidth < 768;
    const targetScale = isMobile ? 1.45 : 1.65;
    const isOpen = animState === 'open';

    const cx = originRect.left + originRect.width / 2;
    const cy = originRect.top + originRect.height / 2;

    let tx: string, ty: string;
    if (isOpen) {
      if (isMobile) {
        const halfH = (originRect.height * targetScale) / 2;
        const topPx = Math.min(halfH + 80, window.innerHeight * 0.38);
        tx = '50vw';
        ty = `${topPx}px`;
      } else {
        tx = '28vw';
        ty = '50vh';
      }
    } else {
      tx = `${cx}px`;
      ty = `${cy}px`;
    }

    return {
      width: originRect.width,
      height: originRect.height,
      transform: `translate(${tx}, ${ty}) translate(-50%, -50%) scale(${isOpen ? targetScale : 1})`,
    } as React.CSSProperties;
  };

  const getExitInitStyle = () => {
    if (!navExitRectRef.current) return {};
    const exitRect = navExitRectRef.current;
    const isM = window.innerWidth < 768;
    const ts = isM ? 1.45 : 1.65;
    if (isM) {
      const halfH = (exitRect.height * ts) / 2;
      const topPx = Math.min(halfH + 80, window.innerHeight * 0.38);
      const cx = window.innerWidth * 0.5;
      return {
        width: exitRect.width,
        height: exitRect.height,
        transform: `translate(${cx}px, ${topPx}px) translate(-50%, -50%) scale(${ts})`,
      } as React.CSSProperties;
    }
    const cx = window.innerWidth * 0.28;
    const cy = window.innerHeight * 0.5;
    return {
      width: exitRect.width,
      height: exitRect.height,
      transform: `translate(${cx}px, ${cy}px) translate(-50%, -50%) scale(1.65)`,
    } as React.CSSProperties;
  };

  const getExitStyle = () => {
    if (!navBook || !navExitRectRef.current) return {};
    const exitRect = navExitRectRef.current;
    const isM = window.innerWidth < 768;
    const dist = isM ? window.innerWidth * 1.5 : window.innerWidth * 1.5;
    const offX = navDir === 'next' ? -dist : dist;
    const yPos = isM ? navExitYRef.current : window.innerHeight * 0.5;
    return {
      width: exitRect.width,
      height: exitRect.height,
      transform: `translate(${offX}px, ${yPos}px) translate(-50%, -50%) scale(0.8)`,
    } as React.CSSProperties;
  };

  const getEnterInitStyle = () => {
    if (!originRect) return {};
    const isM = window.innerWidth < 768;
    const ts = isM ? 1.45 : 1.65;
    const dist = isM ? window.innerWidth * 1.5 : window.innerWidth * 1.5;
    const fromX = navDir === 'next' ? dist : -dist;
    const halfH = (originRect.height * ts) / 2;
    const topPx = Math.min(halfH + 80, window.innerHeight * 0.38);
    const yPos = isM ? topPx : window.innerHeight * 0.5;
    return {
      width: originRect.width,
      height: originRect.height,
      transform: `translate(${fromX}px, ${yPos}px) translate(-50%, -50%) scale(${ts})`,
      transition: 'none',
    } as React.CSSProperties;
  };

  const getNavArrowStyle = (dir: 'prev' | 'next'): React.CSSProperties => {
    if (!originRect) return {};
    const isM = window.innerWidth < 768;
    const ts = isM ? 1.45 : 1.65;
    const cx = isM ? window.innerWidth * 0.5 : window.innerWidth * 0.28;
    const cy = isM
      ? Math.min((originRect.height * ts) / 2 + 80, window.innerHeight * 0.38)
      : window.innerHeight * 0.5;
    const bookHalfW = (originRect.width * ts) / 2;
    const gap = 16;
    const btnW = 44;

    if (dir === 'prev') {
      return {
        position: 'fixed',
        left: cx - bookHalfW - gap - btnW,
        top: cy,
        transform: 'translateY(-50%)',
        zIndex: 60,
      };
    }
    return {
      position: 'fixed',
      left: cx + bookHalfW + gap,
      top: cy,
      transform: 'translateY(-50%)',
      zIndex: 60,
    };
  };

  const mb = window.innerWidth < 768;
  const textMarginTop = mb && originRect && selectedBook && animState === 'open'
    ? (() => {
        const scale = 1.45;
        const halfH = (originRect.height * scale) / 2;
        const center = Math.min(halfH + 80, window.innerHeight * 0.38);
        const bottom = center + halfH;
        const panelTop = window.innerHeight * 0.48;
        return Math.max(48, Math.round(bottom - panelTop + 24));
      })()
    : (mb ? 48 : 0);

  return (
    <div className="h-screen w-screen bg-[#FDFDFD] text-gray-900 overflow-x-hidden overflow-y-auto font-sans relative selection:bg-gray-900 selection:text-white flex flex-col">
      <LoadingScreen />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Text&family=Manrope:wght@400;500;600&display=swap');
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
        }

        /* Wall background: warm linen with subtle vignette */
        .shelf-wall {
          background-color: #F5F0EB;
          background-image:
            radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.45) 0%, transparent 70%),
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='400' height='400' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
          border-radius: 4px;
          position: relative;
        }

        /* Vertical aluminum upright (the track/standard) */
        .shelf-upright {
          position: absolute;
          top: -20px;
          bottom: -20px;
          width: 14px;
          z-index: 1;
          border-radius: 3px;
          background:
            linear-gradient(to right,
              #c8c8c8 0%,
              #e8e8e8 20%,
              #f2f2f2 38%,
              #ffffff 48%,
              #f0f0f0 58%,
              #d8d8d8 80%,
              #bcbcbc 100%
            );
          box-shadow:
            inset 1px 0 0 rgba(255,255,255,0.6),
            inset -1px 0 0 rgba(0,0,0,0.12),
            1px 0 4px rgba(0,0,0,0.08),
            -1px 0 2px rgba(0,0,0,0.04);
        }

        /* Slot holes punched along the upright */
        .shelf-upright::before {
          content: '';
          position: absolute;
          top: 28px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          bottom: 28px;
          background:
            repeating-linear-gradient(
              to bottom,
              transparent 0px,
              transparent 7px,
              rgba(0,0,0,0.22) 7px,
              rgba(0,0,0,0.22) 13px
            );
          border-radius: 2px;
        }

        /* Horizontal shelf board */
        .shelf-board {
          position: absolute;
          left: 0;
          right: 0;
          height: 18px;
          z-index: 2;
          border-radius: 2px 2px 3px 3px;
          /* Warm birch/beech wood grain */
          background:
            repeating-linear-gradient(
              88deg,
              transparent 0px,
              rgba(160,120,60,0.04) 1px,
              transparent 2px,
              transparent 18px,
              rgba(140,100,50,0.03) 19px,
              transparent 20px
            ),
            repeating-linear-gradient(
              92deg,
              transparent 0px,
              rgba(180,140,80,0.03) 3px,
              transparent 4px,
              transparent 26px
            ),
            linear-gradient(to bottom,
              #e8dcc8 0%,
              #ddd0b4 18%,
              #d4c8a4 40%,
              #cfc2a0 55%,
              #d8ccaa 72%,
              #c8bc94 88%,
              #b8ac84 100%
            );
          /* Top highlight (light hitting the top surface) */
          box-shadow:
            0 -1px 0 rgba(255,255,255,0.9),
            0 1px 0 rgba(0,0,0,0.06),
            0 3px 8px rgba(0,0,0,0.13),
            0 6px 16px rgba(0,0,0,0.07),
            inset 0 1px 0 rgba(255,255,255,0.55),
            inset 0 -1px 0 rgba(0,0,0,0.08);
        }

        /* Shelf board front lip / edge-banding (darker front face) */
        .shelf-board::after {
          content: '';
          position: absolute;
          left: 0; right: 0;
          bottom: -5px;
          height: 5px;
          background: linear-gradient(to bottom, #b0a07c, #9a8c68);
          border-radius: 0 0 2px 2px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        /* Shadow cast by books/shelf onto the wall behind */
        .shelf-board::before {
          content: '';
          position: absolute;
          left: -4px; right: -4px;
          top: -24px;
          height: 24px;
          background: linear-gradient(to bottom,
            transparent 0%,
            rgba(0,0,0,0.025) 60%,
            rgba(0,0,0,0.065) 100%
          );
          pointer-events: none;
        }

        /* Bracket (L-shaped support under each shelf) */
        .shelf-bracket {
          position: absolute;
          bottom: 0;
          width: 12px;
          height: 28px;
          z-index: 3;
          background: linear-gradient(to right, #d0d0d0, #e8e8e8 40%, #f0f0f0 55%, #d4d4d4);
          border-radius: 0 0 2px 2px;
          box-shadow:
            inset 1px 0 0 rgba(255,255,255,0.5),
            1px 0 3px rgba(0,0,0,0.1);
        }

        /* Book bottom shadows on shelf */
        .shelf-book-shadow {
          position: absolute;
          left: 0; right: 0;
          height: 6px;
          bottom: 18px; /* sits on top of the shelf board */
          background: linear-gradient(to bottom,
            rgba(0,0,0,0.0) 0%,
            rgba(0,0,0,0.08) 100%
          );
          z-index: 3;
          pointer-events: none;
        }
      `}</style>

      <header className={`w-full py-6 px-6 md:px-12 flex items-center justify-between border-b border-gray-100 transition-opacity duration-300 ${animState !== 'idle' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <a href="https://sangsara.net" className="font-semibold text-lg tracking-tight hover:text-gray-600 transition-colors">
          sangsara.net
        </a>
        <nav className="hidden md:flex space-x-6 text-sm text-gray-600">
          <a href="https://sangsara.net/about/" className="hover:text-gray-900 transition-colors">About</a>
          <a href="https://sangsara.net/apps/" className="hover:text-gray-900 transition-colors">Apps</a>
          <span className="text-gray-900 font-medium">Bookshelf</span>
          <a href="https://sangsara.net/archive/" className="hover:text-gray-900 transition-colors">Archive</a>
          <a href="https://sangsara.net/subscribe/" className="hover:text-gray-900 transition-colors">Subscribe</a>
        </nav>
        <button
          className="md:hidden p-2 text-gray-600 hover:text-gray-900 transition-colors"
          onClick={() => setMobileMenuOpen(v => !v)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 overflow-visible block">
            <line
              x1={mobileMenuOpen ? 5 : 4}
              y1={mobileMenuOpen ? 5 : 9}
              x2={mobileMenuOpen ? 19 : 20}
              y2={mobileMenuOpen ? 19 : 9}
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ transition: 'all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            />
            <line
              x1={mobileMenuOpen ? 5 : 4}
              y1={mobileMenuOpen ? 19 : 15}
              x2={mobileMenuOpen ? 19 : 20}
              y2={mobileMenuOpen ? 5 : 15}
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ transition: 'all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            />
          </svg>
        </button>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[80] bg-[#FDFDFD] flex flex-col md:hidden">
            <div className="py-6 px-6 border-b border-gray-100 flex justify-end">
              <button
                className="p-2 text-gray-600 hover:text-gray-900 transition-colors"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex flex-col items-end px-6 pt-8 space-y-6 text-base text-gray-600">
              <a href="https://sangsara.net/about/" className="hover:text-gray-900 transition-colors" onClick={() => setMobileMenuOpen(false)}>About</a>
              <a href="https://sangsara.net/apps/" className="hover:text-gray-900 transition-colors" onClick={() => setMobileMenuOpen(false)}>Apps</a>
              <span className="text-gray-900 font-medium">Bookshelf</span>
              <a href="https://sangsara.net/archive/" className="hover:text-gray-900 transition-colors" onClick={() => setMobileMenuOpen(false)}>Archive</a>
              <a href="https://sangsara.net/subscribe/" className="hover:text-gray-900 transition-colors" onClick={() => setMobileMenuOpen(false)}>Subscribe</a>
            </nav>
          </div>
        )}
      </header>

      <div className={`flex-1 flex flex-col w-full max-w-6xl mx-auto px-6 md:px-12 md:pt-6 transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]
        ${animState !== 'idle' && animState !== 'closing' ? 'opacity-0 translate-y-12 scale-95 pointer-events-none' : 'opacity-100 translate-y-0 scale-100'}`}
      >
        <div className="mb-6 md:mb-6">
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900 mb-4">Bookshelf</h1>
          <p className="text-lg text-gray-600">{BOOKS.length} of the best books I&rsquo;ve read recently.</p>
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
                <div
                  key={book.id}
                  className="vitsoe-book-wrapper cursor-pointer"
                  onClick={(e) => handleSelect(book, e)}
                  onMouseEnter={(e) => {
                    const timer = hoverTimers.current[book.id];
                    if (timer) { clearTimeout(timer); delete hoverTimers.current[book.id]; }
                    const bookEl = e.currentTarget.firstElementChild as HTMLElement;
                    if (!bookEl) return;
                    const angle = (Math.random() * 14) - 7;
                    bookEl.style.setProperty('--tilt-angle', `${angle}deg`);
                    bookEl.style.zIndex = '99';
                    bookEl.style.transform = `translateY(-20%) rotate(${angle}deg) scale(1.08)`;
                    bookEl.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35)';
                  }}
                  onMouseLeave={(e) => {
                    const id = book.id;
                    hoverTimers.current[id] = setTimeout(() => {
                      const shelfEl = shelfRefs.current[id];
                      if (shelfEl) {
                        shelfEl.style.removeProperty('--tilt-angle');
                        shelfEl.style.zIndex = '';
                        shelfEl.style.transform = '';
                        shelfEl.style.boxShadow = '';
                      }
                      delete hoverTimers.current[id];
                    }, 150);
                  }}
                >
                  <div
                    ref={el => shelfRefs.current[book.id] = el}
                    className={`relative overflow-hidden rounded-sm pointer-events-none ${isHidden ? 'opacity-0' : 'opacity-100'} origin-bottom drop-shadow-[0_4px_12px_rgba(0,0,0,0.25)] book-hover-vitsoe`}
                    style={{
                      transition: closingFade
                        ? 'opacity 0s'
                        : 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.35s ease-out, opacity 0.3s ease-out',
                    } as React.CSSProperties}
                  >
                    <DynamicCover book={book} />
                  </div>
                </div>
              ) : (
                <div
                  key={book.id}
                  ref={el => shelfRefs.current[book.id] = el}
                  onClick={(e) => handleSelect(book, e)}
                  className={`relative overflow-hidden rounded-sm cursor-pointer ${isHidden ? 'opacity-0' : 'opacity-100'} origin-bottom drop-shadow-[0_4px_12px_rgba(0,0,0,0.12)] hover:scale-[1.03] hover:drop-shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition-all duration-300 ease-out`}
                  style={{ transition: closingFade ? 'opacity 0s' : 'all 0.3s ease-out' } as React.CSSProperties}
                >
                  <DynamicCover book={book} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedBook && (
        <div className="fixed inset-0 pointer-events-none z-50">
          <div className={`absolute inset-0 bg-[#FDFDFD] transition-opacity duration-700 ease-out ${animState === 'closing' ? 'opacity-0' : 'opacity-100'}`} />

          {navBook && (
            <div
              className="fixed top-0 left-0 z-[70] pointer-events-auto"
              style={{
                ...(exitReady ? getExitStyle() : getExitInitStyle()),
                transition: `transform 1.2s cubic-bezier(${navDir === 'next' ? '0.4, 0, 0.7, 1' : '0.2, 0.8, 0.2, 1'})`,
              } as React.CSSProperties}
            >
              <div className="absolute inset-0 shadow-[0_20px_40px_rgba(0,0,0,0.3)] rounded-sm overflow-hidden">
                <DynamicCover book={navBook} />
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
                transition: `transform ${animState === 'closing' ? '0.55s' : '1.2s'} cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.08s ease-out`,
              } as React.CSSProperties}
            >
              <div className="absolute inset-0 shadow-[0_20px_40px_rgba(0,0,0,0.3)] rounded-sm overflow-hidden">
                <DynamicCover book={selectedBook} />
              </div>
            </div>
          )}

          <div
            className={`absolute right-0 bottom-0 w-full md:w-[55%] h-[52%] md:h-full flex flex-col justify-start md:justify-center p-8 md:p-16 z-40 bg-gradient-to-t from-[#FDFDFD] via-[#FDFDFD] to-transparent md:to-[#FDFDFD]/90 md:bg-[#FDFDFD] pointer-events-auto transition-all duration-700 delay-150 ease-out overflow-y-auto
              ${animState === 'open' ? 'opacity-100 translate-x-0 md:translate-y-0 translate-y-0' : 'opacity-0 translate-y-12 md:translate-y-0 md:translate-x-8'}`}
            style={{ top: typeof window !== 'undefined' && window.innerWidth < 768 ? 'auto' : '0' }}
          >
            <div className="max-w-md w-full mx-auto md:mx-0" style={{ marginTop: textMarginTop }}>
              <h1 className="font-serif text-3xl md:text-5xl text-gray-900 mb-2 leading-tight drop-shadow-sm">
                {selectedBook.title}
              </h1>

              <div className="font-sans text-gray-500 font-medium tracking-wide uppercase text-xs md:text-sm mb-6 flex items-center space-x-2">
                <span>{selectedBook.author}</span>
                <span className="w-1 h-1 bg-gray-400 rounded-full" />
                <span>{selectedBook.year}</span>
              </div>

              <div className="w-8 h-[2px] bg-gray-900 mb-6" />

              <p className="font-sans text-gray-700 leading-relaxed text-base md:text-lg mb-8">
                {selectedBook.synopsis}
              </p>

              <a
                href={`https://www.goodreads.com/book/show/${selectedBook.gr}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-2 text-sm font-semibold text-gray-900 border-b border-gray-900 pb-1 hover:text-gray-500 hover:border-gray-500 transition-colors"
              >
                <span>View on Goodreads</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div className={`absolute top-6 right-6 md:top-10 md:right-10 z-[60] transition-opacity duration-300 pointer-events-auto ${animState === 'open' ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={handleClose}
              className="p-3 rounded-full hover:bg-gray-100 transition-colors text-gray-800 bg-white/80 backdrop-blur-sm shadow-sm"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav arrows flanking the book cover */}
          {originRect && selectedBook && animState === 'open' && (
            <>
              <button
                onClick={() => navigateBooks('prev')}
                disabled={BOOKS.findIndex(b => b.id === selectedBook.id) === 0}
                style={getNavArrowStyle('prev')}
                className="fixed z-[60] p-3 rounded-full pointer-events-auto disabled:opacity-30 text-gray-800 bg-white/80 backdrop-blur-sm hover:bg-gray-100 shadow-sm"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => navigateBooks('next')}
                disabled={BOOKS.findIndex(b => b.id === selectedBook.id) === BOOKS.length - 1}
                style={getNavArrowStyle('next')}
                className="fixed z-[60] p-3 rounded-full pointer-events-auto disabled:opacity-30 text-gray-800 bg-white/80 backdrop-blur-sm hover:bg-gray-100 shadow-sm"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

        </div>
      )}
      <Suspense fallback={<div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center text-white text-xl">Loading admin…</div>}>
        {showAdmin && <UpdateTool books={BOOKS} onClose={() => setShowAdmin(false)} />}
      </Suspense>
    </div>
  );
}
