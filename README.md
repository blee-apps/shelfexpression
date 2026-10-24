# Shelf Expression

A beautiful, animated bookshelf for your website. Show off up to 48 books you love on a Vitsoe-style shelf or a minimal gallery, in light or dark. Click a cover and it lifts off the shelf, flies to the center and shows its synopsis and a Goodreads link. Page through with the arrow keys or, on a phone, a swipe that follows your finger.

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

Open the editor with **Cmd+Shift+U** (Mac) or **Ctrl+Shift+U** (Windows and Linux) and tap **Site details**. Fill in your site name, heading, the line under it and your menu links. **Save** writes them into `content/site.ts` for you. Your GitHub repo is filled in automatically.

### 3. Choose a look

In the editor, below the book grid, are two switches. Pick one of each:

- **Shelf:** **Vitsoe**, a 606-style shelf with slim aluminum tracks and off-white steel shelves, where a hovered book leans from a corner and lifts as if you're picking it off the shelf. Or **Minimal**, covers on a flat background that grow slightly on hover.
- **Mode:** **Light**, **Dark** (a near-black page, with a graphite shelf on a charcoal wall), or **Auto**, which follows each visitor's device setting.

They're saved in `content/books.json` as `useVitsoeShelf` (`true` or `false`) and `colorMode` (`light`, `dark` or `auto`).

### 4. Add your books

Open the editor with **Cmd+Shift+U** on a Mac or **Ctrl+Shift+U** on Windows and Linux. On a phone or tablet, tap the big heading five times. The same keystroke closes it.

1. Tap **Add book**, then type the title and author. The editor searches **Apple Books, Google Books and OpenLibrary** at once.
2. Pick the right book. The title, author, year, ISBN, synopsis and **Goodreads page** fill in.
3. Choose a cover. They're sorted sharpest first and labeled with their size. Anything too small to look crisp is flagged *Low-res*. You can also upload your own.
4. Tap a book to edit it, and drag its number to reorder. Each book also has **Share** and **Remove**.
5. Tap **Add decoration** to put a plant, snow globe, figure, speaker or film camera on the shelf. It takes a slot like a book, stands at its real size next to your paperbacks, and moves and removes the same way. Decorations only show on the **Vitsoe** shelf, not the **Minimal** one.
6. Tap **Save** at the top. Covers are already in `content/covers/`, and Save writes your books, look and share footer into `content/books.json`.

### 5. Publish

When you're happy with it, commit and push your repo to GitHub. Then pick a host. Both have free plans:

