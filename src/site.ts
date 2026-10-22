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
};
