// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT EACH POST NEEDS (Seb, 2026-10-11: "we need to see what post needs help,
// or which one would need the extra boost from being pushed by social if not
// already.. do we need to create more backlinks?").
//
// The SEO page listed scores, ticks and Google's reasons, and left the creator
// to work out which post to touch and how. This puts every post in ONE stage,
// says why in a sentence, and gives the next steps in order. The stages follow
// what actually moves a post, as far as anyone outside Google can tell:
//
//   1. Google has to FIND it: sitemap, links from posts it already knows,
//      a request in Search Console. (Discovered/unknown.)
//   2. Google has to KEEP it: a post worth indexing, linked from your stronger
//      posts. (Crawled, not indexed.)
//   3. Google has to RANK it: links from other sites and your own strongest
//      posts, a page people want. Sharing brings first readers and another
//      path in; it is not a ranking signal by itself.
//   4. People have to CLICK it: a title that answers the search.
//
// Pure, so the stage rules and the wording are tested (scripts/test-post-doctor).

import { reasonGuide } from '@/lib/indexing-help'

export type Lane = 'blocked' | 'unseen' | 'passed' | 'fresh' | 'close' | 'unclicked' | 'buried' | 'working' | 'waiting'

export interface LaneInfo {
  id: Lane
  title: string
  /** One sentence: what this stage means. */
  blurb: string
  tone: 'red' | 'amber' | 'violet' | 'blue' | 'green' | 'grey'
}

/** In the order a creator should work through them. */
export const LANES: LaneInfo[] = [
  { id: 'blocked', title: 'Fix first', blurb: 'Something stops Google from showing these at all. Nothing else helps until it is fixed.', tone: 'red' },
  { id: 'close', title: 'Almost on page one', blurb: 'Google already ranks these on page two. They are the quickest wins on the blog.', tone: 'violet' },
  { id: 'unseen', title: 'Google has not read these', blurb: 'Google knows the address, or not even that. These need a path in.', tone: 'amber' },
  { id: 'passed', title: 'Google read these and passed', blurb: 'Google visited and chose not to show them yet. The fix is the post and its links, not a button.', tone: 'amber' },
  { id: 'unclicked', title: 'Seen, not clicked', blurb: 'People see these in Google and scroll past. The title is the fix.', tone: 'blue' },
  { id: 'buried', title: 'In Google, nobody sees them', blurb: 'Indexed, but Google shows them for almost nothing. They need links and readers.', tone: 'blue' },
  { id: 'fresh', title: 'New this week', blurb: 'Too new to judge. Give them first readers and a link from an older post.', tone: 'grey' },
  { id: 'waiting', title: 'Waiting on Google', blurb: 'MVP does not have Google\'s answer for these yet. They are checked overnight.', tone: 'grey' },
  { id: 'working', title: 'Working', blurb: 'People find these and click. Keep them fresh and point your new posts at them.', tone: 'green' },
]
export const laneInfo = (id: Lane): LaneInfo => LANES.find((l) => l.id === id)!

/** Social platforms whose post carries a clickable link to the blog post.
 *  (An Instagram post does not, so it is not counted as a path in.) */
export const LINK_PLATFORMS = ['facebook', 'pinterest', 'x', 'linkedin', 'threads', 'bluesky', 'telegram'] as const
export const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', pinterest: 'Pinterest', x: 'X', linkedin: 'LinkedIn', threads: 'Threads', bluesky: 'Bluesky', telegram: 'Telegram',
}

export interface DoctorPost {
  postId: string
  title: string
  url: string | null
  publishedAt?: string | null
  indexed: boolean | null
  coverageState: string | null
  droppedAt?: string | null
  inSitemap?: boolean | null
  urlGuessed?: boolean
  clicks: number
  impressions: number
  position: number | null
  ctr: number | null
  score?: number
  hasBody?: boolean
  /** Your other posts whose text links here. null = MVP cannot tell (too many
   *  post bodies are not stored in MVP to count honestly). */
  linkedFrom?: string[] | null
  /** Platforms MVP shared this post to, from its own records. */
  shared?: string[]
  /** Posts already in Google that could link here (best first). */
  linkSources?: { postId: string; title: string }[]
}

export type StepKind = 'fix' | 'sitemap' | 'link' | 'request' | 'share' | 'improve' | 'title' | 'brand' | 'wait' | 'address'

export interface Step { kind: StepKind; text: string; href?: string }

