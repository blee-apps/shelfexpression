# Bookshelf

A responsive book cover gallery built with React, TypeScript, Tailwind CSS, and Vite. Displays a curated reading list (up to 20 books) as a Vitsoe-style shelf grid of book covers — with an animated detail view for each book.

## Features

- **Cover grid** — responsive 4-column (desktop) / 2-column (mobile) grid of book covers with cover art fetched from OpenLibrary (primary) and the Google Books API as a fallback. Rejects 1×1 placeholder images.
- **Dominant color extraction** — samples cover art pixels to derive a fallback background color. Skips near-white, near-black, and desaturated pixels; prefers saturated hues.
- **Animated detail view** — click a cover to animate it to the center of the screen with a smooth scale transition. Metadata panel slides in alongside with synopsis, author, year, and a Goodreads link.
- **Mobile responsive** — touch gestures (swipe left/right to navigate books, swipe down to close) on the detail view. Swipe is throttled with distance (≥40px) and time (200–800ms) gates to prevent accidental triggers.
- **Secret admin tool** — press `Ctrl+Shift+U` to open an overlay for editing the book list (up-to 20 slots), searching OpenLibrary (auto-populates Goodreads ID and URL fields), pasting Goodreads URLs for metadata, collecting synopses from multiple sources (OpenLibrary Work, OpenLibrary Books API, OpenLibrary Editions, and Google Books as a last-resort fallback), cycling through synopsis options with arrow buttons, condensing long synopses via an OpenRouter model of your choice (when `VITE_OPENROUTER_API_KEY` is set — fetches available models on open, shows free models with a `(free)` tag, remembers your selection), cycling through available cover options from multiple sources with thumbnail preview and arrow buttons, uploading custom high-quality cover images directly to `public/covers/` (via a Vite dev-server endpoint, dev-only), locking covers to prevent build-time overwrite, and generating the updated `RAW_BOOKS` + `USE_VITSOE_SHELF` code. Supports file upload and drag-and-drop reordering.

## Shelf Design Options

The application offers two distinct, high-fidelity aesthetic presentation styles, which can be easily toggled in [`src/books.ts`](src/books.ts) using the `USE_VITSOE_SHELF` flag:

- **Vitsoe 606 Shelf Mode** (`USE_VITSOE_SHELF = true`): Mimics a real-life physical shelving unit. Features warm birch wood shelf boards with multi-tone grain gradients, wall-mounted aluminum upright rails with slotted standard tracks, brushed metal brackets, ambient lighting occlusion, and realistic book drop shadows. Hovering a book simulates picking it off the shelf — it tilts at a random angle (±7°), lifts 20% upward, and scales 1.08× with a deeper shadow. The base stays flush with the shelf surface via `origin-bottom`.
- **Minimalist Gallery Mode** (`USE_VITSOE_SHELF = false`): A sleek, clean, distraction-free modern look where book covers hover gracefully over a pure, flat background with tight responsive spacing.

*Note: The **Secret Admin Tool** contains a toggle checkbox for this feature. When you click **Generate**, it automatically packs your selected shelf design preference into the generated code payload to easily copy-paste into `src/books.ts` alongside the updated book list.*

## How to repurpose for your own site

### 1. Replace the book data

Edit the `RAW_BOOKS` array in [`src/books.ts`](src/books.ts):

```ts
const RAW_BOOKS = [
  { id: '1', isbn: '0307946892', title: 'Tigerman', author: 'Nick Harkaway', year: 2014, synopsis: "...", gr: '19322249' },
  // ...
];
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (string). Must match the 1-based index in practice. |
| `isbn` | ISBN for cover art lookups and stable manifest key. |
| `title` | Book title. |
| `author` | Author name. |
| `year` | Publication year. |
| `synopsis` | Short description shown in the detail panel. |
| `gr` | Goodreads book ID (used for the "View on Goodreads" link). |
| `coverUrl` | *(Optional)* Explicit cover URL. When set, the runtime uses this directly instead of running the auto-detection chain (OpenLibrary → Goodreads → Google Books). Set via the cover selector or custom upload in the admin tool. |
| `coverLocked` | *(Optional)* Boolean. When `true`, the build-time download script skips this book and preserves the existing file in `public/covers/`, only re-measuring its dimensions. Set automatically when uploading a custom cover via the admin tool. |

**Tip:** Use the admin tool (`Ctrl+Shift+U`) to edit books, search OpenLibrary, cycle through cover candidates, upload custom covers, and generate the `RAW_BOOKS` code automatically.

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
| `VITE_OPENROUTER_API_KEY` | Enables the **model selector + Summarize** button in the admin tool, which condenses long synopses via any OpenRouter model. Fetches the model list on open, indicates free models with `(free)`, and persists your choice. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

For Vercel, add these in **Settings → Environment Variables**. For local development, create a `.env` file:

```
VITE_GOOGLE_BOOKS_API_KEY=your_key_here
VITE_OPENROUTER_API_KEY=your_key_here
```

### 4. Build and deploy

```bash
npm install
npm run build    # prebuild step downloads covers, then outputs to dist/
```

The `prebuild` script (`npm run download-covers`) fetches cover images from OpenLibrary (with Goodreads and Google Books fallback) and saves them to `public/covers/`, then generates `src/generated/cover-manifest.json`. At runtime the app serves covers from the same origin — zero API calls, no CORS issues, and the site works offline. Books with `coverLocked: true` are skipped, preserving any manually-placed custom cover images.

Run `npm run download-covers` manually to refresh covers without a full build.

The build produces a static site that can be served from any host (Netlify, Vercel, GitHub Pages, etc.).

## Architecture

```
index.html              — Vite entrypoint
src/
  books.ts              — Book data (RAW_BOOKS) and type definition
  main.tsx              — React root mount
  index.css             — Tailwind directives
  UpdateTool.tsx        — Admin overlay component
  generated/
    cover-manifest.json — Pre-computed cover paths and aspect ratios (generated)
