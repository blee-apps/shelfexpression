// "Add just for sharing": a sheet inside Share Studio for books and
// decorations that aren't on your shelf. Whatever you add here lives only in
// the studio for this visit. It's never saved, published or exported.
import { useRef, useState } from 'react';
import { X, Search, Upload, ChevronLeft, ChevronRight, Copy, ClipboardPaste } from 'lucide-react';
import { searchBooks, BookResult, CoverCandidate } from '../bookSearch';
import { fetchCover } from '../publish';
import { prepareDecorImage } from '../decorUpload';
import { DECOR_CATALOGUE, CUSTOM_DECOR, CUSTOM_HEIGHT, BOOK_ASPECT } from '../decor';
import { decorBook, type Book } from '../books';

// Temporary items are told apart by their id.
export const TEMP_PREFIX = 'share-temp-';
export const isTemp = (b: { id: string } | null | undefined) => !!b?.id.startsWith(TEMP_PREFIX);
let tempCount = 0;
const tempId = () => `${TEMP_PREFIX}${Date.now().toString(36)}-${++tempCount}`;

interface Props {
  gbKey: string;
  // Present when an AI key is set up (running locally): shortens a synopsis.
  summarize?: (text: string) => Promise<string>;
  onAdd: (item: Book) => void;
  onClose: () => void;
  toast: (msg: string) => void;
}

