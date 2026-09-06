// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The campaigns you joined, and what came of them.
//
// Joining a Creator Connections campaign is a commitment with a clock on it. It
// does not get you a sample, the message you send asks for that. It does not get
// you paid either. What it does is make the campaign's boosted commission apply
// to content you publish while the window is open. So a joined campaign with no
// content is worth exactly nothing, and a joined campaign whose window closed
// before you made anything is worth nothing for good.
//
// MVP used to accept campaigns silently, in bulk, as a side effect of sending a
// message. Someone could end a session joined to thirty-four campaigns they
// never chose, with no record of it and no idea which ones still mattered. This
// is the other half of fixing that: joining is now a deliberate act, and this is
// where the creator sees what they took on.
//
// The list is ordered as a work queue rather than an inventory. The first row is
// the thing to make next: still open, nothing published, closing soonest. That
// is the whole point of the page, and every other sort order buries it.
//
// Two rules it will not break.
//
// It never says a campaign earned money. Amazon reports earnings per PRODUCT,
// across every link the creator has anywhere, and does not say which post,
// video or storefront shelf sent the buyer. So the wording credits the product,
// which is what the data says, and never the campaign or the post.
//
// It never scolds someone for a campaign with no deadline. Amazon leaves the end
// date off often enough that treating a missing date as urgency would invent a
// panic out of a blank field.

import { campaignRunway, type BestRoute, type Runway } from './campaign-runway'

export type ContentKind = 'blog' | 'youtube' | 'amazon-video' | 'social'

export interface ContentPiece {
  kind: ContentKind
  url: string | null
  title: string | null
  /** ISO date the piece went live, when known. Null is common and never
   *  interpreted as "published late". */
  at: string | null
}

/**
 * What the product itself looks like, for deciding whether it is worth making
 * something for. A high commission on a product nobody buys is not an
 * opportunity, and this is the difference between the two.
 *
 * Every field is nullable and every null means "not known", never zero. A
 * product with no rating is not a badly rated product.
 */
export interface ProductSignals {
  priceAvgCents: number | null
  priceLowestCents: number | null
  discountPct: number | null
  /** Keepa's read on the current price against its own history. */
  dealQuality: string | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  salesRank: number | null
  salesRankCategory: string | null
}

export interface JoinedCampaign {
  asin: string
  campaignId: string | null
  brand: string | null
  product: string | null
  imageUrl: string | null
  commissionPct: number | null
  priceCents: number | null
  startsAt: string | null
  endsAt: string | null
  /** When the creator joined. Null for campaigns joined on Amazon directly,
   *  which MVP learns about from the sync rather than from having done it. */
  joinedAt: string | null
  /** True when MVP performed the accept itself.
   *
   *  Worth keeping straight, because for a long time MVP accepted a campaign as a
   *  side effect of sending a bulk message, without asking. A creator looking at
   *  a list of hundreds is entitled to know how many of them were their own
   *  decision. MVP writes a ledger row every time it accepts and never writes one
   *  for a campaign found on Amazon, so this is a record rather than a guess. */
  joinedByMvp?: boolean
  messagedAt: string | null
  detailsUrl: string | null
  content: ContentPiece[]
  /** How the product itself is doing. Null when nothing is known about it. */
  signals?: ProductSignals | null
  /** What Amazon reported for this ASIN. Null means Amazon has not been synced,
   *  which is a different fact from Amazon reporting nothing. */
  earned: { clicks: number | null; orders: number | null; cents: number | null } | null
}

/** Green, red and the two states a two-colour view would have to lie about. */
export type CampaignState =
  | 'earning'  // content exists and Amazon has paid on the product
  | 'made'     // content exists
  | 'due'      // window still open, nothing published
  | 'missed'   // window closed, nothing was ever published

