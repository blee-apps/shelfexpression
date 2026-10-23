import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Copy, GripVertical, Upload, RotateCw, ChevronLeft, ChevronRight, Sparkles, Plus, Share2, ClipboardPaste } from 'lucide-react';
import { coverCache, fetchingSet, aspectRatioCache } from '../digital_bookshelf';
import { Book, USE_VITSOE_SHELF, SHARE_FOOTER } from './books';
import ShareStudio from './share/ShareStudio';
import shelfContent from '../content/books.json';
import { SITE } from '../content/site';
import { getToken } from './github';
import { pendingCovers, coverSrc, addPendingCover, fetchCover, resizeCover, describeChanges, publish, PublishError, PublishResult,
  markCoversPublished, canonicalShelf, fetchLatestShelf, fetchPublishedCover, deployStatus, Deploy, Draft, loadDraft, saveDraft, clearDraft, restoreDraftCovers } from './publish';
import coverManifest from './generated/cover-manifest.json';
import { searchBooks, measureImage, BookResult, CoverCandidate } from './bookSearch';

interface Props {
  onClose: () => void;
  books: Book[];
  // On the live site: removes the saved GitHub key from this device.
  onForgetKey?: () => void;
  // Guest mode: try the editor and share studio without a key. Nothing is
  // published or kept as a draft.
  guest?: boolean;
}

const SLOT_COUNT = 24;
// editingIndex value for a brand-new book, which goes in at the top.
const NEW_BOOK = -2;
// Keeps books together at the start, with the empty slots after them.
const compact = (list: (Book | null)[]) => {
  const filled = list.filter((b): b is Book => b !== null).slice(0, SLOT_COUNT);
  return [...filled, ...new Array(SLOT_COUNT - filled.length).fill(null)] as (Book | null)[];
};

type CoverOption = { url: string; label: string; preview?: string; isCurrent?: boolean; w?: number; h?: number };

// Covers shorter than this look soft on the shelf.
const LOW_RES_HEIGHT = 800;

// Accepts a Goodreads link or a bare ID and returns just the ID.
const goodreadsIdFrom = (text: string) => {
  const m = text.match(/goodreads\.com\/book\/show\/(\d+)/) || text.trim().match(/^(\d+)(?:[-.].*)?$/);
  return m ? m[1] : text.trim();
};

// Turns a value into a safe string literal for old books.ts code (escapes quotes,
// backslashes and line breaks), so generated code always compiles.
const lit = (s: string) => JSON.stringify(s);

// Reads a quoted string literal ('...' or "...") starting at `start`,
// understanding escapes like \' \" \n. Returns the text and where it ends.
const readStringLiteral = (src: string, start: number): { value: string; end: number } => {
  const quote = src[start];
  let out = '';
  let i = start + 1;
  while (i < src.length && src[i] !== quote) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
        i += 4;
      } else out += n;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return { value: out, end: i };
};
const gbKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY || '';
const gbUrl = (path: string) => path + (gbKey ? `&key=${gbKey}` : '');
// The OpenRouter key is only read when running locally (`npm run dev`).
// In a production build, `import.meta.env.DEV` is false, so the key is never
// copied into the public JavaScript files and Summarize is hidden.
const orKey: string = import.meta.env.DEV ? (import.meta.env.VITE_OPENROUTER_API_KEY || '') : '';
const OR_STORAGE_KEY = 'orModel';
const SEARCH_HINT = 'Type a title and author, then press Enter. Searches Apple Books, Google Books and OpenLibrary.';

