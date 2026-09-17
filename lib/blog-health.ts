// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Is this blog working, and is it growing.
//
// Nothing in MVP answered that. The SEO page reported an average score of 99
// out of 100 on a site earning nothing, and a 28-day impression total that
// quietly averaged away the fact that traffic had stopped dead four days
// earlier after the site broke. The creator found that out from their host's
// bandwidth chart, which counts crawlers and login-probing bots and has nothing
// to do with whether a human ever read a post.
//
// So this measures the only chain that matters to someone running an affiliate
// blog, end to end:
//
//   Google shows the page  →  someone clicks  →  they click an affiliate link
//   →  they buy
//
// and says which link in it is broken, because each break has a completely
// different fix and three of them are invisible if you only look at earnings.
//
// Two rules it will not break.
//
// It never blames the creator for time. A blog that is six weeks old with no
// clicks is behaving normally, and telling that person they are failing is both
// false and the reason they quit. A blog that is a year old with no clicks has
// a real problem. The same number means opposite things, and the age decides.
//
// It never claims the blog earned money it cannot prove. Offsite Amazon
// earnings cover every link the creator has placed anywhere: the blog, YouTube,
// a newsletter. Amazon does not say which sent the buyer, so neither does this.

export interface DailyPoint {
  /** ISO date, YYYY-MM-DD. */
  date: string
  clicks: number
  impressions: number
  /** Average result position that day. Without it, "shown and never clicked"
   *  gets diagnosed as a headline problem at every position, and at position 26
   *  that is wrong advice: almost nobody reaches page three, so a near-zero
   *  click rate there is the position doing exactly what positions do. Sending
   *  someone off to rewrite titles would cost them weeks and change nothing. */
  position?: number | null
}

export interface BlogHealthInput {
  /** Daily Search Console rows, oldest first. Empty when not connected. */
  daily: DailyPoint[]
  connected: boolean
  posts: number
  /** When the blog first published, so the verdict can account for its age. */
  firstPublishedAt: string | null
  /** Product-link clicks from the blog, through Passport.
   *
   *  Null and zero are different claims and must stay that way. Zero means the
   *  creator has tracked links and readers did not take them. Null means there
   *  are no tracked links to click, which says nothing about the readers, and
   *  reporting it as nobody clicking would be an accusation invented out of an
   *  absence. */
  affiliateClicks: number | null
  /** Everything Amazon paid for links placed away from the storefront. Covers
   *  the blog AND anywhere else, which is why it is never called blog revenue. */
  offsiteEarningsCents: number | null
  /** How much of the site Google is still willing to show. See ReachWindows.
   *  Null when it could not be measured, which must stay distinguishable from
   *  a measured zero. */
  reach?: ReachWindows | null
}

/**
 * How many distinct pages Google showed at all, over three consecutive 28-day
 * windows, oldest first.
 *
 * This exists because impressions alone cannot tell a broken site from a site
 * being dropped out of the index, and the two have nothing in common to fix.
 *
 * Measured, on one real blog: impressions went 48 a day to 2 a day to zero
 * across 29 and 30 August, which is the exact shape of a site going down. It
 * had not gone down. Its indexed page count had been falling since the end of
 * June, 1,076 pages to 47 over ten weeks, and the last of those 47 leaving is
 * what the impression chart was showing. The page said "this is a break, not a
 * slow decline, so look for something that changed that day" and sent its owner
 * hunting a 1 September change that never existed.
 *
 * Distinct pages with at least one impression is the closest thing to that
 * index count the Search Analytics API will give us, and it moves the same way.
 *
 * Posts and archives are counted apart, and that split is the whole point of
 * the second version of this. MVP's own WordPress plugin started noindexing tag,
 * author, date, search and paginated archive pages on 20 August 2026, and
 * dropped tags out of the sitemap at the same time. On the same blog as above,
 * the indexed count went from losing 11 pages a day to losing 55 a day in the
 * week that landed. That was the cleanup working exactly as designed, on pages
 * that were bringing in close to nothing, and it looked identical to a disaster.
 * A single page count cannot tell those apart, so it would have reported our own
 * intended change to every creator running the plugin as their site collapsing.
 */
