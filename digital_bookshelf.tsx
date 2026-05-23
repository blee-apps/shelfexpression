import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import UpdateTool from './src/UpdateTool';

// --- DATA SOURCE ---
const RAW_BOOKS = [
  { id: '1', isbn: '177148776', title: "It Lasts Forever and Then It's Over", author: 'Anne de Marcken', year: 2024, synopsis: "A haunting, spare novel about a zombie navigating the afterlife. It explores memory, loss, and the remnants of humanity in a beautifully decaying world.", gr: '177148776' },
  { id: '2', isbn: '0307946892', title: 'Tigerman', author: 'Nick Harkaway', year: 2014, synopsis: "Sergeant Lester Ferris, a veteran of the Afghan war, serves on the island of Mancreu, a former British colony slated for destruction. He adopts a superhero persona to protect a local street kid.", gr: '19322249' },
  { id: '3', isbn: '203200544', title: 'Perfection', author: 'Vincenzo Latronico', year: 2022, synopsis: "Millennial expat couple Anna and Tom are living the dream in Berlin, in a bright, plant-filled apartment. A sociological novel about the emptiness of contemporary existence.", gr: '203200544' },
  { id: '4', isbn: '1555978401', title: 'Lanny', author: 'Max Porter', year: 2019, synopsis: "In a village not far from London, Lanny is a boy who has a special connection to the woods. An enchanting, dark, and polyphonic fable about Englishness and childhood.", gr: '39738353' },
  { id: '5', isbn: '128533513', title: 'Make Something Wonderful', author: 'Steve Jobs', year: 2023, synopsis: "A curated collection of Steve Jobs's speeches, interviews, and correspondence, offering an unparalleled window into how one of the world's most creative entrepreneurs approached his life and work.", gr: '128533513' },
  { id: '6', isbn: '0995624233', title: 'There Is No Antimemetics Division', author: 'qntm', year: 2020, synopsis: "An antimeme is an idea with self-censoring properties; an idea which, by its very nature, discourages or prevents people from spreading it. A sci-fi thriller about fighting an enemy you can't remember.", gr: '54870256' },
  { id: '7', isbn: '0374139946', title: 'Dilla Time', author: 'Dan Charnas', year: 2022, synopsis: "The life and legacy of J Dilla, a musical genius who transformed the sound of popular music and invented a new rhythm that changed the way musicians play.", gr: '57693653' },
  { id: '8', isbn: '75302296', title: 'People Collide', author: 'Isle McElroy', year: 2023, synopsis: "A gender-bending, body-switching novel that explores marriage, identity, and sex, raising profound questions about the nature of true partnership.", gr: '75302296' },
  { id: '9', isbn: '123163147', title: 'The Future', author: 'Naomi Alderman', year: 2023, synopsis: "A handful of friends plot a daring heist to save the world from the tech billionaires who are intent on surviving the apocalypse in their private bunkers.", gr: '123163147' },
  { id: '10', isbn: '0812550706', title: 'Speaker for the Dead', author: 'Orson Scott Card', year: 1986, synopsis: "Three thousand years after the destruction of the bugger race, Ender Wiggin is still alive, traveling the stars as a Speaker for the Dead, seeking redemption.", gr: '7967' },
  { id: '11', isbn: '123136728', title: 'Orbital', author: 'Samantha Harvey', year: 2023, synopsis: "Six astronauts and cosmonauts rotate through the International Space Station. A compact, lyrical meditation on the Earth, space, and the fragility of human existence.", gr: '123136728' },
  { id: '12', isbn: '0812976711', title: 'The Satanic Verses', author: 'Salman Rushdie', year: 1988, synopsis: "Just before dawn one winter's morning, a hijacked jumbo jet blows apart high above the English Channel. A magical realist epic about migration, faith, and transformation.", gr: '12781' },
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
  try {
    let url: string | null = null;

    let res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}`);
    let data = await res.json();
    url = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;

    if (!url) {
      res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}`);
      data = await res.json();
      const coverI = data.docs?.[0]?.cover_i;
      if (coverI) url = `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
      else url = `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;
    }

    if (url?.includes('googleapis')) {
      url = url.replace('zoom=1', 'zoom=2').replace('http:', 'https:');
    }

    if (!url) return { url: null, color: null };

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
    colorStore.notify();

    return { url, color: colorCache.get(book.id)! };
  } catch {
    if (!colorCache.has(book.id)) {
      colorCache.set(book.id, getColorForString(book.title));
      colorStore.notify();
    }
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

  useEffect(() => {
    if (coverCache.has(book.id)) {
      setCoverState({ url: coverCache.get(book.id)!, status: 'loaded' });
      return;
    }
    setCoverState({ url: null, status: 'loading' });
  }, [book.id]);

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

const Book3D = ({ book }: { book: Book }) => {
  const color = useBookColor(book);

  return (
    <div className="absolute inset-0 flex items-center justify-center transform-style-3d">

      <div className="absolute book-face" style={{ width: 'var(--w)', height: 'var(--h)', transform: 'translateZ(calc(var(--d) / 2))' }}>
        <DynamicCover book={book} />
      </div>

      <div className="absolute book-face" style={{ width: 'var(--w)', height: 'var(--h)', transform: 'translateZ(calc(var(--d) / -2)) rotateY(180deg)', backgroundColor: color }} />

      <div
        className="absolute book-face flex items-center justify-center overflow-hidden border-x border-black/40 shadow-[inset_0_0_20px_rgba(0,0,0,0.4)]"
        style={{
          width: 'var(--d)', height: 'var(--h)',
          transform: 'translateX(calc(var(--w) / -2)) rotateY(-90deg)',
          backgroundColor: color,
          backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.2) 100%)'
        }}
      >
        <span className="font-serif text-white/90 text-[13px] md:text-sm whitespace-nowrap title-rotate drop-shadow-md px-4 tracking-wide select-none block">
          {book.title}
        </span>
      </div>

      <div
        className="absolute book-face bg-[#E8E6E1] flex flex-col justify-evenly py-1 border border-[#D5D3CC] shadow-inner"
        style={{ width: 'var(--d)', height: 'var(--h)', transform: 'translateX(calc(var(--w) / 2)) rotateY(90deg)' }}
      >
        {[...Array(12)].map((_, i) => <div key={i} className="w-full h-px bg-[#D5D3CC]/60" />)}
      </div>

      <div
        className="absolute book-face bg-[#E8E6E1] border border-[#D5D3CC]"
        style={{ width: 'var(--w)', height: 'var(--d)', transform: 'translateY(calc(var(--h) / -2)) rotateX(90deg)' }}
      />

      <div
        className="absolute book-face bg-[#E8E6E1] border border-[#D5D3CC]"
        style={{ width: 'var(--w)', height: 'var(--d)', transform: 'translateY(calc(var(--h) / 2)) rotateX(-90deg)' }}
      />

    </div>
  );
};

