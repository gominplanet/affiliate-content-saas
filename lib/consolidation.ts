// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH POSTS ARE DOING NOTHING, AND WHICH OF THOSE ARE WORTH MERGING?
//
// 279 posts on one site, 47 of them indexed, 394 sitting in "Crawled, currently
// not indexed". A catalogue like that is not helped by a 280th post. It is
// helped by turning the weakest forty into the strongest ten, because a page
// Google has read and declined does not improve by existing, and every one of
// them is competing with the creator's own better pages for the same queries.
//
// This finds the candidates. It does not act on them. Merging or redirecting is
// destructive to live content on a creator's own site, and a list that a person
// reads and decides on is the correct shape for that.
//
// ── The mistake this must not make ──────────────────────────────────────────
//
// A post published three weeks ago with no impressions is NOT weak. It is new.
// Google routinely takes months to decide about a page on a site it does not yet
// trust, and putting a fresh post on a "delete or merge these" list would have a
// creator destroy work that was about to start earning. So nothing is a
// candidate until it has had a real chance, and how long that is depends on the
// site's age rather than a fixed number of days.
//
// ── Two different failures that look identical in a traffic report ───────────
//
// A post with no impressions because Google never indexed it, and a post that is
// indexed and shown but nobody clicks, have nothing in common. The first is a
// candidate for merging into something stronger. The second is a title problem
// on a page that is already working, and merging it away would throw out a
// ranking. They are separated here rather than lumped into "underperforming".

export interface PostStat {
  id: string
  title: string
  /** The live URL, used to join against Search Console. */
  url: string | null
  publishedAt: string | null
  /** Words in the body. */
  words: number
  /** Impressions over the measured window. Null when the page was not in the
   *  Search Console response at all, which is different from a measured zero:
   *  Search Console omits pages with no data, so absence means "never shown"
   *  only once we know the fetch itself succeeded. */
  impressions: number | null
  clicks: number | null
}

export type Weakness = 'never-shown' | 'shown-never-clicked' | 'thin'

export interface Candidate {
  id: string
  title: string
  url: string | null
  publishedAt: string | null
  words: number
  impressions: number
  clicks: number
  weakness: Weakness
  /** Plain sentence naming what is wrong and what it implies. */
  reason: string
  /** Ids of other candidates covering what looks like the same product. */
  overlapsWith: string[]
}

export interface ConsolidationReport {
  candidates: Candidate[]
  /** Posts excluded for being too new to judge, with the count so the creator
   *  can see the list is not the whole catalogue. */
  tooYoung: number
  /** Posts that are working and were never considered. */
  working: number
  /** How many were judged on evidence rather than the calendar: newer than the
   *  grace window, but Google indexed something published after them. */
  judgedByEvidence: number
  /** Groups of candidates that look like the same product, most overlapping
   *  first. These are the merges worth doing. */
  groups: Array<{ key: string; ids: string[]; titles: string[] }>
  note: string | null
}

/**
 * How long a post gets before its silence means anything.
 *
 * Tied to the site's age because the same ninety days mean different things on
 * a two year old site and a four month old one. On a young site Google is still
 * deciding about the whole domain, so an individual post's silence says almost
 * nothing about that post.
 *
 * On its own this is not enough, and a real site showed why. 315 posts, eleven a
 * week, every single one inside the 180 day window, so the panel reported
 * "nothing to consolidate" while Google was showing 106 of the 315 and ignoring
 * the other 209. A site publishing at that rate keeps almost every post inside
 * the window permanently, so age alone makes this list useless for exactly the
 * creators who need it most. See hasHadItsChance.
 */
export function graceDays(ageMonths: number | null | undefined): number {
  const m = Number(ageMonths)
  if (!Number.isFinite(m) || m < 6) return 180
  if (m < 12) return 120
  return 90
}

/** Below this a post is thin however it performs. */
const THIN_WORDS = 400

