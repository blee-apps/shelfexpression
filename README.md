# Shelf Expression

A beautiful, animated bookshelf for your website. Show off the books you love on a Vitsoe-style shelf or a minimal gallery, in light or dark. Click a cover and it lifts off the shelf, flies to the center and shows its synopsis and a Goodreads link.

Built with React, TypeScript, Tailwind CSS and Vite. It's a fully static site, so it's fast, free to host and has no database.

## Make it yours

### 1. Get your own copy

Click **Use this template**, then **Create a new repository** at the top of this page. Clone your new repo and install:

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

### 2. Set your site details

Edit `content/site.ts` to set your site name, link, heading, subtitle and header menu. Set `github.repo` to your new repo (for example `'your-name/your-shelf'`) so you can edit from the live site later.

### 3. Publish

Push your repo to GitHub and import it into [Vercel](https://vercel.com/new). The defaults just work: the build command is `npm run build` and the output folder is `dist`. Every push to `main` goes live.

The site is fully static. Covers are saved in your repo, so it never depends on other websites at runtime. Netlify or any static host works too, but book search, Goodreads lookup and cover fetching on the live site use small Vercel functions in `api/`. Elsewhere, add books locally with `npm run dev`.

### 4. Add your books with the editor

Open the editor with **Cmd+Shift+U** (Mac) or **Ctrl+Shift+U** (Windows). On a phone, tap the big heading five times.

On the live site, it first asks for a GitHub key that can write to your repo. Make one at GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new). Choose **only your shelf's repo**, and give it **Contents: Read and write**. Add **Deployments: Read-only** to see when your changes are live. The key stays on that device. Anyone else who finds the editor can't get past this step.

1. Tap **Add book**, then type the title and author. The editor searches **Apple Books, Google Books and OpenLibrary** at once.
2. Pick the right book. The title, author, year, ISBN, synopsis and **Goodreads page** fill in.
3. Choose a cover. They're sorted sharpest first and labeled with their size. Anything too small to look crisp is flagged *Low-res*. You can also upload your own.
4. Tap a book to edit it, and drag the number to reorder. Your changes are kept on the device as a draft until you publish.
5. Tap **Publish**. The editor commits your books and covers to GitHub, and your host rebuilds the site. To try changes first, choose **Test preview** next to Publish. That sends them to the `editor-test` branch, for a Vercel preview.

Locally (`npm run dev`), there's no key or Publish. Covers save straight into `content/covers/`. When you're done, tap **Generate**, paste the code into `content/books.json`, and commit.

To change the look, use the **Shelf** and **Mode** switches below the editor's book grid, then publish. You can also set them in `content/books.json`. `useVitsoeShelf` picks the shelf style:

- `true`: a Vitsoe 606 shelf with slim aluminum tracks and off-white steel shelves. Hovering a book lifts and tilts it, as if you're picking it off the shelf.
- `false`: a clean, minimal gallery with covers on a flat background. Hovering a cover makes it grow slightly.

`colorMode` works with either style:

- `light` (the default).
- `dark`: a near-black page. The Vitsoe shelf turns graphite, on a charcoal wall.
- `auto`: follows each visitor's device setting.

### 5. Share your favorites

Tap **Make a share image** in the editor, or **Share** on a book. Pick up to 12 books in the order you want them, then tap **Next**. You get a live preview with:

- **Sizes:** Story (9:16), Post (4:5) and Square.
- **Layouts:** Grid, with optional titles, or Shelf. A single book gets Feature, aligned left or centered, with an optional synopsis.
- **Backgrounds:** Paper, White, Dark, or a color taken from a cover. Use the arrows beside the Cover swatch to choose which book.
- **Text:** an optional heading, and a footer line such as your website. The footer is remembered, and saved with your books when you publish.

On an iPhone, **Share** opens the share sheet, so you can save the image to Photos or post it straight to Instagram. Elsewhere, it downloads.

## Optional API keys

Everything works without keys. Add these to a `.env` file in the project folder to unlock extras:

| Variable | What it does |
|----------|--------------|
| `VITE_GOOGLE_BOOKS_API_KEY` | Raises Google Books' rate limits for search and covers. |
| `VITE_OPENROUTER_API_KEY` | Adds a **Summarize** button to the editor that tightens long synopses using an [OpenRouter](https://openrouter.ai/keys) model. Local only. |

> **Important:** anything starting with `VITE_` ends up in the JavaScript visitors download. Never add `VITE_OPENROUTER_API_KEY` to your host. Keep it in your local `.env`, which isn't committed. If you add the Google Books key to your host, restrict it to your domain and the Books API in Google Cloud Console.

## Book fields

`content/books.json` holds your books in shelf order. Each one looks like this:

| Field | Description |
|-------|-------------|
| `id` | Position on the shelf, as a string (`"1"`, `"2"`…). |
| `isbn` | Used to find covers and to name the saved cover file. |
| `title`, `author`, `year` | Shown in the detail view. |
| `synopsis` | Short description shown in the detail view. |
| `gr` | Goodreads book ID, used for the "View on Goodreads" link. |
| `coverUrl` | The saved cover, such as `/covers/9780441478125.jpg`. |

Three settings sit alongside the books: `useVitsoeShelf`, `colorMode` (`light`, `dark` or `auto`), and `share.footer` (the footer line on share images).

## How it's put together

```
content/site.ts           Your site name, heading, menu and GitHub repo
content/books.json        Your books and shelf style
content/covers/           Saved cover images (served at /covers/)
digital_bookshelf.tsx     The shelf, animations and detail view
src/AdminGate.tsx         Asks for a GitHub key before the editor opens on the live site
src/UpdateTool.tsx        The editor
src/publish.ts            Publishing to GitHub, drafts and deploy status
src/share/                Share images: drawing and the share studio
src/bookSearch.ts         Apple Books / Google Books / OpenLibrary search
api/, server/lookup.ts    Goodreads and cover lookups (Vercel functions, and the dev server)
scripts/measure-covers.ts Measures saved covers at build time
vite.config.ts            Local-only helpers for the editor (saving covers and books)
```

Fonts (DM Serif Text and Manrope) are self-hosted, so no requests go to Google.

### Updating from an older version

Older copies kept books in `src/books.ts` and covers in `public/covers/`. Move your books into `content/books.json`, your covers into `content/covers/`, and your site details into `content/site.ts`.

## Credits

Made by Brandon Lee ([sangsara.net](https://sangsara.net)). MIT licensed, so use it, change it and make it your own.
