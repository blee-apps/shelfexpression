// Goodreads import: read the CSV that Goodreads' "Export Library" gives you,
// tick the books you want, and they fill the shelf's free slots. Goodreads
// doesn't export covers or blurbs, so both are looked up for the books you
// pick, using the same search as Add book.
import { useMemo, useRef, useState } from 'react';
import { X, Upload, Check, Search } from 'lucide-react';
import { Book } from './books';
import { searchBooks } from './bookSearch';
import { addPendingCover, fetchCover } from './publish';

export type GoodreadsRow = {
  grId: string; title: string; author: string; isbn: string; year: number;
  rating: number; shelf: string; dateRead: string; dateAdded: string;
};

// A small CSV reader: quoted fields, doubled quotes, and line breaks inside
// quotes (reviews have them).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

// Goodreads writes ISBNs as ="9780441012039" so spreadsheets keep the zeros.
const cleanIsbn = (s = '') => s.replace(/[^0-9Xx]/g, '').toUpperCase();
// "Neuromancer (Sprawl, #1)" → "Neuromancer"
const cleanTitle = (t: string) => t.replace(/\s*\([^()]*#\s*[\d.]+\)\s*$/, '').trim();

export function readGoodreads(text: string): GoodreadsRow[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const iTitle = col('title'), iAuthor = col('author');
  if (iTitle < 0 || iAuthor < 0) throw new Error('This doesn\u2019t look like a Goodreads export.');
  const get = (r: string[], name: string) => { const i = col(name); return i >= 0 ? (r[i] || '').trim() : ''; };
  return rows.slice(1).map(r => {
    const isbn13 = cleanIsbn(get(r, 'isbn13')), isbn10 = cleanIsbn(get(r, 'isbn'));
    const year = parseInt(get(r, 'original publication year'), 10) || parseInt(get(r, 'year published'), 10) || 0;
    return {
      grId: get(r, 'book id'),
      title: cleanTitle(get(r, 'title')),
      author: get(r, 'author').replace(/\s+/g, ' '),
      isbn: isbn13 || isbn10,
      year,
      rating: parseInt(get(r, 'my rating'), 10) || 0,
      shelf: get(r, 'exclusive shelf') || 'read',
      dateRead: get(r, 'date read'),
      dateAdded: get(r, 'date added'),
    };
  }).filter(b => b.title && b.author);
}

const SHELVES = [
  { id: 'read', label: 'Read' },
  { id: 'currently-reading', label: 'Reading' },
  { id: 'to-read', label: 'Want to read' },
  { id: 'all', label: 'All' },
];

// Goodreads dates look like 2024/03/17.
const dateKey = (b: GoodreadsRow) => (b.dateRead || b.dateAdded || '').replace(/\D/g, '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type Props = {
  existing: Book[];
  freeSlots: number;
  slotCount: number;
  gbKey: string;
  onAdd: (books: Book[]) => void;
  onClose: () => void;
};

export default function GoodreadsImport({ existing, freeSlots, slotCount, gbKey, onAdd, onClose }: Props) {
  const [rows, setRows] = useState<GoodreadsRow[] | null>(null);
  const [error, setError] = useState('');
  const [shelf, setShelf] = useState('read');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]); // keys, in the order ticked
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<AbortController | null>(null);

  const keyOf = (b: GoodreadsRow) => b.grId || `${norm(b.title)}|${norm(b.author)}`;
  const onShelf = useMemo(() => {
    const set = new Set<string>();
    for (const b of existing) {
      if (b.gr) set.add(`gr:${b.gr}`);
      if (b.isbn) set.add(`isbn:${b.isbn}`);
      set.add(`ta:${norm(b.title)}|${norm(b.author)}`);
    }
    return (b: GoodreadsRow) => (b.grId && set.has(`gr:${b.grId}`)) || (b.isbn && set.has(`isbn:${b.isbn}`)) || set.has(`ta:${norm(b.title)}|${norm(b.author)}`);
  }, [existing]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length || 0 };
    rows?.forEach(b => { c[b.shelf] = (c[b.shelf] || 0) + 1; });
    return c;
  }, [rows]);

  const list = useMemo(() => {
    if (!rows) return [];
    const q = norm(query);
    return rows
      .filter(b => shelf === 'all' || b.shelf === shelf)
      .filter(b => !q || norm(b.title).includes(q) || norm(b.author).includes(q))
      .sort((a, b) => dateKey(b).localeCompare(dateKey(a)));
  }, [rows, shelf, query]);

  const byKey = useMemo(() => new Map((rows || []).map(b => [keyOf(b), b])), [rows]);
  const full = picked.length >= freeSlots;

  const readFile = async (file: File) => {
    setError('');
    try {
      const found = readGoodreads(await file.text());
      if (!found.length) throw new Error('No books found in that file.');
      setRows(found);
      setPicked([]);
      if (!found.some(b => b.shelf === 'read')) setShelf('all');
    } catch (e: any) {
      setError(e.message || 'Couldn\u2019t read that file.');
    }
  };

  const toggle = (b: GoodreadsRow) => {
    const k = keyOf(b);
    setPicked(p => p.includes(k) ? p.filter(x => x !== k) : p.length >= freeSlots ? p : [...p, k]);
  };

  // Look up a blurb for each picked book (a few at a time), then add them.
  const add = async () => {
    const chosen = picked.map(k => byKey.get(k)).filter((b): b is GoodreadsRow => !!b);
    if (!chosen.length) return;
    const ac = new AbortController();
    cancelRef.current = ac;
    const synopses: string[] = new Array(chosen.length).fill('');
    const years: number[] = chosen.map(b => b.year);
    const covers: string[] = new Array(chosen.length).fill('');
    let next = 0, done = 0;
    setProgress({ done: 0, total: chosen.length });
    const worker = async () => {
      while (next < chosen.length && !ac.signal.aborted) {
        const i = next++;
        const b = chosen[i];
        try {
          const { results } = await searchBooks(b.title, b.author, gbKey, ac.signal);
          // Same ISBN first; otherwise the title and author's surname have to match, so
          // a knockoff "Summary of…" never sneaks in.
          const short = norm(b.title.split(':')[0]);
          const surname = norm(b.author.split(/\s+/).pop() || '');
          const hit = results.find(r => b.isbn && r.isbns.includes(b.isbn))
            || results.find(r => surname && norm(r.author).includes(surname)
              && norm(r.title).startsWith(short) && !/^summary\b/i.test(r.title));
          if (hit) {
            synopses[i] = hit.synopses[0] || '';
            if (!years[i] && hit.year) years[i] = hit.year;
            const url = hit.covers[0]?.url;
            if (url) {
              // Like Add book: on the live site the cover is downloaded now and
              // uploaded when you publish. Locally it just points at the URL.
              if (!import.meta.env.DEV && /^https:\/\//.test(url)) {
                try { covers[i] = addPendingCover(b.isbn || `gr-${b.grId || i}`, await fetchCover(url)); } catch {}
              } else covers[i] = url;
            }
          }
        } catch {}
        done++;
        if (!ac.signal.aborted) setProgress({ done, total: chosen.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    cancelRef.current = null;
    const stamp = Date.now().toString(36);
    onAdd(chosen.map((b, i) => ({
      id: `gr-${stamp}-${i + 1}`,
      isbn: b.isbn,
      title: b.title,
      author: b.author,
      year: years[i] || 0,
      synopsis: synopses[i],
      gr: b.grId,
      mult: 1.0,
      coverUrl: covers[i],
    })));
  };

  const skipBlurbs = () => cancelRef.current?.abort();

  const pill = (active: boolean): React.CSSProperties => ({
    flexShrink: 0, padding: '5px 11px', borderRadius: 999, border: 'none', cursor: 'pointer',
    fontSize: '0.78rem', fontWeight: 500, minHeight: 30,
    background: active ? '#1a1a1a' : '#eee', color: active ? '#fff' : '#333',
  });
  const primary = (disabled: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none', borderRadius: 6,
    fontSize: '0.85rem', fontWeight: 500, cursor: disabled ? 'default' : 'pointer', minHeight: 36,
    background: '#1a1a1a', color: '#fff', opacity: disabled ? 0.4 : 1,
  });
  const secondary: React.CSSProperties = { ...primary(false), background: '#eee', color: '#333' };

  return (
    <div className="gr-import" style={{
      position: 'fixed', inset: 0, zIndex: 10001, background: '#fff', display: 'flex', flexDirection: 'column',
      fontFamily: 'Manrope, system-ui, sans-serif', color: '#1a1a1a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', paddingTop: 'max(12px, env(safe-area-inset-top))', borderBottom: '1px solid #eee' }}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Import from Goodreads</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => { skipBlurbs(); onClose(); }} aria-label="Close"
          style={{ ...secondary, padding: 8, minHeight: 34 }}><X size={16} /></button>
      </div>

      {!rows ? (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '32px 20px' }}>
          <div style={{ maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 16, fontSize: '0.9rem', lineHeight: 1.5, color: '#444' }}>
            <p style={{ margin: 0 }}>
              Pick books from your Goodreads library to fill your shelf's {freeSlots} free {freeSlots === 1 ? 'slot' : 'slots'}.
            </p>
            <ol style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal' }}>
              <li>On Goodreads, open <a href="https://www.goodreads.com/review/import" target="_blank" rel="noreferrer" style={{ color: '#1a1a1a' }}>Import and export</a> and tap Export Library.</li>
              <li>When it's ready, download the file (it ends in .csv).</li>
              <li>Choose that file here.</li>
            </ol>
            <div>
              <button onClick={() => fileRef.current?.click()} style={primary(freeSlots <= 0)} disabled={freeSlots <= 0}>
                <Upload size={15} /> Choose file…
              </button>
            </div>
            {freeSlots <= 0 && <p style={{ margin: 0, color: '#b42318' }}>The shelf is full ({slotCount} slots). Remove something first.</p>}
            {error && <p style={{ margin: 0, color: '#b42318' }}>{error}</p>}
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
              The file stays on this device. Covers and blurbs are looked up for the books you pick.
            </p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f); }} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {SHELVES.filter(s => s.id === 'all' || counts[s.id]).map(s => (
                <button key={s.id} onClick={() => setShelf(s.id)} style={pill(shelf === s.id)}>
                  {s.label} <span style={{ opacity: 0.6 }}>{counts[s.id] || 0}</span>
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #ddd', borderRadius: 6, padding: '0 10px' }}>
              <Search size={14} color="#999" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by title or author"
                style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 16, background: 'transparent', minWidth: 0 }} />
            </label>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {list.length === 0 && <p style={{ padding: 20, color: '#888', fontSize: '0.85rem' }}>No books here.</p>}
            {list.map(b => {
              const k = keyOf(b);
              const already = onShelf(b);
              const on = picked.includes(k);
              const disabled = already || (!on && full);
              return (
                <button key={k} onClick={() => !disabled && toggle(b)} disabled={disabled}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                    padding: '9px 16px', border: 'none', borderBottom: '1px solid #f2f2f2', background: on ? '#f6f6f4' : '#fff',
                    cursor: disabled ? 'default' : 'pointer', opacity: disabled && !on ? 0.4 : 1, minHeight: 0, font: 'inherit', color: 'inherit',
                  }}>
                  <span style={{
                    flexShrink: 0, width: 20, height: 20, borderRadius: 5, display: 'grid', placeItems: 'center',
                    border: on ? 'none' : '1.5px solid #ccc', background: on ? '#1a1a1a' : '#fff',
                  }}>{on && <Check size={14} color="#fff" strokeWidth={3} />}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</span>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.author}{b.year ? ` \u00b7 ${b.year}` : ''}{b.rating ? ` \u00b7 ${'\u2605'.repeat(b.rating)}` : ''}
                    </span>
                  </span>
                  {already && <span style={{ flexShrink: 0, fontSize: '0.7rem', color: '#888' }}>On shelf</span>}
                </button>
              );
            })}
          </div>

          <div className="sheet-footer" style={{ padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', borderTop: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontSize: '0.8rem', color: full ? '#1a1a1a' : '#888', lineHeight: 1.35 }}>
              {progress
                ? `Finding covers and blurbs\u2026 ${progress.done} of ${progress.total}`
                : `${picked.length} of ${freeSlots} free ${freeSlots === 1 ? 'slot' : 'slots'}`}
            </span>
            {progress ? (
              <button onClick={skipBlurbs} style={secondary}>Skip the rest</button>
            ) : (
              <>
                {picked.length > 0 && <button onClick={() => setPicked([])} style={secondary}>Clear</button>}
                <button onClick={add} disabled={!picked.length} style={primary(!picked.length)}>
                  Add {picked.length || ''} {picked.length === 1 ? 'book' : 'books'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