export default function UpdateTool({ onClose, books, onForgetKey, guest = false }: Props) {
  const [slots, setSlots] = useState<(Book | null)[]>(() => {
    const arr: (Book | null)[] = new Array(SLOT_COUNT).fill(null);
    books.forEach((b, i) => {
      if (i < SLOT_COUNT) arr[i] = { ...b };
    });
    return arr;
  });
  const [editingIndex, setEditingIndex] = useState(-1);
  const [generatedCode, setGeneratedCode] = useState('');
  const [toast, setToast] = useState('');
  const [useVitsoeShelf, setUseVitsoeShelf] = useState(USE_VITSOE_SHELF);

  // Publishing (live site only). `baseJson` is the books.json this editor
  // started from, so Publish can tell if GitHub changed in the meantime.
  const [baseJson, setBaseJson] = useState(() => JSON.stringify(shelfContent, null, 2) + '\n');
  const [publishToTest, setPublishToTest] = useState(() => localStorage.getItem('bookshelf.publishTarget') !== 'live');
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{ text: string; error?: boolean; result?: PublishResult } | null>(null);
  const [deploy, setDeploy] = useState<Deploy | null>(null);
  const [startupDone, setStartupDone] = useState(import.meta.env.DEV);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(null);

  // Edit form fields
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editIsbn, setEditIsbn] = useState('');
  const [editGr, setEditGr] = useState('');
  const [editSynopsis, setEditSynopsis] = useState('');
  const [synopsisOptions, setSynopsisOptions] = useState<string[]>([]);
  const [synopsisIndex, setSynopsisIndex] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  // `preview` is what the picker shows; `url` is what gets saved as coverUrl.
  // The book's existing cover is always offered first, labeled "Current".
  const [coverOptions, setCoverOptions] = useState<CoverOption[]>([]);
  const coverRequestId = useRef(0);
  const [coversLoading, setCoversLoading] = useState(false);
  const [coverIndex, setCoverIndex] = useState(0);
  const [coverLocked, setCoverLocked] = useState(false);
  const [shareMode, setShareMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedForShare, setSelectedForShare] = useState<Set<number>>(new Set());
  const [studioOpen, setStudioOpen] = useState(false);
  // Footer line on share images. Starts as the site address, then remembers
  // what you type (on this device right away, and in books.json on publish).
  const [shareFooter, setShareFooter] = useState<string | undefined>(() => {
    if (SHARE_FOOTER !== undefined) return SHARE_FOOTER;
    try { return localStorage.getItem('bookshelf.shareFooter') ?? undefined; } catch { return undefined; }
  });
  const footerText = shareFooter ?? (SITE.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const changeFooter = (text: string) => {
    setShareFooter(text);
    try { localStorage.setItem('bookshelf.shareFooter', text); } catch {}
  };
  // Picks up settings saved alongside the books.
  const applyMeta = (data: any) => {
    if (data && !Array.isArray(data)) {
      if (typeof data.useVitsoeShelf === 'boolean') setUseVitsoeShelf(data.useVitsoeShelf);
      if (typeof data.share?.footer === 'string') setShareFooter(data.share.footer);
    }
  };

  // OpenRouter model state
  const [models, setModels] = useState<{ id: string; name: string; free: boolean }[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(OR_STORAGE_KEY) || '');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAuthorQuery, setSearchAuthorQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BookResult[]>([]);
  const [searchStatus, setSearchStatus] = useState(SEARCH_HINT);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Goodreads match state
  const [grStatus, setGrStatus] = useState<{ text: string; warn?: boolean } | null>(null);
  const grRequestId = useRef(0);
  const [saving, setSaving] = useState(false);

  // Paste / load state
  const [pasteText, setPasteText] = useState('');

  // Drag state

  // File input ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Toast timer
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  const filledCount = slots.filter(b => b !== null).length;

  // --- PARSER ---
  const parseRAWBOOKS = (text: string): Book[] => {
    // Find `RAW_BOOKS = [` and walk to its matching `]`, skipping over quoted
    // text so brackets, braces or quotes inside a synopsis can't confuse it.
    const head = text.match(/RAW_BOOKS[^=]*=\s*\[/);
    if (!head || head.index === undefined) throw new Error('Could not find RAW_BOOKS array in the text.');
    const entries: { fields: Record<string, string>; raw: string }[] = [];
    let i = head.index + head[0].length;
    let depth = 0;
    let current: { fields: Record<string, string>; raw: string } | null = null;
    let key = '';
    let entryStart = -1;
    let closed = false;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const { value, end } = readStringLiteral(text, i);
        if (current && depth === 1 && key) { current.fields[key] = value; key = ''; }
        i = end + 1;
        continue;
      }
      if (ch === '{') {
        depth++;
        if (depth === 1) { current = { fields: {}, raw: '' }; entryStart = i; }
      } else if (ch === '}') {
        if (depth === 1 && current) { current.raw = text.slice(entryStart, i + 1); entries.push(current); current = null; }
        depth--;
      } else if (ch === ']' && depth === 0) {
        closed = true;
        break;
      } else if (current && depth === 1 && /[A-Za-z_]/.test(ch)) {
        const m = text.slice(i).match(/^([A-Za-z_]\w*)\s*:\s*/);
        if (m) {
          key = m[1];
          const after = text.slice(i + m[0].length);
          const val = after.match(/^(-?\d+(?:\.\d+)?|true|false)/);
          if (val) { current.fields[key] = val[1]; key = ''; i += m[0].length + val[1].length; continue; }
          i += m[0].length;
          continue;
        }
      }
      i++;
    }
    if (!closed || depth !== 0) throw new Error('Unbalanced brackets in RAW_BOOKS.');

    return entries.map(({ fields }) => ({
      id: fields.id || '',
      isbn: fields.isbn || '',
      title: fields.title || '',
      author: fields.author || '',
      year: parseInt(fields.year || '0', 10) || 0,
      synopsis: fields.synopsis || '',
      gr: fields.gr || '',
      mult: 1.0,
      coverUrl: fields.coverUrl || undefined,
      coverLocked: fields.coverLocked === 'true' || undefined,
    }));
  };

  const fillSlots = (parsed: Book[], quiet = false) => {
    const arr: (Book | null)[] = new Array(SLOT_COUNT).fill(null);
    // Fresh ids, so covers cached for the books shown before aren't reused.
    const stamp = Date.now().toString(36);
    parsed.forEach((book, i) => {
      if (i < SLOT_COUNT) arr[i] = { ...book, id: `${stamp}-${i + 1}` };
    });
    setSlots(arr);
    if (!quiet) showToast(`Loaded ${parsed.length} book${parsed.length !== 1 ? 's' : ''}.`);
  };

  const loadFromPaste = (text: string, quiet = false) => {
    try {
      // content/books.json (current format)
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const data = JSON.parse(trimmed);
        const list = Array.isArray(data) ? data : data.books;
        if (!Array.isArray(list)) throw new Error('No "books" list found in the JSON.');
        fillSlots(list.map((b: any) => ({
          id: String(b.id ?? ''), isbn: String(b.isbn ?? ''), title: String(b.title ?? ''), author: String(b.author ?? ''),
          year: Number(b.year) || 0, synopsis: String(b.synopsis ?? ''), gr: String(b.gr ?? ''), mult: 1.0,
          coverUrl: b.coverUrl || undefined, coverLocked: b.coverLocked === true || undefined,
        })), quiet);
        applyMeta(data);
        return;
      }
      // Older books.ts code (RAW_BOOKS array)
      const parsed = parseRAWBOOKS(text);
      fillSlots(parsed);
      const vitsoeMatch = text.match(/USE_VITSOE_SHELF\s*=\s*(true|false)/);
      if (vitsoeMatch) {
        setUseVitsoeShelf(vitsoeMatch[1] === 'true');
      }
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
  };

  const loadFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') loadFromPaste(text);
    };
    reader.readAsText(file);
  };

  const reloadFromApp = () => {
    const arr: (Book | null)[] = new Array(SLOT_COUNT).fill(null);
    books.forEach((b, i) => {
      if (i < SLOT_COUNT) arr[i] = { ...b };
    });
    setSlots(arr);
    showToast('Reloaded from app data.');
  };

  const handleLoadClick = () => {
    const text = pasteText.trim();
    if (text) loadFromPaste(text);
    else if (fileInputRef.current?.files?.length) loadFromFile(fileInputRef.current.files[0]);
    else showToast('Upload or paste content/books.json.');
  };

  const confirmRemove = (title: string) =>
    confirm(`Remove \u201c${title}\u201d from the shelf?`);

  const removeBook = (index: number) => {
    setSlots(prev => compact(prev.map((b, i) => i === index ? null : b)));
    showToast(`Removed slot #${index + 1}.`);
  };

  const moveBook = (from: number, to: number) => {
    if (from === to) return;
    setSlots(prev => {
      const next = [...prev];
      const book = next[from];
      if (!book) return prev;
      next.splice(from, 1);
      next.splice(to, 0, book);
      return next;
    });
    showToast(`Moved book #${from + 1} to #${to + 1}.`);
  };

  // --- SHARE IMAGE RENDERER ---
  const loadImg = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

  // The best available image of a book's cover, for the share studio.
  const loadCover = async (book: Book): Promise<HTMLImageElement | null> => {
    const cached = coverCache.get(book.id);
    if (cached) { try { return await loadImg(cached); } catch {} }
    if (book.coverUrl) { try { return await loadImg(coverSrc(book.coverUrl)); } catch {} }
    const m = coverManifest[(book.isbn || book.id) as keyof typeof coverManifest] as { path: string | null } | undefined;
    if (m?.path) { try { return await loadImg(m.path); } catch {} }
    return null;
  };

  const toggleShareSelection = (i: number) => {
    setSelectedForShare(prev => {
      const next = new Set(prev);
      if (next.has(i)) { next.delete(i); }
      else if (next.size >= 12) { return prev; }
      else { next.add(i); }
      return next;
    });
  };

  // Covers anyone can find from an ISBN alone.
  const isbnCovers = (isbn?: string): CoverCandidate[] => isbn ? [
    { url: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`, label: 'OpenLibrary (ISBN)' },
    { url: `https://covers.goodreads.com/bisbn/${isbn}-L.jpg`, label: 'Goodreads' },
  ] : [];

  // Fills the cover picker: measures every candidate, keeps the sharpest one
  // per source, and sorts sharpest first. `current` (the book's existing cover)
  // always stays first. `selectNew` picks the sharpest new cover instead of
  // keeping the current one (used after choosing a search result).
  const populateCoverOptions = async (
    candidates: CoverCandidate[],
    current?: CoverOption | null,
    selectNew = false,
  ) => {
    const requestId = ++coverRequestId.current;
    setCoversLoading(true);
    const measured = await Promise.all(candidates.map(async c => ({ ...c, size: await measureImage(c.url) })));
    // Ignore results from an older lookup (e.g. you opened another book meanwhile).
    if (requestId !== coverRequestId.current) return;
    const bestPerSource = new Map<string, CoverOption>();
    for (const c of measured) {
      // Missing covers come back as tiny placeholder images.
      if (!c.size || c.size.h < 100 || (current && c.url === current.url)) continue;
      const prev = bestPerSource.get(c.label);
      if (!prev || c.size.w * c.size.h > (prev.w || 0) * (prev.h || 0)) {
        bestPerSource.set(c.label, { url: c.url, label: c.label, w: c.size.w, h: c.size.h });
      }
    }
    // The same image often comes back twice from one source (e.g. OpenLibrary by
    // cover ID and by ISBN); keep just one.
    const found = [...bestPerSource.values()]
      .sort((a, b) => (b.w! * b.h!) - (a.w! * a.h!))
      .filter((c, i, all) => !all.slice(0, i).some(o => o.w === c.w && o.h === c.h && o.label.split(' ')[0] === c.label.split(' ')[0]));
    setCoversLoading(false);
    setCoverOptions(current ? [current, ...found] : found);
    setCoverIndex(current && selectNew && found.length > 0 ? 1 : 0);
  };

  // The cover a slot already has, as a picker option.
  const currentCoverOption = (book: Book | null): CoverOption | null => {
    if (!book) return null;
    if (book.coverUrl) return { url: book.coverUrl, preview: pendingCovers.has(book.coverUrl) ? coverSrc(book.coverUrl) : undefined, label: 'Current', isCurrent: true };
    // No override: the site uses the build-time cover. Keep it that way unless changed.
    const local = coverManifest[(book.isbn || book.id) as keyof typeof coverManifest] as { path: string | null } | undefined;
    const preview = coverCache.get(book.id) || local?.path || undefined;
    return { url: '', preview, label: 'Current (automatic)', isCurrent: true };
  };

  const openEdit = (index: number) => {
    setEditingIndex(index);
    const book = slots[index];
    setEditTitle(book?.title || '');
    setEditAuthor(book?.author || '');
    setEditYear(String(book?.year || ''));
    setEditIsbn(book?.isbn || '');
    setEditGr(book?.gr || '');
    setEditSynopsis(book?.synopsis || '');
    setSynopsisOptions([]);
    setSynopsisIndex(0);
    setSearchQuery(book?.title || '');
    setSearchAuthorQuery(book?.author || '');
    setSearchStatus(SEARCH_HINT);
    setSearchResults([]);
    grRequestId.current++;
    setGrStatus(null);
    setCoverLocked(book?.coverLocked || false);
    // Show the current cover right away (and drop the previous book's options).
    const current = currentCoverOption(book);
    setCoverOptions(current ? [current] : []);
    setCoverIndex(0);
    populateCoverOptions(isbnCovers(book?.isbn), current);
  };

  const saveEdit = async (): Promise<boolean> => {
    const title = editTitle.trim();
    const author = editAuthor.trim();
    if (!title) { showToast('Title is required.'); return false; }
    if (!author) { showToast('Author is required.'); return false; }

    // A cover picked from the web gets saved into the project (when running
    // locally), so the site serves its own copy and the build keeps it.
    const picked = coverOptions[coverIndex];
    let coverUrl = picked ? picked.url : slots[editingIndex]?.coverUrl || '';
    let locked = coverLocked;
    const isNew = editingIndex === NEW_BOOK;
    if (isNew && filledCount >= SLOT_COUNT) { showToast(`The shelf is full (${SLOT_COUNT} books). Remove one first.`); return false; }
    const coverKey = editIsbn.trim() || (isNew ? 'new' : String(editingIndex + 1));
    // On the live site, the picked cover is downloaded and resized now, and
    // uploaded to GitHub when you publish.
    if (!import.meta.env.DEV && picked && !picked.isCurrent && /^https:\/\//.test(picked.url)) {
      setSaving(true);
      try {
        coverUrl = addPendingCover(coverKey, await fetchCover(picked.url));
      } catch (err: any) {
        setSaving(false);
        showToast(`Couldn't get that cover (${err.message}). Pick another or upload one.`);
        return false;
      }
      setSaving(false);
    }
    if (import.meta.env.DEV && picked && !picked.isCurrent && /^https:\/\//.test(picked.url)) {
      setSaving(true);
      const key = coverKey;
      try {
        const res = await fetch(`/api/save-cover?key=${encodeURIComponent(key)}&src=${encodeURIComponent(picked.url)}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        coverUrl = data.path;
        locked = true;
        setCoverLocked(true);
      } catch (err: any) {
        showToast(`Couldn't save the cover file (${err.message}). Using the web link instead.`);
      }
      setSaving(false);
    }

    // Keep the book's id when editing (ids follow a book when it's moved), so
    // its cached cover isn't mixed up with another book's.
    const bookId = slots[editingIndex]?.id || `new-${Date.now()}`;
    setSlots(prev => {
      const next = [...prev];
      const saved: Book = {
        id: bookId,
        isbn: editIsbn.trim(),
        title,
        author,
        year: parseInt(editYear, 10) || 0,
        synopsis: editSynopsis.trim(),
        gr: (editGr || '').trim(),
        mult: 1.0,
        // Keep the existing cover unless a different one was picked.
        coverUrl: coverUrl || '',
        coverLocked: locked || undefined,
      };
      // A new book goes in at the top and pushes the rest down.
      if (isNew) return compact([saved, ...prev]);
      next[editingIndex] = saved;
      return next;
    });
    coverCache.delete(bookId);
    aspectRatioCache.delete(bookId);
    showToast(isNew ? `Added \u201c${title}\u201d at the top.` : `Saved \u201c${title}\u201d.`);
    return true;
  };

  const clearSlot = () => {
    if (editingIndex === NEW_BOOK) return;
    setSlots(prev => compact(prev.map((b, i) => i === editingIndex ? null : b)));
    showToast(`Removed book #${editingIndex + 1}.`);
  };

  // --- SEARCH ---
  const doSearch = async () => {
    const title = searchQuery.trim();
    const author = searchAuthorQuery.trim();
    if (!title && !author) { showToast('Enter at least a title or author.'); return; }

    setSearching(true);
    setSearchStatus('Searching Apple Books, Google Books and OpenLibrary…');
    setSearchResults([]);

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const { results, failed } = await searchBooks(title, author, gbKey, ac.signal);
      const note = failed.length ? ` (${failed.join(' and ')} didn't respond.)` : '';
      setSearchStatus(results.length
        ? `${results.length} book${results.length !== 1 ? 's' : ''} found. Pick the right one.${note}`
        : `No results. Try fewer words or check the spelling.${note}`);
      setSearchResults(results);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setSearchStatus('Search failed. Check your connection.');
    }
    setSearching(false);
  };

  // --- SYNOPSIS HELPERS ---
  const olWorkSynopsis = async (key: string): Promise<string> => {
    try {
      const r = await fetch(`https://openlibrary.org${key}.json`);
      const detail = await r.json();
      const desc = detail.description;
      if (typeof desc === 'string') return desc;
      if (desc?.value) return desc.value;
      return '';
    } catch { return ''; }
  };

  const summarizeSynopsis = async () => {
    if (!editSynopsis || !orKey || !selectedModel) return;
    setSummarizing(true);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${orKey}` },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'user', content: `Summarize this book synopsis in 2-3 short, punchy sentences. Keep it tight — avoid long clauses, elaborate phrasing, and unnecessary detail. Preserve the key details and tone:\n\n${editSynopsis}` }],
        }),
      });
      if (!r.ok) {
        showToast(`Summarize failed (${r.status}${r.status === 429 ? ' — rate limited. Try a different model or wait.' : ''})`);
      } else {
        const data = await r.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) {
          setEditSynopsis(text);
          setSynopsisOptions([]);
          setSynopsisIndex(0);
        } else {
          showToast('Summarize returned empty response.');
        }
      }
    } catch {
      showToast('Summarize failed — network error.');
    }
    setSummarizing(false);
  };

  // Finds the book's Goodreads page through /api/goodreads (a Vercel function
  // on the live site, the dev server locally), since Goodreads blocks direct
  // requests from the browser.
  const findGoodreads = async (r: BookResult) => {
    const requestId = ++grRequestId.current;
    setGrStatus({ text: 'Finding it on Goodreads…' });
    try {
      const params = new URLSearchParams({ isbn: r.isbns.slice(0, 6).join(','), title: r.title, author: r.author });
      const res = await fetch(`/api/goodreads?${params}`);
      if (requestId !== grRequestId.current) return;
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data?.id) throw new Error();
      setEditGr(String(data.id));
      setGrStatus(data.via === 'isbn'
        ? { text: 'Matched on Goodreads by ISBN.' }
        : { text: 'Best guess from a Goodreads search. Open it to check.', warn: true });
    } catch {
      if (requestId !== grRequestId.current) return;
      if (r.grId) { setEditGr(r.grId); setGrStatus({ text: 'Linked from OpenLibrary. Worth a quick check.' }); }
      else setGrStatus({ text: "Couldn't find it on Goodreads. Paste the link instead.", warn: true });
    }
  };

  const selectResult = async (r: BookResult) => {
    setEditTitle(r.title);
    setEditAuthor(r.author);
    setEditYear(r.year ? String(r.year) : '');
    const isbn = r.isbns[0] || '';
    setEditIsbn(isbn);
    setEditGr('');
    setSearchStatus(`Filled in from ${r.sources.join(', ')}. Check the details, then Save.`);

    findGoodreads(r);
    populateCoverOptions([...r.covers, ...isbnCovers(isbn)], currentCoverOption(slots[editingIndex] ?? null), true);

    // Synopses: what the search returned, plus OpenLibrary's if it has one.
    let options = [...r.synopses];
    setSynopsisOptions(options);
    setSynopsisIndex(0);
    setEditSynopsis(options[0] || '');
    if (r.olKey) {
      const extra = await olWorkSynopsis(r.olKey);
      if (extra && !options.includes(extra)) {
        options = [...options, extra];
        setSynopsisOptions(options);
        if (options.length === 1) setEditSynopsis(extra);
      }
    }
  };

  // --- CODE GENERATION ---
  // The shelf as content/books.json text.
  const buildJson = () => {
    const filled = slots.filter((b): b is Book => b !== null);
    const books = filled.map((book, i) => {
      const entry: Record<string, unknown> = {
        id: String(i + 1), isbn: book.isbn || '', title: book.title || '', author: book.author || '',
        year: Number(book.year) || 0, synopsis: book.synopsis || '', gr: book.gr || '',
      };
      if (book.coverUrl) entry.coverUrl = book.coverUrl;
      return entry;
    });
    const data: Record<string, unknown> = { useVitsoeShelf, books };
    if (shareFooter !== undefined) data.share = { footer: shareFooter };
    return JSON.stringify(data, null, 2) + '\n';
  };

  const generateCode = () => {
    if (filledCount === 0) {
      showToast('No books to encode.');
      return;
    }
    setGeneratedCode(buildJson());
    showToast(`Code generated (${filledCount} books).`);
  };

  // --- PUBLISH ---
  const currentJson = buildJson();
  const sameJson = (a: string, b: string) => canonicalShelf(a) === canonicalShelf(b);
  const hasChanges = !sameJson(currentJson, baseJson);

  const validate = (): string | null => {
    const filled = slots.filter((b): b is Book => b !== null);
    if (!filled.length) return 'The shelf is empty.';
    const missing = filled.find(b => !b.title.trim() || !b.author.trim());
    if (missing) return `A book is missing its ${missing.title.trim() ? 'author' : 'title'}.`;
    const web = filled.find(b => b.coverUrl && /^https?:/.test(b.coverUrl));
    if (web) return `\u201c${web.title}\u201d still uses a cover from another website. Edit it and save the cover again.`;
    return null;
  };

  const doPublish = async () => {
    const problem = validate();
    if (problem) { setPublishStatus({ text: problem, error: true }); return; }
    const token = getToken();
    if (!token) { setPublishStatus({ text: 'No GitHub key on this device. Close the editor and open it again to add one.', error: true }); return; }
    const json = currentJson;
    const { summary, details } = describeChanges(JSON.parse(baseJson), JSON.parse(json));
    const message = `${summary}\n\n${details.map(d => `- ${d}`).join('\n')}\n\nPublished from the bookshelf editor.`;
    setPublishing(true);
    setDeploy(null);
    try {
      const result = await publish({ token, json, baseJson, message, toTest: publishToTest, onStep: text => setPublishStatus({ text }) });
      if (!publishToTest) { setBaseJson(json); markCoversPublished(); clearDraft(); }
      pollDeploy(result.commit);
      setPublishStatus({
        text: publishToTest
          ? `Published to the test branch (${result.branch}).`
          : 'Published to the live site.',
        result,
      });
    } catch (err: any) {
      setPublishStatus({ text: err instanceof PublishError ? err.message : `Publish failed: ${err.message}`, error: true });
    }
    setPublishing(false);
  };

  const copyCode = async () => {
    if (!generatedCode) { showToast('Generate code first.'); return; }
    try {
      await navigator.clipboard.writeText(generatedCode);
      showToast('Copied to clipboard.');
    } catch {
      showToast('Copy failed. Select and copy manually.');
    }
  };

  // Opening on the live site: load the newest shelf from GitHub (the site can
  // be a few minutes behind after a publish), then offer any unpublished draft.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (guest) { setStartupDone(true); return; }
    (async () => {
      const token = getToken();
      const latest = token ? await fetchLatestShelf(token) : null;
      if (latest && !sameJson(latest, baseJson)) {
        try {
          const shown = new Set(Object.values(coverManifest).map(m => (m as { path: string | null }).path));
          const missing = (JSON.parse(latest).books as { coverUrl?: string }[])
            .map(b => b.coverUrl || '')
            .filter(u => /^\/covers\/[^/]+$/.test(u) && !shown.has(u) && !pendingCovers.has(u));
          await Promise.all(missing.map(u => fetchPublishedCover(token, u)));
          loadFromPaste(latest, true);
          applyMeta(JSON.parse(latest));
          setBaseJson(latest);
          setPublishStatus({ text: 'Loaded the newest shelf from GitHub. The live site is still catching up.' });
        } catch {}
      }
      const draft = loadDraft();
      if (draft && !sameJson(draft.json, latest || baseJson)) setDraftOffer(draft);
      else if (draft) clearDraft();
      setStartupDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep unpublished changes on this device as you work.
  useEffect(() => {
    if (import.meta.env.DEV || guest || !startupDone || draftOffer) return;
    if (hasChanges) saveDraft({ json: currentJson, baseJson, savedAt: Date.now() });
    else clearDraft();
  }, [currentJson, baseJson, startupDone, draftOffer, hasChanges]);

  const restoreDraft = async () => {
    if (!draftOffer) return;
    await restoreDraftCovers();
    loadFromPaste(draftOffer.json, true);
    try { applyMeta(JSON.parse(draftOffer.json)); } catch {}
    setPublishStatus(sameJson(draftOffer.baseJson, baseJson)
      ? { text: 'Restored your unpublished changes.' }
      : { text: 'Restored your unpublished changes. The shelf was changed elsewhere since then, and publishing will replace those changes.', error: true });
    setDraftOffer(null);
  };

  const discardDraft = () => { clearDraft(); setDraftOffer(null); };

  // After publishing, follow the Vercel build for that commit.
  const pollDeploy = (sha: string) => {
    const token = getToken();
    const started = Date.now();
    setDeploy({ state: 'waiting' });
    const tick = async () => {
      let d: Deploy = { state: 'waiting' };
      try { d = await deployStatus(token, sha); } catch {}
      setDeploy(d);
      const done = d.state === 'ready' || d.state === 'failed' || d.state === 'no-access';
      if (!done && Date.now() - started < 8 * 60 * 1000) setTimeout(tick, 6000);
    };
    setTimeout(tick, 4000);
  };

  // --- DRAG TO REORDER ---
  // Works with a mouse, trackpad or finger. With a mouse, drag the whole card.
  // On a touch screen, drag by the #number handle, so the page still scrolls.
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState(-1);
  const [dragOver, setDragOver] = useState(-1);
  const drag = useRef<{
    from: number; pointerId: number; x0: number; y0: number; x: number; y: number;
    scroll0: number; started: boolean; el: HTMLElement; over: number; raf: number;
  } | null>(null);
  const justDragged = useRef(false);

  const placeDragged = () => {
    const d = drag.current;
    if (!d || !d.started) return;
    const scrolled = (scrollRef.current?.scrollTop || 0) - d.scroll0;
    d.el.style.transform = `translate(${d.x - d.x0}px, ${d.y - d.y0 + scrolled}px) scale(1.03)`;
    // Which slot is under the pointer?
    let over = -1;
    Array.from(gridRef.current?.children || []).forEach((child, i) => {
      if (i === d.from) return;
      const r = child.getBoundingClientRect();
      if (d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom) over = i;
    });
    if (over !== d.over) { d.over = over; setDragOver(over); }
  };

  // Scrolls the editor while a book is held near its top or bottom edge.
  const autoScroll = () => {
    const d = drag.current;
    const box = scrollRef.current;
    if (!d || !box) return;
    const r = box.getBoundingClientRect();
    const edge = 70;
    const speed = d.y < r.top + edge ? -Math.ceil((r.top + edge - d.y) / 5) : d.y > r.bottom - edge ? Math.ceil((d.y - (r.bottom - edge)) / 5) : 0;
    if (speed) { box.scrollTop += speed; placeDragged(); }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const startDrag = () => {
    const d = drag.current!;
    d.started = true;
    setDragFrom(d.from);
    d.raf = requestAnimationFrame(autoScroll);
  };

  const onSlotPointerDown = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (shareMode || !slots[i] || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, select, textarea')) return;
    const onHandle = !!target.closest('.admin-grip');
    if (e.pointerType !== 'mouse' && !onHandle) return;
    if (e.pointerType === 'mouse') e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      from: i, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      scroll0: scrollRef.current?.scrollTop || 0, started: false, el: e.currentTarget, over: -1, raf: 0,
    };
    // A finger on the handle starts dragging at once.
    if (onHandle && e.pointerType !== 'mouse') startDrag();
  };

  const onSlotPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.started && Math.hypot(d.x - d.x0, d.y - d.y0) > 6) startDrag();
    placeDragged();
  };

  const onSlotPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    if (!d.started) return;
    d.el.style.transform = '';
    setDragFrom(-1);
    setDragOver(-1);
    justDragged.current = true; // so letting go doesn't also count as a click
    setTimeout(() => { justDragged.current = false; }, 0);
    if (e.type === 'pointerup' && d.over >= 0 && d.over !== d.from) moveBook(d.from, d.over);
  };

  useEffect(() => {
    if (!orKey) { setModels([]); return; }
    const controller = new AbortController();
    fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal, headers: { 'Authorization': `Bearer ${orKey}` } })
      .then(r => r.json())
      .then(data => {
        const list: { id: string; name: string; free: boolean }[] = (data?.data || [])
          .filter((m: any) => m.id.endsWith(':free') || (m.pricing?.prompt === 0 && m.pricing?.completion === 0))
          .map((m: any) => ({ id: m.id, name: m.name || m.id, free: true }))
          .concat(
            (data?.data || [])
              .filter((m: any) => !m.id.endsWith(':free') && (m.pricing?.prompt !== 0 || m.pricing?.completion !== 0))
              .map((m: any) => ({ id: m.id, name: m.name || m.id, free: false }))
          );
        setModels(list);
        const saved = localStorage.getItem(OR_STORAGE_KEY);
        if (saved && list.some(m => m.id === saved)) {
          setSelectedModel(saved);
        } else {
          const firstFree = list.find(m => m.free);
          setSelectedModel(firstFree?.id || list[0]?.id || '');
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [orKey]);

  useEffect(() => {
    if (selectedModel) localStorage.setItem(OR_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#FDFDFD', color: '#1a1a1a',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Manrope", sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
        padding: '12px 20px', borderBottom: '1px solid #eee', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#bbb', background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em' }}>
            ADMIN
          </span>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Bookshelf Editor</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          <button onClick={reloadFromApp} style={btnStyle({ secondary: true, small: true })}>Reload from App</button>
          {onForgetKey && (
            <button onClick={() => { if (confirm('Remove your GitHub key from this device? You\u2019ll need to paste it again to edit.')) onForgetKey(); }}
              style={btnStyle({ secondary: true, small: true })}>Forget key</button>
          )}
          <button onClick={onClose} style={btnStyle({ small: true })}><X size={14} /></button>
        </div>
      </div>

      {/* GUEST MODE */}
      {guest && !shareMode && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fafafa', fontSize: '0.8rem', color: '#555', lineHeight: 1.45 }}>
          <b style={{ color: '#1a1a1a' }}>Guest mode.</b> Look around and make share images. Your edits aren’t saved or published.
        </div>
      )}

      {/* PUBLISH (live site only) */}
      {!import.meta.env.DEV && !guest && !shareMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '8px 20px', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fafafa',
        }}>
          <select value={publishToTest ? 'test' : 'live'} disabled={publishing}
            onChange={e => { const t = e.target.value === 'test'; setPublishToTest(t); localStorage.setItem('bookshelf.publishTarget', t ? 'test' : 'live'); }}
            style={{ fontSize: '16px', padding: '4px 6px', borderRadius: 5, border: '1px solid #ddd', background: '#fff', color: '#1a1a1a', maxWidth: '100%' }}>
            <option value="test">Test preview ({SITE.github.testBranch})</option>
            <option value="live">Live site ({SITE.github.branch})</option>
          </select>
          <button onClick={doPublish} disabled={publishing || !hasChanges}
            style={{ ...btnStyle({ small: true }), ...(publishing || !hasChanges ? { opacity: 0.45, cursor: publishing ? 'wait' : 'default' } : {}) }}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
          <span style={{ fontSize: '0.75rem', color: publishStatus?.error ? '#b42318' : '#888', flex: '1 1 200px', lineHeight: 1.4 }}>
            {publishStatus
              ? <>{publishStatus.text}{publishStatus.result && <> <a href={publishStatus.result.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>View commit</a></>}</>
              : hasChanges ? 'Unpublished changes, saved on this device.' : 'No changes to publish.'}
            {deploy && publishStatus?.result && (
              <span style={{ display: 'block', color: deploy.state === 'failed' ? '#b42318' : deploy.state === 'ready' ? '#1e7a3c' : '#888' }}>
                {deploy.state === 'waiting' && <><span className="admin-spinner" style={{ width: 9, height: 9, marginRight: 5, verticalAlign: -1 }} />Waiting for Vercel…</>}
                {deploy.state === 'building' && <><span className="admin-spinner" style={{ width: 9, height: 9, marginRight: 5, verticalAlign: -1 }} />Vercel is building…</>}
                {deploy.state === 'ready' && (publishStatus.result.branch === SITE.github.branch
                  ? <>Live now. <a href={window.location.origin} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Open the site</a></>
                  : <>Preview ready. {deploy.url && <a href={deploy.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Open the preview</a>}</>)}
                {deploy.state === 'failed' && <>Vercel's build failed. {deploy.url && <a href={deploy.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>See why</a>}</>}
                {deploy.state === 'no-access' && <>To see build progress here, give your key Deployments: Read-only.</>}
              </span>
            )}
          </span>
        </div>
      )}

      {/* UNPUBLISHED DRAFT */}
      {draftOffer && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '10px 20px', borderBottom: '1px solid #f0e0b0', flexShrink: 0, background: '#fff8e6',
        }}>
          <span style={{ fontSize: '0.8rem', flex: '1 1 200px', lineHeight: 1.4 }}>
            You have unpublished changes from {new Date(draftOffer.savedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
          </span>
          <button onClick={restoreDraft} style={btnStyle({ small: true })}>Restore</button>
          <button onClick={() => { if (confirm('Throw away these unpublished changes?')) discardDraft(); }} style={btnStyle({ secondary: true, small: true })}>Discard</button>
        </div>
      )}

      {shareMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 20px', borderBottom: '1px solid #eee', flexShrink: 0,
          background: '#fafafa',
        }}>
          <button onClick={() => { setShareMode(false); setSelectedForShare(new Set()); }} style={btnStyle({ secondary: true, small: true })}>Done</button>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1a1a1a' }}>
            {selectedForShare.size ? `${selectedForShare.size} of 12 picked` : 'Pick up to 12 books'}
          </span>
          {(() => {
            const maxSel = Math.min(12, slots.filter(s => s !== null).length);
            const allSelected = maxSel > 0 && selectedForShare.size >= maxSel;
            return (
              <button onClick={() => {
                if (allSelected) setSelectedForShare(new Set());
                else setSelectedForShare(new Set(slots.map((_, i) => slots[i] ? i : -1).filter(i => i >= 0).slice(0, 12)));
              }} style={btnStyle({ secondary: true, small: true })}>
                {allSelected ? 'Clear' : 'Select all'}
              </button>
            );
          })()}
          <div style={{ flex: 1 }} />
          <button onClick={() => setStudioOpen(true)} disabled={selectedForShare.size === 0}
            style={{ ...btnStyle({ small: true }), ...(selectedForShare.size === 0 ? { opacity: 0.45, cursor: 'default' } : {}) }}>
            Next
          </button>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {/* SHARE */}
        {!shareMode && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            border: '1px solid #eee', borderRadius: 10, padding: '12px 14px', marginBottom: 16,
            background: 'linear-gradient(135deg, #fafafa, #f3f1ee)',
          }}>
            <Share2 size={18} style={{ color: '#555', flexShrink: 0 }} />
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Share your favorites</div>
              <div style={{ fontSize: '0.75rem', color: '#888', lineHeight: 1.4 }}>Pick up to 12 books and make an image for Instagram Stories or posts.</div>
            </div>
            <button onClick={() => { setShareMode(true); setSelectedForShare(new Set()); }} style={btnStyle({ small: true })}>Make a share image</button>
          </div>
        )}

        {/* ADD BOOK */}
        {!shareMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <button onClick={() => openEdit(NEW_BOOK)} disabled={filledCount >= SLOT_COUNT}
              title={filledCount >= SLOT_COUNT ? `The shelf is full (${SLOT_COUNT} books). Remove one first.` : 'Add a book at the top'}
              style={{ ...btnStyle({ small: false }), ...(filledCount >= SLOT_COUNT ? { opacity: 0.45, cursor: 'default' } : {}) }}>
              <Plus size={15} /> Add book
            </button>
            <span style={{ fontSize: '0.75rem', color: '#999' }}>
              {filledCount >= SLOT_COUNT ? 'The shelf is full. Remove a book to add another.' : 'New books go in at the top.'}
            </span>
          </div>
        )}

        {(import.meta.env.DEV || showAdvanced) && <>
        {/* LOAD SECTION */}
        <div style={{
          background: '#f8f8f8', border: '1px solid #eee', borderRadius: 8,
          padding: 20, marginBottom: 20,
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>
              Upload <code>content/books.json</code>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.ts,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadFromFile(file);
              }}
              style={{ fontSize: '0.85rem', width: '100%' }}
            />
          </div>
          <div style={{ alignSelf: 'flex-end', paddingBottom: 2 }}>
            <span style={{ color: '#bbb', fontSize: '0.8rem' }}>or</span>
          </div>
          <div style={{ flex: 2, minWidth: 250 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>
              Or paste its contents here
            </label>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste everything from content/books.json"
              style={{
                width: '100%', height: 80, fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
                fontSize: '0.75rem', padding: 8, border: '1px solid #ddd', borderRadius: 4,
                resize: 'vertical',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-end' }}>
            <button onClick={handleLoadClick} style={btnStyle({ small: false })}><Upload size={14} /> Load</button>
            <button onClick={() => fileInputRef.current?.click()} style={btnStyle({ secondary: true, small: true })}><RotateCw size={12} /> Refresh</button>
          </div>
        </div>

        </>}

        {/* GRID */}
        <div ref={gridRef} style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 10, marginBottom: 20,
        }}>
          {slots.map((book, i) => book && (
            <div key={i}
              className={`admin-slot${dragFrom === i ? ' dragging' : ''}${dragOver === i ? ' drag-over' : ''}`}
              onPointerDown={onSlotPointerDown(i)}
              onPointerMove={onSlotPointerMove}
              onPointerUp={onSlotPointerUp}
              onPointerCancel={onSlotPointerUp}
              onDragStart={e => e.preventDefault()}
              onClickCapture={e => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); } }}
              style={{
                background: book ? '#fff' : '#fafafa',
                border: selectedForShare.has(i) ? '2px solid #1a1a1a' : book ? '1px solid #eee' : '1px dashed #ddd',
                borderRadius: 8, padding: 10, position: 'relative',
                display: 'flex', flexDirection: 'column', gap: 5,
                cursor: book ? (shareMode ? 'pointer' : 'grab') : 'pointer',
                minHeight: book ? 'auto' : 130,
                alignItems: book ? 'stretch' : 'center',
                justifyContent: book ? undefined : 'center',
                color: book ? undefined : '#bbb',
                fontSize: book ? undefined : '0.85rem',
                transition: 'box-shadow 0.15s',
              }}
              onClick={() => {
                if (shareMode && book) { toggleShareSelection(i); return; }
                // Tapping a book opens it for editing.
                openEdit(i);
              }}
            >
              {book ? (
                <>
                  {shareMode ? (
                    <div aria-label={selectedForShare.has(i) ? 'Picked' : 'Not picked'} style={{
                      position: 'absolute', top: 6, left: 6, zIndex: 2, width: 26, height: 26, borderRadius: 13,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                      background: selectedForShare.has(i) ? '#1a1a1a' : 'rgba(255,255,255,0.9)', color: '#fff',
                      border: selectedForShare.has(i) ? 'none' : '1.5px solid #bbb', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }}>
                      {selectedForShare.has(i) ? [...selectedForShare].indexOf(i) + 1 : ''}
                    </div>
                  ) : (
                    <div className="admin-grip" title="Drag to move" onClick={e => e.stopPropagation()}
                      style={{ position: 'absolute', top: 4, left: 4, zIndex: 2, fontSize: '0.65rem', fontWeight: 600, color: '#999', background: 'rgba(245,245,245,0.92)', padding: '5px 8px 5px 5px', borderRadius: 5, touchAction: 'none', cursor: 'grab', userSelect: 'none' }}>
                      <GripVertical size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />#{i + 1}
                    </div>
                  )}
                  <div style={{
                    width: '100%', aspectRatio: aspectRatioCache.get(book.id) || 2/3, background: '#f0f0f0', borderRadius: 4,
                    overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <BookCover book={book} />
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, overflowWrap: 'break-word' }}>
                    {book.title}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#888' }}>{book.author}</div>
                  <div style={{ fontSize: '0.68rem', color: '#aaa' }}>{book.year || ''}</div>
                  {!shareMode && (
                    <div style={{ display: 'flex', gap: 5, marginTop: 'auto', paddingTop: 4 }}>
                      <button onClick={(e) => { e.stopPropagation(); setShareMode(true); setSelectedForShare(new Set([i])); }}
                        title="Make a share image, starting with this book"
                        style={btnStyle({ secondary: true, small: true })}><Share2 size={12} /> Share</button>
                      <button onClick={(e) => { e.stopPropagation(); if (confirmRemove(book.title)) removeBook(i); }} style={{ ...btnStyle({ secondary: true, small: true }), color: '#c0392b' }}>Remove</button>
                    </div>
                  )}
                </>
              ) : (
                <span onClick={() => openEdit(i)} style={{ cursor: 'pointer' }}>+ Empty slot #{i + 1}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ fontSize: '0.8rem', color: '#999', textAlign: 'center', margin: '-6px 0 20px' }}>
          {filledCount}/{SLOT_COUNT} slots used
        </div>

        {!import.meta.env.DEV && (
          <button onClick={() => setShowAdvanced(v => !v)} style={{ ...btnStyle({ secondary: true, small: true }), marginBottom: 12 }}>
            {showAdvanced ? 'Hide advanced' : 'Advanced: load or copy books.json'}
          </button>
        )}

        {/* CODE OUTPUT */}
        {(import.meta.env.DEV || showAdvanced) && <div style={{ background: '#f8f8f8', border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#666' }}>Generated Code</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer', marginLeft: 16 }}>
              <input type="checkbox" checked={useVitsoeShelf} onChange={e => setUseVitsoeShelf(e.target.checked)} />
              Enable Vitsoe Bookshelf
            </label>
            <button onClick={generateCode} style={{ ...btnStyle({ small: true }), marginLeft: 'auto' }}>&#9889; Generate</button>
            <button onClick={copyCode} style={btnStyle({ secondary: true, small: true })}><Copy size={12} /> Copy</button>
            <span style={{ fontSize: '0.72rem', color: '#aaa' }}>
              {generatedCode ? `${filledCount} books encoded` : ''}
            </span>
          </div>
          <textarea readOnly value={generatedCode} placeholder="Click 'Generate' to build your books.json"
            style={{
              width: '100%', minHeight: 200, fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
              fontSize: '0.7rem', lineHeight: 1.6, padding: 10, border: '1px solid #ddd',
              borderRadius: 5, resize: 'vertical', whiteSpace: 'pre', background: '#fff',
            }}
          />
          <div style={{ fontSize: '0.72rem', color: '#aaa', marginTop: 8 }}>
            Copy this and paste it into <strong>content/books.json</strong>, replacing everything in the file.
            The app will reload with your updated selection.
          </div>
        </div>}
      </div>

      <style>{`
        .admin-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: admin-spin 0.7s linear infinite; }
        @keyframes admin-spin { to { transform: rotate(360deg); } }
        .admin-result { transition: border-color 0.15s, box-shadow 0.15s; }
        /* Phones: full-screen edit window, no zoom-on-focus, swipeable rows. */
        @media (max-width: 600px) {
          .admin-modal-wrap { padding: 0 !important; align-items: stretch !important; }
          .admin-modal { max-width: none !important; max-height: none !important; height: 100%; border-radius: 0 !important; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
          .admin-modal input, .admin-modal textarea, .admin-modal select { font-size: 16px !important; }
          .admin-modal button { min-height: 34px; }
          .admin-results { grid-template-columns: none !important; grid-auto-flow: column; grid-auto-columns: 112px; overflow-x: auto !important; overflow-y: hidden !important; max-height: none !important; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
          .admin-results > * { scroll-snap-align: start; }
          .admin-cover-opts { flex-wrap: nowrap !important; overflow-x: auto; padding: 3px 3px 4px; }
          .admin-cover-opts > * { flex-shrink: 0; }
          .admin-cover-big { width: 92px !important; }
          .admin-syn { flex-wrap: wrap; justify-content: space-between; }
          .admin-syn textarea { order: -1; flex: 1 1 100% !important; min-height: 160px; }
        }
        .admin-slot { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
        .admin-slot.dragging { z-index: 10; box-shadow: 0 12px 32px rgba(0,0,0,0.18) !important; cursor: grabbing !important; transition: none !important; }
        .admin-slot.drag-over { outline: 2px solid #1a1a1a; outline-offset: 2px; }
        .admin-result:hover, .admin-result:focus-visible { border-color: #ccc !important; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
      `}</style>

      {/* SHARE STUDIO */}
      {studioOpen && (
        <ShareStudio
          books={[...selectedForShare].map(i => slots[i]).filter((b): b is Book => b !== null)}
          loadCover={loadCover}
          footer={footerText}
          onFooterChange={changeFooter}
          toast={showToast}
          onClose={order => {
            // Keep the order and picks from the studio.
            setSelectedForShare(new Set(order.map(b => slots.findIndex(s => s?.id === b.id)).filter(i => i >= 0)));
            setStudioOpen(false);
          }}
        />
      )}

      {/* EDIT MODAL */}
      {editingIndex !== -1 && (
        <div className="admin-modal-wrap" style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.35)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => setEditingIndex(-1)}>
          <div className="admin-modal" style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 660,
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{editingIndex === NEW_BOOK ? 'Add a book' : `Edit book #${editingIndex + 1}`}</span>
              <button onClick={() => setEditingIndex(-1)} style={btnStyle({ secondary: true, small: true })}><X size={14} /></button>
            </div>

            <div style={{ padding: '14px 18px', overflow: 'auto', flex: 1 }}>
              {/* Search */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Title" style={inputStyle}
                  onKeyDown={e => e.key === 'Enter' && doSearch()} />
                <input value={searchAuthorQuery} onChange={e => setSearchAuthorQuery(e.target.value)}
                  placeholder="Author" style={{ ...inputStyle, maxWidth: 160 }}
                  onKeyDown={e => e.key === 'Enter' && doSearch()} />
                <button onClick={doSearch} style={btnStyle({ small: true })} disabled={searching}>
                  {searching ? <span className="admin-spinner" /> : <Search size={14} />}
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: 6 }}>{searchStatus}</div>

              {searchResults.length > 0 && (
                <div className="admin-results" style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8,
                  maxHeight: 300, overflow: 'auto', padding: 2, marginBottom: 14,
                }}>
                  {searchResults.map(r => (
                    <button key={r.key} type="button" onClick={() => selectResult(r)} className="admin-result"
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 4, padding: 6, textAlign: 'left',
                        border: '1px solid #eee', borderRadius: 8, background: '#fff', cursor: 'pointer',
                        font: 'inherit', color: 'inherit',
                      }}>
                      <div style={{ width: '100%', aspectRatio: '2 / 3', borderRadius: 4, background: '#f2f2f2', overflow: 'hidden' }}>
                        {r.thumb && (
                          <img src={r.thumb} alt="" loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        )}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', lineHeight: 1.25 }}>{r.title}</div>
                      <div style={{ fontSize: '0.68rem', color: '#777', lineHeight: 1.25 }}>{r.author || 'Unknown author'}</div>
                      <div style={{ fontSize: '0.62rem', color: '#aaa', lineHeight: 1.3 }}>
                        {[r.year, r.publisher].filter(Boolean).join(' · ') || '\u00a0'}
                        <br />{r.sources.join(' · ')}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Form */}
              <label style={labelStyle}>Title</label>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={inputStyle} />

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Author</label>
                  <input value={editAuthor} onChange={e => setEditAuthor(e.target.value)} style={inputStyle} />
                </div>
                <div style={{ maxWidth: 90 }}>
                  <label style={labelStyle}>Year</label>
                  <input value={editYear} onChange={e => setEditYear(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>ISBN</label>
                  <input value={editIsbn} onChange={e => setEditIsbn(e.target.value)} style={inputStyle} placeholder="Names the cover file" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>
                    Goodreads <span style={{ fontWeight: 400, color: '#aaa' }}>(link or ID)</span>
                  </label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={editGr} onChange={e => { setEditGr(goodreadsIdFrom(e.target.value)); setGrStatus(null); }}
                      style={inputStyle} placeholder="Paste a Goodreads link" />
                    {/^\d+$/.test(editGr) && (
                      <a href={`https://www.goodreads.com/book/show/${editGr}`} target="_blank" rel="noreferrer"
                        style={{ ...btnStyle({ secondary: true, small: true }), textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        Open ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
              {grStatus && (
                <div style={{ fontSize: '0.7rem', color: grStatus.warn ? '#b26a00' : '#888', marginTop: 4, textAlign: 'right' }}>
                  {grStatus.text}
                  {grStatus.warn && !editGr && (editTitle || editAuthor) && (
                    <> <a href={`https://www.goodreads.com/search?q=${encodeURIComponent(`${editTitle} ${editAuthor}`.trim())}`}
                      target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Search Goodreads ↗</a></>
                  )}
                </div>
              )}

              <label style={labelStyle}>
                Cover {coversLoading && <span style={{ fontWeight: 400, color: '#aaa' }}>· finding the sharpest versions…</span>}
              </label>
              {coverOptions.length > 0 ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <img className="admin-cover-big" src={coverOptions[coverIndex]?.preview || coverOptions[coverIndex]?.url || ''} alt="Selected cover"
                    style={{ width: 110, height: 'auto', borderRadius: 4, background: '#f0f0f0', border: '1px solid #eee', flexShrink: 0 }}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                  <div className="admin-cover-opts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1 }}>
                    {coverOptions.map((c, idx) => {
                      const low = c.h !== undefined && c.h < LOW_RES_HEIGHT;
                      const selected = idx === coverIndex;
                      return (
                        <button key={c.url + idx} type="button" onClick={() => setCoverIndex(idx)}
                          title={c.label}
                          style={{
                            width: 64, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                            font: 'inherit', textAlign: 'center',
                          }}>
                          <img src={c.preview || c.url} alt=""
                            style={{
                              width: 64, height: 96, objectFit: 'cover', borderRadius: 4, display: 'block',
                              background: '#f0f0f0',
                              outline: selected ? '2px solid #1a1a1a' : '1px solid #e5e5e5',
                              outlineOffset: selected ? 2 : 0,
                              opacity: low && !selected ? 0.6 : 1,
                            }} />
                          <div style={{ fontSize: '0.6rem', color: '#777', marginTop: 4, lineHeight: 1.25 }}>
                            {c.isCurrent ? 'Current' : c.label}
                          </div>
                          {c.h !== undefined && (
                            <div style={{ fontSize: '0.58rem', color: low ? '#b26a00' : '#aaa', lineHeight: 1.25 }}>
                              {low ? 'Low-res · ' : ''}{c.w}×{c.h}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#aaa', padding: '8px 0' }}>
                  {coversLoading ? 'Looking for covers…' : 'No covers yet. Search and pick a book to see cover options.'}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                {(
                  <>
                    <input
                      type="file" accept="image/*"
                      id="cover-file-input" style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const isbn = editIsbn.trim() || (editingIndex === NEW_BOOK ? 'new' : String(editingIndex + 1));
                        // Live site: resize it now; it's uploaded when you publish.
                        if (!import.meta.env.DEV) {
                          try {
                            const path = addPendingCover(isbn, await resizeCover(file));
                            coverRequestId.current++;
                            setCoversLoading(false);
                            setCoverOptions([{ url: path, preview: coverSrc(path), label: 'Custom (uploaded)' }]);
                            setCoverIndex(0);
                            showToast('Cover added. It\u2019s uploaded when you publish.');
                          } catch (err: any) {
                            showToast(`Couldn't use that image: ${err.message}`);
                          }
                          (e.target as HTMLInputElement).value = '';
                          return;
                        }
                        try {
                          const res = await fetch(`/api/upload-cover?key=${encodeURIComponent(isbn)}`, {
                            method: 'POST',
                            body: file,
                          });
                          if (!res.ok) throw new Error(await res.text());
                          const safeKey = isbn.replace(/[^a-zA-Z0-9_-]/g, '');
                          coverRequestId.current++; // ignore any cover lookup still running
                          setCoversLoading(false);
                          setCoverOptions([{ url: `/covers/${safeKey}.jpg`, label: 'Custom (uploaded)' }]);
                          setCoverIndex(0);
                          setCoverLocked(true);
                          showToast('Cover uploaded. Rebuild will preserve this file.');
                        } catch (err: any) {
                          showToast(`Upload failed: ${err.message}`);
                        }
                        (e.target as HTMLInputElement).value = '';
                      }}
                    />
                    <button onClick={() => document.getElementById('cover-file-input')?.click()}
                      style={{ ...btnStyle({ secondary: true, small: true }), fontSize: '0.7rem' }}>
                      <Upload size={12} /> Choose custom cover…
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <label style={labelStyle}>Synopsis</label>
                <div style={{ display: 'flex', gap: 5 }}>
                {editSynopsis && (
                  <button onClick={async () => {
                    try { await navigator.clipboard.writeText(editSynopsis); showToast('Copied. Shorten it in your Shortcut, then paste it back here.'); }
                    catch { showToast('Couldn\u2019t copy. Select the text and copy it instead.'); }
                  }} title="Copy the synopsis, to shorten it with your own Shortcut or AI app"
                    style={{ ...btnStyle({ secondary: true, small: true }), marginBottom: 3, fontSize: '0.7rem' }}>
                    <Copy size={12} /> Copy
                  </button>
                )}
                {/* iOS shows a small Paste bubble to tap the first time, to allow it. */}
                <button onClick={async () => {
                  try {
                    const text = (await navigator.clipboard.readText()).trim();
                    if (!text) { showToast('The clipboard is empty.'); return; }
                    setEditSynopsis(text);
                    showToast('Pasted the synopsis.');
                  } catch { showToast('Couldn\u2019t read the clipboard. Tap in the box and paste instead.'); }
                }} title="Replace the synopsis with what's on the clipboard"
                  style={{ ...btnStyle({ secondary: true, small: true }), marginBottom: 3, fontSize: '0.7rem' }}>
                  <ClipboardPaste size={12} /> Paste
                </button>
                </div>
              </div>
              <div className="admin-syn" style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                {synopsisOptions.length > 1 && (
                  <button onClick={() => {
                    const idx = synopsisIndex > 0 ? synopsisIndex - 1 : synopsisOptions.length - 1;
                    setSynopsisIndex(idx);
                    setEditSynopsis(synopsisOptions[idx]);
                  }} style={{ ...btnStyle({ secondary: true, small: true }), marginTop: 0, flexShrink: 0 }}>
                    <ChevronLeft size={14} />
                  </button>
                )}
                <textarea value={editSynopsis} onChange={e => setEditSynopsis(e.target.value)} rows={3}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', flex: 1 }} />
                {synopsisOptions.length > 1 && (
                  <button onClick={() => {
                    const idx = synopsisIndex < synopsisOptions.length - 1 ? synopsisIndex + 1 : 0;
                    setSynopsisIndex(idx);
                    setEditSynopsis(synopsisOptions[idx]);
                  }} style={{ ...btnStyle({ secondary: true, small: true }), marginTop: 0, flexShrink: 0 }}>
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
              {synopsisOptions.length > 1 && (
                <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: 3, textAlign: 'center' }}>
                  {synopsisIndex + 1} / {synopsisOptions.length}
                </div>
              )}
              {orKey && editSynopsis && models.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4, width: '100%' }}>
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                    style={{
                      flex: 1, fontSize: '0.7rem', padding: '2px 4px',
                      borderRadius: 4, border: '1px solid #ccc', background: '#fff',
                      color: '#1a1a1a',
                    }}>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.name}{m.free ? ' (free)' : ''}</option>
                    ))}
                  </select>
                  <button onClick={summarizeSynopsis} disabled={summarizing}
                    style={{ ...btnStyle({ secondary: true, small: true }), whiteSpace: 'nowrap' }}>
                    <Sparkles size={12} /> {summarizing ? '…' : 'Summarize'}
                  </button>
                </div>
              )}
            </div>

            <div style={{ padding: '10px 18px', borderTop: '1px solid #eee', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {editingIndex !== NEW_BOOK && (
                <button onClick={() => { if (confirmRemove(slots[editingIndex]?.title || 'this book')) { clearSlot(); setEditingIndex(-1); } }} style={{ ...btnStyle({ secondary: true, small: true }), color: '#c0392b' }}>Remove</button>
              )}
              <button onClick={async () => { if (await saveEdit()) setEditingIndex(-1); }} disabled={coversLoading || saving}
                title={coversLoading ? 'Loading cover options…' : undefined}
                style={{ ...btnStyle({ small: true }), ...(coversLoading || saving ? { opacity: 0.5, cursor: 'wait' } : {}) }}>
                {saving ? 'Saving cover…' : coversLoading ? 'Loading covers…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, background: '#1a1a1a', color: '#fff',
          padding: '10px 18px', borderRadius: 8, fontSize: '0.82rem', zIndex: 20000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// --- SUB-COMPONENT ---
function BookCover({ book }: { book: Book }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setSrc(null);

    const cached = coverCache.get(book.id);
    if (cached) {
      setSrc(cached);
      setState('loaded');
      return;
    }

    if (fetchingSet.has(book.id)) {
      const check = setInterval(() => {
        if (coverCache.has(book.id)) {
          setSrc(coverCache.get(book.id)!);
          setState('loaded');
          clearInterval(check);
        }
      }, 200);
      setTimeout(() => clearInterval(check), 10000);
      return () => clearInterval(check);
    }

    const tryCovers = async () => {
      // If a coverUrl override is set, use it directly
      if (book.coverUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = coverSrc(book.coverUrl);
          });
          if (img.naturalHeight >= 300) {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d')!.drawImage(img, 0, 0);
            const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/jpeg', 0.9));
            const objectUrl = blob ? URL.createObjectURL(blob) : img.src;
            setSrc(objectUrl);
            setState('loaded');
            coverCache.set(book.id, objectUrl);
            aspectRatioCache.set(book.id, img.naturalWidth / img.naturalHeight);
            return;
          }
        } catch {}
      }

      const candidates: string[] = [];

      // Check local cover manifest first
      const local = coverManifest[(book.isbn || book.id) as keyof typeof coverManifest];
      if (local) {
        const p = (local as { path: string | null }).path;
        if (p) candidates.push(p);
      }

      // OpenLibrary search by title+author
      try {
        const res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}`);
        const data = await res.json();
        const coverI = data.docs?.[0]?.cover_i;
        if (coverI) candidates.push(`https://covers.openlibrary.org/b/id/${coverI}-L.jpg`);
      } catch {}

      // OpenLibrary ISBN direct
      if (book.isbn) {
        candidates.push(`https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`);
      }

      // Goodreads (via ISBN)
      if (book.isbn) {
        candidates.push(`https://covers.goodreads.com/bisbn/${book.isbn}-L.jpg`);
      }

      let loadedImg: HTMLImageElement | null = null;
      let fallback: HTMLImageElement | null = null;

      for (const url of candidates) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = url;
          });
        } catch { continue; }

        if (img.naturalHeight >= 300) {
          loadedImg = img;
          break;
        }

        if (!fallback) fallback = img;
      }

      if (!loadedImg && fallback) loadedImg = fallback;

      if (!loadedImg) {
        if (!cancelled) setState('error');
        return;
      }

      if (!cancelled) {
        const c = document.createElement('canvas');
        c.width = loadedImg.naturalWidth;
        c.height = loadedImg.naturalHeight;
        c.getContext('2d')!.drawImage(loadedImg, 0, 0);
        const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/jpeg', 0.9));
        const objectUrl = blob ? URL.createObjectURL(blob) : loadedImg.src;
        setSrc(objectUrl);
        setState('loaded');
        coverCache.set(book.id, objectUrl);
        aspectRatioCache.set(book.id, loadedImg.naturalWidth / loadedImg.naturalHeight);
      }
    };

    tryCovers();
    return () => { cancelled = true; };
  }, [book.id, book.title, book.author, book.isbn, book.coverUrl]);

  return (
    <>
      {state === 'loading' && <div className="admin-spinner" />}
      {src && (
        <img
          src={src}
          alt={`Cover of ${book.title}`}
          style={{
            width: '100%', height: '100%', objectFit: 'contain',
            display: state === 'loaded' ? 'block' : 'none',
          }}
        />
      )}
      {state === 'error' && <span style={{ color: '#ccc', fontSize: '0.65rem', textAlign: 'center' }}>No cover</span>}
    </>
  );
}

// --- STYLE HELPERS ---
const btnStyle = ({ secondary, small }: { secondary?: boolean; small?: boolean } = {}): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: small ? '4px 10px' : '7px 14px',
  border: 'none', borderRadius: 5,
  fontSize: small ? '0.72rem' : '0.82rem',
  fontWeight: 500, cursor: 'pointer',
  background: secondary ? '#eee' : '#1a1a1a',
  color: secondary ? '#333' : '#fff',
  transition: 'background 0.15s',
  textDecoration: 'none',
});

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 9px', border: '1px solid #ddd',
  borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', fontWeight: 500,
  color: '#555', marginBottom: 3, marginTop: 9,
};
