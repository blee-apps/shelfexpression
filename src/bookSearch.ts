// Book search for the admin tool: asks Apple Books, Google Books and
// OpenLibrary at the same time, then merges results that are the same book.

export type CoverCandidate = { url: string; label: string };

export type BookResult = {
  key: string;
  title: string;
  author: string;
  year?: number;
  publisher?: string;
  isbns: string[]; // best first
  thumb?: string;
  covers: CoverCandidate[];
  synopses: string[];
  sources: string[];
  olKey?: string;
  grId?: string;
};

type Hit = Omit<BookResult, 'key' | 'sources' | 'synopses'> & { source: string; synopsis?: string; originalYear?: boolean };

const TIMEOUT_MS = 8000;

// Gives up after a few seconds, or as soon as a newer search starts.
const fetchJson = async (url: string, signal: AbortSignal) => {
  const ac = new AbortController();
  const stop = () => ac.abort();
  const timer = setTimeout(stop, TIMEOUT_MS);
  signal.addEventListener('abort', stop);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
};

// "The Name of the Wind: The Kingkiller Chronicle, Day One" → "the name of the wind"
const simplifyTitle = (t: string) =>
  t.toLowerCase().split(/[:(\[]/)[0].replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
const lastName = (a: string) => (a.trim().split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z]/g, '');

// Apple and Google often add "A Novel" or series info after a colon.
const cleanTitle = (t: string) => t.replace(/\s*[:(]\s*a novel\)?\s*$/i, '').trim();

const stripHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
};

const yearOf = (d?: string) => {
  const m = d?.match(/\d{4}/);
  return m ? parseInt(m[0], 10) : undefined;
};

async function searchApple(title: string, author: string, signal: AbortSignal): Promise<Hit[]> {
  const term = encodeURIComponent(`${title} ${author}`.trim());
  const data = await fetchJson(`https://itunes.apple.com/search?term=${term}&media=ebook&entity=ebook&limit=10&country=us`, signal);
  return (data.results || []).map((r: any): Hit => {
    const art: string = r.artworkUrl100 || '';
    return {
      source: 'Apple Books',
      title: cleanTitle(r.trackName || ''),
      author: r.artistName || '',
      year: yearOf(r.releaseDate),
      isbns: [],
      thumb: art.replace(/\/\d+x\d+bb\./, '/200x200bb.'),
      covers: art ? [{ url: art.replace(/\/\d+x\d+bb\./, '/2400x2400bb.'), label: 'Apple Books' }] : [],
      synopsis: r.description ? stripHtml(r.description) : undefined,
    };
  });
}

async function searchGoogle(title: string, author: string, gbKey: string, signal: AbortSignal): Promise<Hit[]> {
  const parts: string[] = [];
  if (title) parts.push(`intitle:${title}`);
  if (author) parts.push(`inauthor:${author}`);
  const key = gbKey ? `&key=${gbKey}` : '';
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(parts.join(' '))}&maxResults=10&printType=books${key}`, signal);
  return (data.items || []).map((it: any): Hit => {
    const v = it.volumeInfo || {};
    const ids: { type: string; identifier: string }[] = v.industryIdentifiers || [];
    const isbn13 = ids.filter(i => i.type === 'ISBN_13').map(i => i.identifier);
    const isbn10 = ids.filter(i => i.type === 'ISBN_10').map(i => i.identifier);
    const thumb: string | undefined = v.imageLinks?.thumbnail?.replace('http:', 'https:');
    const covers: CoverCandidate[] = [];
    if (thumb) {
      covers.push({ url: `https://books.google.com/books/publisher/content/images/frontcover/${it.id}?fife=w1600-h2400&source=gbs_api`, label: 'Google Books' });
      covers.push({ url: thumb.replace('zoom=1', 'zoom=2').replace('&edge=curl', ''), label: 'Google Books' });
    }
    return {
      source: 'Google Books',
      title: cleanTitle(v.title || ''),
      author: v.authors?.[0] || '',
      year: yearOf(v.publishedDate),
      publisher: v.publisher,
      isbns: [...isbn13, ...isbn10],
      thumb,
      covers,
      synopsis: v.description ? stripHtml(v.description) : undefined,
    };
  });
}

