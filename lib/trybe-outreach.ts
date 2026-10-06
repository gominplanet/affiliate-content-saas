// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE outreach (Labs): the rules, kept apart from the route so they can be
// tested without a database.
//
// THE BRAKES. The creator has sent 40 to 50 requests by hand back to back with
// no trouble, but a tool doing it is held to a slower, steadier pace:
//   - a daily cap, 20 to start (settings allow 1 to 50), counted over the LAST
//     24 HOURS, not since midnight, so a batch at 11pm and another at 1am can
//     never add up to twice the cap;
//   - a send MVP started and never heard back about counts toward the cap, so
//     a lost answer can only make it send fewer, never more;
//   - a random wait of 45 to 120 seconds between two requests, with a longer
//     pause every few, so the rhythm never looks like a script.

export const DEFAULT_DAILY_CAP = 20
export const MAX_DAILY_CAP = 50
export const MIN_GAP_MS = 45_000
export const MAX_GAP_MS = 120_000
/** After this many sends in one run, one longer pause. */
export const BREAK_EVERY = 5
export const BREAK_MS: [number, number] = [180_000, 300_000]

export type TrybeStatus = 'new' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already'
export const STATUSES: TrybeStatus[] = ['new', 'drafted', 'sending', 'sent', 'failed', 'skipped', 'already']

export function clampCap(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULT_DAILY_CAP
  return Math.min(MAX_DAILY_CAP, Math.max(1, v))
}

/** Requests that count toward the cap: seen sent, or started and unanswered. */
export function countsTowardCap(row: { status: string; send_started_at: string | null }, now: number): boolean {
  if (row.status !== 'sent' && row.status !== 'sending') return false
  if (!row.send_started_at) return false
  const t = Date.parse(row.send_started_at)
  return Number.isFinite(t) && now - t < 24 * 3600_000
}

/** The wait before the next request, in ms. `sentThisRun` is how many have
 *  gone in this run so far. */
export function nextGapMs(sentThisRun: number, rand: () => number = Math.random): number {
  const span = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo))
  if (sentThisRun > 0 && sentThisRun % BREAK_EVERY === 0) return span(BREAK_MS[0], BREAK_MS[1])
  return span(MIN_GAP_MS, MAX_GAP_MS)
}

/** One brand as SCOUT read it from TRYBE. Everything is untrusted page text,
 *  so each field is coerced and capped. */
export interface ScannedBrand {
  brandId: string
  name: string
  categories: string[]
  brandUrl: string | null
  website: string | null
  about: string | null
  payText: string | null
  rating: number | null
  reviews: number | null
  creatorEarnings: string | null
  totalCreators: number | null
  trybeScore: number | null
  alreadyRequested: boolean
}

const str = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : null
}
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}
const httpsUrl = (v: unknown, host?: RegExp): string | null => {
  const s = str(v, 600)
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (host && !host.test(u.hostname)) return null
    return u.toString()
  } catch { return null }
}

export function sanitizeScanned(raw: unknown): ScannedBrand | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const brandId = str(r.brandId, 80)
  const name = str(r.name, 120)
  if (!brandId || !/^[A-Za-z0-9-]{6,80}$/.test(brandId) || !name) return null
  const cats = Array.isArray(r.categories) ? r.categories.map(c => str(c, 60)).filter((c): c is string => !!c).slice(0, 8) : []
  return {
    brandId,
    name,
    categories: cats,
    // Only a TRYBE address is ever opened for a send.
    brandUrl: httpsUrl(r.brandUrl, /(^|\.)jointrybe\.com$/i),
    website: httpsUrl(r.website),
    about: str(r.about, 2000),
    payText: str(r.payText, 120),
    rating: num(r.rating),
    reviews: num(r.reviews) == null ? null : Math.round(num(r.reviews) as number),
    creatorEarnings: str(r.creatorEarnings, 40),
    totalCreators: num(r.totalCreators) == null ? null : Math.round(num(r.totalCreators) as number),
    trybeScore: num(r.trybeScore) == null ? null : Math.round(num(r.trybeScore) as number),
    alreadyRequested: r.alreadyRequested === true,
  }
}

/** The send address for a brand: its own discover link when SCOUT saw one,
 *  else the discover page with the brand id (SCOUT finds it by name there). */
export function sendUrl(brandId: string, brandUrl: string | null): string {
  if (brandUrl) return brandUrl
  return `https://jointrybe.com/creator/discover?brand=${encodeURIComponent(brandId)}`
}

/** Last pass over a draft. The prompt asks for the same; this makes sure. */
export function tidyDraft(text: string, max = 900): string {
  let t = String(text || '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/ +- +/g, ', ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (t.length > max) {
    const cut = t.slice(0, max)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'))
    t = (end > max * 0.6 ? cut.slice(0, end + 1) : cut).trim()
  }
  return t
}

export interface DraftFacts {
  coreMessage: string
  creator: string[]
  brand: {
    name: string
    categories: string[]
    about: string | null
    payText: string | null
    website: string | null
    siteSummary: string
    siteProducts: string[]
  }
}

export const DRAFT_SYSTEM = (bannedRule: string) => `You write the first message a content creator sends to a brand on TRYBE, a marketplace where brands pay creators for UGC videos. The brand reads this one message and decides whether to accept the creator.

You are given the creator's CORE MESSAGE. Keep its points, its offer and its voice. Rewrite it for this one brand:
- Open by naming something real and specific about this brand: a product by name from its website, or what it makes. Never a compliment that could fit any brand.
- Connect the creator to that product in one sentence, using only the creator facts given.
- Keep the core message's call to action.
- 350 to 700 characters. Plain text, first person, no subject line, no greeting with a placeholder, no markdown, no hashtags, no links unless the core message or the creator facts contain them.
- NEVER invent facts: no follower counts, results, past work or claims not in the core message or creator facts.
- Never write a year.
${bannedRule}
Output ONLY the message.`

export function draftUserPrompt(f: DraftFacts): string {
  const b = f.brand
  const brandLines = [
    `Name: ${b.name}`,
    b.categories.length ? `TRYBE categories: ${b.categories.join(', ')}` : '',
    b.payText ? `TRYBE pay: ${b.payText}` : '',
    b.about ? `TRYBE about: ${b.about.slice(0, 800)}` : '',
    b.website ? `Website: ${b.website}` : '',
    b.siteProducts.length ? `Products on their website: ${b.siteProducts.slice(0, 12).join(' | ')}` : '',
    b.siteSummary ? `From their website:\n${b.siteSummary}` : '(Their website could not be read. Work from the TRYBE details only, and do not pretend to know their products.)',
  ].filter(Boolean)
  return `--- CORE MESSAGE ---\n${f.coreMessage.trim()}\n\n--- CREATOR FACTS ---\n${f.creator.length ? f.creator.join('\n') : '(none beyond the core message)'}\n\n--- BRAND ---\n${brandLines.join('\n')}`
}
