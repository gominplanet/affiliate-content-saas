// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What should this person do about their blog, right now.
//
// The SEO page knows a great deal and says almost none of it in a way someone
// can act on. It opens with eight crawler names nobody outside the industry has
// heard of, all ticked green, then a score of 80 with no scale beside it, then
// six tool tabs. Someone who does not already know SEO learns nothing from any
// of it, and the one button that actually helps is three cards down.
//
// So this turns every signal the page already has into a short ranked list of
// plain sentences: what is wrong, what it is costing, and what to do. Rules it
// holds to:
//
//   No jargon. "Google has not added these posts to its results yet", never
//   "4 not indexed". No score without something to compare it against.
//
//   Nothing appears unless it is worth doing. A page with nothing wrong says so
//   in one line rather than inventing four chores.
//
//   Never claim a fix MVP cannot perform. Where the work is manual, it says so.
//
// A pure function, so scripts/test-seo-next-steps.ts can check the wording and
// the ranking against every shape of blog without a browser or a live site.

export interface SeoSignals {
  /** Published posts MVP knows about. */
  posts: number
  /** Google Search Console connected. Without it most of this is guesswork. */
  connected: boolean
  indexed: number
  notIndexed: number
  /** Posts Google has never told us about either way. */
  unknown: number
  notInSitemap: number
  /** Posts that were in Google and fell out in the last week. */
  recentlyDropped: number
  sitemapFound: boolean
  totalClicks: number
  totalImpressions: number
  /** AI answer engines blocked from reading the site, out of those checked. */
  crawlersBlocked: number
  crawlersTotal: number
  /** The AI-answer readiness rollup, when any post has been scored. */
  aio: {
    scored: number
    avgScore: number
    /** The check that fails on the most posts, which is the biggest single lift. */
    topFix: { label: string; hint: string; share: number; count: number } | null
  } | null
}

export interface SeoStep {
  id: string
  /** What is true, in words the person already uses. */
  title: string
  /** Why it matters to them, not to a crawler. */
  why: string
  /** The next physical action. */
  doThis: string
  /** Which control on the page does it, so the card can point at the right one.
   *  'none' means there is nothing to click and the work is theirs. */
  action: 'connect-gsc' | 'get-found' | 'fix-404s' | 'robots' | 'write' | 'none'
  tone: 'blocked' | 'act' | 'good'
  /** Higher goes first. Set from how much it costs to leave undone. */
  weight: number
}

