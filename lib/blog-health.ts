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
}

export type FunnelStage = 'not-shown' | 'not-clicked' | 'not-following-links' | 'not-buying' | 'working'

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

export function analyseBlogHealth(input: BlogHealthInput): BlogHealth {
  const { daily, connected, posts, affiliateClicks, offsiteEarningsCents } = input
  const recentRows = daily.slice(-28)
  const previousRows = daily.slice(-56, -28)
  const recent = { clicks: sum(recentRows, r => r.clicks), impressions: sum(recentRows, r => r.impressions) }
  const previous = { clicks: sum(previousRows, r => r.clicks), impressions: sum(previousRows, r => r.impressions) }
  const ageMonths = monthsSince(input.firstPublishedAt)
  const collapse = findCollapse(daily)

  // Where the chain gives out. Each break has a different fix, and only the
  // last of them is visible from earnings alone.
  let stage: FunnelStage = 'working'
  if (recent.impressions === 0) stage = 'not-shown'
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
    doThis = 'This is a break, not a slow decline, so look for something that changed that day: the site going down, a redirect, or a setting that hid your pages. Fix the cause and the traffic comes back on its own.'
  } else if (stage === 'not-shown') {
    verdict = tooEarly
      ? `Google has not started showing your ${posts} posts yet, which is normal at ${ageMonths === 0 ? 'under a month' : `${ageMonths} month${ageMonths === 1 ? '' : 's'}`} old.`
      : `Google is not showing your posts to anyone.`
    doThis = tooEarly
      ? 'Nothing is wrong. A new site usually waits weeks before Google shows it to anyone, and months before that turns into real traffic. Keep publishing.'
      : 'Nobody can click a page they are never shown, so nothing else matters until this moves. Check that your posts are actually in Google, and that they are linked from somewhere on your own site rather than sitting alone.'
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

  return { connected, recent, previous, ageMonths, stage, collapse, verdict, doThis, tooEarly, daily }
}