/**
 * Has Google had its chance with this post?
 *
 * Two ways to be sure, and the second is the one that matters on a fast site.
 *
 * Age: the post is older than the grace window. Fine on a slow site, useless on
 * a site publishing eleven a week, where nothing ever leaves the window.
 *
 * Evidence: Google has indexed a post published LATER than this one. That is
 * proof it crawled this part of the site and kept going, so this page was not
 * missed, it was passed over. A stronger signal than a calendar, and it needs no
 * assumption about how long Google takes.
 *
 * `newestIndexed` is the publish date of the most recent post that has actually
 * been shown in search, or null when nothing has been. Null falls back to age
 * alone, because with no indexed post anywhere there is no evidence Google has
 * looked at the site at all, and condemning every page on that basis would be
 * the worst thing this file could do.
 */
export function hasHadItsChance(
  publishedAt: number,
  now: number,
  graceMs: number,
  newestIndexed: number | null,
): boolean {
  if (now - publishedAt >= graceMs) return true
  if (newestIndexed != null && publishedAt <= newestIndexed) return true
  return false
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'best', 'top', 'review', 'reviews',
  'vs', 'is', 'it', 'to', 'of', 'in', 'on', 'my', 'our', 'your', 'this', 'that',
  'guide', 'worth', 'should', 'you', 'buy', 'are', 'was', 'does', 'do', 'how',
])

/**
 * The words in a title that identify the product.
 *
 * Deliberately crude, and deliberately conservative: it only groups posts that
 * share several distinctive words, because grouping two unrelated posts would
 * invite a creator to merge away a page that was fine.
 */
export function titleKeywords(title: string): string[] {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
}

/** Shared distinctive words needed before two posts are called the same subject. */
const OVERLAP_WORDS = 2

