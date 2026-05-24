import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import UpdateTool from './src/UpdateTool';

// --- DATA SOURCE ---
const RAW_BOOKS = [
  { id: '1', isbn: '177148776', title: "It Lasts Forever and Then It's Over", author: 'Anne de Marcken', year: 2024, synopsis: "A haunting, spare novel about a zombie navigating the afterlife. It explores memory, loss, and the remnants of humanity in a beautifully decaying world.", gr: '177148776' },
  { id: '2', isbn: '1555978401', title: "Lanny", author: 'Max Porter', year: 2019, synopsis: "In a village not far from London, Lanny is a boy who has a special connection to the woods. An enchanting, dark, and polyphonic fable about Englishness and childhood.", gr: '39738353' },
  { id: '3', isbn: '0812550706', title: "Speaker for the Dead", author: 'Orson Scott Card', year: 1986, synopsis: "Three thousand years after the destruction of the bugger race, Ender Wiggin is still alive, traveling the stars as a Speaker for the Dead, seeking redemption.", gr: '7967' },
  { id: '4', isbn: '123136728', title: "Orbital", author: 'Samantha Harvey', year: 2023, synopsis: "Six astronauts and cosmonauts rotate through the International Space Station. A compact, lyrical meditation on the Earth, space, and the fragility of human existence.", gr: '123136728' },
  { id: '5', isbn: '203200544', title: "Perfection", author: 'Vincenzo Latronico', year: 2022, synopsis: "Millennial expat couple Anna and Tom are living the dream in Berlin, in a bright, plant-filled apartment. A sociological novel about the emptiness of contemporary existence.", gr: '203200544' },
  { id: '6', isbn: '0374139946', title: "Dilla Time", author: 'Dan Charnas', year: 2022, synopsis: "The life and legacy of J Dilla, a musical genius who transformed the sound of popular music and invented a new rhythm that changed the way musicians play.", gr: '57693653' },
  { id: '7', isbn: '0307946892', title: "Tigerman", author: 'Nick Harkaway', year: 2014, synopsis: "Sergeant Lester Ferris, a veteran of the Afghan war, serves on the island of Mancreu, a former British colony slated for destruction. He adopts a superhero persona to protect a local street kid.", gr: '19322249' },
  { id: '8', isbn: '0812976711', title: "The Satanic Verses", author: 'Salman Rushdie', year: 1988, synopsis: "Just before dawn one winter's morning, a hijacked jumbo jet blows apart high above the English Channel. A magical realist epic about migration, faith, and transformation.", gr: '12781' },
  { id: '9', isbn: '128533513', title: "Make Something Wonderful", author: 'Steve Jobs', year: 2023, synopsis: "A curated collection of Steve Jobs's speeches, interviews, and correspondence, offering an unparalleled window into how one of the world's most creative entrepreneurs approached his life and work.", gr: '128533513' },
  { id: '10', isbn: '0995624233', title: "There Is No Antimemetics Division", author: 'qntm', year: 2020, synopsis: "An antimeme is an idea with self-censoring properties; an idea which, by its very nature, discourages or prevents people from spreading it. A sci-fi thriller about fighting an enemy you can't remember.", gr: '54870256' },
  { id: '11', isbn: '75302296', title: "People Collide", author: 'Isle McElroy', year: 2023, synopsis: "A gender-bending, body-switching novel that explores marriage, identity, and sex, raising profound questions about the nature of true partnership.", gr: '75302296' },
  { id: '12', isbn: '123163147', title: "The Future", author: 'Naomi Alderman', year: 2023, synopsis: "A handful of friends plot a daring heist to save the world from the tech billionaires who are intent on surviving the apocalypse in their private bunkers.", gr: '123163147' },
];

export interface Book {
  id: string; isbn: string; title: string; author: string;
  year: number; synopsis: string; gr: string; mult: number;
}

