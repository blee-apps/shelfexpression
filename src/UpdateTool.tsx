import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Copy, GripVertical, Upload, RotateCw, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { coverCache, fetchingSet, aspectRatioCache } from '../digital_bookshelf';
import { Book } from './books';
import coverManifest from './generated/cover-manifest.json';

interface Props {
  onClose: () => void;
  books: Book[];
}

const SLOT_COUNT = 20;

const escDq = (s: string) => s.replace(/"/g, '\\"');
const escSq = (s: string) => s.replace(/'/g, "\\'");
const synopsisCache = new Map<string, string>();
const gbKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY || '';
const gbUrl = (path: string) => path + (gbKey ? `&key=${gbKey}` : '');
const orKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
const OR_STORAGE_KEY = 'orModel';

export default function UpdateTool({ onClose, books }: Props) {
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
  const [useVitsoeShelf, setUseVitsoeShelf] = useState(true);

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
  const [coverOptions, setCoverOptions] = useState<{ url: string; label: string }[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);

  // OpenRouter model state
  const [models, setModels] = useState<{ id: string; name: string; free: boolean }[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(OR_STORAGE_KEY) || '');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAuthorQuery, setSearchAuthorQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchStatus, setSearchStatus] = useState('Search OpenLibrary by title and author.');
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Goodreads URL lookup state
  const [grUrl, setGrUrl] = useState('');
  const [grLookupStatus, setGrLookupStatus] = useState('');

  // Paste / load state
  const [pasteText, setPasteText] = useState('');

  // Drag state
  const dragIndex = useRef(-1);

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
    const match = text.match(/RAW_BOOKS\s*=\s*\[([\s\S]*?)\];/);
    if (!match) throw new Error('Could not find RAW_BOOKS array in the text.');
    const body = match[1];

    const entries: string[] = [];
    let depth = 0, start = -1;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          entries.push(body.slice(start, i + 1));
          start = -1;
        }
      }
    }
    if (depth !== 0) throw new Error('Unbalanced braces in RAW_BOOKS.');

    return entries.map((entry) => {
      const getStr = (key: string) => {
        const re = new RegExp(key + ':\\s*(["\'])(.*?)\\1');
        const m = entry.match(re);
        return m ? m[2] : '';
      };
      const getNum = (key: string) => {
        const re = new RegExp(key + ':\\s*(\\d+)');
        const m = entry.match(re);
        return m ? parseInt(m[1], 10) : 0;
      };
      return {
        id: getStr('id'),
        isbn: getStr('isbn'),
        title: getStr('title'),
        author: getStr('author'),
        year: getNum('year'),
        synopsis: getStr('synopsis'),
        gr: getStr('gr'),
        mult: 1.0,
        coverUrl: getStr('coverUrl') || undefined,
      };
    });
  };

  const fillSlots = (parsed: Book[]) => {
    const arr: (Book | null)[] = new Array(SLOT_COUNT).fill(null);
    parsed.forEach((book, i) => {
      if (i < SLOT_COUNT) arr[i] = { ...book, id: String(i + 1) };
    });
    setSlots(arr);
    showToast(`Loaded ${parsed.length} book${parsed.length !== 1 ? 's' : ''}.`);
  };

  const loadFromPaste = (text: string) => {
    try {
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
    else showToast('Upload a file or paste the RAW_BOOKS array.');
  };

  const removeBook = (index: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
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

  const populateCoverOptions = async (book: { title?: string; author?: string; isbn?: string } | null, extraCoverId?: number) => {
    const coverSources: { url: string; label: string }[] = [];

    if (extraCoverId) {
      coverSources.push({ url: `https://covers.openlibrary.org/b/id/${extraCoverId}-L.jpg`, label: 'OpenLibrary' });
    }
    if (book?.isbn) {
      coverSources.push({ url: `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`, label: 'OpenLibrary (ISBN)' });
    }
    if (book?.isbn) {
      coverSources.push({ url: `https://covers.goodreads.com/bisbn/${book.isbn}-L.jpg`, label: 'Goodreads' });
    }
    if (gbKey && (book?.title || book?.author)) {
      try {
        const q = `${book?.title || ''} ${book?.author || ''}`.trim();
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&key=${gbKey}&maxResults=1`);
        const data = await res.json();
        const thumb = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
        if (thumb) {
          coverSources.push({ url: thumb.replace('zoom=1', 'zoom=2').replace('http:', 'https:'), label: 'Google Books' });
        }
      } catch {}
    }

    const validCovers: { url: string; label: string }[] = [];
    let fallback: { url: string; label: string } | null = null;
    for (const src of coverSources) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = src.url;
        });
      } catch { continue; }
      if (img.naturalHeight >= 300) {
        validCovers.push(src);
      } else if (!fallback) {
        fallback = src;
      }
    }
    if (validCovers.length === 0 && fallback) validCovers.push(fallback);
    setCoverOptions(validCovers);
    setCoverIndex(0);
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
    setSearchStatus('Search OpenLibrary by title and author.');
    setSearchResults([]);
    setGrUrl('');
    setGrLookupStatus('');
    populateCoverOptions(book);
  };

  const saveEdit = () => {
    const title = editTitle.trim();
    const author = editAuthor.trim();
    if (!title) { showToast('Title is required.'); return; }
    if (!author) { showToast('Author is required.'); return; }

    setSlots(prev => {
      const next = [...prev];
      next[editingIndex] = {
        id: String(editingIndex + 1),
        isbn: editIsbn.trim(),
        title,
        author,
        year: parseInt(editYear, 10) || 0,
        synopsis: editSynopsis.trim(),
        gr: editGr.trim(),
        mult: 1.0,
        coverUrl: coverOptions[coverIndex]?.url || '',
      };
      return next;
    });
    showToast(`Saved slot #${editingIndex + 1}.`);
  };

  const clearSlot = () => {
    setSlots(prev => {
      const next = [...prev];
      next[editingIndex] = null;
      return next;
    });
    showToast(`Cleared slot #${editingIndex + 1}.`);
  };

  // --- SEARCH ---
  const doSearch = async () => {
    const title = searchQuery.trim();
    const author = searchAuthorQuery.trim();
    if (!title && !author) { showToast('Enter at least a title or author.'); return; }

    setSearching(true);
    setSearchStatus('Searching...');
    setSearchResults([]);

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const qParts: string[] = [];
      if (title) qParts.push(title);
      if (author) qParts.push(author);

      const resp = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(qParts.join(' '))}&limit=10&fields=key,title,author_name,first_publish_year,isbn,cover_i,id_goodreads`,
        { signal: ac.signal }
      );
      const data = await resp.json();
      const docs = data.docs || [];

      if (docs.length === 0) {
        setSearchStatus('No results found. Try different search terms.');
        setSearching(false);
        return;
      }

      setSearchStatus(`Found ${docs.length} result${docs.length !== 1 ? 's' : ''}. Click one to fill the form.`);
      setSearchResults(docs);
      setSearching(false);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setSearchStatus('Search failed. Check your connection.');
      setSearching(false);
    }
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

  const olBibkeySynopsis = async (bibkeys: string[]): Promise<string> => {
    try {
      const r = await fetch(`https://openlibrary.org/api/books?bibkeys=${bibkeys.join(',')}&format=json&jscmd=data`);
      const data = await r.json();
      for (const bibkey of bibkeys) {
        const entry = data[bibkey];
        if (!entry) continue;
        if (entry.excerpts?.[0]?.text) return entry.excerpts[0].text;
        if (entry.description?.value) return entry.description.value;
        if (typeof entry.description === 'string') return entry.description;
      }
      return '';
    } catch { return ''; }
  };

  const olEditionSynopsis = async (key: string): Promise<string> => {
    try {
      const r = await fetch(`https://openlibrary.org${key}/editions.json?limit=50`);
      const data = await r.json();
      for (const edition of (data.entries || [])) {
        if (edition.description) {
          if (typeof edition.description === 'string') return edition.description;
          if (edition.description.value) return edition.description.value;
        }
        if (edition.excerpts?.[0]?.text) return edition.excerpts[0].text;
      }
      return '';
    } catch { return ''; }
  };

  const googleBooksSynopsis = async (title: string, author: string): Promise<string> => {
    const key = `gb:${title}|${author}`;
    const cached = synopsisCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const q = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
      const r = await fetch(gbUrl(`https://www.googleapis.com/books/v1/volumes?q=${q}&fields=items(volumeInfo(description))`));
      if (r.status === 429) return ''; // rate limited
      const data = await r.json();
      const desc = data?.items?.[0]?.volumeInfo?.description || '';
      synopsisCache.set(key, desc);
      return desc;
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

  const selectResult = async (doc: any) => {
    setEditTitle(doc.title || '');
    setEditAuthor(doc.author_name?.[0] || '');
    setEditYear(String(doc.first_publish_year || ''));
    const isbn = doc.isbn?.[0] || '';
    setEditIsbn(isbn);
    const goodreadsId = doc.id_goodreads?.[0] || '';
    setEditGr(goodreadsId);
    if (goodreadsId) setGrUrl(`https://www.goodreads.com/book/show/${goodreadsId}`);

    setEditSynopsis('Loading synopsis...');

    // Collect all synopsis identifiers
    const bibkeys: string[] = [];
    if (goodreadsId) bibkeys.push(`GR_${goodreadsId}`);
    const isbns = (doc.isbn || []).slice(0, 3) as string[];
    isbns.forEach((id) => bibkeys.push(`ISBN:${id}`));
    const olid = doc.key?.replace('/works/', 'OL');
    if (olid) bibkeys.push(olid);

    // Fire OpenLibrary synopsis lookups in parallel first
    const olSources: Promise<{ source: string; text: string }>[] = [];
    if (doc.key) olSources.push(olWorkSynopsis(doc.key).then(text => ({ source: 'OpenLibrary Work', text })));
    if (bibkeys.length > 0) olSources.push(olBibkeySynopsis(bibkeys).then(text => ({ source: 'OpenLibrary Books API', text })));
    if (doc.key) olSources.push(olEditionSynopsis(doc.key).then(text => ({ source: 'OpenLibrary Editions', text })));

    const olResults = await Promise.all(olSources);
    const options = olResults
      .filter(r => r.text && r.text.length > 0)
      .map(r => r.text);

    // Only hit Google Books if OpenLibrary came up empty (avoids rate limits)
    if (options.length === 0 && (doc.title || doc.author_name?.[0])) {
      const gbText = await googleBooksSynopsis(doc.title || '', doc.author_name?.[0] || '');
      if (gbText) options.push(gbText);
    }

    if (options.length > 0) {
      setSynopsisOptions(options);
      setSynopsisIndex(0);
      setEditSynopsis(options[0]);
    } else {
      setSynopsisOptions([]);
      setSynopsisIndex(0);
      setEditSynopsis('');
    }

    populateCoverOptions({ title: doc.title || '', author: doc.author_name?.[0] || '', isbn }, doc.cover_i);

    setSearchStatus('Book details filled from selection.');
    showToast('Book data loaded from OpenLibrary.');
  };

  // --- GOODREADS URL LOOKUP ---
  const lookupGoodreadsUrl = async () => {
    const url = grUrl.trim();
    if (!url) { showToast('Paste a Goodreads book URL first.'); return; }

    const match = url.match(/goodreads\.com\/book\/show\/(\d+)/);
    if (!match) { showToast('Could not extract Goodreads ID from that URL.'); return; }

    const grId = match[1];
    setGrLookupStatus('Looking up book on OpenLibrary...');

    try {
      const resp = await fetch(`https://openlibrary.org/api/books?bibkeys=GR_${grId}&format=json&jscmd=data`);
      const data = await resp.json();
      const entry = data[`GR_${grId}`];

      if (!entry) {
        setGrLookupStatus('Book not found on OpenLibrary. Try a different source.');
        showToast('No data found for that Goodreads ID.');
        return;
      }

      setEditTitle(entry.title || editTitle);
      if (entry.authors?.[0]?.name) setEditAuthor(entry.authors[0].name);

      if (entry.publish_date) {
        const yearMatch = entry.publish_date.match(/\d{4}/);
        if (yearMatch) setEditYear(yearMatch[0]);
      }

      const isbns = entry.identifiers?.isbn_10 || entry.identifiers?.isbn_13 || [];
      if (isbns.length > 0) setEditIsbn(isbns[0]);

      setEditGr(grId);
      setGrUrl(`https://www.goodreads.com/book/show/${grId}`);

      if (entry.excerpts?.[0]?.text) {
        setEditSynopsis(entry.excerpts[0].text);
      } else if (entry.description?.value) {
        setEditSynopsis(entry.description.value);
      } else if (typeof entry.description === 'string') {
        setEditSynopsis(entry.description);
      }

      setGrLookupStatus(`Loaded from Goodreads #${grId}.`);
      showToast(`Book data loaded from Goodreads ID ${grId}.`);
    } catch {
      setGrLookupStatus('Lookup failed. Check your connection.');
      showToast('Goodreads lookup failed.');
    }
  };

  // --- CODE GENERATION ---
  const generateCode = () => {
    const filled = slots.filter((b): b is Book => b !== null);
    if (filled.length === 0) {
      showToast('No books to encode.');
      return;
    }
    const lines = filled.map((book, i) => {
      const base = `  { id: '${i + 1}', isbn: '${escSq(book.isbn || '')}', title: "${escDq(book.title || '')}", author: '${escSq(book.author || '')}', year: ${book.year || 0}, synopsis: "${escDq(book.synopsis || '')}", gr: '${escSq(book.gr || '')}'`;
      if (book.coverUrl) {
        return base + `, coverUrl: '${escSq(book.coverUrl)}' }`;
      }
      return base + ' }';
    });
    const code = 'const RAW_BOOKS = [\n' + lines.join(',\n') + ',\n];\n\nexport const USE_VITSOE_SHELF = ' + useVitsoeShelf + ';';
    setGeneratedCode(code);
    showToast(`Code generated (${filled.length} books).`);
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

  // --- DRAG HANDLERS ---
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    (e.currentTarget as HTMLElement).classList.add('dragging');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('dragging');
    document.querySelectorAll('.admin-slot.drag-over').forEach(el => el.classList.remove('drag-over'));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (index !== dragIndex.current) {
      (e.currentTarget as HTMLElement).classList.add('drag-over');
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(from) && from !== index) {
      moveBook(from, index);
    }
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
        padding: '12px 20px', borderBottom: '1px solid #eee', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#bbb', background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em' }}>
            ADMIN
          </span>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Bookshelf Editor</h1>
          <span style={{ fontSize: '0.8rem', color: '#999' }}>{filledCount}/{SLOT_COUNT} slots filled</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={reloadFromApp} style={btnStyle({ secondary: true, small: true })}>Reload from App</button>
          <button onClick={onClose} style={btnStyle({ small: true })}><X size={14} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {/* LOAD SECTION */}
        <div style={{
          background: '#f8f8f8', border: '1px solid #eee', borderRadius: 8,
          padding: 20, marginBottom: 20,
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>
              Upload <code>src/books.ts</code>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tsx,.txt,.js"
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
              Paste the <code>RAW_BOOKS</code> array here
            </label>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste the RAW_BOOKS array from src/books.ts, starting at const RAW_BOOKS = [...]"
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

        {/* GRID */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10, marginBottom: 20,
        }}>
          {slots.map((book, i) => (
            <div key={i}
              className="admin-slot"
              draggable={!!book}
              onDragStart={book ? handleDragStart(i) : undefined}
              onDragEnd={book ? handleDragEnd : undefined}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter(i)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(i)}
              style={{
                background: book ? '#fff' : '#fafafa',
                border: book ? '1px solid #eee' : '1px dashed #ddd',
                borderRadius: 8, padding: 10, position: 'relative',
                display: 'flex', flexDirection: 'column', gap: 5,
                cursor: book ? 'grab' : 'pointer',
                minHeight: book ? 'auto' : 130,
                alignItems: book ? 'stretch' : 'center',
                justifyContent: book ? undefined : 'center',
                color: book ? undefined : '#bbb',
                fontSize: book ? undefined : '0.85rem',
                transition: 'box-shadow 0.15s',
              }}
              onClick={() => { if (!book) openEdit(i); }}
            >
              {book ? (
                <>
                  <div style={{ position: 'absolute', top: 5, left: 7, fontSize: '0.6rem', fontWeight: 600, color: '#bbb', background: '#f5f5f5', padding: '1px 5px', borderRadius: 3 }}>
                    <GripVertical size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />#{i + 1}
                  </div>
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
                  <div style={{ display: 'flex', gap: 5, marginTop: 'auto', paddingTop: 4 }}>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(i); }} style={btnStyle({ secondary: true, small: true })}>Edit</button>
                    <button onClick={(e) => { e.stopPropagation(); removeBook(i); }} style={{ ...btnStyle({ secondary: true, small: true }), color: '#c0392b' }}>Remove</button>
                    {i > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); moveBook(i, 0); }} style={btnStyle({ secondary: true, small: true })} title="Move to top">↑</button>
                    )}
                  </div>
                </>
              ) : (
                <span onClick={() => openEdit(i)} style={{ cursor: 'pointer' }}>+ Empty slot #{i + 1}</span>
              )}
            </div>
          ))}
        </div>

        {/* CODE OUTPUT */}
        <div style={{ background: '#f8f8f8', border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
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
          <textarea readOnly value={generatedCode} placeholder="Click 'Generate' to build the RAW_BOOKS array..."
            style={{
              width: '100%', minHeight: 200, fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
              fontSize: '0.7rem', lineHeight: 1.6, padding: 10, border: '1px solid #ddd',
              borderRadius: 5, resize: 'vertical', whiteSpace: 'pre', background: '#fff',
            }}
          />
          <div style={{ fontSize: '0.72rem', color: '#aaa', marginTop: 8 }}>
            Copy this code and paste it into <strong>src/books.ts</strong>, replacing the <code>RAW_BOOKS</code> array and <code>USE_VITSOE_SHELF</code> flag.
            The app will reload with your updated selection.
          </div>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editingIndex >= 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.35)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => setEditingIndex(-1)}>
          <div style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560,
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Edit Slot #{editingIndex + 1}</span>
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
                <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #eee', borderRadius: 6, marginBottom: 12 }}>
                  {searchResults.map((doc, idx) => (
                    <div key={idx} onClick={() => selectResult(doc)}
                      style={{
                        display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #f0f0f0',
                        cursor: 'pointer', transition: 'background 0.1s', alignItems: 'center',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8f8f8')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <img src={doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg` : ''}
                        alt="" style={{ width: 30, height: 45, objectFit: 'cover', borderRadius: 3, background: '#f0f0f0', flexShrink: 0 }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{doc.title || 'Unknown'}</div>
                        <div style={{ fontSize: '0.72rem', color: '#888' }}>{doc.author_name?.[0] || 'Unknown'}</div>
                        <div style={{ fontSize: '0.65rem', color: '#aaa' }}>{doc.first_publish_year || '?'}{(doc.isbn?.[0] ? ` — ISBN: ${doc.isbn[0]}` : '')}{(doc.id_goodreads?.[0] ? ` — GR: ${doc.id_goodreads[0]}` : '')}</div>
                      </div>
                    </div>
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

              <label style={labelStyle}>ISBN</label>
              <input value={editIsbn} onChange={e => setEditIsbn(e.target.value)} style={inputStyle} placeholder="Used for cover art" />

              <label style={labelStyle}>
                Goodreads ID <span style={{ fontWeight: 400, color: '#aaa' }}>(for &ldquo;View on Goodreads&rdquo; link)</span>
              </label>
              <input value={editGr} onChange={e => setEditGr(e.target.value)} style={inputStyle} placeholder="e.g. 19322249" />

              <label style={labelStyle}>
                Goodreads URL <span style={{ fontWeight: 400, color: '#aaa' }}>(paste to auto-fill)</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={grUrl} onChange={e => setGrUrl(e.target.value)}
                  placeholder="https://www.goodreads.com/book/show/19322249-tigerman"
                  style={inputStyle}
                  onKeyDown={e => e.key === 'Enter' && lookupGoodreadsUrl()} />
                <button onClick={lookupGoodreadsUrl} style={btnStyle({ small: true })}>Lookup</button>
              </div>
              {grLookupStatus && <div style={{ fontSize: '0.72rem', color: '#888', marginTop: 4 }}>{grLookupStatus}</div>}

              <label style={labelStyle}>Book Cover</label>
              {coverOptions.length > 0 ? (
                <div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                    {coverOptions.length > 1 && (
                      <button onClick={() => {
                        const idx = coverIndex > 0 ? coverIndex - 1 : coverOptions.length - 1;
                        setCoverIndex(idx);
                      }} style={{ ...btnStyle({ secondary: true, small: true }), flexShrink: 0 }}>
                        <ChevronLeft size={14} />
                      </button>
                    )}
                    <img src={coverOptions[coverIndex]?.url || ''} alt=""
                      style={{ width: 100, height: 'auto', borderRadius: 4, background: '#f0f0f0', objectFit: 'contain', border: '1px solid #eee' }}
                      onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                    {coverOptions.length > 1 && (
                      <button onClick={() => {
                        const idx = coverIndex < coverOptions.length - 1 ? coverIndex + 1 : 0;
                        setCoverIndex(idx);
                      }} style={{ ...btnStyle({ secondary: true, small: true }), flexShrink: 0 }}>
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                  {coverOptions.length > 1 && (
                    <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: 3, textAlign: 'center' }}>
                      {coverOptions[coverIndex].label} &mdash; {coverIndex + 1} / {coverOptions.length}
                    </div>
                  )}
                  {coverOptions.length === 1 && (
                    <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: 3, textAlign: 'center' }}>
                      {coverOptions[0].label}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.75rem', color: '#aaa', padding: '8px 0' }}>No cover options loaded. Search and select a book to populate cover options.</div>
              )}

              <label style={labelStyle}>Synopsis</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
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
              <button onClick={() => { clearSlot(); setEditingIndex(-1); }} style={btnStyle({ secondary: true, small: true })}>Clear</button>
              <button onClick={() => { saveEdit(); setEditingIndex(-1); }} style={btnStyle({ small: true })}>Save</button>
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
            img.src = book.coverUrl!;
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
      const local = coverManifest[book.id as keyof typeof coverManifest];
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
  }, [book.id, book.title, book.author, book.isbn]);

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
