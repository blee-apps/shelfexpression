// Where the shelf comes from. Normally that's content/books.json and the
// cover list made at build time. A site made with Create Static Site carries
// its own copy inside index.html (window.__SHELF__), which wins when present.
import bundledContent from '../content/books.json';
import bundledManifest from './generated/cover-manifest.json';
import { SITE as BUNDLED_SITE } from '../content/site';

export type CoverInfo = { path: string | null; aspectRatio: number | null };
export type NavLink = { label: string; href: string; current?: boolean };

// Site details a static site can change without a rebuild.
export type StaticSiteSettings = {
  name: string;
  url: string;
  title: string;
  // `{count}` is replaced with the number of books.
  subtitle: string;
  nav: NavLink[];
  // Whether the editor opens with the keystroke or 5 taps.
  editor: boolean;
};

export type StaticShelf = {
  version: 1;
  content: any;
  covers: Record<string, CoverInfo>;
  site: StaticSiteSettings;
};

declare global {
  interface Window { __SHELF__?: StaticShelf }
}

export const STATIC_SHELF: StaticShelf | undefined =
  typeof window !== 'undefined' && window.__SHELF__?.version === 1 ? window.__SHELF__ : undefined;

// True on a site made with Create Static Site.
export const IS_STATIC_SITE = !!STATIC_SHELF;

export const SHELF_CONTENT: any = STATIC_SHELF?.content ?? bundledContent;

export const COVER_MANIFEST: Record<string, CoverInfo> =
  STATIC_SHELF?.covers ?? (bundledManifest as Record<string, CoverInfo>);

export const coverInfo = (book: { isbn?: string; id: string }): CoverInfo | undefined =>
  COVER_MANIFEST[book.isbn || book.id];

const fillCount = (text: string, count: number) => text.split('{count}').join(String(count));

const staticSite = STATIC_SHELF?.site;

export const SITE = {
  name: staticSite?.name ?? BUNDLED_SITE.name,
  url: staticSite?.url ?? BUNDLED_SITE.url,
  title: staticSite?.title ?? BUNDLED_SITE.title,
  subtitle: staticSite ? (count: number) => fillCount(staticSite.subtitle, count) : BUNDLED_SITE.subtitle,
  nav: (staticSite?.nav ?? BUNDLED_SITE.nav) as NavLink[],
  // A static site has no GitHub repo to publish to. Otherwise an empty
  // github.repo means the repo this copy was built from.
  github: staticSite
    ? { repo: '', branch: 'main', testBranch: 'editor-test' }
    : { ...BUNDLED_SITE.github, repo: BUNDLED_SITE.github.repo || (typeof __SHELF_REPO__ === 'string' ? __SHELF_REPO__ : '') },
  guestMode: (BUNDLED_SITE as { guestMode?: boolean }).guestMode !== false,
};

// The editor is always there on a normal build (it asks for a key on the
// live site). On a static site, only when it was included.
export const EDITOR_AVAILABLE = !staticSite || staticSite.editor;

// The subtitle as a template, e.g. "{count} of the best books I've read."
export const subtitleTemplate = (): string => {
  if (staticSite) return staticSite.subtitle;
  const probe = 987654;
  return BUNDLED_SITE.subtitle(probe).split(String(probe)).join('{count}');
};
