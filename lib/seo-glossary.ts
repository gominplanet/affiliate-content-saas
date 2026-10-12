// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE WORDS ON THE SEO PAGE, IN PLAIN LANGUAGE (Seb, 2026-10-12: "need to have
// much more information to explain to users what each thing does and what it
// means to them"). One place for every term the page uses, each with what it
// is and why it matters to a creator's earnings. The page's info tips, the
// glossary and the section headers all read from here, so a term is explained
// the same way everywhere. Pure data, checked by scripts/test-seo-explain.

export interface Term {
  id: string
  /** The word as the page shows it. */
  word: string
  /** What it is, in one or two sentences. */
  means: string
  /** Why it matters to the creator. */
  forYou: string
}

export const TERMS: Term[] = [
  {
    id: 'search-console', word: 'Search Console',
    means: 'Google\'s free dashboard for your blog. It is the only place Google says which of your posts it has, how often they show up and why some are left out.',
    forYou: 'Connect it once. MVP reads it every night and turns it into the plain answers on this page. Without it, MVP can only check your posts, not what Google does with them.',
  },
  {
    id: 'indexed', word: 'Indexed (in Google)',
    means: 'Google has saved the post and can show it in search results.',
    forYou: 'A post that is not indexed cannot get a single visitor from Google, however good it is. Getting posts indexed comes before everything else.',
  },
  {
    id: 'crawl', word: 'Crawl (Google reads it)',
    means: 'Google\'s robot visiting a page to read it. Google decides when, usually a few pages a day on a young blog.',
    forYou: 'You cannot force a visit, but a sitemap and links from your other posts make Google come sooner.',
  },
  {
    id: 'sitemap', word: 'Sitemap',
    means: 'A list of every post address that WordPress keeps up to date for search engines.',
    forYou: 'Submit it once in Search Console. After that Google re-reads it by itself, and every new post is on it.',
  },
  {
    id: 'impressions', word: 'Views in Google (impressions)',
    means: 'How many times a post appeared in someone\'s search results in the last 28 days, clicked or not.',
    forYou: 'The first sign a post is gaining. Views come before clicks: a post with rising views is on its way.',
  },
  {
    id: 'clicks', word: 'Clicks',
    means: 'Visits from Google search in the last 28 days.',
    forYou: 'This is the number that turns into affiliate earnings. Everything else on this page exists to raise it.',
  },
  {
    id: 'position', word: 'Position',
    means: 'Where the post sits in Google\'s results on average. 1 to 10 is page one, 11 to 20 is page two.',
    forYou: 'Most clicks go to the top three results, and almost nobody opens page two. A post at position 12 is close to paying off.',
  },
  {
    id: 'ctr', word: 'Click rate (CTR)',
    means: 'Clicks divided by views in Google.',
    forYou: 'A low click rate at a good position means people see the post and pick another result. The title is usually the fix.',
  },
  {
    id: 'seo-score', word: 'SEO score',
    means: 'MVP\'s check of a post\'s on-page basics: the title, headings, keyword, images, links and product details.',
    forYou: '100 means the basics are in place, not that Google ranks the post. Fix what is red, then spend your time on links and getting posts into Google.',
  },
  {
    id: 'internal-link', word: 'Link between your posts',
    means: 'A link from one of your posts to another one of yours.',
    forYou: 'Google follows these links to find posts and to judge which ones matter. It is the most effective thing you control, and MVP adds them for you.',
  },
  {
    id: 'orphan', word: 'Post nothing links to',
    means: 'A post that none of your other posts link to.',
    forYou: 'Google has no path to it except your sitemap, so it is often the last one read and the first one left out.',
  },
  {
    id: 'backlink', word: 'Backlink',
    means: 'A link to your blog from another website.',
    forYou: 'The strongest signal you can earn once posts are in Google. Earn them from brands you review and real answers; never buy them.',
  },
  {
    id: 'request-indexing', word: 'Request indexing',
    means: 'A button in Search Console that asks Google to read one page. Google allows about 10 a day.',
    forYou: 'It helps Google find a post sooner. It does not make Google keep it, and asking twice does not help.',
  },
  {
    id: 'indexnow', word: 'Bing and Copilot ping (IndexNow)',
    means: 'A message MVP sends to Bing, Copilot and Yandex every time you publish or change a post.',
    forYou: 'Your posts reach Bing and Copilot within days. Google does not take these messages; it reads your sitemap instead.',
  },
  {
    id: 'not-found', word: 'Broken address (404) and redirect (301)',
    means: 'A 404 is an address that no longer opens a page. A 301 redirect sends visitors and Google from the old address to the right post.',
    forYou: 'A redirect keeps the history Google built for the old address, so a moved post does not start from zero.',
  },
  {
    id: 'discovered', word: 'Discovered, not indexed',
    means: 'Google knows the address and has not read the page yet.',
    forYou: 'Normal on a growing blog. Links from your posts in Google are what get it read.',
  },
  {
    id: 'crawled', word: 'Crawled, not indexed',
    means: 'Google read the page and chose not to keep it yet.',
    forYou: 'Google thinks it adds little over pages it already has. Your own testing, photos and a clear verdict change that; asking again does not.',
  },
  {
    id: 'ai-crawlers', word: 'AI crawlers',
    means: 'The robots ChatGPT, Perplexity, Google\'s AI and others send to read websites.',
    forYou: 'If your blog blocks them, AI answers cannot quote or link your reviews.',
  },
  {
    id: 'ai-ready', word: 'AI answer readiness',
    means: 'How easy a post is to quote in an AI answer: a clear verdict near the top, short direct answers, questions and answers.',
    forYou: 'More shoppers ask an AI before they buy. A post an AI quotes sends readers who are ready to buy.',
  },
]