export interface ReachWindow {
  /** Distinct article and page URLs Google showed at least once. The number
   *  that actually matters, because these are what earn traffic. */
  posts: number
  /** Distinct archive URLs: tag, author, date, search, category, paginated.
   *  Counted so their disappearance can be named as the cleanup it is. */
  archives: number
  /** Every distinct URL shown, whatever kind. Only used to catch a measurement
   *  that contradicts the impressions it is meant to explain. */
  total: number
}

export interface ReachWindows {
  /** [oldest 28 days, middle 28 days, most recent 28 days]. */
  windows: [ReachWindow, ReachWindow, ReachWindow]
}

export type ReachTrend = 'shrinking' | 'steady' | 'growing' | 'unknown'

export interface ReachRead {
  /** The trend in POSTS. Archives leaving is not the creator's problem. */
  trend: ReachTrend
  oldest: number
  newest: number
  /** True when the archive pages left and the posts did not. That is MVP's own
   *  noindex doing its job, and the creator needs to be told so by name rather
   *  than left to discover a cliff in Search Console and assume the worst. */
  archivesOnly: boolean
  /** The archive counts behind that claim, or null when not worth stating. */
  archives: { oldest: number; newest: number } | null
}

/** Archive URL shapes, in WordPress's default permalink vocabulary. */
const ARCHIVE_SEGMENT = /\/(tag|author|category|date|page)\/[^/]/i
/** A date archive is a path that is ONLY a date. /2026/08/14/some-post/ is a
 *  post using the dated permalink structure and must not be counted as one. */
const DATE_ARCHIVE = /^\/(19|20)\d{2}(\/\d{1,2}){0,2}\/?$/

/**
 * Is this URL an article, an archive, or neither.
 *
 * 'other' is the site root and anything unparseable. The homepage is neither a
 * post nor a thin archive, and counting it as either would put a permanent +1
 * on one side of a comparison that is supposed to be about articles.
 */
export function classifyReachUrl(raw: string): 'post' | 'archive' | 'other' {
  let path: string
  let search: string
  try {
    const u = new URL(raw)
    path = u.pathname
    search = u.search
  } catch {
    return 'other'
  }
  if (/[?&]s=/.test(search)) return 'archive'
  if (path === '/' || path === '') return 'other'
  if (ARCHIVE_SEGMENT.test(path)) return 'archive'
  if (DATE_ARCHIVE.test(path)) return 'archive'
  if (/\/feed\/?$/i.test(path)) return 'archive'
  return 'post'
}

/** Count one window's URLs into a ReachWindow. */
export function countReach(urls: string[]): ReachWindow {
  let posts = 0
  let archives = 0
  for (const u of urls) {
    const kind = classifyReachUrl(u)
    if (kind === 'post') posts++
    else if (kind === 'archive') archives++
  }
  return { posts, archives, total: urls.length }
}

export type FunnelStage = 'not-shown' | 'not-ranking' | 'not-clicked' | 'not-following-links' | 'not-buying' | 'working'

/** Roughly where a result stops being seen at all. Page one ends at ten, and
 *  click-through falls off a cliff well before the bottom of it. */
const PAGE_ONE = 10
const BURIED = 15

export interface BlogHealth {
  connected: boolean
  /** The last 28 complete days, and the 28 before them, for comparison. */
  recent: { clicks: number; impressions: number }
  previous: { clicks: number; impressions: number }
  /** Whole months since the first post went live, or null when nothing has. */
  ageMonths: number | null
  /** Where the chain from search result to sale gives out. */
  stage: FunnelStage
  /** Traffic that stopped rather than declined, with the day it happened, so it
   *  can be lined up against whatever else went on that day. */
  collapse: { date: string; before: number; after: number } | null
  /** One sentence, in the creator's terms. */
  verdict: string
  /** What to do about it. */
  doThis: string
  /** True when there is genuinely not enough here to judge yet, so the page can
   *  encourage rather than diagnose. */
  tooEarly: boolean
  /** Impression-weighted average position, or null when nothing was shown. */
  avgPosition: number | null
  /** Whether the number of pages Google shows is shrinking, and by how much.
   *  'unknown' whenever it could not be measured or the numbers are too small
   *  to mean anything, and 'unknown' never asserts a cause. */
  reach: ReachRead
  daily: DailyPoint[]
}

