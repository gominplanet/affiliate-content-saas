/**
 * Single source of truth for in-app tutorial videos. Drives both the
 * inline <TutorialVideo /> embeds on each page AND the all-in-one
 * /tutorials page that lists every walkthrough.
 *
 * To swap a video: replace the `videoId` here — every page picks the
 * change up automatically.
 */

export interface Tutorial {
  /** Unique key for localStorage dismissal + React keying. kebab-case. */
  sectionKey: string
  /** Display name on /tutorials and as the embed's title. */
  title: string
  /** Short hook shown under the title. */
  description: string
  /** YouTube video ID (the part after v= in a /watch URL). */
  videoId: string
  /** Where this tutorial lives in the workspace — link target for the
   *  "Open page" button on /tutorials. */
  href: string
}

export const TUTORIALS: Tutorial[] = [
  {
    sectionKey: 'dashboard',
    title: 'Dashboard',
    description: 'Your home base — what every card means and how to read it.',
    videoId: 'CpH4tk699Gw',
    href: '/dashboard',
  },
  {
    sectionKey: 'blog-setup',
    title: 'Blog Set Up',
    description: 'Get your WordPress affiliate blog running in minutes.',
    videoId: '0zKEU6I6O1M',
    href: '/setup',
  },
  {
    sectionKey: 'integrations',
    title: 'Integrations',
    description: 'Connect Facebook, Pinterest, Threads, LinkedIn, X, Bluesky, Telegram, Instagram, YouTube — all the third-party hooks.',
    videoId: 'v8R0sWwyQtI',
    href: '/setup?tab=integrations',
  },
  {
    sectionKey: 'brand-profile',
    title: 'Brand Profile',
    description: 'Fill these out once and every generated post sounds like you.',
    videoId: '-5IPwoJYdNQ',
    href: '/brand',
  },
  {
    sectionKey: 'learning',
    title: 'Learning',
    description: 'Train the AI on your own taste — what real writing sounds like vs. what feels fake.',
    videoId: 'c5eXJ1VvRLI',
    href: '/learn',
  },
  {
    sectionKey: 'customize',
    title: 'Customize Blog',
    description: 'Banner strip, in-content ads, footer links, analytics — every blog visual setting.',
    videoId: 'qx2hnsNgZx8',
    href: '/customize',
  },
  {
    sectionKey: 'studio',
    title: 'YouTube Co-Pilot',
    description: 'Generate titles, descriptions, tags, and pinned comments for new videos before you upload.',
    videoId: '-d06O5SWUhU',
    href: '/studio',
  },
  {
    sectionKey: 'library',
    title: 'Library and Social Push',
    description: 'Sync videos, generate posts, fan content out to every connected platform.',
    videoId: 'nonNh0S0UKc',
    href: '/content',
  },
  {
    sectionKey: 'campaigns',
    title: 'Creator Campaigns',
    description: 'Run multi-creator campaigns end to end.',
    videoId: 'vuYGt2nCz3o',
    href: '/campaigns',
  },
  {
    sectionKey: 'collaborations',
    title: 'Collaborations',
    description: 'Fill the form, hit Generate, copy the email. The exact workflow to land brand collabs.',
    videoId: 'Q8bqmpW48O4',
    href: '/collaborations',
  },
]

/** Lookup helper — returns undefined if no tutorial registered for the key. */
export function getTutorial(key: string): Tutorial | undefined {
  return TUTORIALS.find(t => t.sectionKey === key)
}