const useDragScroll = (ref: React.RefObject<HTMLDivElement | null>) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    const onDown = (x: number) => {
      isDown = true;
      startX = x;
      scrollLeft = el.scrollLeft;
    };

    const onMove = (x: number) => {
      if (!isDown) return;
      const dx = x - startX;
      el.scrollLeft = scrollLeft - dx;
    };

    const onUp = () => { isDown = false; };

    const handleMouseDown = (e: MouseEvent) => {
      onDown(e.pageX);
      e.preventDefault();
    };
    const handleMouseMove = (e: MouseEvent) => onMove(e.pageX);
    const handleMouseUp = () => onUp();
    const handleMouseLeave = () => onUp();

    const handleTouchDown = (e: TouchEvent) => {
      onDown(e.touches[0].pageX);
    };
    const handleTouchMove = (e: TouchEvent) => {
      onMove(e.touches[0].pageX);
    };
    const handleTouchEnd = () => onUp();

    el.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('touchstart', handleTouchDown, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('touchstart', handleTouchDown);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [ref]);
};

export default function App() {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [originRect, setOriginRect] = useState<DOMRect | null>(null);
  const [animState, setAnimState] = useState<'idle' | 'opening' | 'open' | 'closing'>('idle');
  const [closeCrossfade, setCloseCrossfade] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const shelfRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bookElRef = useRef<HTMLDivElement | null>(null);
  useDragScroll(scrollerRef);

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
    if (animState !== 'open' || !selectedBook) return;
    const idx = BOOKS.findIndex(b => b.id === selectedBook.id);

    if (direction === 'next' && idx < BOOKS.length - 1) {
      const nextBook = BOOKS[idx + 1];
      setOriginRect(shelfRefs.current[nextBook.id]!.getBoundingClientRect());
      setSelectedBook(nextBook);
    }

    if (direction === 'prev' && idx > 0) {
      const prevBook = BOOKS[idx - 1];
      setOriginRect(shelfRefs.current[prevBook.id]!.getBoundingClientRect());
      setSelectedBook(prevBook);
    }
  }, [animState, selectedBook]);

  useEffect(() => {
    if (animState === 'opening') {
      const timer = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(timer);
    }
    if (animState === 'closing') {
      setCloseCrossfade(false);
      const fadeTimer = setTimeout(() => setCloseCrossfade(true), 380);
      const cleanupTimer = setTimeout(() => {
        setSelectedBook(null);
        setOriginRect(null);
        setAnimState('idle');
        setCloseCrossfade(false);
      }, 750);
      return () => { clearTimeout(fadeTimer); clearTimeout(cleanupTimer); };
    }
  }, [animState]);

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
  }, [animState]);

  const getFlyingBookStyle = () => {
    if (!originRect || !selectedBook) return {};

    const isMobile = window.innerWidth < 768;
    const targetLeft = isMobile ? '50%' : '28%';
    const targetTop = isMobile ? '28%' : '50%';
    const targetScale = isMobile ? 'scale(1.0)' : 'scale(1.25)';
    const targetRotate = `rotateY(0deg) rotateX(0deg) ${targetScale}`;

    const initialLeft = `${originRect.left + originRect.width / 2}px`;
    const initialTop = `${originRect.top + originRect.height / 2}px`;
    const initialRotate = 'rotateY(90deg) rotateX(0deg) scale(1)';

    const isOpen = animState === 'open';

    return {
      top: isOpen ? targetTop : initialTop,
      left: isOpen ? targetLeft : initialLeft,
      transform: `translate(-50%, -50%) ${isOpen ? targetRotate : initialRotate}`,
      transition: 'all 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)',
      '--d': `calc(var(--base-d) * ${selectedBook.mult})`
    } as React.CSSProperties;
  };

  return (
    <div className="h-screen w-screen bg-[#FDFDFD] text-gray-900 overflow-x-hidden overflow-y-auto font-sans relative selection:bg-gray-900 selection:text-white flex flex-col">
      <LoadingScreen />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Text&family=Inter:wght@400;500;600&display=swap');
        .font-serif { font-family: 'DM Serif Text', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }

        .perspective-env { perspective: 2500px; }
        .transform-style-3d { transform-style: preserve-3d; }
        .book-face { backface-visibility: hidden; }

        :root {
          --w: 285px;
          --h: 430px;
          --base-d: 52px;
        }

        @media (max-width: 768px) {
          :root {
            --w: 160px;
            --h: 240px;
            --base-d: 30px;
          }
        }

        .book-bounding-box {
          width: var(--d);
          height: var(--h);
        }

        .book-volumetric-center {
          width: var(--w);
          height: var(--h);
        }

        .title-rotate {
          transform: rotate(90deg);
          width: var(--h);
          text-align: center;
        }

        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <header className={`w-full py-6 px-6 md:px-12 flex flex-col md:flex-row md:items-center justify-between border-b border-gray-100 transition-opacity duration-300 ${animState !== 'idle' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <a href="https://sangsara.net" className="font-semibold text-lg tracking-tight mb-4 md:mb-0 hover:text-gray-600 transition-colors">
          sangsara.net
        </a>
        <nav className="flex space-x-6 text-sm text-gray-600">
          <a href="https://sangsara.net/about/" className="hover:text-gray-900 transition-colors">About</a>
          <a href="https://sangsara.net/apps/" className="hover:text-gray-900 transition-colors">Apps</a>
          <span className="text-gray-900 font-medium">Bookshelf</span>
          <a href="https://sangsara.net/archive/" className="hover:text-gray-900 transition-colors">Archive</a>
          <a href="https://sangsara.net/subscribe/" className="hover:text-gray-900 transition-colors">Subscribe</a>
        </nav>
      </header>

      <div className={`flex-1 flex flex-col w-full max-w-6xl mx-auto px-6 md:px-12 md:pt-12 transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]
        ${animState !== 'idle' && animState !== 'closing' ? 'opacity-0 translate-y-12 scale-95 pointer-events-none' : 'opacity-100 translate-y-0 scale-100'}`}
      >
        <div className="mb-6 md:mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900 mb-4">Bookshelf</h1>
          <p className="text-lg text-gray-600">The 12 best books I&rsquo;ve read recently.</p>
        </div>

        <div className="flex-1 flex flex-col justify-center w-full relative perspective-env py-4 md:py-12">
          <div ref={scrollerRef} className="w-full overflow-x-auto hide-scrollbar pb-12 cursor-grab active:cursor-grabbing">
            <div className="flex items-end h-[300px] md:h-[500px] justify-center px-[10vw] md:px-[15vw]">
              {BOOKS.map((book) => {
                const isHidden = selectedBook?.id === book.id && (animState === 'open' || (animState === 'closing' && !closeCrossfade));
                return (
                  <div
                    key={book.id}
                    ref={el => shelfRefs.current[book.id] = el}
                    onClick={(e) => handleSelect(book, e)}
                    className={`book-bounding-box shrink-0 group relative ${isHidden ? 'opacity-0' : 'opacity-100'} transition-all duration-300 ease-out hover:-translate-y-8 cursor-pointer`}
                    style={{ '--d': `calc(var(--base-d) * ${book.mult})` } as React.CSSProperties}
                  >
                    <div
                      className="book-volumetric-center absolute top-1/2 left-1/2 transform-style-3d shadow-xl"
                      style={{ transform: 'translate(-50%, -50%) rotateY(90deg)' }}
                    >
                      <Book3D book={book} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedBook && (
        <div className="fixed inset-0 perspective-env pointer-events-none z-50">

          <div
            ref={bookElRef}
            className="book-volumetric-center absolute z-50 transform-style-3d pointer-events-auto"
            style={{ ...getFlyingBookStyle(), opacity: closeCrossfade ? 0 : 1, transition: `opacity 0.35s ease-out, ${getFlyingBookStyle().transition || ''}` } as React.CSSProperties}
          >
            <div className="absolute inset-0 shadow-2xl rounded-sm" />
            <Book3D book={selectedBook} />
          </div>

          <div
            className={`absolute right-0 bottom-0 w-full md:w-[55%] h-[52%] md:h-full flex flex-col justify-start md:justify-center p-8 md:p-16 z-40 bg-gradient-to-t from-[#FDFDFD] via-[#FDFDFD] to-transparent md:to-[#FDFDFD]/90 md:bg-[#FDFDFD] pointer-events-auto transition-all duration-700 delay-150 ease-out overflow-y-auto
              ${animState === 'open' ? 'opacity-100 translate-x-0 md:translate-y-0 translate-y-0' : 'opacity-0 translate-y-12 md:translate-y-0 md:translate-x-8'}`}
            style={{ top: typeof window !== 'undefined' && window.innerWidth < 768 ? 'auto' : '0' }}
          >
            <div className="max-w-md w-full mx-auto md:mx-0 mt-12 md:mt-0">
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

          <div className={`absolute top-6 right-6 md:top-10 md:right-10 z-50 flex space-x-2 transition-opacity duration-300 pointer-events-auto ${animState === 'open' ? 'opacity-100' : 'opacity-0'}`}>
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