export const term = (id: string): Term | undefined => TERMS.find((t) => t.id === id)

/** The page's sections, in order, each with what it is and what it means for
 *  the creator. The page and the intro both read from here. */
export interface SectionInfo {
  id: string
  title: string
  /** What this section is. */
  what: string
  /** What it means for the creator: when to use it, what to expect. */
  forYou: string
  /** Which step of the path to visitors it helps (see JOURNEY). */
  helps: Array<JourneyId>
}

export type JourneyId = 'found' | 'kept' | 'shown' | 'clicked'

/** The path every post takes before it earns from Google. */
export const JOURNEY: Array<{ id: JourneyId; title: string; says: string; measure: string }> = [
  { id: 'found', title: 'Found', says: 'Google learns the post exists, from your sitemap or a link.', measure: 'In your sitemap, linked from your posts' },
  { id: 'kept', title: 'Kept', says: 'Google reads it and decides to keep it.', measure: 'Indexed' },
  { id: 'shown', title: 'Shown', says: 'Google shows it when people search.', measure: 'Views in Google, position' },
  { id: 'clicked', title: 'Clicked', says: 'People choose it, read it and click your links.', measure: 'Clicks, click rate' },
]

export const SECTIONS: SectionInfo[] = [
  {
    id: 'seo-health', title: 'Is your blog growing?',
    what: 'How often Google showed your posts each day, how many people clicked, and which step from search to sale is the weak one right now.',
    forYou: 'Flat or falling? Start with the next section. Climbing? Keep publishing and keep linking new posts to the ones that already work.',
    helps: ['shown', 'clicked'],
  },
  {
    id: 'seo-next', title: 'What to do next',
    what: 'MVP reads your numbers and lists the few things worth your time, biggest first, plus anything that broke.',
    forYou: 'Have ten minutes? Do the first item. Items marked "MVP does this" are one button.',
    helps: ['found', 'kept', 'shown', 'clicked'],
  },
  {
    id: 'seo-board', title: 'What each post needs',
    what: 'Every post sorted into the one stage it is stuck at, with a plan for the whole stage and the steps for each post.',
    forYou: 'Pick the stage with the most posts and follow its plan from the top. The buttons do the work: links, requests to Google, shares.',
    helps: ['found', 'kept', 'shown', 'clicked'],
  },
  {
    id: 'get-found', title: 'Get found on Google, Bing and AI',
    what: 'The setup that lets search engines find every post: your sitemap, the ping to Bing and Copilot, fixes for broken addresses, and what Google says about each post it left out.',
    forYou: 'Run Get my blog found after big changes. Google still decides when to visit; this makes sure nothing on your side stops it.',
    helps: ['found', 'kept'],
  },
  {
    id: 'seo-grow', title: 'Grow your traffic',
    what: 'Posts close to paying off, searches you already show up for with no post written for them, and weak posts worth merging.',
    forYou: 'Once posts are in Google, this is where new visitors come from: small changes to posts that are almost there, and new posts people are already searching for.',
    helps: ['shown', 'clicked'],
  },
  {
    id: 'seo-ai', title: 'AI search: ChatGPT, Perplexity, Google AI',
    what: 'Whether AI tools are allowed to read your blog, and how easy each post is to quote in an AI answer.',
    forYou: 'More shoppers ask an AI before they buy. Check this once; come back when you change your theme or plugins.',
    helps: ['found', 'shown'],
  },
  {
    id: 'seo-posts', title: 'Every post: score and on-page checks',
    what: 'Each post\'s on-page basics, worst first, with a Fix button wherever MVP can fix it for you.',
    forYou: 'A high score means the basics are done, not that Google ranks the post. Fix what is red, then put your time into the sections above.',
    helps: ['kept', 'clicked'],
  },
]

export const section = (id: string): SectionInfo => SECTIONS.find((s) => s.id === id)!

/** The other SEO tools in the tab bar, each in one line. */
export const TOOLS: Array<{ href: string; label: string; says: string }> = [
  { href: '/tools/title-audit', label: 'Title Check', says: 'Finds posts whose title names the wrong product, and fixes each title in one click without touching the rest of the post.' },
  { href: '/tools/clean-links', label: 'Clean Links', says: 'Removes leftover duplicate affiliate tags that old link plugins left in your posts.' },
  { href: '/tools/duplicates', label: 'Duplicates', says: 'Finds the same product reviewed twice, keeps the best post and redirects the others to it, so they stop splitting your rankings.' },
  { href: '/tools/redirects', label: 'Fix 404s', says: 'Sends old, broken addresses to the right live post, so the history Google built for them is kept.' },
  { href: '/tools/fix-formatting', label: 'Fix Formatting', says: 'Repairs posts that show raw code instead of clean text.' },
  { href: '/tools/logo-check', label: 'Logo Check', says: 'Finds published pictures carrying a store\'s logo, so you can replace them before anyone else notices.' },
]
