# Bookshelf

A 3D interactive bookshelf built with React, TypeScript, Tailwind CSS, and Vite. Displays a curated reading list as visually rich 3D books — complete with covers, colored spines, and an animated detail view.

## Features

- **3D book rendering** — each book is a CSS 3D box with cover art, colored spine/back, and subtle shadows. Hover lifts the book 32px with a smooth ease-out transition.
- **Cover art fetching** — automatically pulls cover images from Google Books API and OpenLibrary, with multi-source fallback and validation (rejects 1×1 placeholder images).
- **Dominant color extraction** — samples cover art pixels to derive spine and back-cover colors. Skips near-white, near-black, and desaturated pixels; prefers saturated hues.
- **Animated detail view** — click a book to fly it to the center of the screen in a smooth 3D animation. Metadata panel slides in alongside with synopsis, author, year, and a Goodreads link.
- **Mobile responsive** — adapts book dimensions, layout, and touch gestures (swipe left/right to navigate books, swipe down to close) for mobile viewports.
- **Drag-to-scroll shelf** — click-and-drag or touch-drag to scroll horizontally through the shelf.
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
- CSS custom properties for book dimensions live in a `<style>` tag inside the component:
  ```css
  :root { --w: 285px; --h: 430px; --base-d: 52px; }
  @media (max-width: 768px) { :root { --w: 160px; --h: 240px; --base-d: 30px; } }
  ```
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
- **Cover cache** — `coverCache` and `colorCache` are module-level Maps, persisted across renders. A `colorStore` notifies subscribers when spine colors finish extracting.
- **3D via CSS transforms** — no Three.js or WebGL. Books are built from absolutely-positioned `div`s with `transform-style: preserve-3d` and `rotateY` / `translateZ` transforms. The flying-book animation uses CSS transitions on `top`, `left`, and `transform`.
- **Loading screen** — the app waits for all cover images to load (or fail) and for dominant colors to be extracted before revealing the shelf. A progress bar gives visual feedback.

## Dependencies

- [React 18](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/) (strict mode)
- [Vite 6](https://vite.dev/)
- [Tailwind CSS 3](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/) (icons)

## License

MIT