export function seoNextSteps(s: SeoSignals): SeoStep[] {
  const steps: SeoStep[] = []
  const n = (x: number) => x.toLocaleString()
  const postWord = (x: number) => `post${x === 1 ? '' : 's'}`

  // Nothing published. Everything else on the page is moot.
  if (s.posts === 0) {
    return [{
      id: 'no-posts',
      title: 'You have not published anything yet',
      why: 'Google can only show pages that exist. Until there is a post on your blog there is nothing here to improve.',
      doThis: 'Write your first post. MVP can draft one from a product you already promote.',
      action: 'write',
      tone: 'act',
      weight: 100,
    }]
  }

  // The site is unreadable to AI engines. Rare, and everything else is smaller.
  if (s.crawlersBlocked > 0) {
    steps.push({
      id: 'crawlers-blocked',
      title: `${n(s.crawlersBlocked)} AI answer engine${s.crawlersBlocked === 1 ? '' : 's'} cannot read your site`,
      why: 'When someone asks ChatGPT or Perplexity for a recommendation, the answer is built from sites those tools are allowed to read. Yours is closed to them, so you cannot be the answer no matter how good the post is.',
      doThis: 'Open your robots.txt, or your SEO plugin’s crawler settings, and allow them.',
      action: 'robots',
      tone: 'blocked',
      weight: 95,
    })
  }

  // Flying blind. Almost every other number on this page comes from Search
  // Console, so this gates the rest.
  if (!s.connected) {
    steps.push({
      id: 'connect-gsc',
      title: 'Connect Google Search Console',
      why: 'It is free and it is how MVP finds out which of your posts Google is actually showing people, what they searched for, and which pages Google is refusing. Without it this page is guessing.',
      doThis: 'Connect it, then come back. It takes about a minute.',
      action: 'connect-gsc',
      tone: 'act',
      weight: 90,
    })
  }

  // Traffic you already had and lost. The most expensive thing on the page.
  if (s.recentlyDropped > 0) {
    steps.push({
      id: 'dropped',
      title: `${n(s.recentlyDropped)} ${postWord(s.recentlyDropped)} fell out of Google in the last week`,
      why: 'These were being shown to people and are not any more. That is traffic and commission you had and have now lost, usually from a broken link, a redirect, or a setting telling Google to hide the page.',
      doThis: 'Run Get my blog found below. It repairs the usual causes and asks Google to look again.',
      action: 'get-found',
      tone: 'blocked',
      weight: 85,
    })
  }

  // Google has not taken them yet.
  if (s.connected && s.notIndexed > 0) {
    const share = Math.round((s.notIndexed / Math.max(1, s.posts)) * 100)
    steps.push({
      id: 'not-indexed',
      title: `Google has not added ${n(s.notIndexed)} of your ${n(s.posts)} ${postWord(s.posts)} to its results`,
      why: share >= 50
        ? 'More than half your blog cannot be found by searching, however well written it is. Nobody lands on a page Google does not list.'
        : 'Those posts cannot be found by searching, so the work in them is earning nothing.',
      doThis: 'Run Get my blog found below. It refreshes your sitemap and asks Google and Bing to crawl the missing pages.',
      action: 'get-found',
      tone: 'act',
      weight: 80,
    })
  }

  // The single content change that would lift the most posts.
  const fix = s.aio?.topFix
  if (fix && fix.share >= 50 && (s.aio?.scored ?? 0) >= 3) {
    steps.push({
      id: `aio-${fix.label.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      title: fix.share >= 95
        ? `Every one of your ${n(s.aio?.scored ?? 0)} scored ${postWord(s.aio?.scored ?? 0)} is missing the same thing`
        : `${fix.share}% of your posts are missing the same thing`,
      why: `${fix.label}. ${fix.hint}`,
      doThis: 'Every new post MVP writes for you includes this. For the ones already published, it is a small edit at the top of each.',
      action: 'none',
      tone: 'act',
      weight: 70,
    })
  }

  // In the blog, absent from the map you hand Google.
  if (s.sitemapFound && s.notInSitemap > 0) {
    steps.push({
      id: 'not-in-sitemap',
      title: `${n(s.notInSitemap)} ${postWord(s.notInSitemap)} ${s.notInSitemap === 1 ? 'is' : 'are'} missing from your sitemap`,
      why: 'Your sitemap is the list of pages you hand to Google. A post left off it can still be found, but it takes far longer and often does not happen at all.',
      doThis: 'Run Get my blog found below. It rebuilds the sitemap and resubmits it.',
      action: 'get-found',
      tone: 'act',
      weight: 60,
    })
  }

  // Being seen, never clicked. A real and different problem from not ranking.
  if (s.connected && s.totalImpressions >= 500 && s.totalClicks === 0) {
    steps.push({
      id: 'impressions-no-clicks',
      title: `Google showed your posts ${n(s.totalImpressions)} times and nobody clicked`,
      why: 'You are ranking. People are seeing your title and choosing something else, which makes this a headline problem rather than a search one, and it is much faster to fix than ranking.',
      doThis: 'Use Title Check above and rewrite the titles that are being shown the most.',
      action: 'none',
      tone: 'act',
      weight: 55,
    })
  }

  // Nothing wrong. Say that in one line and point at what actually grows a blog,
  // rather than inventing chores to fill the space.
  if (!steps.length) {
    steps.push({
      id: 'all-clear',
      title: 'Nothing is broken on your blog',
      why: s.connected
        ? `All ${n(s.posts)} of your ${postWord(s.posts)} are in Google, your sitemap is current, and every AI answer engine can read you.`
        : `Your ${n(s.posts)} ${postWord(s.posts)} look healthy from everything MVP can see without Search Console.`,
      doThis: 'The thing that grows a blog from here is more posts on products people are already searching for, not more settings.',
      action: 'write',
      tone: 'good',
      weight: 10,
    })
  }

  return steps.sort((a, b) => b.weight - a.weight).slice(0, 4)
}