export interface LibraryRow extends JoinedCampaign {
  state: CampaignState
  /** Whole days until the window closes. Negative once it has. Null when Amazon
   *  gave no end date, which is not the same as no deadline. */
  daysLeft: number | null
  /** Commission on one sale at the listed price, in cents. Null unless both the
   *  price and the rate are known, because half of that sum is not a number. */
  perSaleCents: number | null
  /** False only when every piece is dated and every one of them landed after the
   *  window closed. Null when nothing is dated. */
  madeInWindow: boolean | null
  /** What the remaining time is good for. The reason a campaign closing in three
   *  days is urgent and almost worthless at the same time. */
  runway: Runway
  note: string
}

export interface CampaignLibrary {
  rows: LibraryRow[]
  summary: {
    joined: number
    made: number
    due: number
    missed: number
    earning: number
    /** Open, nothing published, and a week or less left. */
    urgent: number
    /** How many of these MVP accepted itself, rather than the creator accepting
     *  on Amazon or through a deliberate press here. */
    joinedByMvp: number
    /** Open, nothing published, split by what the remaining time can carry. */
    routes: Record<BestRoute, number>
    /** Amazon's total across the products in this list, or null when unsynced. */
    earnedCents: number | null
  }
  verdict: string
  doThis: string
}

/** A week is where "later" stops being a real option. */
const SOON_DAYS = 7

const DAY = 86400000

/** Whole days from today to an ISO date, in UTC so a timezone cannot move a
 *  deadline by one day in either direction. */
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso)
  if (isNaN(then.getTime())) return null
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate())
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((a - b) / DAY)
}

const money = (cents: number) =>
  cents % 100 === 0 ? `$${(cents / 100).toLocaleString()}` : `$${(cents / 100).toFixed(2)}`

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const KIND_LABEL: Record<ContentKind, string> = {
  blog: 'blog post',
  youtube: 'YouTube video',
  'amazon-video': 'Amazon video',
  social: 'social post',
}

/** "a blog post and 2 Amazon videos", in a fixed order so the same library reads
 *  the same way twice. */