async function searchOpenLibrary(title: string, author: string, signal: AbortSignal): Promise<Hit[]> {
  const params = new URLSearchParams({ limit: '10', fields: 'key,title,author_name,first_publish_year,isbn,cover_i,id_goodreads,publisher' });
  if (title) params.set('title', title);
  if (author) params.set('author', author);
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`, signal);
  return (data.docs || []).map((d: any): Hit => ({
    source: 'OpenLibrary',
    title: d.title || '',
    author: d.author_name?.[0] || '',
    year: d.first_publish_year,
    originalYear: true,
    publisher: d.publisher?.[0],
    isbns: (d.isbn || []).slice(0, 8),
    thumb: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
    covers: d.cover_i ? [{ url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, label: 'OpenLibrary' }] : [],
    olKey: d.key,
    grId: d.id_goodreads?.[0],
  }));
}

export async function searchBooks(
  title: string,
  author: string,
  gbKey: string,
  signal: AbortSignal,
): Promise<{ results: BookResult[]; failed: string[] }> {
  const sources = [
    { name: 'Apple Books', run: () => searchApple(title, author, signal) },
    { name: 'Google Books', run: () => searchGoogle(title, author, gbKey, signal) },
    { name: 'OpenLibrary', run: () => searchOpenLibrary(title, author, signal) },
  ];
  const settled = await Promise.allSettled(sources.map(s => s.run()));
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const failed = sources.filter((_, i) => settled[i].status === 'rejected').map(s => s.name);

  // Interleave so each source's best match comes before anyone's second best.
  const lists = settled.map(s => (s.status === 'fulfilled' ? s.value : []));
  const hits: { hit: Hit; rank: number }[] = [];
  for (let rank = 0; rank < 10; rank++) lists.forEach(l => l[rank] && hits.push({ hit: l[rank], rank }));

  const groups = new Map<string, BookResult & { originalYear?: boolean; firstRank: number; titleFromApple: boolean }>();
  for (const { hit, rank } of hits) {
    if (!hit.title) continue;
    const key = `${simplifyTitle(hit.title)}|${lastName(hit.author)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        key, title: hit.title, author: hit.author, year: hit.year, publisher: hit.publisher,
        isbns: [...hit.isbns], thumb: hit.thumb, covers: [...hit.covers],
        synopses: hit.synopsis ? [hit.synopsis] : [], sources: [hit.source],
        olKey: hit.olKey, grId: hit.grId, originalYear: hit.originalYear, firstRank: rank,
        titleFromApple: hit.source === 'Apple Books',
      });
      continue;
    }
    if (!g.sources.includes(hit.source)) g.sources.push(hit.source);
    // OpenLibrary knows the original publication year; otherwise keep the earliest.
    if (hit.originalYear && hit.year) { g.year = hit.year; g.originalYear = true; }
    else if (!g.originalYear && hit.year && (!g.year || hit.year < g.year)) g.year = hit.year;
    // Prefer OpenLibrary / Google's tidier title over Apple's.
    if (hit.source !== 'Apple Books' && g.titleFromApple) { g.title = hit.title; g.titleFromApple = false; }
    g.publisher ||= hit.publisher;
    // Google's ISBNs belong to a real, matching edition, so they go first.
    g.isbns = hit.source === 'Google Books' ? [...hit.isbns, ...g.isbns] : [...g.isbns, ...hit.isbns];
    if (hit.source === 'Apple Books' && hit.thumb) g.thumb = hit.thumb; // Apple's thumbnails look best
    else g.thumb ||= hit.thumb;
    for (const c of hit.covers) if (!g.covers.some(x => x.url === c.url)) g.covers.push(c);
    if (hit.synopsis && !g.synopses.includes(hit.synopsis)) g.synopses.push(hit.synopsis);
    g.olKey ||= hit.olKey;
    g.grId ||= hit.grId;
  }

  const results = [...groups.values()]
    .map(g => ({ ...g, isbns: [...new Set(g.isbns)] }))
    // Books found by several sources are more likely the real thing.
    .sort((a, b) => b.sources.length - a.sources.length || a.firstRank - b.firstRank)
    .slice(0, 12)
    .map(({ originalYear: _o, firstRank: _f, titleFromApple: _t, ...rest }) => rest);
  return { results, failed };
}

// Loads an image to learn its real size. No CORS needed just to measure.
export const measureImage = (url: string): Promise<{ w: number; h: number } | null> =>
  new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(null); }, TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
