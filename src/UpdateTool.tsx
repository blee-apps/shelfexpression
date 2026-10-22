import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Copy, GripVertical, Upload, RotateCw, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { coverCache, fetchingSet, aspectRatioCache } from '../digital_bookshelf';
import { Book } from './books';
import coverManifest from './generated/cover-manifest.json';
import { searchBooks, measureImage, BookResult, CoverCandidate } from './bookSearch';

interface Props {
  onClose: () => void;
  books: Book[];
}

const SLOT_COUNT = 24;

type CoverOption = { url: string; label: string; preview?: string; isCurrent?: boolean; w?: number; h?: number };

// Covers shorter than this look soft on the shelf.
const LOW_RES_HEIGHT = 800;

// Accepts a Goodreads link or a bare ID and returns just the ID.
const goodreadsIdFrom = (text: string) => {
  const m = text.match(/goodreads\.com\/book\/show\/(\d+)/) || text.trim().match(/^(\d+)(?:[-.].*)?$/);
  return m ? m[1] : text.trim();
};

// Turns a value into a safe string literal for books.ts (escapes quotes,
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
  // `preview` is what the picker shows; `url` is what gets saved as coverUrl.
  // The book's existing cover is always offered first, labeled "Current".
  const [coverOptions, setCoverOptions] = useState<CoverOption[]>([]);
  const coverRequestId = useRef(0);
  const [coversLoading, setCoversLoading] = useState(false);
  const [coverIndex, setCoverIndex] = useState(0);
  const [coverLocked, setCoverLocked] = useState(false);
  const [shareMode, setShareMode] = useState(false);
  const [selectedForShare, setSelectedForShare] = useState<Set<number>>(new Set());
  const [shareBg, setShareBg] = useState<'light' | 'dark' | 'vitsoe'>('light');

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

  // --- SHARE IMAGE RENDERER ---
  const loadImg = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const renderShareImage = async (): Promise<Blob | null> => {
    const indices = [...selectedForShare].sort((a, b) => a - b);
    const books = indices.map(i => slots[i]).filter((b): b is Book => b !== null);
    if (books.length === 0) return null;

    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const isLight = shareBg === 'light';
    const isVitsoe = shareBg === 'vitsoe';
    ctx.fillStyle = isVitsoe ? '#F5F0EB' : isLight ? '#FDFDFD' : '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    // Vitsoe wall vignette — radial gradient, top-center highlight
    if (isVitsoe) {
      const vignette = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.7);
      vignette.addColorStop(0, 'rgba(255,255,255,0.35)');
      vignette.addColorStop(0.7, 'rgba(255,255,255,0)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    }

    // Load fonts (with timeout fallback)
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('80px "DM Serif Text"'),
          document.fonts.load('52px "DM Serif Text"'),
          document.fonts.load('32px Manrope'),
          document.fonts.load('44px Manrope'),
        ]),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    } catch {}

    // Load cover images
    const coverImgs: (HTMLImageElement | null)[] = [];
    for (const book of books) {
      let img: HTMLImageElement | null = null;
      const cached = coverCache.get(book.id);
      if (cached) {
        try { img = await loadImg(cached); } catch {}
      }
      if (!img && book.coverUrl) {
        try { img = await loadImg(book.coverUrl); } catch {}
      }
      if (!img) {
        const m = coverManifest[(book.isbn || book.id) as keyof typeof coverManifest];
        if (m) {
          const p = (m as { path: string | null }).path;
          if (p) {
            try { img = await loadImg(p); } catch {}
          }
        }
      }
      coverImgs.push(img);
    }

    const textColor = isVitsoe ? '#2a2a2a' : isLight ? '#1a1a1a' : '#FDFDFD';
    const subColor = isVitsoe ? '#555555' : isLight ? '#666666' : '#bbbbbb';

    // Single book — portrait (cover on top, text stacked below)
    if (books.length === 1) {
      const book = books[0];
      const cover = coverImgs[0];
      const pad = 80;
      const coverW = 560;
      const coverRatio = cover ? cover.naturalWidth / cover.naturalHeight : 2 / 3;
      const coverH = Math.min(coverW / coverRatio, 780);
      const coverX = (W - coverW) / 2;
      const coverY = 100;

      if (cover) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.30)';
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 16;
        ctx.drawImage(cover, coverX, coverY, coverW, coverH);
        ctx.restore();
      }

      const textStartY = coverY + coverH + 100;

      const textMaxW = 880;
      const textX = (W - textMaxW) / 2;

      // Scaling steps: [title size, synopsis size] — scale both down together to fit
      const scaleSteps = [
        { t: 80, tlh: 96, s: 44, slh: 60 },
        { t: 64, tlh: 77, s: 36, slh: 48 },
        { t: 52, tlh: 62, s: 30, slh: 40 },
        { t: 44, tlh: 53, s: 24, slh: 34 },
      ];

      const availableH = H - pad - textStartY;
      const authorH = 50;
      const gapH = 22 + 65 + 5 + 65;
      const synopsis = book.synopsis;

      let titleFontSize = 44, titleLH = 53;
      let synFontSize = 24, synLH = 34;
      let finalTitleLines: string[] = [];
      let finalSynLines: string[] = [];
      let keepSynLines = 0;

      for (const step of scaleSteps) {
        ctx.font = `${step.t}px "DM Serif Text", serif`;
        const tLines = wrapText(ctx, book.title, textMaxW).slice(0, 3);

        ctx.font = `${step.s}px Manrope, sans-serif`;
        const sLines = synopsis ? wrapText(ctx, synopsis, textMaxW) : [];

        const contentH = tLines.length * step.tlh + gapH + authorH + sLines.length * step.slh;

        titleFontSize = step.t;
        titleLH = step.tlh;
        synFontSize = step.s;
        synLH = step.slh;
        finalTitleLines = tLines;
        finalSynLines = sLines;

        if (contentH <= availableH) {
          keepSynLines = sLines.length;
          break;
        }

        // Last step — truncate synopsis to fit
        if (step === scaleSteps[scaleSteps.length - 1]) {
          const maxSyn = Math.floor((availableH - tLines.length * step.tlh - gapH - authorH) / step.slh);
          keepSynLines = Math.max(0, maxSyn);
        }
      }

      // Draw title — left-aligned, with drop shadow on light/vitsoe themes
      let textY = textStartY + titleFontSize * 0.85;
      ctx.fillStyle = textColor;
      ctx.font = `${titleFontSize}px "DM Serif Text", serif`;
      if (shareBg !== 'dark') {
        ctx.shadowColor = 'rgba(0,0,0,0.06)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
      }
      for (let i = 0; i < finalTitleLines.length; i++) {
        ctx.fillText(finalTitleLines[i], textX, textY);
        if (i < finalTitleLines.length - 1) textY += titleLH;
      }
      ctx.shadowColor = 'transparent';

      // Draw author — uppercased, left-aligned, proportional to detail view spacing
      textY += titleFontSize * 0.15 + 22 + 32 * 0.85;
      ctx.fillStyle = subColor;
      ctx.font = '32px Manrope, sans-serif';
      const authorLine = `${book.author.toUpperCase()}${book.year ? '  \u2022  ' + book.year : ''}`;
      ctx.fillText(authorLine, textX, textY);

      // Separator line — proportional to detail view (w-8 h-[2px] → 86×5 at canvas scale)
      if (synopsis && keepSynLines > 0) {
        textY += 32 * 0.15 + 65;
        ctx.fillStyle = textColor;
        ctx.fillRect(textX, textY, 86, 5);

        textY += 5 + 65 + synFontSize * 0.85;
        ctx.font = `${synFontSize}px Manrope, sans-serif`;
        ctx.fillStyle = textColor;
        for (let i = 0; i < keepSynLines; i++) {
          ctx.fillText(finalSynLines[i], textX, textY);
          textY += synLH;
        }
      }
    } else {
      // Multi-book grid: 2 cols for ≤5 books, 3 cols for 6+
      const cols = books.length === 2 ? 1 : books.length <= 6 ? 2 : 3;
      const rows = Math.ceil(books.length / cols);

      if (isVitsoe) {
        // Vitsoe shelf layout — books bottom-aligned to shelf boards
        const px = 80;
        const boardH = 18, lipH = 5, bracketW = 12, bracketH = 24, uprightW = 14;
        const bottomExtra = 40;

        // Pre-scan max book height so the shelf block can be vertically centered
        const aw = W - px * 2 + 16;
        const colW = (aw - (cols - 1) * 24) / cols;
        let maxBookH = 0;
        for (const img of coverImgs) {
          if (!img) continue;
          const h = Math.min(colW / (img.naturalWidth / img.naturalHeight), 620);
          if (h > maxBookH) maxBookH = h;
        }
        if (maxBookH === 0) maxBookH = 500;

        // Constrain maxBookH so all rows fit within canvas height
        const furniturePerRow = 36 + boardH + lipH + bracketH;
        const maxFitH = Math.floor((H - 40 - bottomExtra) / rows) - furniturePerRow;
        if (maxBookH > maxFitH) maxBookH = maxFitH;

        const rowH = maxBookH + furniturePerRow;
        const padY = Math.max(40, Math.floor((H - rows * rowH - bottomExtra) / 2));

        // Uprights (left and right)
        const drawUpright = (x: number) => {
          const ug = ctx.createLinearGradient(x, 0, x + uprightW, 0);
          ug.addColorStop(0, '#c8c8c8'); ug.addColorStop(0.35, '#e8e8e8');
          ug.addColorStop(0.5, '#ffffff'); ug.addColorStop(0.65, '#e0e0e0');
          ug.addColorStop(1, '#bcbcbc');
          ctx.fillStyle = ug;
          ctx.fillRect(x, 0, uprightW, H);
          // Slot holes
          ctx.fillStyle = 'rgba(0,0,0,0.13)';
          const sx = x + (uprightW - 4) / 2;
          for (let sy = 60; sy < H - 60; sy += 14) ctx.fillRect(sx, sy, 4, 6);
        };
        drawUpright(px - uprightW - 8);
        drawUpright(W - px + 8);

        for (let row = 0; row < rows; row++) {
          const shelfTop = padY + (row + 1) * rowH - boardH;
          const rowStartY = padY + row * rowH;
          const bookAreaH = shelfTop - rowStartY - 36;

          // Shelf board — wood gradient
          const bg = ctx.createLinearGradient(0, shelfTop, 0, shelfTop + boardH);
          bg.addColorStop(0, '#e8dcc8'); bg.addColorStop(0.55, '#d4c8a4'); bg.addColorStop(1, '#b8ac84');
          ctx.fillStyle = bg;
          ctx.fillRect(px - 8, shelfTop, W - px * 2 + 16, boardH);

          // Shelf front lip
          const lg = ctx.createLinearGradient(0, shelfTop + boardH, 0, shelfTop + boardH + lipH);
          lg.addColorStop(0, '#b0a07c'); lg.addColorStop(1, '#9a8c68');
          ctx.fillStyle = lg;
          ctx.fillRect(px - 8, shelfTop + boardH, W - px * 2 + 16, lipH);

          // Contact shadow above shelf
          const sg = ctx.createLinearGradient(0, shelfTop - 14, 0, shelfTop);
          sg.addColorStop(0, 'transparent'); sg.addColorStop(1, 'rgba(0,0,0,0.07)');
          ctx.fillStyle = sg;
          ctx.fillRect(px - 8, shelfTop - 14, W - px * 2 + 16, 14);

          // Brackets — draw downward from shelf top (match main app behavior)
          const bkg = ctx.createLinearGradient(px - 8 + 20, 0, px - 8 + 20 + bracketW, 0);
          bkg.addColorStop(0, '#d0d0d0'); bkg.addColorStop(0.4, '#e8e8e8'); bkg.addColorStop(0.55, '#f0f0f0'); bkg.addColorStop(1, '#d4d4d4');
          ctx.fillStyle = bkg;
          ctx.fillRect(px - 8 + 20, shelfTop, bracketW, bracketH);
          ctx.fillRect(W - px + 8 - 20 - bracketW, shelfTop, bracketW, bracketH);

          // Books in this row
          const rowBooks: number[] = [];
          for (let i = 0; i < books.length; i++) { if (Math.floor(i / cols) === row) rowBooks.push(i); }
          const n = rowBooks.length;
          const aw = W - px * 2 + 16;
          const maxBW = (aw - (cols - 1) * 24) / cols;
          const rowW = n * maxBW + (n - 1) * 24;
          const ox = (aw - rowW) / 2;

          for (let bi = 0; bi < n; bi++) {
            const img = coverImgs[rowBooks[bi]];
            if (!img) continue;
            const r = img.naturalWidth / img.naturalHeight;
            let dw = maxBW, dh = dw / r;
            if (dh > bookAreaH) { dh = bookAreaH; dw = dh * r; }
            if (dw > maxBW) { dw = maxBW; dh = dw / r; }
            const bx = px - 8 + ox + bi * (maxBW + 24);
            const by = shelfTop - dh;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.18)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetY = 4;
            ctx.drawImage(img, bx + (maxBW - dw) / 2, by, dw, dh);
            ctx.restore();
          }
        }
      } else {
      const pad = 60;
      const gap = 24;
      const gridW = W - pad * 2;
      const gridH = H - pad * 2;
      const cellW = (gridW - gap * (cols - 1)) / cols;
      const cellH = (gridH - gap * (rows - 1)) / rows;

      for (let i = 0; i < books.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const img = coverImgs[i];

        // Center partial last row
        const cellsInThisRow = (row < rows - 1) ? cols : books.length - (rows - 1) * cols;
        const rowOffset = (cols - cellsInThisRow) * (cellW + gap) / 2;

        const cx = pad + rowOffset + col * (cellW + gap);
        const cy = pad + row * (cellH + gap);

        if (img) {
          const imgRatio = img.naturalWidth / img.naturalHeight;
          let drawW = cellW;
          let drawH = drawW / imgRatio;
          if (drawH > cellH) {
            drawH = cellH;
            drawW = drawH * imgRatio;
          }
          const dx = cx + (cellW - drawW) / 2;
          const dy = cy + (cellH - drawH) / 2;

          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.15)';
          ctx.shadowBlur = 24;
          ctx.shadowOffsetY = 6;
          ctx.drawImage(img, dx, dy, drawW, drawH);
          ctx.restore();
        }
      }
      }
    }

    return new Promise(resolve => {
      canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92);
    });
  };

  const generateShareJpg = async () => {
    if (selectedForShare.size === 0) return;
    try {
      const blob = await renderShareImage();
      if (!blob) { showToast('Failed to generate image.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bookshelf.jpg';
      a.click();
      // Free the image a moment later; revoking right away can cancel the download in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`Saved (${selectedForShare.size} ${selectedForShare.size === 1 ? 'book' : 'books'}).`);
    } catch (err: any) {
      showToast('Error generating image: ' + err.message);
    }
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
    if (book.coverUrl) return { url: book.coverUrl, label: 'Current', isCurrent: true };
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
    if (import.meta.env.DEV && picked && !picked.isCurrent && /^https:\/\//.test(picked.url)) {
      setSaving(true);
      const key = editIsbn.trim() || String(editingIndex + 1);
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
        // Keep the existing cover unless a different one was picked.
        coverUrl: coverUrl || '',
        coverLocked: locked || undefined,
      };
      return next;
    });
    coverCache.delete(String(editingIndex + 1));
    showToast(`Saved slot #${editingIndex + 1}.`);
    return true;
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

  // Finds the book's Goodreads page (via the local dev server, since
  // Goodreads blocks direct requests from the browser).
  const findGoodreads = async (r: BookResult) => {
    const requestId = ++grRequestId.current;
    if (!import.meta.env.DEV) {
      if (r.grId) { setEditGr(r.grId); setGrStatus({ text: 'Linked from OpenLibrary. Worth a quick check.' }); }
      else setGrStatus({ text: 'Paste the Goodreads link for this book.', warn: true });
      return;
    }
    setGrStatus({ text: 'Finding it on Goodreads…' });
    try {
      const params = new URLSearchParams({ isbn: r.isbns.slice(0, 6).join(','), title: r.title, author: r.author });
      const res = await fetch(`/api/goodreads?${params}`);
      if (requestId !== grRequestId.current) return;
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEditGr(data.id);
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
  const generateCode = () => {
    const filled = slots.filter((b): b is Book => b !== null);
    if (filled.length === 0) {
      showToast('No books to encode.');
      return;
    }
    const lines = filled.map((book, i) => {
      let entry = `  { id: ${lit(String(i + 1))}, isbn: ${lit(book.isbn || '')}, title: ${lit(book.title || '')}, author: ${lit(book.author || '')}, year: ${Number(book.year) || 0}, synopsis: ${lit(book.synopsis || '')}, gr: ${lit(book.gr || '')}`;
      if (book.coverUrl) entry += `, coverUrl: ${lit(book.coverUrl)}`;
      if (book.coverLocked) entry += ', coverLocked: true';
      return entry + ' }';
    });
    const code = 'export const RAW_BOOKS = [\n' + lines.join(',\n') + ',\n];\n\nexport const USE_VITSOE_SHELF = ' + useVitsoeShelf + ';';
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
          <button onClick={() => { setShareMode(v => !v); setSelectedForShare(new Set()); }} style={btnStyle({ secondary: true, small: true })}>
            {shareMode ? 'Exit Share' : 'Share'}
          </button>
          <button onClick={onClose} style={btnStyle({ small: true })}><X size={14} /></button>
        </div>
      </div>

      {shareMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 20px', borderBottom: '1px solid #eee', flexShrink: 0,
          background: '#fafafa',
        }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1a1a1a' }}>
            {selectedForShare.size} selected
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => setShareBg('light')} style={{
              ...btnStyle({ secondary: true, small: true }),
              background: shareBg === 'light' ? '#1a1a1a' : undefined,
              color: shareBg === 'light' ? '#fff' : undefined,
            }}>Light</button>
            <button onClick={() => setShareBg('dark')} style={{
              ...btnStyle({ secondary: true, small: true }),
              background: shareBg === 'dark' ? '#1a1a1a' : undefined,
              color: shareBg === 'dark' ? '#fff' : undefined,
            }}>Dark</button>
            <button onClick={() => setShareBg('vitsoe')} style={{
              ...btnStyle({ secondary: true, small: true }),
              background: shareBg === 'vitsoe' ? '#1a1a1a' : undefined,
              color: shareBg === 'vitsoe' ? '#fff' : undefined,
            }}>Vitsoe</button>
          </div>
          <div style={{ width: 1, height: 20, background: '#ddd' }} />
          {(() => {
            const maxSel = Math.min(12, slots.filter(s => s !== null).length);
            const allSelected = maxSel > 0 && selectedForShare.size >= maxSel;
            return (
              <button onClick={() => {
                if (allSelected) setSelectedForShare(new Set());
                else setSelectedForShare(new Set(slots.map((_, i) => slots[i] ? i : -1).filter(i => i >= 0).slice(0, 12)));
              }} style={btnStyle({ secondary: true, small: true })}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            );
          })()}
          <div style={{ flex: 1 }} />
          <button onClick={generateShareJpg} disabled={selectedForShare.size === 0}
            style={btnStyle({ small: true })}>
            Generate JPG ({selectedForShare.size})
          </button>
        </div>
      )}

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
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 10, marginBottom: 20,
        }}>
          {slots.map((book, i) => (
            <div key={i}
              className="admin-slot"
              draggable={!!book && !shareMode}
              onDragStart={book ? handleDragStart(i) : undefined}
              onDragEnd={book ? handleDragEnd : undefined}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter(i)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(i)}
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
                if (!book) openEdit(i);
              }}
            >
              {book ? (
                <>
                  {shareMode ? (
                    <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}>
                      <input type="checkbox" checked={selectedForShare.has(i)}
                        onChange={() => toggleShareSelection(i)}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#1a1a1a' }} />
                    </div>
                  ) : (
                    <div style={{ position: 'absolute', top: 5, left: 7, fontSize: '0.6rem', fontWeight: 600, color: '#bbb', background: '#f5f5f5', padding: '1px 5px', borderRadius: 3 }}>
                      <GripVertical size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />#{i + 1}
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
                      <button onClick={(e) => { e.stopPropagation(); openEdit(i); }} style={btnStyle({ secondary: true, small: true })}>Edit</button>
                      <button onClick={(e) => { e.stopPropagation(); removeBook(i); }} style={{ ...btnStyle({ secondary: true, small: true }), color: '#c0392b' }}>Remove</button>
                      {i > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); moveBook(i, 0); }} style={btnStyle({ secondary: true, small: true })} title="Move to top">↑</button>
                      )}
                    </div>
                  )}
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

      <style>{`
        .admin-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: admin-spin 0.7s linear infinite; }
        @keyframes admin-spin { to { transform: rotate(360deg); } }
        .admin-result { transition: border-color 0.15s, box-shadow 0.15s; }
        .admin-result:hover, .admin-result:focus-visible { border-color: #ccc !important; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
      `}</style>

      {/* EDIT MODAL */}
      {editingIndex >= 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.35)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => setEditingIndex(-1)}>
          <div style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 660,
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
                <div style={{
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
                  <img src={coverOptions[coverIndex]?.preview || coverOptions[coverIndex]?.url || ''} alt="Selected cover"
                    style={{ width: 110, height: 'auto', borderRadius: 4, background: '#f0f0f0', border: '1px solid #eee', flexShrink: 0 }}
                    onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1 }}>
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
                {import.meta.env.DEV && (
                  <>
                    <input
                      type="file" accept="image/*"
                      id="cover-file-input" style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const isbn = editIsbn.trim() || String(editingIndex + 1);
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={coverLocked} onChange={e => setCoverLocked(e.target.checked)}
                    style={{ cursor: 'pointer' }} />
                  Lock cover
                </label>
              </div>

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
