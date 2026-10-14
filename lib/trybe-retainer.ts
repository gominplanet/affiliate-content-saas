// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// RETAINERS (Seb, 2026-10-14: "build 1, 2, 3, and 4", after six TRYBE
// strategy videos; retainers came up in four of them). Colin Reich's way:
// after about a month of steady volume for a brand that pays you, ask for a
// smart retainer ("$1,000 for 30 videos in 30 days": the brand tops up your
// commission to that amount). MVP sees when a brand is ready, drafts the ask
// from your real numbers for YOU to send (it is never sent for you, and it is
// the one message where money is yours to raise), and tracks the deal once
// the brand says yes: videos due, days left, and the top up.
// Pure, so it is tested (scripts/test-trybe-retainer).

export interface Brand30 { id: string; name: string; submitted: number | null; approved: number | null; earnings: number | null }

/** Ready to ask: in the last 30 days at least this many videos sent, at
 *  least RETAINER_MIN_APPROVED approved, and paid something. */
export const RETAINER_MIN_VIDEOS = 25
export const RETAINER_MIN_APPROVED = 10
export const RETAINER_DAYS = 30

export interface Readiness { ready: boolean; why: string }

export function retainerReady(b: Brand30): Readiness {
  const sent = b.submitted ?? 0, ok = b.approved ?? 0, paid = b.earnings ?? 0
  if (b.submitted == null && b.approved == null) return { ready: false, why: 'TRYBE did not say how many videos you sent this brand.' }
  if (sent >= RETAINER_MIN_VIDEOS && ok >= RETAINER_MIN_APPROVED && paid > 0) {
    return { ready: true, why: `${sent} videos in 30 days, ${ok} approved, and it pays you: you have shown you deliver.` }
  }
  const need: string[] = []
  if (sent < RETAINER_MIN_VIDEOS) need.push(`${RETAINER_MIN_VIDEOS - sent} more videos`)
  if (ok < RETAINER_MIN_APPROVED) need.push(`${RETAINER_MIN_APPROVED - ok} more approved`)
  if (paid <= 0) need.push('a first payout')
  return { ready: false, why: `Not yet: ${need.join(', ')} in 30 days.` }
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** A starting amount for the ask: what this brand paid you in 30 days plus
 *  a fifth, rounded up to $100, never under $500. Yours to change. Pure. */
export function suggestAmount(earned30: number | null): number {
  const e = Math.max(0, earned30 ?? 0)
  return Math.max(500, Math.ceil((e * 1.2) / 100) * 100)
}

export type RetainerKind = 'smart' | 'standard'

/** The ask, in plain words, for you to send in the brand's TRYBE chat. Pure. */
export function retainerAsk(o: { brand: string; sent30: number; approved30: number; amount: number; videos: number; kind: RetainerKind }): string {
  const deal = o.kind === 'smart'
    ? `Something like ${money(o.amount)} for ${o.videos} videos over the next 30 days, with my commission counting toward it, so you only top up if my videos earn less than that.`
    : `Something like ${money(o.amount)} for ${o.videos} videos over the next 30 days, on top of my usual commission.`
  return [
    `Hi ${o.brand} team!`,
    `Over the last 30 days I sent you ${o.sent30} videos and ${o.approved30} were approved, and I would love to keep ${o.brand} as one of my main brands.`,
    `I am getting pulled in a lot of directions right now, and I work on ${o.kind === 'smart' ? 'smart retainers' : 'retainers'} with a few other brands. Would you be open to one with me?`,
    deal,
    'Happy to hop on a quick call or adjust the numbers. Thank you!',
  ].join(' ')
}

export interface Retainer { brandId: string; name: string; amount: number; videos: number; kind: RetainerKind; startedAt: string }

/** Saved retainers, read safely: at most 20, each with real numbers. Pure. */
export function readRetainers(v: unknown): Retainer[] {
  if (!Array.isArray(v)) return []
  const out: Retainer[] = []
  for (const x of v.slice(0, 20)) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const amount = Number(o.amount), videos = Number(o.videos), t = Date.parse(String(o.startedAt))
    const brandId = typeof o.brandId === 'string' ? o.brandId.slice(0, 80) : ''
    if (!brandId || !(amount > 0 && amount <= 1_000_000) || !(videos > 0 && videos <= 1000) || !Number.isFinite(t)) continue
    out.push({ brandId, name: String(o.name || 'A brand').slice(0, 120), amount: Math.round(amount), videos: Math.round(videos), kind: o.kind === 'standard' ? 'standard' : 'smart', startedAt: new Date(t).toISOString() })
  }
  return out
}

export interface Track { daysLeft: number; videosLeft: number | null; perDay: number | null; topUp: number | null; says: string; done: boolean }

/** Where a retainer stands: days left of 30, videos still due (from the
 *  videos you sent since it started, when read), and for a smart retainer
 *  the top up so far (the amount less what the brand paid you in the last
 *  30 days, when read). Pure. */
export function trackRetainer(r: Retainer, o: { sentSince: number | null; earned30: number | null; now?: number }): Track {
  const now = o.now ?? Date.now()
  const end = Date.parse(r.startedAt) + RETAINER_DAYS * 86_400_000
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86_400_000))
  const videosLeft = o.sentSince == null ? null : Math.max(0, r.videos - o.sentSince)
  const perDay = videosLeft == null ? null : daysLeft ? Math.ceil(videosLeft / daysLeft) : videosLeft
  const topUp = r.kind === 'smart' && o.earned30 != null ? Math.max(0, r.amount - o.earned30) : null
  const done = daysLeft === 0
  const parts: string[] = []
  if (done) parts.push('This 30 days is over: ask to renew if it went well.')
  else parts.push(`${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`)
  if (videosLeft != null) parts.push(videosLeft ? `${videosLeft} of ${r.videos} videos still due${!done && perDay ? `: about ${perDay} a day` : ''}.` : `All ${r.videos} videos sent.`)
  else parts.push(`MVP could not count your videos since it started; check them on TRYBE.`)
  if (topUp != null) parts.push(topUp ? `If it ended today the brand would top you up about ${money(topUp)}.` : 'Your commission already passed the amount: no top up needed.')
  return { daysLeft, videosLeft, perDay, topUp, says: parts.join(' '), done }
}
