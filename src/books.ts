export interface Book {
  id: string; isbn: string; title: string; author: string;
  year: number; synopsis: string; gr: string; mult: number;
  coverUrl?: string;
  coverLocked?: boolean;
}

export const RAW_BOOKS = [
  { id: '1', isbn: '9781848874503', title: "Reamde", author: 'Neal Stephenson', year: 2011, synopsis: "A woman is kidnapped, and her friends—connected through a fictional MMORPG—race across the globe to save her. The chase pulls in Russian Mafia, terrorists, and a thriving world of online gold farming. Neal Stephenson's globe-spanning thriller blends cybercrime, real-world danger, and virtual-world obsession.", gr: '12803304', coverUrl: '/covers/9781848874503.jpg', coverLocked: true },
  { id: '2', isbn: '1432843591', title: "Young Jane Young", author: 'Gabrielle Zevin', year: 2017, synopsis: "Five women are bound together by a scandalous secret. From political ambitions to digital pasts, their lives collide as they fight to protect their families.", gr: '33590214', coverUrl: 'https://covers.openlibrary.org/b/isbn/1432843591-L.jpg' },
  { id: '3', isbn: '9781101972083', title: "Exhalation", author: 'Ted Chiang', year: 2014, synopsis: "Nine provocative stories explore humanity's oldest questions and imagined new quandaries. From time portals to alternate universes, these tales challenge how you perceive existence. It is Ted Chiang at his most profound.", gr: '41160292' },
  { id: '4', isbn: '1250893682', title: "Glorious Exploits", author: 'Ferdia Lennon', year: 2024, synopsis: "In 412 BC, two struggling potters decide to stage a play with starving Athenian prisoners in a Sicilian quarry. As they prepare a production of *Medea*, the line between enemy and friend blurs. It is a bold story of brotherhood, art, and survival against all odds.", gr: '127278133', coverUrl: '/covers/1250893682.jpg', coverLocked: true },
  { id: '5', isbn: '177148776', title: "It Lasts Forever and Then It's Over", author: 'Anne de Marcken', year: 2024, synopsis: "A haunting, spare novel about a zombie navigating the afterlife. It explores memory, loss, and the remnants of humanity in a beautifully decaying world.", gr: '177148776', coverUrl: '/covers/177148776.jpg', coverLocked: true },
  { id: '6', isbn: '1555978401', title: "Lanny", author: 'Max Porter', year: 2019, synopsis: "In a village not far from London, Lanny is a boy who has a special connection to the woods. An enchanting, dark, and polyphonic fable about Englishness and childhood.", gr: '39738353' },
  { id: '7', isbn: '0812550706', title: "Speaker for the Dead", author: 'Orson Scott Card', year: 1986, synopsis: "Three thousand years after the destruction of the bugger race, Ender Wiggin is still alive, traveling the stars as a Speaker for the Dead, seeking redemption.", gr: '7967', coverUrl: '/covers/0812550706.jpg', coverLocked: true },
  { id: '8', isbn: '123136728', title: "Orbital", author: 'Samantha Harvey', year: 2023, synopsis: "Six astronauts and cosmonauts rotate through the International Space Station. A compact, lyrical meditation on the Earth, space, and the fragility of human existence.", gr: '123136728' },
  { id: '9', isbn: '0811231941', title: "The Wall", author: 'Marlen Haushofer', year: 1963, synopsis: "While in a hunting lodge in the Austrian mountains, a woman awakens one morning to find herself separated from the rest of the world by an invisible wall. With a cat, a dog, and a cow as her sole companions, she learns how to survive and cope with her loneliness.", gr: '59468837', coverUrl: '/covers/0811231941.jpg', coverLocked: true },
  { id: '10', isbn: '203200544', title: "Perfection", author: 'Vincenzo Latronico', year: 2022, synopsis: "Millennial expat couple Anna and Tom are living the dream in Berlin, in a bright, plant-filled apartment. A sociological novel about the emptiness of contemporary existence.", gr: '203200544', coverUrl: '/covers/203200544.jpg', coverLocked: true },
  { id: '11', isbn: '0307946892', title: "Tigerman", author: 'Nick Harkaway', year: 2014, synopsis: "Sergeant Lester Ferris, a veteran of the Afghan war, serves on the island of Mancreu, a former British colony slated for destruction. He adopts a superhero persona to protect a local street kid.", gr: '19322249', coverUrl: '/covers/0307946892.jpg', coverLocked: true },
  { id: '12', isbn: '0374139946', title: "Dilla Time", author: 'Dan Charnas', year: 2022, synopsis: "The life and legacy of J Dilla, a musical genius who transformed the sound of popular music and invented a new rhythm that changed the way musicians play.", gr: '57693653' },
  { id: '13', isbn: '0812976711', title: "The Satanic Verses", author: 'Salman Rushdie', year: 1988, synopsis: "Just before dawn one winter's morning, a hijacked jumbo jet blows apart high above the English Channel. A magical realist epic about migration, faith, and transformation.", gr: '12781' },
  { id: '14', isbn: '128533513', title: "Make Something Wonderful", author: 'Steve Jobs', year: 2023, synopsis: "A curated collection of Steve Jobs's speeches, interviews, and correspondence, offering an unparalleled window into how one of the world's most creative entrepreneurs approached his life and work.", gr: '128533513', coverUrl: '/covers/128533513.jpg', coverLocked: true },
  { id: '15', isbn: '0995624233', title: "There Is No Antimemetics Division", author: 'qntm', year: 2020, synopsis: "An antimeme is an idea with self-censoring properties; an idea which, by its very nature, discourages or prevents people from spreading it. A sci-fi thriller about fighting an enemy you can't remember.", gr: '54870256', coverUrl: '/covers/0995624233.jpg', coverLocked: true },
  { id: '16', isbn: '75302296', title: "People Collide", author: 'Isle McElroy', year: 2023, synopsis: "A gender-bending, body-switching novel that explores marriage, identity, and sex, raising profound questions about the nature of true partnership.", gr: '75302296' },
  { id: '17', isbn: '123163147', title: "The Future", author: 'Naomi Alderman', year: 2023, synopsis: "A handful of friends plot a daring heist to save the world from the tech billionaires who are intent on surviving the apocalypse in their private bunkers.", gr: '123163147' },
];

export const USE_VITSOE_SHELF = true;

export const BOOKS: Book[] = RAW_BOOKS.map(book => ({
  ...book,
  mult: (() => {
    let hash = 0;
    for (let i = 0; i < book.title.length; i++) hash = book.title.charCodeAt(i) + ((hash << 5) - hash);
    return 1.0 + (Math.abs(hash) % 50) / 100;
  })(),
}));