// --- UTILITIES ---
const getColorForString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 40%, 26%)`;
};

const getThicknessMult = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return 1.0 + (Math.abs(hash) % 50) / 100;
};

const BOOKS: Book[] = RAW_BOOKS.map(book => ({
  ...book,
  mult: getThicknessMult(book.title)
}));

// --- COVER ART CACHE & COLOR CACHE ---
const coverCache = new Map<string, string>();
const colorCache = new Map<string, string>();
const fetchingSet = new Set<string>();

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

const fetchCover = async (book: Book): Promise<{ url: string | null; color: string | null }> => {
  fetchingSet.add(book.id);
  try {
    let url: string | null = null;

    let res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}`);
    if (res.status !== 429) {
      const gData = await res.json();
      url = gData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    }

    if (!url) {
      res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}`);
      const olData = await res.json();
      const coverI = olData.docs?.[0]?.cover_i;
      if (coverI) url = `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
      else url = `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;
    }

    if (url?.includes('googleapis')) {
      url = url.replace('zoom=1', 'zoom=2').replace('http:', 'https:');
    }

    if (!url) {
      fetchingSet.delete(book.id);
      colorStore.notify();
      return { url: null, color: null };
    }

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => { if (img.width > 1) resolve(); else reject(); };
      img.onerror = reject;
      img.src = url!;
    });

    coverCache.set(book.id, url);
    colorCache.set(book.id, getColorForString(book.title));
    let color = await extractDominantColor(url);
    if (color) {
      colorCache.set(book.id, color);
    }
    fetchingSet.delete(book.id);
    colorStore.notify();

    return { url, color: colorCache.get(book.id)! };
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

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: fallbackColor }}>
      {url && (
        <img
          src={url}
          alt={`Cover of ${book.title}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
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

  const handleSelect = (book: Book, e: React.MouseEvent) => {
    if (animState !== 'idle') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setOriginRect(rect);
    setSelectedBook(book);
    setAnimState('opening');
  };

  const handleClose = useCallback(() => {
    if (!selectedBook) return;
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
      const swapTimer = setTimeout(() => setClosingFade(true), 600);
      const cleanupTimer = setTimeout(() => {
        setSelectedBook(null);
        setOriginRect(null);
        setAnimState('idle');
        setClosingFade(false);
      }, 680);
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
    if (!originRect) return {};
    const isM = window.innerWidth < 768;
    const ts = isM ? 1.45 : 1.65;
    if (isM) {
      const halfH = (originRect.height * ts) / 2;
      const topPx = Math.min(halfH + 80, window.innerHeight * 0.38);
      const cx = window.innerWidth * 0.5;
      return {
        width: originRect.width,
        height: originRect.height,
        transform: `translate(${cx}px, ${topPx}px) translate(-50%, -50%) scale(${ts})`,
      } as React.CSSProperties;
    }
    const cx = window.innerWidth * 0.28;
    const cy = window.innerHeight * 0.5;
    return {
      width: originRect.width,
      height: originRect.height,
      transform: `translate(${cx}px, ${cy}px) translate(-50%, -50%) scale(1.65)`,
    } as React.CSSProperties;
  };

  const getExitStyle = () => {
    if (!navBook || !originRect) return {};
    const isM = window.innerWidth < 768;
    const dist = isM ? window.innerWidth * 1.5 : window.innerWidth * 1.5;
    const offX = navDir === 'next' ? -dist : dist;
    const yPos = isM ? navExitYRef.current : window.innerHeight * 0.5;
    return {
      width: originRect.width,
      height: originRect.height,
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
          <p className="text-lg text-gray-600">The {BOOKS.length} best books I&rsquo;ve read recently.</p>
        </div>

        <div className="flex-1 flex flex-col w-full relative py-4 md:py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 w-full">
            {BOOKS.map((book) => {
              const isHidden = selectedBook?.id === book.id && animState !== 'idle' && !closingFade;
              return (
                <div
                  key={book.id}
                  ref={el => shelfRefs.current[book.id] = el}
                  onClick={(e) => handleSelect(book, e)}
                  className={`aspect-[2/3] relative overflow-hidden rounded-sm cursor-pointer ${isHidden ? 'opacity-0' : 'opacity-100'} hover:scale-[1.03] transition-all duration-300 ease-out drop-shadow-[0_4px_12px_rgba(0,0,0,0.12)]`}
                  style={{ transition: closingFade ? 'opacity 0s' : 'all 0.3s ease-out' }}
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
              <div className="absolute inset-0 shadow-2xl rounded-sm overflow-hidden">
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
                transition: 'transform 1.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.08s ease-out',
              } as React.CSSProperties}
            >
              <div className="absolute inset-0 shadow-2xl rounded-sm overflow-hidden">
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

          <div className={`absolute top-6 right-6 md:top-10 md:right-10 z-[60] flex space-x-2 transition-opacity duration-300 pointer-events-auto ${animState === 'open' ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={() => navigateBooks('prev')}
              disabled={BOOKS.findIndex(b => b.id === selectedBook.id) === 0}
              className="p-3 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-30 text-gray-800 bg-white/80 backdrop-blur-sm"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => navigateBooks('next')}
              disabled={BOOKS.findIndex(b => b.id === selectedBook.id) === BOOKS.length - 1}
              className="p-3 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-30 text-gray-800 bg-white/80 backdrop-blur-sm"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="p-3 rounded-full hover:bg-gray-100 transition-colors text-gray-800 ml-2 bg-white/80 backdrop-blur-sm shadow-sm"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

        </div>
      )}
      {showAdmin && <UpdateTool books={BOOKS} onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
