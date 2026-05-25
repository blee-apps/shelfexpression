# Bookshelf

A responsive book cover gallery built with React, TypeScript, Tailwind CSS, and Vite. Displays a curated reading list (up to 20 books) as a Vitsoe-style shelf grid of book covers — with an animated detail view for each book.

## Features

- **Cover grid** — responsive 4-column (desktop) / 2-column (mobile) grid of book covers with cover art fetched from OpenLibrary (primary) and the Google Books API as a fallback. Rejects 1×1 placeholder images.
- **Dominant color extraction** — samples cover art pixels to derive a fallback background color. Skips near-white, near-black, and desaturated pixels; prefers saturated hues.
- **Animated detail view** — click a cover to animate it to the center of the screen with a smooth scale transition. Metadata panel slides in alongside with synopsis, author, year, and a Goodreads link.
- **Mobile responsive** — touch gestures (swipe left/right to navigate books, swipe down to close) on the detail view. Swipe is throttled with distance (≥40px) and time (200–800ms) gates to prevent accidental triggers.
- **Secret admin tool** — press `Shift+Cmd+U` (Mac) or `Shift+Ctrl+U` (Windows/Linux) to open an overlay for editing the book list (up-to 20 slots), searching OpenLibrary (auto-populates Goodreads ID), pasting Goodreads URLs for metadata, collecting synopses from multiple sources (OpenLibrary Work, OpenLibrary Books API, OpenLibrary Editions, and Google Books as a last-resort fallback), cycling through synopsis options with arrow buttons, condensing long synopses with the **Summarize with Gemini** button (when `VITE_GEMINI_API_KEY` is set), and generating the updated `RAW_BOOKS` array. Supports file upload and drag-and-drop reordering.

## Shelf Design Options

The application offers two distinct, high-fidelity aesthetic presentation styles, which can be easily toggled near the top of [`digital_bookshelf.tsx`](digital_bookshelf.tsx) using the `USE_VITSOE_SHELF` flag:

- **Vitsoe 606 Shelf Mode** (`USE_VITSOE_SHELF = true`): Mimics a real-life physical shelving unit. Features warm birch wood shelf boards with multi-tone grain gradients, wall-mounted aluminum upright rails with slotted standard tracks, brushed metal brackets, ambient lighting occlusion, and realistic book drop shadows. Hovering a book lifts it forward and upwards (using `origin-bottom`) to keep its base perfectly flush with the shelving surface rather than clipping through it.
- **Minimalist Gallery Mode** (`USE_VITSOE_SHELF = false`): A sleek, clean, distraction-free modern look where book covers hover gracefully over a pure, flat background with tight responsive spacing.

*Note: The **Secret Admin Tool** contains a toggle checkbox for this feature. When you click **Generate**, it automatically packs your selected shelf design preference into the generated code payload to easily copy-paste into `digital_bookshelf.tsx` alongside the updated book list.*

## How to repurpose for your own site

### 1. Replace the book data

Edit the `RAW_BOOKS` array at the top of [`digital_bookshelf.tsx`](digital_bookshelf.tsx):

```ts
const RAW_BOOKS = [
  { id: '1', isbn: '0307946892', title: 'Tigerman', author: 'Nick Harkaway', year: 2014, synopsis: "...", gr: '19322249' },
  // ...
];
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (string). Must match the 1-based index in practice. |
| `isbn` | ISBN for cover art lookups. |
| `title` | Book title. |
| `author` | Author name. |
| `year` | Publication year. |
| `synopsis` | Short description shown in the detail panel. |
| `gr` | Goodreads book ID (used for the "View on Goodreads" link). |

**Tip:** Use the admin tool (`Shift+Cmd+U`) to edit books, search OpenLibrary, and generate the `RAW_BOOKS` code automatically.

### 2. Customize styling

- Tailwind classes are used throughout; adjust colors, spacing, and fonts in the JSX.
- Fonts: **DM Serif Text** for headings, **Manrope** for body text. Both loaded via Google Fonts in the `<style>` tag.
- The grid layout lives in the App component: `grid-cols-2 md:grid-cols-4 gap-4 md:gap-6`. Adjust these classes to change column count or spacing.
- The flying book's detail-view scale is set in `getFlyingBookStyle()` (`targetScale: 1.65` desktop / `1.45` mobile).
- The admin tool supports up to 20 slots (`SLOT_COUNT` in `src/UpdateTool.tsx`).
- The page subtitle (`The {BOOKS.length} best books I've read recently.`) updates dynamically based on the number of books in `RAW_BOOKS`.
- Header links and site references point to `sangsara.net` throughout the JSX; replace them with your own domain in the `<header>` section and anywhere else they appear.

### 3. (Optional) API keys

The app works without any API keys — OpenLibrary (unthrottled) is the primary source for covers and synopses. Set these environment variables to unlock additional features:

| Variable | Purpose |
|----------|---------|
| `VITE_GOOGLE_BOOKS_API_KEY` | Lifts rate limits on Google Books cover/synopsis fallback |
| `VITE_GEMINI_API_KEY` | Enables the **Summarize with Gemini** button in the admin tool, which condenses long synopses to 2–3 sentences via Gemini 1.5 Flash. Get a free key at [aistudio.google.com](https://aistudio.google.com/apikey) (60 req/min, no credit card). |

For Vercel, add these in **Settings → Environment Variables**. For local development, create a `.env` file:

```
VITE_GOOGLE_BOOKS_API_KEY=your_key_here
VITE_GEMINI_API_KEY=your_key_here
```

### 4. Build and deploy

```bash
npm install
npm run build    # outputs to dist/
```

The build produces a static site that can be served from any host (Netlify, Vercel, GitHub Pages, etc.).

## Architecture

```
index.html              — Vite entrypoint
src/
  main.tsx              — React root mount
  index.css             — Tailwind directives
  UpdateTool.tsx        — Admin overlay component
digital_bookshelf.tsx   — Main app (all UI + logic in one file)
UpdateTool.html         — Standalone reference for the admin tool (not used at runtime)
```

### Key design decisions

- **Single file app** — `digital_bookshelf.tsx` contains all state, rendering, caching, and hooks. This was intentional for simplicity and easy copying into a new project.
- **Shared cover cache** — `coverCache` and `colorCache` are module-level Maps exported from `digital_bookshelf.tsx`, so the admin tool's `BookCover` component reads from the same cache instead of making duplicate fetch requests.
- **Google Books as last resort** — OpenLibrary search (unthrottled) is tried first for both covers and synopses. Google Books is only queried when OpenLibrary returns nothing, avoiding unnecessary 429s. An optional `VITE_GOOGLE_BOOKS_API_KEY` env var authenticates requests when higher rate limits are needed.
- **CSS transition animation** — the click-to-detail animation uses CSS transitions on `top`, `left`, `transform`, and `opacity`. The flying book's base size is set from the grid item's `originRect`, so it always lands back at the exact same pixel size with no pop.
- **Loading screen** — the app waits for all cover images to load (or fail) and for dominant colors to be extracted before revealing the grid. A progress bar gives visual feedback.

## Dependencies

- [React 18](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/) (strict mode)
- [Vite 6](https://vite.dev/)
- [Tailwind CSS 3](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/) (icons)

## License

MIT