const isbnCovers = (isbn?: string): CoverCandidate[] => isbn ? [
  { url: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`, label: 'OpenLibrary' },
] : [];

export default function AddForShare({ gbKey, summarize, onAdd, onClose, toast }: Props) {
  const [tab, setTab] = useState<'book' | 'decor'>('book');
  // Book search
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<BookResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // The picked book, being checked before it's added.
  const [picked, setPicked] = useState<BookResult | null>(null);
  const [covers, setCovers] = useState<CoverCandidate[]>([]);
  const [coverAt, setCoverAt] = useState(0);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [synopsis, setSynopsis] = useState('');
  const [year, setYear] = useState('');
  const [adding, setAdding] = useState(false);
  const [shortening, setShortening] = useState(false);
  // Your own decoration
  const [custom, setCustom] = useState<{ preview: string; aspect: number; base: [number, number]; height: number } | null>(null);
  const coverFile = useRef<HTMLInputElement>(null);
  const decorFile = useRef<HTMLInputElement>(null);

  const search = async () => {
    if (!title.trim() && !author.trim()) { toast('Enter a title or an author.'); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true); setResults([]); setStatus('Searching\u2026');
    try {
      const { results } = await searchBooks(title.trim(), author.trim(), gbKey, ac.signal);
      setResults(results);
      setStatus(results.length ? '' : 'No results. Try fewer words.');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setStatus('Search failed. Check your connection.');
    }
    setSearching(false);
  };

  const pick = (r: BookResult) => {
    setPicked(r);
    const list = [...r.covers, ...isbnCovers(r.isbns[0])];
    setCovers(list);
    setCoverAt(0);
    setUploaded(null);
    setSynopsis(r.synopses[0] || '');
    setYear(r.year ? String(r.year) : '');
  };

  // Copy and Paste make it easy to shorten a synopsis in another app,
  // like ChatGPT or Claude, and bring the result back.
  const copySynopsis = async () => {
    try { await navigator.clipboard.writeText(synopsis.trim()); toast('Synopsis copied.'); }
    catch { toast('Couldn\u2019t copy. Select the text and copy it instead.'); }
  };
  const pasteSynopsis = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setSynopsis(text); else toast('Nothing to paste. Copy some text first.');
    } catch { toast('Couldn\u2019t paste. Tap in the box and paste there instead.'); }
  };

  const shorten = async () => {
    if (!summarize || !synopsis.trim()) return;
    setShortening(true);
    try { setSynopsis(await summarize(synopsis)); }
    catch { toast('Couldn\u2019t shorten it just now.'); }
    setShortening(false);
  };

  // Downloads the chosen cover (through the site's cover helper, so it can be
  // drawn on the share image), trying the others if it doesn't come.
  const addBook = async () => {
    if (!picked) return;
    setAdding(true);
    let src = uploaded;
    if (!src) {
      const order = [...covers.slice(coverAt), ...covers.slice(0, coverAt)];
      for (const c of order) {
        try { src = URL.createObjectURL(await fetchCover(c.url)); break; } catch {}
      }
    }
    setAdding(false);
    if (!src) { toast('Couldn\u2019t get a cover for it. Upload one instead.'); return; }
    onAdd({
      id: tempId(), isbn: picked.isbns[0] || '', title: picked.title, author: picked.author,
      year: Number(year) || 0, synopsis: synopsis.trim(), gr: '', mult: 1, coverUrl: src,
    });
    onClose();
  };

  const uploadCover = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('That isn\u2019t an image.'); return; }
    setUploaded(URL.createObjectURL(file));
  };

  const addDecor = (id: string) => {
    onAdd(decorBook(tempId(), id));
    onClose();
  };

  const uploadDecor = async (file: File | undefined) => {
    if (!file) return;
    try {
      const d = await prepareDecorImage(file);
      setCustom({ preview: d.preview, aspect: d.aspect, base: d.base, height: CUSTOM_HEIGHT.default });
    } catch (e: any) { toast(`Couldn\u2019t use that image: ${e.message}.`); }
  };

  const addCustom = () => {
    if (!custom) return;
    const b = decorBook(tempId(), CUSTOM_DECOR);
    onAdd({ ...b, title: 'My decoration', label: 'My decoration', src: custom.preview, height: custom.height, aspect: custom.aspect, base: custom.base });
    onClose();
  };

  const coverShown = uploaded || covers[coverAt]?.url;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="share-add" onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid #eee' }}>
          {(picked || custom) && (
            <button onClick={() => { setPicked(null); setCustom(null); }} style={iconBtn} aria-label="Back"><ChevronLeft size={16} /></button>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Add just for sharing</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>It stays out of your shelf and goes when you leave.</div>
          </div>
          <button onClick={onClose} style={iconBtn} aria-label="Close"><X size={16} /></button>
        </div>

        {!picked && !custom && (
          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: 9, padding: 3, gap: 3, margin: '12px 14px 0' }}>
            {(['book', 'decor'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, border: 'none', borderRadius: 7, padding: '7px 4px', minHeight: 34, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                background: tab === t ? '#fff' : 'transparent', color: '#1a1a1a', boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}>{t === 'book' ? 'Book' : 'Decoration'}</button>
            ))}
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Search for a book */}
          {tab === 'book' && !picked && (
            <>
              <form onSubmit={e => { e.preventDefault(); search(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={input} autoFocus />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author (optional)" style={{ ...input, flex: 1 }} />
                  <button type="submit" disabled={searching} style={primary}><Search size={14} /> Search</button>
                </div>
              </form>
              {status && <div style={{ fontSize: 13, color: '#888' }}>{status}</div>}
              {results.map(r => (
                <button key={r.key} onClick={() => pick(r)} style={{
                  display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', padding: 8, border: '1px solid #eee', borderRadius: 10,
                  background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <div style={{ width: 38, height: 56, borderRadius: 3, overflow: 'hidden', background: '#eee', flexShrink: 0 }}>
                    {(r.thumb || r.covers[0]) && <img src={r.thumb || r.covers[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{r.author}{r.year ? ` \u00b7 ${r.year}` : ''}</div>
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Check the picked book */}
          {tab === 'book' && picked && (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {!uploaded && covers.length > 1 && <button onClick={() => setCoverAt((coverAt - 1 + covers.length) % covers.length)} style={iconBtn} aria-label="Previous cover"><ChevronLeft size={16} /></button>}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 84, height: 126, borderRadius: 4, overflow: 'hidden', background: '#eee', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                      {coverShown && <img src={coverShown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                    </div>
                    <span className="cover-count" style={{ fontSize: 11, color: '#999', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {uploaded ? 'Your upload' : covers.length ? `${coverAt + 1} of ${covers.length}` : 'No covers'}
                    </span>
                  </div>
                  {!uploaded && covers.length > 1 && <button onClick={() => setCoverAt((coverAt + 1) % covers.length)} style={iconBtn} aria-label="Next cover"><ChevronRight size={16} /></button>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{picked.title}</div>
                  <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{picked.author}</div>
                  <input value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="Year" inputMode="numeric" style={{ ...input, width: 90, marginTop: 8 }} />
                  <button onClick={() => coverFile.current?.click()} style={{ ...secondary, marginTop: 8 }}><Upload size={13} /> Upload a cover</button>
                  <input ref={coverFile} type="file" accept="image/*" hidden onChange={e => { uploadCover(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Synopsis</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={copySynopsis} disabled={!synopsis.trim()} style={secondary} title="Copy the synopsis, to shorten it in another app"><Copy size={13} /> Copy</button>
                  <button onClick={pasteSynopsis} style={secondary} title="Replace the synopsis with what you copied"><ClipboardPaste size={13} /> Paste</button>
                  {summarize && <button onClick={shorten} disabled={shortening || !synopsis.trim()} style={secondary}>{shortening ? 'Shortening\u2026' : 'Shorten'}</button>}
                </div>
              </div>
              <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} rows={6} placeholder="Shown on its feature slide" style={{ ...input, resize: 'vertical', lineHeight: 1.45 }} />
              <button onClick={addBook} disabled={adding} style={{ ...primary, justifyContent: 'center', minHeight: 42 }}>{adding ? 'Getting the cover\u2026' : 'Add to this set'}</button>
            </>
          )}

          {/* Decorations */}
          {tab === 'decor' && !custom && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {DECOR_CATALOGUE.map(d => (
                  <button key={d.id} onClick={() => addDecor(d.id)} style={{ border: '1px solid #eee', borderRadius: 10, background: '#f6f5f2', padding: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ height: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <img src={d.src} alt="" style={{ maxHeight: `${Math.max(30, d.height * 100)}%`, maxWidth: '100%', objectFit: 'contain' }} />
                    </div>
                    <div style={{ fontSize: 12, marginTop: 6, color: '#1a1a1a' }}>{d.label}</div>
                  </button>
                ))}
              </div>
              <button onClick={() => decorFile.current?.click()} style={{ ...secondary, justifyContent: 'center', minHeight: 40 }}><Upload size={13} /> Upload your own (transparent PNG)</button>
              <input ref={decorFile} type="file" accept="image/png,image/webp" hidden onChange={e => { uploadDecor(e.target.files?.[0]); e.target.value = ''; }} />
            </>
          )}

          {tab === 'decor' && custom && (
            <>
              {/* Its size next to a paperback. */}
              <div style={{ height: 180, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 14, background: '#f6f5f2', borderRadius: 10, padding: '12px 12px 0' }}>
                <div style={{ height: 160, width: 160 * BOOK_ASPECT, borderRadius: 3, background: '#ddd', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#999' }}>Paperback</div>
                <img src={custom.preview} alt="" style={{ height: 160 * custom.height, width: 'auto', display: 'block' }} />
              </div>
              <label style={{ fontSize: 13 }}>Size
                <input type="range" min={CUSTOM_HEIGHT.min} max={CUSTOM_HEIGHT.max} step={0.01} value={custom.height}
                  onChange={e => setCustom({ ...custom, height: Number(e.target.value) })} style={{ width: '100%', minHeight: 32 }} />
              </label>
              <button onClick={addCustom} style={{ ...primary, justifyContent: 'center', minHeight: 42 }}>Add to this set</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', background: '#fff',
};
const primary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', minHeight: 38, borderRadius: 8, border: 'none',
  cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: '#1a1a1a', color: '#fff',
};
const secondary: React.CSSProperties = { ...primary, background: '#f0f0f0', color: '#1a1a1a', minHeight: 32, padding: '6px 10px' };
const iconBtn: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: '#f0f0f0',
  borderRadius: 8, cursor: 'pointer', padding: 0, color: '#1a1a1a', flexShrink: 0,
};
