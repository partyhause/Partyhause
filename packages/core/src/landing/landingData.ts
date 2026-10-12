export interface Principle {
  id: string;
  title: string;
  body: string;
  icon: string;
}

export interface Archetype {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

export interface LandingSection {
  id: string;
  title: string;
  subtitle?: string;
}

export const LANDING_PRINCIPLES: Principle[] = [
  {
    id: 'one-place',
    title: 'Everyone in one place',
    body: 'Guest list, RSVPs, running order and the group chat that usually lives in four apps. One link, one page, one source of truth.',
    icon: 'users',
  },
  {
    id: 'nothing-forgotten',
    title: 'Nothing forgotten',
    body: 'Turn a sticky note into a task, split the cost, and see what is still open. The plan updates for everyone the moment it changes.',
    icon: 'checklist',
  },
  {
    id: 'get-out-way',
    title: 'Then get out of the way',
    body: 'The work happens before the night. On the night you should be at your own party, not answering the same question eleven times.',
    icon: 'party',
  },
];

export const LANDING_ARCHETYPES: Archetype[] = [
  {
    id: 'intimate',
    title: 'The Intimate Host',
    description: 'Small groups, personal touches, and conversations that matter.',
    icon: 'heart',
    color: '#C02A16',
  },
  {
    id: 'curator',
    title: 'The Curator',
    description: 'Themes, playlists, and details that feel intentional.',
    icon: 'lightbulb',
    color: '#B62066',
  },
  {
    id: 'organizer',
    title: 'The Organizer',
    description: 'Guest lists, budgets, and timelines — all under control.',
    icon: 'calendar',
    color: '#389F8D',
  },
  {
    id: 'social',
    title: 'The Social Connector',
    description: 'Bringing people together who should know each other.',
    icon: 'users',
    color: '#4133FF',
  },
];

export const LANDING_SECTIONS: LandingSection[] = [
  { id: 'hero', title: 'Throw the party. Skip the admin.' },
  { id: 'how-it-works', title: 'Hosting is a logistics problem' },
  { id: 'find-your-style', title: 'Four kinds of host' },
  { id: 'culture', title: 'Party culture' },
];