digital_bookshelf.tsx   — Main app (all UI + logic in one file)
scripts/
  download-covers.ts    — Build-time cover download script (run via prebuild)
public/
  covers/               — Downloaded cover images (generated)
UpdateTool.html         — Standalone reference for the admin tool (not used at runtime)
```

### Key design decisions

- **Shared cover cache** — `coverCache` and `colorCache` are module-level Maps exported from `digital_bookshelf.tsx`, so the admin tool's `BookCover` component reads from the same cache instead of making duplicate fetch requests.
- **Google Books as last resort** — OpenLibrary search (unthrottled) is tried first for both covers and synopses. Google Books is only queried when OpenLibrary returns nothing, avoiding unnecessary 429s. An optional `VITE_GOOGLE_BOOKS_API_KEY` env var authenticates requests when higher rate limits are needed.
- **CSS transition animation** — the click-to-detail animation uses CSS transitions on `top`, `left`, `transform`, and `opacity`. The flying book's base size is set from the grid item's `originRect`, so it always lands back at the exact same pixel size with no pop. Prev/next arrows flank the flying book rather than sitting in a top-right button bar.
- **Navigation exit uses exiting book's own dimensions** — `navExitRectRef` preserves the leaving book's grid rect so the exit container matches the correct aspect ratio, preventing warping during the exit animation.
- **Build-time cover cache** — a `prebuild` script (`scripts/download-covers.ts`) fetches all cover images and pre-computes aspect ratios during build. Images are saved to `public/covers/` and served as static assets. The manifest (`cover-manifest.json`) keys books by ISBN for stable lookups — reordering books in the admin tool no longer affects cover assignments. The app checks `cover-manifest.json` first at runtime, skipping live API calls entirely for existing books. Covers not in the manifest (e.g., added later via the admin tool) still fall through to the live OpenLibrary/Goodreads/Google Books APIs. Stale cover images from removed books are automatically cleaned up on each build.
- **Cover lock system** — setting `coverLocked: true` on a book tells the download script to skip that book and preserve the existing file in `public/covers/`, only re-measuring its dimensions for the manifest. This protects manually-placed, high-quality cover images from being overwritten during rebuilds. A custom cover upload button (dev-only) in the admin tool writes user-selected images directly to `public/covers/` via `POST /api/upload-cover` and auto-sets the lock flag. The file persists in production because it lives in `public/covers/` — no server-side code needed beyond the Vite dev-server middleware.
- **Dynamic cover aspect ratio** — cover aspect ratio is determined by the actual downloaded image, not hardcoded to 2:3. Validated via `Image()` load and stored in a module-level `aspectRatioCache`.
- **Blob URL image cache** — validated cover images are drawn to a canvas and stored as blob URLs (`URL.createObjectURL`). Every `<img>` element resolves from memory instantly, eliminating re-download flashes during navigation.
- **Robust API fallback** — each external API (OpenLibrary search, Google Books) is wrapped in its own try-catch. If OpenLibrary returns a 500 or CORS error, the code falls through to Google Books instead of skipping the entire fetch.
- **Mobile swipe-down close** — swipe-down on the detail view clears the inline hover transform before running the closing animation, preventing the grid book from appearing tilted after returning to the shelf.
- **Loading screen** — the app waits for all cover images to load (or fail) and for dominant colors to be extracted before revealing the grid. A progress bar gives visual feedback.

## Dependencies

- [React 18](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/) (strict mode)
- [Vite 6](https://vite.dev/)
- [Tailwind CSS 3](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/) (icons)

## License

MIT
