// Your site's details. Change these to make the bookshelf your own.

export const SITE = {
  // Shown at the top left. Leave `url` empty to show the name without a link.
  name: 'My Site',
  url: '',

  // Big heading above the shelf. (Tap it 5 times on a phone to open the editor.)
  title: 'Bookshelf',

  // Line under the heading. `count` is the number of books on the shelf.
  subtitle: (count: number) => `${count} of the best books I\u2019ve read recently.`,

  // Links in the header menu. Leave the list empty to hide the menu.
  // Mark this page with `current: true` to show it as the page you're on.
  nav: [
    // { label: 'About', href: 'https://example.com/about/' },
    // { label: 'Bookshelf', href: '/', current: true },
  ] as { label: string; href: string; current?: boolean }[],

  // The GitHub repo this site is published from. The editor on the live site
  // asks for a GitHub key that can write to this repo before it opens.
  // Publish goes to `branch` (the live site), or to `testBranch` to try a
  // change on a Vercel preview first.
  // Set `repo` to your own, written as 'your-name/your-repo'.
  github: { repo: '', branch: 'main', testBranch: 'editor-test' },
};
