# Shelf Expression

A beautiful, animated bookshelf for your website. Show off the books you love on a Vitsoe-style shelf. Click a cover and it lifts off the shelf, flies to the center and shows its synopsis and a Goodreads link.

Built with React, TypeScript, Tailwind CSS and Vite. It's a fully static site, so it's fast, free to host and has no database.

## Make it yours

### 1. Get your own copy

Click **Use this template**, then **Create a new repository** at the top of this page. Clone your new repo and install:

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

### 2. Add your books with the editor

Press **Cmd+Shift+U** (Mac) or **Ctrl+Shift+U** (Windows) to open the editor. On a phone, tap the big heading five times.

1. Click an empty slot, or **Edit** on a sample book.
2. Type the title and author and press Enter. The editor searches **Apple Books, Google Books and OpenLibrary** at the same time.
3. Pick the right book. The title, author, year, ISBN and synopsis fill in, and the editor finds the book's **Goodreads page** for you.
4. Choose a cover. Covers are sorted sharpest first and labeled with their size. Anything too small to look crisp is flagged *Low-res*. You can also upload your own.
5. Press **Save**. The chosen cover is saved into `public/covers/` in your project.

Drag slots to reorder them. When you're happy, click **Generate**, copy the code and paste it into `src/books.ts`, replacing what's there.

> The Goodreads lookup and cover saving only work while running `npm run dev` on your computer.

### 3. Set your site details

Edit `src/site.ts` to set your site name, link, heading, subtitle and header menu.

To switch between the two shelf styles, set `USE_VITSOE_SHELF` in `src/books.ts`:

- `true`: a Vitsoe 606 shelf with birch boards and aluminum rails. Hovering a book lifts and tilts it, as if you're picking it off the shelf.
- `false`: a clean, minimal gallery with covers floating on a flat background.

### 4. Publish

Push your repo to GitHub and import it into [Vercel](https://vercel.com/new), Netlify or any static host. The defaults just work: the build command is `npm run build` and the output folder is `dist`.

During the build, covers for any book without a saved cover are downloaded automatically, so the site never depends on other websites at runtime.

## Optional API keys

Everything works without keys. Add these to a `.env` file in the project folder to unlock extras:

| Variable | What it does |
|----------|--------------|
| `VITE_GOOGLE_BOOKS_API_KEY` | Raises Google Books' rate limits for search and covers. |
| `VITE_OPENROUTER_API_KEY` | Adds a **Summarize** button to the editor that tightens long synopses using an [OpenRouter](https://openrouter.ai/keys) model. Local only. |

> **Important:** anything starting with `VITE_` ends up in the JavaScript visitors download. Never add `VITE_OPENROUTER_API_KEY` to your host. Keep it in your local `.env`, which isn't committed. If you add the Google Books key to your host, restrict it to your domain and the Books API in Google Cloud Console.

## Book fields

Each book in `src/books.ts` looks like this:

| Field | Description |
|-------|-------------|
| `id` | Position on the shelf, as a string (`'1'`, `'2'`…). |
| `isbn` | Used to find covers and to name the saved cover file. |
| `title`, `author`, `year` | Shown in the detail view. |
| `synopsis` | Short description shown in the detail view. |
| `gr` | Goodreads book ID, used for the "View on Goodreads" link. |
| `coverUrl` | *(Optional)* The cover to use, set by the editor. |
| `coverLocked` | *(Optional)* Keeps the build from replacing a saved cover. |

## How it's put together

```
src/site.ts               Your site name, heading and menu
src/books.ts              Your books and shelf style
src/UpdateTool.tsx        The editor
src/bookSearch.ts         Apple Books / Google Books / OpenLibrary search
digital_bookshelf.tsx     The shelf, animations and detail view
scripts/download-covers.ts  Downloads covers at build time
vite.config.ts            Local-only helpers for the editor (cover saving, Goodreads lookup)
public/covers/            Saved cover images
```

Fonts (DM Serif Text and Manrope) are self-hosted, so no requests go to Google.

## Credits

Made by Brandon Lee ([sangsara.net](https://sangsara.net)). MIT licensed, so use it, change it and make it your own.
