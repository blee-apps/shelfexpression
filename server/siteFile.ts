// Writes the export sheet's site details back into content/site.ts, so a
// shelf made locally keeps them. Only name, url, title, subtitle, nav and
// (when given) github.repo and guestMode change; everything else in the file (comments,
// branches) stays. Runs on the dev server and, for Save on the
// live site, in the browser.

export type SiteDetails = {
  name: string;
  url: string;
  title: string;
  subtitle: string; // `{count}` stands for the number of books
  nav: { label: string; href: string; current?: boolean }[];
  repo?: string; // 'owner/name'; left alone when undefined
  guestMode?: boolean; // left alone when undefined
};

// Non-ASCII characters are written as \u escapes, like the rest of the file.
const ascii = (s: string) => s.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const quote = (s: string) => `'${ascii(s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '))}'`;
const template = (s: string) =>
  '`' + ascii(s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\r?\n/g, ' ').split('{count}').join('${count}')) + '`';

// Returns the new file, or null when the file doesn't look like the one
// Shelf Expression ships (so nothing gets broken).
export function updateSiteFile(src: string, d: SiteDetails): string | null {
  let out = src;
  const swap = (re: RegExp, value: string) => {
    if (out === null) return;
    if (!re.test(out)) { out = null as unknown as string; return; }
    out = out.replace(re, (_m, head: string) => head + value);
  };
  swap(/^(\s*name:\s*)'(?:[^'\\\n]|\\.)*'/m, quote(d.name));
  swap(/^(\s*url:\s*)'(?:[^'\\\n]|\\.)*'/m, quote(d.url));
  swap(/^(\s*title:\s*)'(?:[^'\\\n]|\\.)*'/m, quote(d.title));
  if (d.repo !== undefined) swap(/^(\s*github:\s*\{[^}\n]*?\brepo:\s*)'(?:[^'\\\n]|\\.)*'/m, quote(d.repo));
  swap(/^(\s*subtitle:\s*\(count(?::\s*number)?\)\s*=>\s*)`(?:[^`\\]|\\.)*`/m, template(d.subtitle));
  if (out === null) return null;
  if (d.guestMode !== undefined) {
    const re = /^(\s*guestMode:\s*)(true|false)/m;
    if (!re.test(out)) return null;
    out = out.replace(re, (_m, head: string) => head + String(d.guestMode));
  }

  const nav = out.match(/^(\s*)nav:\s*\[([\s\S]*?)\n(\s*)\]\s*as\s/m);
  if (!nav) return null;
  const indent = nav[1] + '  ';
  // Keep comment lines (the examples), replace the links.
  const comments = nav[2].split('\n').filter(l => l.trim().startsWith('//'));
  const links = d.nav.map(l =>
    `${indent}{ label: ${quote(l.label)}, href: ${quote(l.href)}${l.current ? ', current: true' : ''} },`);
  const body = [...comments, ...links].join('\n');
  out = out.replace(nav[0], `${nav[1]}nav: [${body ? '\n' + body : ''}\n${nav[3]}] as `);
  return out;
}