- **Vercel:** go to [vercel.com/new](https://vercel.com/new), import your repo and tap **Deploy**.
- **Netlify:** go to [app.netlify.com/start](https://app.netlify.com/start), choose **GitHub**, pick your repo and tap **Deploy**.

You don't need to change any settings. The build command (`npm run build`) and output folder (`dist`) fill themselves in, from `netlify.toml` on Netlify. From then on, every push to `main` goes live.

The site is fully static. Covers are saved in your repo, so it never depends on other websites at runtime. The Goodreads lookup and cover fetching on the live site use two small functions, which run on both Vercel and Netlify. Any other static host works too, but there, add books locally with `npm run dev`.

From then on, you can also edit right on your live site. The editor first asks for a GitHub key that can write to your repo. Make one at GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new). Choose **only your shelf's repo**, and give it **Contents: Read and write**. Add **Deployments: Read-only** to follow the build of a test preview. The key stays on that device, and anyone else who finds the editor can't get past this step.

On the live site, **Publish** takes the place of Save. It commits your books and covers to GitHub, and your host rebuilds the site. To try changes first, choose **Test preview** next to Publish. That sends them to the `editor-test` branch, for a preview. Vercel builds it by itself. On Netlify, turn it on once: go to **Site configuration → Build & deploy → Continuous deployment → Branches and deploy contexts**, set **Branch deploys** to **Let me add individual branches**, and add `editor-test`. Until you publish, your changes are kept on the device as a draft, which you can restore or discard the next time you open the editor. **Site details** saves straight to your live site too, and the old copy-and-paste tools sit under **Advanced: load or copy books.json** at the bottom.

### 6. Share your favorites

Tap **Create image** in the editor, or **Share** on a book. Pick up to 12 books in the order you want them, then tap **Next**. Share Studio fills the screen with a live preview. Drag the thumbnails to reorder or tap their X to drop one. You can choose:

- **Sizes:** Story (9:16), Post (4:5) and Square.
- **Layouts:** Grid, with optional titles, or Shelf. A single book gets Feature, aligned left or centered, with an optional synopsis.
- **Backgrounds:** Paper, White, Dark, or a color taken from a cover. Use the arrows beside the Cover swatch to choose which book.
- **Text:** an optional heading, and a footer line such as your website. The footer is remembered, and saved with your books when you publish.

On an iPhone, **Share** opens the share sheet, so you can save the image to Photos or post it straight to Instagram. Elsewhere, it downloads.

### 7. Host it yourself, without GitHub

You don't need GitHub, Vercel or Netlify to have a shelf. In the editor, tap **Export site** (under *Host it yourself*). Fill in your site name, link, heading, the line under it (`{count}` becomes the number of books) and up to five menu links, then tap **Download**.

You get a zip with a complete website: your books, every cover, and your shelf style, mode and share footer. If you export from your own computer (`npm run dev`), the editor also saves your books, look and share footer into `content/books.json`, and the site details into `content/site.ts`. Next time you run it, everything is just as you left it. Unzip it and upload the folder to any web host, such as Netlify Drop, Cloudflare Pages, Neocities or your own server. Put it at the top of an address (like `books.example.com`), not in a subfolder.

Turn on **Include the editor** to edit on that site later. It opens the same way (the keystroke or five taps), with no key and no Publish. Make your changes, tap **Export site** again, and upload the new folder over the old one. On a plain host, some covers can't be fetched from book sites, but uploading your own image always works.

**Guest mode.** Anyone who finds the editor on your site can tap **Continue as guest** to try it, make share images or create a static site. Nothing is ever published. To turn that off, untick **Let visitors try the editor** in **Site details**. Then the editor only opens with your GitHub key.

## Optional API keys

Everything works without keys. Add these to a `.env` file in the project folder to unlock extras:

| Variable | What it does |
|----------|--------------|
| `VITE_GOOGLE_BOOKS_API_KEY` | Raises Google Books' rate limits for search and covers. |
| `VITE_OPENROUTER_API_KEY` | Adds a **Summarize** button to the editor that tightens long synopses using an [OpenRouter](https://openrouter.ai/keys) model. Local only. |

> **Important:** anything starting with `VITE_` ends up in the JavaScript visitors download. Never add `VITE_OPENROUTER_API_KEY` to your host. Keep it in your local `.env`, which isn't committed. To use the Google Books key on your live site, add it under **Environment variables** in your Vercel or Netlify project settings, then redeploy. Restrict it to your domain and the Books API in Google Cloud Console.

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

Up to three settings sit alongside the books: `useVitsoeShelf`, `colorMode` (`light`, `dark` or `auto`, left out means light), and `share.footer` (the footer line on share images).

## How it's put together

```
content/site.ts           Your site name, heading, menu, GitHub repo and guest mode (Site details in the editor writes it)
content/books.json        Your books, shelf style, mode and share footer
content/covers/           Saved cover images (served at /covers/)
digital_bookshelf.tsx     The shelf, animations and detail view
src/AdminGate.tsx         Asks for a GitHub key before the editor opens on the live site
src/UpdateTool.tsx        The editor
src/exportSite.ts         Export site: zips the site with your books inside
src/StaticSitePanel.tsx   The Export site sheet (site details and Download)
src/SiteDetailsPanel.tsx  The Site details sheet: saves to content/site.ts, or to GitHub on the live site
src/shelfData.ts          Reads your books and site details (or a static site's own copy)
src/publish.ts            Publishing to GitHub, drafts and deploy status
src/share/                Share images: drawing and the share studio
src/bookSearch.ts         Apple Books / Google Books / OpenLibrary search
api/, server/lookup.ts    Goodreads and cover lookups (Vercel functions, and the dev server)
netlify/, netlify.toml    The same lookups and settings for Netlify
scripts/measure-covers.ts Measures saved covers at build time
vite.config.ts            Local-only helpers for the editor (saving covers and books)
```

Fonts (DM Serif Text and Manrope) are self-hosted, so no requests go to Google.

## Full site or exported zip?

Both look identical to visitors. The difference is how you edit them.

| | Full site (GitHub + Vercel or Netlify) | Exported zip (any host) |
|---|---|---|
| Where your books live | `content/` in your repo, with history | Baked into the zip's `index.html` |
| Editing | The editor, unlocked with your GitHub key | The editor, if you included it, with no key |
| Going live | **Publish**, or **Test preview** first | **Export site** again and upload the new folder |
| Unsaved changes | Kept as a draft on your device | Lost unless you export |
| Book search | Works | Mostly works |
| Goodreads lookup and fetching covers | Works | Not on a plain host. Uploading your own cover always works |
| Where it can sit | Any address your host gives it | The top of an address, not a subfolder |

Choose the full site if you'll update often. The zip suits a shelf you set and forget, or anyone who'd rather skip GitHub.

## Credits

Made by Brandon Lee ([sangsara.net](https://sangsara.net)). MIT licensed, so use it, change it and make it your own.