export function buildConsolidationReport(
  posts: PostStat[],
  opts: { ageMonths?: number | null; now?: Date; statsAvailable: boolean },
): ConsolidationReport {
  // Without Search Console there is no evidence any post is weak, and a list
  // built on an absence of data would be a list of guesses presented as
  // findings.
  if (!opts.statsAvailable) {
    return {
      candidates: [], tooYoung: 0, working: 0, judgedByEvidence: 0, groups: [],
      note: 'Connect Google Search Console to see which posts are doing nothing. Without it MVP can see what you published but not whether anyone found it, and guessing at that would be worse than not saying.',
    }
  }

  const now = opts.now ?? new Date()
  const grace = graceDays(opts.ageMonths)
  const graceMs = grace * 86_400_000

  // The publish date of the newest post Google has actually shown. Anything
  // published on or before it has demonstrably been crawled past.
  let newestIndexed: number | null = null
  for (const p of posts) {
    if (Number(p.impressions ?? 0) <= 0) continue
    const t = p.publishedAt ? new Date(p.publishedAt).getTime() : NaN
    if (!Number.isFinite(t)) continue
    if (newestIndexed == null || t > newestIndexed) newestIndexed = t
  }

  let tooYoung = 0
  let working = 0
  let judgedByEvidence = 0
  const candidates: Candidate[] = []

  for (const p of posts) {
    const t = p.publishedAt ? new Date(p.publishedAt).getTime() : NaN
    // A post with no publish date cannot be aged, and guessing would put real
    // work on a delete list. Left out of every bucket rather than assumed old.
    if (!Number.isFinite(t)) continue
    if (!hasHadItsChance(t, now.getTime(), graceMs, newestIndexed)) { tooYoung++; continue }
    // Inside the window, but Google indexed something published after it.
    const byEvidence = now.getTime() - t < graceMs
    if (byEvidence) judgedByEvidence++

    const impressions = Math.max(0, Number(p.impressions ?? 0))
    const clicks = Math.max(0, Number(p.clicks ?? 0))

    if (clicks > 0) { working++; continue }

    let weakness: Weakness
    let reason: string
    if (impressions === 0) {
      weakness = 'never-shown'
      const days = Math.floor((now.getTime() - t) / 86_400_000)
      reason = byEvidence
        ? `Published ${days} days ago and never shown to anyone, while Google HAS indexed posts you published after it. It was not missed, it was crawled past. It is not competing for anything, so folding it into a stronger post on the same subject loses nothing and gives that post more to work with.`
        : `Published ${days} days ago and Google has never shown it to anyone. It is not competing for anything, so folding it into a stronger post on the same subject loses nothing and gives that post more to work with.`
    } else if (p.words < THIN_WORDS) {
      weakness = 'thin'
      reason = `Shown ${impressions.toLocaleString()} times with no clicks, and only ${p.words.toLocaleString()} words. Google is putting it in front of people and they are choosing something else, which on a post this short is usually because there is not enough here to be the best answer.`
    } else {
      weakness = 'shown-never-clicked'
      reason = `Shown ${impressions.toLocaleString()} times and never clicked. This one is ranking, so do NOT merge it away. It is the title and description people are reading in the results and passing over, which is a much quicker fix than ranking.`
    }

    candidates.push({
      id: p.id, title: p.title, url: p.url, publishedAt: p.publishedAt,
      words: p.words, impressions, clicks, weakness, reason, overlapsWith: [],
    })
  }

  // Group the mergeable ones by subject. Only 'never-shown' posts are grouped:
  // a post that ranks must never appear in a merge suggestion, because merging
  // it away throws out a ranking the creator already has.
  const mergeable = candidates.filter(c => c.weakness !== 'shown-never-clicked')
  const groups: ConsolidationReport['groups'] = []
  const claimed = new Set<string>()

  for (let i = 0; i < mergeable.length; i++) {
    const a = mergeable[i]
    if (claimed.has(a.id)) continue
    const aWords = new Set(titleKeywords(a.title))
    const members = [a]
    for (let j = i + 1; j < mergeable.length; j++) {
      const b = mergeable[j]
      if (claimed.has(b.id)) continue
      const shared = titleKeywords(b.title).filter(w => aWords.has(w))
      if (new Set(shared).size >= OVERLAP_WORDS) members.push(b)
    }
    if (members.length < 2) continue
    for (const m of members) claimed.add(m.id)
    const aKeys = [...aWords]
    groups.push({
      key: aKeys.slice(0, 3).join(' ') || a.title.slice(0, 40),
      ids: members.map(m => m.id),
      titles: members.map(m => m.title),
    })
  }

  // Record the overlaps on the candidates themselves so a row can say it
  // without the caller re-deriving the grouping.
  const byId = new Map(candidates.map(c => [c.id, c]))
  for (const g of groups) {
    for (const id of g.ids) {
      const c = byId.get(id)
      if (c) c.overlapsWith = g.ids.filter(x => x !== id)
    }
  }

  groups.sort((a, b) => b.ids.length - a.ids.length)
  candidates.sort((a, b) => a.impressions - b.impressions || b.words - a.words)

  const neverShown = candidates.filter(c => c.weakness === 'never-shown').length
  const note = candidates.length === 0
    ? (tooYoung > 0
      ? `Nothing to consolidate. ${tooYoung.toLocaleString()} ${tooYoung === 1 ? 'post is' : 'posts are'} still inside the ${grace} day window where silence means nothing yet, so they were not judged.`
      : 'Nothing to consolidate. Every post old enough to judge is getting clicks.')
    : `${candidates.length.toLocaleString()} posts are earning nothing.${judgedByEvidence > 0 ? ` ${judgedByEvidence.toLocaleString()} of them are newer than the ${grace} day window but counted anyway, because Google has indexed posts you published after them: those were crawled past rather than missed.` : ''} ${neverShown.toLocaleString()} of them have never been shown to anyone at all. ${tooYoung > 0 ? `A further ${tooYoung.toLocaleString()} are still inside the ${grace} day window and were not judged. ` : ''}Merging the weakest into your strongest post on the same subject, and redirecting the old URLs to it, gives Google one good page instead of several it has already passed over.`

  return { candidates, tooYoung, working, judgedByEvidence, groups, note }
}