export interface Diagnosis {
  lane: Lane
  /** Why it is in this stage, in plain words, with its own numbers. */
  why: string
  steps: Step[]
  /** True when a social push is one of the steps (not shared yet, and it would help). */
  wantsShare: boolean
}

/** Thresholds, named so the page and the test say the same thing. */
export const NEW_DAYS = 7
export const BURIED_MIN_DAYS = 21
export const BURIED_MAX_IMPRESSIONS = 30
export const CLOSE_POSITION: [number, number] = [8, 20]
export const CLOSE_MIN_IMPRESSIONS = 20
export const UNCLICKED_MIN_IMPRESSIONS = 100
export const UNCLICKED_MAX_CTR = 0.015
export const WORKING_MIN_CLICKS = 3

const DAY = 86_400_000
const ageDays = (p: DoctorPost, now: number): number | null => {
  const t = Date.parse(p.publishedAt || '')
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function sharedLinks(p: DoctorPost): string[] {
  return (p.shared ?? []).filter((s) => (LINK_PLATFORMS as readonly string[]).includes(s))
}

/** Which stage a post is in. Pure. */
export function laneFor(p: DoctorPost, now = Date.now()): Lane {
  const age = ageDays(p, now)
  if (p.indexed === false) {
    const sev = reasonGuide(p.coverageState).severity
    if (sev === 'urgent' || sev === 'fix') return 'blocked'
    const dropped = p.droppedAt ? now - Date.parse(p.droppedAt) < 14 * DAY : false
    if (dropped) return 'blocked'
    if (age !== null && age < NEW_DAYS) return 'fresh'
    if (/crawled/i.test(p.coverageState || '')) return 'passed'
    return 'unseen'
  }
  if (p.indexed === null) {
    if (age !== null && age < NEW_DAYS) return 'fresh'
    return 'waiting'
  }
  // In Google.
  const pos = p.position ?? 0
  if (pos >= CLOSE_POSITION[0] && pos <= CLOSE_POSITION[1] && p.impressions >= CLOSE_MIN_IMPRESSIONS) return 'close'
  if (p.clicks >= WORKING_MIN_CLICKS) return 'working'
  if (p.impressions >= UNCLICKED_MIN_IMPRESSIONS && pos > 0 && pos < CLOSE_POSITION[0] && (p.ctr ?? 0) < UNCLICKED_MAX_CTR) return 'unclicked'
  if (age !== null && age < BURIED_MIN_DAYS && p.impressions < BURIED_MAX_IMPRESSIONS) return 'fresh'
  if (p.impressions < BURIED_MAX_IMPRESSIONS) return 'buried'
  return 'working'
}

/** The stage, why, and the next steps in order. Pure. */
export function diagnose(p: DoctorPost, now = Date.now()): Diagnosis {
  const lane = laneFor(p, now)
  const steps: Step[] = []
  const shared = sharedLinks(p)
  const linked = p.linkedFrom
  const orphan = Array.isArray(linked) && linked.length === 0
  const sources = (p.linkSources ?? []).filter((s) => !(linked ?? []).includes(s.postId))
  const linkStep = (why: string): Step | null => {
    if (Array.isArray(linked) && linked.length >= 3) return null
    if (sources.length === 0) return null
    return { kind: 'link', text: why }
  }
  const shareStep = (why: string): Step | null => (shared.length > 0 ? null : { kind: 'share', text: why })
  const push = (s: Step | null) => { if (s) steps.push(s) }

  const pos = p.position ? Math.round(p.position * 10) / 10 : null
  let why = ''

  if (p.urlGuessed) {
    steps.push({ kind: 'address', text: 'MVP does not have this post\'s real address, so Google\'s answer may be about the wrong page. Press Refresh post URLs under Tools first.' })
  }

  switch (lane) {
    case 'blocked': {
      const g = reasonGuide(p.coverageState)
      const dropped = p.indexed === false && p.droppedAt && reasonGuide(p.coverageState).severity !== 'urgent' && reasonGuide(p.coverageState).severity !== 'fix'
      why = dropped
        ? `It was in Google and dropped out on ${new Date(p.droppedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Google now says: ${p.coverageState || 'not indexed'}.`
        : `Google says "${g.label}". ${g.means}`
      steps.push({ kind: 'fix', text: g.todo, href: g.tool?.href })
      if (dropped) steps.push({ kind: 'request', text: 'Once the post loads normally, ask Google to look again.' })
      break
    }
    case 'unseen': {
      why = /unknown/i.test(p.coverageState || '')
        ? 'Google has never seen this address.'
        : 'Google knows this address but has not visited it. On a young blog Google reads a few pages a day and picks the ones other pages point at.'
      if (p.inSitemap === false) steps.push({ kind: 'sitemap', text: 'It is missing from your sitemap, the list Google reads. Press Get my blog found to refresh it.' })
      push(linkStep(orphan ? 'None of your other posts link here, so Google has no path to it. Add a link from a post Google already shows.' : 'Add a link from a post Google already shows. That is the path Google follows.'))
      steps.push({ kind: 'request', text: 'Ask Google to read it (Search Console allows about 10 a day).' })
      push(shareStep('Share it. A share brings first readers and gives Google another path to the post.'))
      break
    }
    case 'passed': {
      why = 'Google read it and decided it adds little over pages it already has. Pressing a button again will not change that.'
      steps.push({ kind: 'improve', text: p.hasBody === false
        ? 'Make it worth keeping: rebuild it from the video so it carries your own testing and verdict.'
        : 'Make it worth keeping: your own photos or video, real testing notes, a clear verdict. Open its checks below.' })
      push(linkStep('Link to it from two or three of your posts that ARE in Google.'))
      steps.push({ kind: 'request', text: 'After the changes, ask Google to look again, once.' })
      push(shareStep('Share it, so real readers reach it.'))
      break
    }
    case 'fresh': {
      why = 'Published in the last few days. Google usually takes days to weeks with a new post.'
      if (p.inSitemap === false) steps.push({ kind: 'sitemap', text: 'It is missing from your sitemap. Press Get my blog found to refresh it.' })
      push(shareStep('Share it now. This is when a share helps most: first readers, and a path for Google.'))
      push(linkStep('Link to it from an older post Google already shows.'))
      if (steps.length === 0) steps.push({ kind: 'wait', text: 'Nothing to do yet. MVP checks it with Google overnight.' })
      break
    }
    case 'close': {
      why = `Google shows it at position ${pos} for searches people make, which is page two. ${plural(p.impressions, 'view')} in Google in 28 days, ${plural(p.clicks, 'click')}.`
      push(linkStep('Link to it from your strongest posts, using the words people search as the link text.'))
      steps.push({ kind: 'improve', text: 'Refresh it: answer the question better than the posts above it. Open its checks below.' })
      push(shareStep('Share it. Shares are not a ranking signal by themselves, but readers are how other sites find a post and link to it.'))
      steps.push({ kind: 'brand', text: 'Ask the brand to link to your review. A link from another site is what moves a page-two post most.' })
      break
    }
    case 'unclicked': {
      const ctr = Math.round((p.ctr ?? 0) * 1000) / 10
      why = `Shown ${plural(p.impressions, 'time')} at position ${pos}, clicked ${ctr}% of the time. People see it and choose another result.`
      steps.push({ kind: 'title', text: 'Rewrite the title so it answers the search: the product, the verdict, who it is for.', href: '/tools/title-audit' })
      break
    }
    case 'buried': {
      why = `In Google, but shown only ${plural(p.impressions, 'time')} in 28 days. Google has it and sees no reason to rank it yet.`
      push(linkStep('Link to it from your strongest posts.'))
      push(shareStep('Share it so it gets its first readers.'))
      steps.push({ kind: 'brand', text: 'Ask the brand to link to your review. Links from other sites are what lift a post Google already has.' })
      steps.push({ kind: 'title', text: 'Check the title says what someone would search for.', href: '/tools/title-audit' })
      break
    }
    case 'working': {
      why = `${plural(p.clicks, 'click')} from Google in 28 days${pos ? `, position ${pos}` : ''}.`
      steps.push({ kind: 'link', text: 'Point your new posts on the same topic at this one. It is the post Google trusts.' })
      push(shareStep('Share it. It already converts readers.'))
      break
    }
    case 'waiting': {
      why = 'MVP has not had Google\'s answer for this post yet.'
      steps.push({ kind: 'wait', text: 'Nothing to do. It is checked overnight.' })
      push(shareStep('Meanwhile, share it.'))
      break
    }
  }
  return { lane, why, steps, wantsShare: steps.some((s) => s.kind === 'share') }
}

export interface Board {
  lanes: { info: LaneInfo; posts: (DoctorPost & { dx: Diagnosis })[] }[]
  /** Not shared yet and in a stage where a share helps, best first. */
  shareFirst: (DoctorPost & { dx: Diagnosis })[]
  /** Posts no other post links to (only when MVP can count). */
  orphans: number
}

const SHARE_ORDER: Lane[] = ['close', 'fresh', 'unseen', 'buried', 'passed', 'working', 'waiting']

/** Every post in its stage, stages in working order, best candidates first. */
export function buildBoard(posts: DoctorPost[], now = Date.now()): Board {
  const withDx = posts.map((p) => ({ ...p, dx: diagnose(p, now) }))
  const lanes = LANES.map((info) => ({
    info,
    posts: withDx.filter((p) => p.dx.lane === info.id).sort((a, b) =>
      info.id === 'close' ? (a.position ?? 99) - (b.position ?? 99)
        : info.id === 'unclicked' || info.id === 'working' ? b.impressions - a.impressions
          : (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0)),
  })).filter((l) => l.posts.length > 0)
  const shareFirst = withDx
    .filter((p) => p.dx.wantsShare && !!p.url)
    .sort((a, b) => SHARE_ORDER.indexOf(a.dx.lane) - SHARE_ORDER.indexOf(b.dx.lane) || b.impressions - a.impressions)
    .slice(0, 6)
  const orphans = withDx.filter((p) => Array.isArray(p.linkedFrom) && p.linkedFrom.length === 0).length
  return { lanes, shareFirst, orphans }
}

// ── Backlinks: a straight answer from the blog's own numbers ────────────────

export interface BacklinkVerdict { need: 'not_yet' | 'yes' | 'helps'; headline: string; detail: string }

export function backlinkVerdict(board: Board): BacklinkVerdict {
  const count = (id: Lane) => board.lanes.find((l) => l.info.id === id)?.posts.length ?? 0
  const notIn = count('unseen') + count('passed') + count('blocked')
  const inButLow = count('buried') + count('close')
  const working = count('working') + count('unclicked')
  const total = board.lanes.reduce((s, l) => s + l.posts.length, 0) || 1
  if (notIn / total >= 0.5) {
    return {
      need: 'not_yet',
      headline: 'Not first. Google is not keeping most of your posts yet.',
      detail: `${notIn} of ${total} posts are not in Google. Links between your own posts, a fresh sitemap and posts with your own testing come first. A few real links from other sites will help after that.`,
    }
  }
  if (inButLow / total >= 0.3) {
    return {
      need: 'yes',
      headline: 'Yes. This is the step your blog is on.',
      detail: `${inButLow} of ${total} posts are in Google but shown for almost nothing, or stuck on page two. Google has them; links from other sites are what tell it they deserve a better spot.`,
    }
  }
  return {
    need: 'helps',
    headline: working > 0 ? 'They help, and your blog already has posts that work.' : 'They help once posts are in Google.',
    detail: 'Real links from sites in your niche lift every post a little. Point them at the posts that already earn, and link from those to the rest.',
  }
}

// ── One plan per stage (Alejandro, 2026-10-12: 71 posts "Google has not read
// these", each repeating the same three steps, and no way to tell where to
// start). A stage with many posts is one problem with one plan: what is going
// on, in the blog's own numbers, then the moves in order, each done for the
// whole stage at once where it can be. Pure, so the plan is tested.

export type PlanMoveKind = 'sitemap' | 'link_all' | 'request_today' | 'share' | 'improve' | 'titles' | 'brand' | 'pace'
export interface PlanMove {
  kind: PlanMoveKind
  /** What to do and why, with the stage's own numbers. */
  text: string
  /** Posts this move is for; 0 means it is already done for this stage. */
  count: number
}
export interface LanePlan { headline: string; why: string; moves: PlanMove[] }

type DxPost = DoctorPost & { dx: Diagnosis }

/** How many requests Search Console takes in a day, about. */
export const REQUESTS_PER_DAY = 10
/** Links added per press, so one press never republishes half the blog. */
export const BULK_LINKS = 10
/** New links from any one post per press, so no post becomes a link list. */
export const PER_SOURCE = 2
/** Published in the last 30 days, above which the pace itself is named. */
export const FAST_PACE = 20

/** The posts a link would help that have a post in Google to link from. */
function linkable(p: DxPost): boolean {
  const linked = new Set(p.linkedFrom ?? [])
  if (Array.isArray(p.linkedFrom) && p.linkedFrom.length >= 3) return false
  return (p.linkSources ?? []).some((s) => !linked.has(s.postId))
}

/** One link per post, from its best source not used PER_SOURCE times
 *  already, at most BULK_LINKS. Posts no post links to come first, then the
 *  newest. Pure. */
export function bulkLinkPairs(posts: DxPost[], done: Set<string> = new Set(), max = BULK_LINKS): Array<{ from: string; to: string; fromTitle: string; toTitle: string }> {
  const used = new Map<string, number>()
  const order = posts.filter(linkable).sort((a, b) =>
    (Array.isArray(a.linkedFrom) && a.linkedFrom.length === 0 ? 0 : 1) - (Array.isArray(b.linkedFrom) && b.linkedFrom.length === 0 ? 0 : 1)
    || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
  const out: Array<{ from: string; to: string; fromTitle: string; toTitle: string }> = []
  for (const p of order) {
    if (out.length >= max) break
    const linked = new Set(p.linkedFrom ?? [])
    const src = (p.linkSources ?? []).find((s) => !linked.has(s.postId) && !done.has(`${s.postId}>${p.postId}`) && (used.get(s.postId) ?? 0) < PER_SOURCE)
    if (!src) continue
    used.set(src.postId, (used.get(src.postId) ?? 0) + 1)
    out.push({ from: src.postId, to: p.postId, fromTitle: src.title, toTitle: p.title })
  }
  return out
}

/** Today's requests to Google: posts not asked about in the last week, the
 *  ones with a path in first (a link, a share), then the newest. Pure. */
export function requestQueue(posts: DxPost[], requested: Record<string, string>, now = Date.now(), n = REQUESTS_PER_DAY): DxPost[] {
  const recent = (u: string | null) => { const t = u ? Date.parse(requested[u] || '') : NaN; return Number.isFinite(t) && now - t < 7 * DAY }
  const hasPath = (p: DxPost) => (Array.isArray(p.linkedFrom) && p.linkedFrom.length > 0) || sharedLinks(p).length > 0
  return posts.filter((p) => p.url && !recent(p.url))
    .sort((a, b) => Number(hasPath(b)) - Number(hasPath(a)) || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
    .slice(0, Math.max(0, n - requestedToday(requested, now)))
}

/** Requests opened since midnight, in this browser. */
export function requestedToday(requested: Record<string, string>, now = Date.now()): number {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  return Object.values(requested).filter((v) => { const t = Date.parse(v); return Number.isFinite(t) && t >= start.getTime() && t <= now }).length
}

/** The plan for one stage, or null when a stage needs none. Pure. */
export function lanePlan(lane: Lane, posts: DxPost[], allPosts: DxPost[], connected: boolean, now = Date.now()): LanePlan | null {
  const n = posts.length
  if (n === 0) return null
  const missing = posts.filter((p) => p.inSitemap === false).length
  const canLink = posts.filter(linkable).length
  const noSource = posts.filter((p) => !(p.linkSources ?? []).length).length
  const orphans = posts.filter((p) => Array.isArray(p.linkedFrom) && p.linkedFrom.length === 0).length
  const unshared = posts.filter((p) => sharedLinks(p).length === 0 && !!p.url).length
  const thin = posts.filter((p) => p.hasBody === false).length
  const recent = allPosts.filter((p) => { const t = Date.parse(p.publishedAt || ''); return Number.isFinite(t) && now - t < 30 * DAY }).length
  const inGoogle = allPosts.filter((p) => p.indexed === true).length
  const posts1 = (k: number) => plural(k, 'post')
  const moves: PlanMove[] = []
  const linkMove = (why: string) => moves.push({
    kind: 'link_all', count: canLink,
    text: canLink
      ? `${why} ${canLink} of these have a post in Google on the same topic to link from${orphans ? `; ${orphans} have no link from any of your posts` : ''}.${noSource ? ` ${posts1(noSource)} have no post in Google on their topic yet: link to them from the next post you publish on it.` : ''}`
      : noSource === n ? 'None of these has a post in Google on the same topic to link from yet. Link to them from the next post you publish on each topic.' : 'Each of these already has links from your posts.',
  })
  const shareMove = (why: string) => moves.push({ kind: 'share', count: unshared, text: unshared ? `${why} ${posts1(unshared)} here were never shared from MVP.` : 'All of these were shared from MVP.' })

  switch (lane) {
    case 'unseen': {
      if (missing || connected) moves.push({ kind: 'sitemap', count: missing, text: missing ? `${posts1(missing)} are missing from your sitemap, the list Google reads first. Refresh it once and all of them are in.` : 'All of these are in your sitemap, so Google has the addresses.' })
      linkMove('Google follows links. A link from a post it already shows is the strongest path in, and MVP adds them for you, ten at a time.')
      if (connected) moves.push({ kind: 'request_today', count: Math.min(n, REQUESTS_PER_DAY), text: `Ask Google about ${REQUESTS_PER_DAY} a day, not all ${n}: Search Console allows about ${REQUESTS_PER_DAY} a day and asking twice does not help. MVP lists today's ${REQUESTS_PER_DAY}, the ones with a path in first.` })
      shareMove('A share brings first readers and another path in.')
      if (recent >= FAST_PACE) moves.push({ kind: 'pace', count: recent, text: `You published ${recent} posts in the last 30 days, and Google has ${inGoogle} of your posts so far. Google reads a young blog a few pages a day, so it falls behind a fast pace. Keep publishing, and link every new post from an older one in Google: that is what lets Google keep up.` })
      return {
        headline: `${posts1(n)} Google has not read yet. Here is the plan for all of them.`,
        why: 'Google knows most of these addresses and has not visited them. On a growing blog that is normal: Google reads a few pages a day and picks the ones other pages point to. Nothing is broken, and pressing Request indexing on every post will not change it. Paths in will.',
        moves,
      }
    }
    case 'passed': {
      moves.push({ kind: 'improve', count: n, text: thin
        ? `Google read these and kept similar pages instead. Make each one worth keeping: your own photos or video, real testing notes, a clear verdict. ${posts1(thin)} have no text stored in MVP: rebuild them from the video.`
        : 'Google read these and kept similar pages instead. Make each one worth keeping: your own photos or video, real testing notes, a clear verdict. Open each post\'s checks below.' })
      linkMove('Then link to them from posts Google shows, so Google sees they matter.')
      if (connected) moves.push({ kind: 'request_today', count: Math.min(n, REQUESTS_PER_DAY), text: 'After a post is improved, ask Google to look again, once. Not before: Google already read it.' })
      return { headline: `${posts1(n)} Google read and chose not to show yet.`, why: 'This is Google saying "not worth keeping yet", not "not found". A request alone will not change it; the post and its links will.', moves }
    }
    case 'buried': {
      linkMove('Google has these but sees no reason to show them. Links from your strongest posts are the quickest lift you control.')
      moves.push({ kind: 'titles', count: n, text: 'Check each title names what someone actually searches: the product, the verdict, who it is for. Title Check does all of them at once.' })
      moves.push({ kind: 'brand', count: n, text: 'Links from other sites lift posts Google already has more than anything you do on your own blog. The easiest: send each brand your review.' })
      shareMove('First readers help other sites find the post.')
      return { headline: `${posts1(n)} in Google that almost nobody sees.`, why: `Google indexed them and shows them for almost nothing (under ${BURIED_MAX_IMPRESSIONS} views in 28 days). They are not broken; they need links and a title that matches a real search.`, moves }
    }
    case 'close': {
      linkMove('These are on page two, the quickest wins on the blog. Links from your own strongest posts can move them.')
      moves.push({ kind: 'improve', count: n, text: 'Refresh each one so it answers the search better than the posts above it. Open each post\'s checks below.' })
      moves.push({ kind: 'brand', count: n, text: 'One link from another site moves a page-two post more than anything else. Send each brand your review.' })
      return { headline: `${posts1(n)} on page two of Google.`, why: 'Google already ranks these for real searches, just below the fold. A small push moves them onto page one.', moves }
    }
    case 'fresh': {
      shareMove('This is when a share helps most: first readers, and a path for Google.')
      linkMove('Link each from an older post Google already shows.')
      return { headline: `${posts1(n)} published in the last few days.`, why: 'Too new to judge. Google usually takes days to weeks with a new post.', moves }
    }
    case 'unclicked': {
      moves.push({ kind: 'titles', count: n, text: 'People see these and choose another result. Rewrite each title so it answers the search. Title Check does all of them at once.' })
      return { headline: `${posts1(n)} seen in Google and not clicked.`, why: 'The ranking is there. The title is what loses the click.', moves }
    }
    default:
      return null
  }
}