const sum = (rows: DailyPoint[], pick: (r: DailyPoint) => number) =>
  rows.reduce((a, r) => a + pick(r), 0)

/** Whole months between a date and now. */
function monthsSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (isNaN(then.getTime())) return null
  const now = new Date()
  const months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
  return Math.max(0, months)
}

/**
 * Traffic that stopped, as opposed to traffic that drifted down.
 *
 * A site that breaks does not decline, it flatlines, and that is the shape
 * looked for here: a run of days at or near zero immediately after a stretch
 * that was reliably above it. Requiring the earlier stretch to have carried real
 * volume keeps a quiet blog from being told it crashed.
 */
export function findCollapse(daily: DailyPoint[]): { date: string; before: number; after: number } | null {
  if (daily.length < 10) return null
  // Walk from the most recent day back, counting the run of near-dead days.
  let dead = 0
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].impressions <= 1) dead++
    else break
  }
  if (dead < 3) return null
  const before = daily.slice(Math.max(0, daily.length - dead - 14), daily.length - dead)
  if (before.length < 5) return null
  const beforeAvg = sum(before, r => r.impressions) / before.length
  // A blog that was barely being shown has not crashed, it was always quiet.
  if (beforeAvg < 5) return null
  return {
    date: daily[daily.length - dead].date,
    before: Math.round(beforeAvg),
    after: 0,
  }
}

/**
 * Read the reach windows, refusing to claim a trend the numbers cannot carry.
 *
 * Every refusal here is load-bearing, because the caller turns 'shrinking' into
 * "your pages are dropping out of Google", which is a different instruction to a
 * creator than "something changed that day". Saying it wrongly costs them the
 * same day the old wording did.
 *
 * `recentImpressions` is passed in as a cross-check. If Google showed the site
 * anything at all in the last 28 days then the count of pages it showed cannot
 * be zero, so a zero there is a broken measurement rather than a dead site, and
 * the only honest answer is that we do not know.
 *
 * The trend reported is the trend in POSTS. Archives are read separately and
 * only to answer one question: did the archives go while the posts stayed. That
 * is MVP's own noindex cleanup, it is not a fault, and a creator who is not told
 * so by name is left staring at a cliff in Search Console assuming the worst.
 */
export function readReach(reach: ReachWindows | null | undefined, recentImpressions: number): ReachRead {
  const unknown: ReachRead = { trend: 'unknown', oldest: 0, newest: 0, archivesOnly: false, archives: null }
  if (!reach) return unknown
  const w = reach.windows
  if (!Array.isArray(w) || w.length !== 3) return unknown
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (!w.every(x => x && ok(x.posts) && ok(x.archives) && ok(x.total))) return unknown

  // The measurement contradicts the traffic it is supposed to explain. Google
  // cannot have shown the site 900 times across no pages at all, so this is a
  // failed count, and reporting it would invent a catastrophe.
  if (recentImpressions > 0 && w[2].total === 0) return unknown

  // Same rule applied to whichever series is being read. Kept as one function so
  // posts and archives can never drift into being judged differently.
  const trendOf = (oldest: number, middle: number, newest: number): ReachTrend => {
    // Too few pages for a ratio to mean anything. Three becoming one is not a
    // deindexing, it is a small blog having a slow month.
    if (oldest < 10) return 'unknown'
    if (newest <= oldest * 0.6 && middle <= oldest) return 'shrinking'
    if (newest >= oldest * 1.4) return 'growing'
    return 'steady'
  }

  const trend = trendOf(w[0].posts, w[1].posts, w[2].posts)
  const archiveTrend = trendOf(w[0].archives, w[1].archives, w[2].archives)
  const archives = { oldest: w[0].archives, newest: w[2].archives }

  // The cleanup, told apart from the disease. Both halves are required: the
  // archives must actually have gone, AND the posts must have held. If the posts
  // went too then something real is happening and calling it housekeeping would
  // be the worst thing this function could say.
  const archivesOnly = archiveTrend === 'shrinking' && trend !== 'shrinking' && trend !== 'unknown'

  return { trend, oldest: w[0].posts, newest: w[2].posts, archivesOnly, archives: archiveTrend === 'unknown' ? null : archives }
}

