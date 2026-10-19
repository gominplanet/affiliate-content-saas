// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE REFUND PER CREATOR (Seb, 2026-10-18), AND ONE FREE WEEK (2026-10-19).
//
// Members who joined between the end of the old free trial and the free week
// started with a 7-day refund, no questions asked (lib/guarantee), and keep
// it. Taken once, it is not available again to the same creator under a new
// account. The free week that replaced it is matched the same way, on the
// card and the email, the two things known at signup (priorFreeWeek).
// "The same creator" is matched on what MVP is useless without: their card,
// their YouTube channel, their Amazon Associates tag and storefront, and
// their email with the usual tricks taken out. A match does not stop anybody
// buying; it only means the refund is not offered twice, and the admin page
// shows which earlier refund it matched and on what.
//
// Pure: the admin route reads the rows and Stripe, and these decide.

import { FREE_WEEK_FROM, LEGACY_REFUND_DAYS as GUARANTEE_DAYS } from '@/lib/guarantee'

const DAY_MS = 24 * 60 * 60 * 1000

/** An email with case, Gmail dots and "+anything" taken out, so
 *  "Jane.Doe+mvp@gmail.com" and "janedoe@gmail.com" are one person. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return null
  let local = e.slice(0, at)
  let domain = e.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  local = local.split('+')[0]
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return local ? `${local}@${domain}` : null
}

/** An Associates tag, compared without case or spaces. */
export function normalizeTag(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '')
  return t || null
}

/** A storefront address reduced to its handle: amazon.com/shop/janedoe,
 *  www.amazon.com/shop/JaneDoe?ref=x and "janedoe" all become "janedoe". */
export function normalizeStorefront(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  const m = s.match(/\/shop\/([a-z0-9._-]+)/)
  if (m) return m[1]
  if (/^[a-z0-9._-]+$/.test(s)) return s
  return null
}

export interface CreatorIds {
  email: string | null
  card: string | null
  channel: string | null
  tag: string | null
  storefront: string | null
}

export interface RefundRow {
  user_id: string
  email_norm: string | null
  card_fingerprint: string | null
  youtube_channel_id: string | null
  amazon_tag: string | null
  storefront: string | null
  refunded_at: string
}

const LABEL: Record<keyof CreatorIds, string> = {
  email: 'the same email', card: 'the same card', channel: 'the same YouTube channel',
  tag: 'the same Amazon Associates tag', storefront: 'the same Amazon storefront',
}

/** Earlier refunds this creator matches, each with what matched, never
 *  counting this account's own row. Pure. */
export function priorRefunds(userId: string, ids: CreatorIds, rows: RefundRow[]): Array<{ row: RefundRow; on: string[] }> {
  const out: Array<{ row: RefundRow; on: string[] }> = []
  for (const r of rows) {
    if (r.user_id === userId) continue
    const on: string[] = []
    if (ids.email && r.email_norm === ids.email) on.push(LABEL.email)
    if (ids.card && r.card_fingerprint === ids.card) on.push(LABEL.card)
    if (ids.channel && r.youtube_channel_id === ids.channel) on.push(LABEL.channel)
    if (ids.tag && r.amazon_tag === ids.tag) on.push(LABEL.tag)
    if (ids.storefront && r.storefront === ids.storefront) on.push(LABEL.storefront)
    if (on.length) out.push({ row: r, on })
  }
  return out
}

export interface RefundCheck {
  eligible: boolean
  /** Which day of the window this is (1 to 7), or null when it cannot tell. */
  day: number | null
  /** Why not, in words, or the reason it is fine. */
  reason: string
}

/** Can this member have the refund? Pure.
 *  - `paidAtISO`: the first payment on this subscription.
 *  - `alreadyRefunded`: this account had it before.
 *  - `matches`: earlier refunds to the same creator (priorRefunds). */
export function refundCheck(o: {
  paidAtISO: string | null
  alreadyRefunded: boolean
  matches: Array<{ on: string[] }>
  now?: Date
}): RefundCheck {
  const now = o.now ?? new Date()
  const paid = Date.parse(String(o.paidAtISO ?? ''))
  const day = Number.isFinite(paid) ? Math.floor((now.getTime() - paid) / DAY_MS) + 1 : null
  if (o.alreadyRefunded) return { eligible: false, day, reason: 'This account has already had its refund.' }
  if (o.matches.length) {
    return { eligible: false, day, reason: `Refunded before under another account (${[...new Set(o.matches.flatMap((m) => m.on))].join(', ')}). One refund per creator.` }
  }
  if (day === null) return { eligible: false, day, reason: 'No payment found to refund.' }
  // Paid on or after the free week began: they joined with the free week (or
  // on the yearly plan), which replaced the refund.
  if (paid >= Date.parse(FREE_WEEK_FROM)) return { eligible: false, day, reason: 'Joined after the free week replaced the refund, so no refund was promised.' }
  if (day > GUARANTEE_DAYS) return { eligible: false, day, reason: `Day ${day}: the ${GUARANTEE_DAYS}-day window has closed.` }
  return { eligible: true, day, reason: `Day ${day} of ${GUARANTEE_DAYS}. Eligible.` }
}

/** A free week someone started: who, and the card and email they started it
 *  with (migration 444, creator_trials). */
export interface TrialRow {
  user_id: string
  email_norm: string | null
  card_fingerprint: string | null
}

/** Why this creator gets no free week, or null when they may have one. A
 *  free week before, or a refund under the old promise, on the same card or
 *  the same email, never counting this account's own rows. Pure. */
export function priorFreeWeek(userId: string, ids: { email: string | null; card: string | null }, trials: TrialRow[], refunds: RefundRow[]): string | null {
  for (const t of trials) {
    if (t.user_id === userId) continue
    if (ids.card && t.card_fingerprint === ids.card) return 'This card already had a free week on another account.'
    if (ids.email && t.email_norm === ids.email) return 'This email already had a free week on another account.'
  }
  const refunded = priorRefunds(userId, { email: ids.email, card: ids.card, channel: null, tag: null, storefront: null }, refunds)
  if (refunded.length) return `Refunded before under another account (${[...new Set(refunded.flatMap((m) => m.on))].join(', ')}).`
  return null
}
