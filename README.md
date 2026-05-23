# Bookshelf

A responsive book cover gallery built with React, TypeScript, Tailwind CSS, and Vite. Displays a curated reading list as a grid of book covers — with an animated detail view for each book.

## Features

- **Cover grid** — responsive 4-column (desktop) / 2-column (mobile) grid of book covers with cover art fetched from Google Books API and OpenLibrary, with multi-source fallback and validation (rejects 1×1 placeholder images).
- **Dominant color extraction** — samples cover art pixels to derive a fallback background color. Skips near-white, near-black, and desaturated pixels; prefers saturated hues.
- **Animated detail view** — click a cover to animate it to the center of the screen with a smooth scale transition. Metadata panel slides in alongside with synopsis, author, year, and a Goodreads link.
- **Mobile responsive** — touch gestures (swipe left/right to navigate books, swipe down to close) on the detail view.
- **Secret admin tool** — press `Shift+Cmd+U` (Mac) or `Shift+Ctrl+U` (Windows/Linux) to open an overlay for editing the book list, searching OpenLibrary, and generating the updated `RAW_BOOKS` array.

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
- The grid layout lives in the App component: `grid-cols-2 md:grid-cols-4 gap-4 md:gap-6`. Adjust these classes to change column count or spacing.
- The flying book's detail-view scale is set in `getFlyingBookStyle()` (`targetScale: 1.65` desktop / `1.45` mobile).
- Header links and site references point to `sangsara.net` throughout the JSX; replace them with your own domain in the `<header>` section and anywhere else they appear.

### 3. Build and deploy

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
- **Cover cache** — `coverCache` and `colorCache` are module-level Maps, persisted across renders. A `colorStore` notifies subscribers when cover colors finish extracting.
- **CSS transition animation** — the click-to-detail animation uses CSS transitions on `top`, `left`, `transform`, and `opacity`. No animation libraries required.
- **Loading screen** — the app waits for all cover images to load (or fail) and for dominant colors to be extracted before revealing the grid. A progress bar gives visual feedback.

## Dependencies

- [React 18](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/) (strict mode)
- [Vite 6](https://vite.dev/)
- [Tailwind CSS 3](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/) (icons)

## License

MIT