function describeContent(content: ContentPiece[]): string {
  const order: ContentKind[] = ['blog', 'amazon-video', 'youtube', 'social']
  const parts: string[] = []
  for (const kind of order) {
    const n = content.filter(c => c.kind === kind).length
    if (n > 0) parts.push(plural(n, KIND_LABEL[kind]))
  }
  if (parts.length <= 1) return parts[0] || ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Did anything land while the boost applied?
 *
 * Only answers false when every dated piece missed the window, because one post
 * inside it is enough for the campaign to have done its job. Undated pieces are
 * left out of the judgement rather than assumed to be late.
 */
export function madeInWindow(c: JoinedCampaign): boolean | null {
  if (!c.content.length) return null
  const dated = c.content.filter(p => p.at && !isNaN(new Date(p.at).getTime()))
  if (!dated.length || !c.endsAt) return null
  const end = new Date(c.endsAt.length <= 10 ? `${c.endsAt}T23:59:59Z` : c.endsAt).getTime()
  const start = c.startsAt ? new Date(c.startsAt.length <= 10 ? `${c.startsAt}T00:00:00Z` : c.startsAt).getTime() : null
  return dated.some(p => {
    const t = new Date(p.at as string).getTime()
    return t <= end && (start == null || t >= start)
  })
}

function stateOf(c: JoinedCampaign, daysLeft: number | null): CampaignState {
  const has = c.content.length > 0
  const paid = (c.earned?.cents ?? 0) > 0
  if (has) return paid ? 'earning' : 'made'
  // A missing end date is not an expiry. Amazon leaves it off often enough that
  // reading a blank as "closed" would file live campaigns under regret.
  const closed = daysLeft != null && daysLeft < 0
  return closed ? 'missed' : 'due'
}

function noteFor(row: Omit<LibraryRow, 'note'>): string {
  const { state, daysLeft, content, earned } = row
  const made = describeContent(content)
  if (state === 'earning') {
    const paid = money(earned?.cents ?? 0)
    const orders = earned?.orders ?? null
    // The product, not the post. Amazon does not say which link sent the buyer.
    return `${made} published. Amazon has paid ${paid} on this product${orders ? ` across ${plural(orders, 'order')}` : ''}.`
  }
  if (state === 'made') {
    if (row.madeInWindow === false) {
      return `${made} published, but after the campaign window closed, so the boosted rate did not apply to it.`
    }
    const clicks = earned?.clicks ?? null
    if (clicks != null && clicks > 0) return `${made} published. ${plural(clicks, 'click')} on this product so far, no sale yet.`
    return `${made} published. Nothing from Amazon on this product yet.`
  }
  // The days left are in the runway sentence already, and it says what they are
  // good for, which is the part that decides what to make.
  if (state === 'due') return `Nothing published for it yet. ${row.runway.headline}`
  const ago = daysLeft == null ? null : Math.abs(daysLeft)
  return ago == null
    ? 'The window closed with nothing published for it.'
    : `Closed ${plural(ago, 'day')} ago with nothing published for it.`
}

/** Work queue order: the thing to make next, first. */
const STATE_RANK: Record<CampaignState, number> = { due: 0, made: 1, earning: 2, missed: 3 }

/**
 * What the remaining time can still carry, best first.
 *
 * Sorting the queue by deadline alone put the wrong row on top. A campaign
 * closing in three days is the most urgent and close to the least valuable:
 * nothing can be filmed, delivered and seen in three days. A campaign with three
 * weeks left is where the work actually pays, and it is quietly decaying towards
 * the useless band while the dying one sits above it.
 *
 * So the bands come first. Both video bands share a rank because they call for
 * the same action, and inside a band the one closing soonest leads, because that
 * is the one about to fall out of it.
 */
const ROUTE_RANK: Record<BestRoute, number> = { 'video-long': 0, video: 0, 'social-now': 1, unknown: 2, closed: 3 }

function compare(a: LibraryRow, b: LibraryRow): number {
  if (STATE_RANK[a.state] !== STATE_RANK[b.state]) return STATE_RANK[a.state] - STATE_RANK[b.state]
  if (a.state === 'due') {
    const ar = ROUTE_RANK[a.runway.best]
    const br = ROUTE_RANK[b.runway.best]
    if (ar !== br) return ar - br
    // A campaign with no end date is not urgent and must not push a dated one
    // down the list, so it sorts after every dated row.
    const ad = a.daysLeft ?? Number.POSITIVE_INFINITY
    const bd = b.daysLeft ?? Number.POSITIVE_INFINITY
    if (ad !== bd) return ad - bd
    return (b.perSaleCents ?? 0) - (a.perSaleCents ?? 0)
  }
  if (a.state === 'earning') return (b.earned?.cents ?? 0) - (a.earned?.cents ?? 0)
  if (a.state === 'missed') return (b.daysLeft ?? 0) - (a.daysLeft ?? 0)
  return (b.perSaleCents ?? 0) - (a.perSaleCents ?? 0)
}

export function buildCampaignLibrary(campaigns: JoinedCampaign[], now: Date = new Date()): CampaignLibrary {
  const rows: LibraryRow[] = campaigns.map(c => {
    const daysLeft = daysUntil(c.endsAt, now)
    const perSaleCents = c.priceCents != null && c.commissionPct != null && c.priceCents > 0 && c.commissionPct > 0
      ? Math.round(c.priceCents * (c.commissionPct / 100))
      : null
    // A creator who has already published for this product plainly has it, so the
    // sample wait does not apply to making another piece for it.
    const ownsProduct = c.content.some(p => p.kind === 'amazon-video' || p.kind === 'youtube')
    const partial = {
      ...c, state: stateOf(c, daysLeft), daysLeft, perSaleCents,
      madeInWindow: madeInWindow(c), runway: campaignRunway(daysLeft, { ownsProduct }),
    }
    return { ...partial, note: noteFor(partial) }
  })
  rows.sort(compare)

  const count = (s: CampaignState) => rows.filter(r => r.state === s).length
  const made = count('made') + count('earning')
  const due = count('due')
  const missed = count('missed')
  const earning = count('earning')
  const urgent = rows.filter(r => r.state === 'due' && r.daysLeft != null && r.daysLeft <= SOON_DAYS).length
  const anyEarnings = rows.some(r => r.earned != null)
  const earnedCents = anyEarnings ? rows.reduce((a, r) => a + (r.earned?.cents ?? 0), 0) : null

  const routes: Record<BestRoute, number> = { 'video-long': 0, video: 0, 'social-now': 0, unknown: 0, closed: 0 }
  for (const r of rows) if (r.state === 'due') routes[r.runway.best]++

  const joinedByMvp = rows.filter(r => r.joinedByMvp).length
  const summary = { joined: rows.length, made, due, missed, earning, urgent, joinedByMvp, routes, earnedCents }

  if (!rows.length) {
    return {
      rows, summary,
      verdict: 'You have not joined any campaigns yet.',
      doThis: 'Joining is what makes a campaign’s boosted commission apply to what you publish. You can message any brand without joining, so join a campaign when you are ready to make something for it.',
    }
  }

  const first = rows[0]
  let verdict: string
  if (made === 0) {
    verdict = `You have joined ${plural(rows.length, 'campaign')} and published nothing for any of them yet.`
  } else if (due === 0 && missed === 0) {
    verdict = `Every campaign you have joined has content. ${made} of ${rows.length}.`
  } else {
    verdict = `You have joined ${plural(rows.length, 'campaign')}. ${made} ${made === 1 ? 'has' : 'have'} content, ${due} ${due === 1 ? 'is' : 'are'} still open with nothing published.`
  }
  if (missed > 0) {
    verdict += ` ${missed} closed before anything was made for ${missed === 1 ? 'it' : 'them'}.`
  }
  // Why the open ones matter, said once at the top rather than on every row.
  if (due > 0) verdict += ' A joined campaign pays nothing until something exists to link from.'

  let doThis: string
  if (due === 0) {
    doThis = missed > 0
      ? 'Nothing is waiting on you. The ones that closed empty are the argument for joining a campaign when you are ready to make something for it, rather than in bulk.'
      : 'Nothing is waiting on you. Join the next campaign when you have something you want to make for it.'
  } else {
    // Name the campaign, and name what its remaining time is actually good for.
    // "14 days left" tells someone to hurry; it does not tell them that a sample
    // cannot arrive in 14 days and that the only thing that still reaches a buyer
    // inside that window is a social post.
    const name = first.product || first.brand || first.asin
    const worth = first.perSaleCents != null ? ` at ${money(first.perSaleCents)} a sale` : ''
    const make =
      first.runway.best === 'video-long' ? 'Ask for the sample and film it. A window this long means that one video keeps selling for weeks.'
      : first.runway.best === 'video' ? 'Ask for the sample now and film it. It usually arrives in a few days, which is the only route fast enough for a window this size.'
      : first.runway.best === 'social-now' ? 'Only a social post can land in time. If you cannot post today, spend the effort on one of the longer campaigns instead.'
      : 'Check its window on Amazon first, because there is no end date to plan around.'
    doThis = `Start with ${name}${worth}. ${make}`
    const videoRoom = routes.video + routes['video-long']
    if (videoRoom > 0 && first.runway.best !== 'video' && first.runway.best !== 'video-long') {
      doThis += ` ${plural(videoRoom, 'campaign')} still ${videoRoom === 1 ? 'has' : 'have'} room for a video, which is the better use of the time.`
    }
    // When most of the list has no end date, that IS the finding. Everything this
    // page decides comes from the window, so without one it cannot say which
    // campaign is worth the work, and quietly ranking them anyway would be
    // pretending to know. Say it once, plainly, instead of printing "no end date"
    // seven hundred times and leaving the creator to draw the conclusion.
    if (routes.unknown > due / 2) {
      doThis = `Amazon gave no end date for ${routes.unknown} of the ${plural(due, 'campaign')} waiting on you, and the time left is what decides whether a video, a post or a social push is worth making. Until those windows are known this list can only tell you what you joined, not what to do about it. ${doThis}`
    }
  }

  return { rows, summary, verdict, doThis }
}