export function analyseBlogHealth(input: BlogHealthInput): BlogHealth {
  const { daily, connected, posts, affiliateClicks, offsiteEarningsCents } = input
  const recentRows = daily.slice(-28)
  const previousRows = daily.slice(-56, -28)
  const recent = { clicks: sum(recentRows, r => r.clicks), impressions: sum(recentRows, r => r.impressions) }
  const previous = { clicks: sum(previousRows, r => r.clicks), impressions: sum(previousRows, r => r.impressions) }
  const ageMonths = monthsSince(input.firstPublishedAt)
  const collapse = findCollapse(daily)
  const reach = readReach(input.reach, recent.impressions)

  // Where the chain gives out. Each break has a different fix, and only the
  // last of them is visible from earnings alone.
  // Impression-weighted average position over the window. A day with two
  // impressions should not pull the average as hard as a day with two hundred.
  const positioned = recentRows.filter(r => r.position != null && r.impressions > 0)
  const weight = sum(positioned, r => r.impressions)
  const avgPosition = weight > 0
    ? positioned.reduce((a, r) => a + (r.position as number) * r.impressions, 0) / weight
    : null

  let stage: FunnelStage = 'working'
  if (recent.impressions === 0) stage = 'not-shown'
  // Buried, rather than ignored. These look identical in the click count and
  // have opposite fixes: one is the words in the result, the other is that
  // nobody scrolls that far.
  else if (recent.clicks === 0 && avgPosition != null && avgPosition > BURIED) stage = 'not-ranking'
  else if (recent.clicks === 0) stage = 'not-clicked'
  else if (affiliateClicks != null && affiliateClicks === 0) stage = 'not-following-links'
  else if (offsiteEarningsCents != null && offsiteEarningsCents === 0 && (affiliateClicks ?? 0) > 0) stage = 'not-buying'

  // Young blogs are not failing blogs. Google routinely takes months to trust a
  // new site, and a page that calls that failure is both wrong and the reason
  // people give up two months before it would have worked.
  const young = ageMonths != null && ageMonths < 3
  const tooEarly = young && recent.clicks === 0

  let verdict: string
  let doThis: string

  if (!connected) {
    verdict = 'MVP cannot see how your blog is doing yet.'
    doThis = 'Connect Google Search Console. It is free, it takes a minute, and it is the only way to know whether anyone is finding your posts.'
  } else if (posts === 0) {
    verdict = 'Nothing published yet, so there is nothing to measure.'
    doThis = 'Write your first post.'
  } else if (collapse) {
    verdict = `Your traffic stopped on ${collapse.date}. Before that Google was showing your posts about ${collapse.before} times a day; since then it has been nothing.`
    if (reach.trend === 'shrinking') {
      // The day the impressions hit zero is the END of this, not the start of
      // it, and saying otherwise sends someone looking for a change that was
      // never made.
      verdict += ` It did not start that day. Over the last three months the number of your POSTS Google shows at all fell from ${reach.oldest} to ${reach.newest}.`
      doThis = 'Your posts have been dropping out of Google for weeks, so there is no single day to investigate and nothing broke. Open Search Console, go to Pages, and read the reasons it gives for the pages it is no longer indexing. Fix whichever reason covers your actual posts, then ask Google to recrawl them.'
    } else if (reach.archivesOnly) {
      // The cleanup, not the disease. MVP's own plugin noindexed the archives on
      // 20 August 2026, and a creator who reads that cliff in Search Console
      // without being told what made it assumes their site is dying.
      verdict += ` Your posts are still in Google: ${reach.newest} of them were shown over that period. What left was your tag and archive pages, which went from ${reach.archives?.oldest} to ${reach.archives?.newest} because MVP noindexes them on purpose.`
      doThis = 'Ignore the drop in your indexed page count, that part was us. Those tag and date pages were thin, they earned you almost nothing, and removing them is meant to concentrate Google on your actual posts. The traffic stopping is a separate question: your posts are still indexed, so check the site loads and that nothing changed that day.'
    } else if (reach.trend === 'unknown') {
      // We know when it stopped. We do NOT know why, and there are two causes
      // that look identical here, so this gives an order to check rather than
      // an answer it cannot support.
      doThis = `Two different things look like this, so check which one it is before changing anything. Open one of your posts in a browser and see whether the page still loads. If it does, search Google for its exact title and see whether the post comes back. A page that loads but is no longer in Google is being dropped from the index, which takes weeks and has no single cause to find on ${collapse.date}. A page that does not load is a site fault, and that is where the change that day will be.`
    } else {
      // Reach held up, so the site really was being shown right until it
      // stopped. Now the one-day claim is earned.
      verdict += ` Google was still showing ${reach.newest} of your pages over that period, so they had not been dropped from the index.`
      doThis = 'Your pages are still in Google, so this is a break rather than a slow decline and something changed that day: the site going down, a redirect, or a setting that hid your pages. Fix the cause and the traffic comes back on its own.'
    }
  } else if (stage === 'not-shown') {
    verdict = tooEarly
      ? `Google has not started showing your ${posts} posts yet, which is normal at ${ageMonths === 0 ? 'under a month' : `${ageMonths} month${ageMonths === 1 ? '' : 's'}`} old.`
      : `Google is not showing your posts to anyone.`
    if (!tooEarly && reach.trend === 'shrinking') {
      // Same disease as the collapse case, caught before it reached zero.
      verdict += ` The number of your posts it shows at all fell from ${reach.oldest} to ${reach.newest} over the last three months, so they are being dropped rather than never picked up.`
    }
    doThis = tooEarly
      ? 'Nothing is wrong. A new site usually waits weeks before Google shows it to anyone, and months before that turns into real traffic. Keep publishing.'
      : reach.trend === 'shrinking'
        ? 'Pages that were indexed and are not any more is a different problem from pages Google never took, and it is the one you have. Open Search Console, go to Pages, and read the reasons listed for the pages it stopped indexing. Fix whichever reason covers your actual posts, then ask Google to recrawl them.'
        : 'Nobody can click a page they are never shown, so nothing else matters until this moves. Check that your posts are actually in Google, and that they are linked from somewhere on your own site rather than sitting alone.'
  } else if (stage === 'not-ranking') {
    verdict = `Google showed your posts ${recent.impressions.toLocaleString()} times in the last 28 days, but at an average position of ${Math.round(avgPosition as number)}, which is page ${Math.ceil((avgPosition as number) / 10)} of the results.`
    doThis = 'Almost nobody scrolls that far, so a near-zero click rate here is the position doing what positions do, not your titles. Rewriting them will not help until the pages move up. What moves them is fewer, better posts on questions people actually type, and links between your own posts so the strongest ones pass authority to the rest.'
  } else if (stage === 'not-clicked') {
    verdict = `Google showed your posts ${recent.impressions.toLocaleString()} times in the last 28 days and nobody clicked.`
    doThis = 'You are ranking. People are reading your title in the results and choosing something else, which makes this a headline problem, not a search one, and it is far quicker to fix than ranking. Rewrite the titles on the posts being shown most.'
  } else if (stage === 'not-following-links') {
    verdict = `${recent.clicks.toLocaleString()} people read your posts in the last 28 days and none of them clicked a product link.`
    doThis = 'They came for the answer and left with it. Put the recommendation higher up, and make the link a clear thing to click rather than a word in a sentence.'
  } else if (stage === 'not-buying') {
    verdict = `People are reading your posts and clicking through to Amazon, and none of it has turned into a sale yet.`
    doThis = 'This is the closest anyone gets to earning without earning. Usually it is the product rather than the post: out of stock, badly reviewed, or priced above what the article implies.'
  } else {
    const growth = previous.clicks > 0 ? ((recent.clicks - previous.clicks) / previous.clicks) * 100 : null
    verdict = growth != null && Math.abs(growth) >= 15
      ? `${recent.clicks.toLocaleString()} people read your posts in the last 28 days, ${growth > 0 ? 'up' : 'down'} ${Math.abs(Math.round(growth))}% on the 28 before.`
      : `${recent.clicks.toLocaleString()} people read your posts in the last 28 days.`
    doThis = offsiteEarningsCents != null && offsiteEarningsCents > 0
      ? 'The whole chain is working. More posts on products people are already searching for is what grows this from here.'
      : 'The chain works as far as the click. Keep publishing, and watch which posts bring the readers so you can make more like them.'
  }

  return { connected, recent, previous, ageMonths, stage, collapse, verdict, doThis, tooEarly, daily, avgPosition, reach }
}
