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

export type TrybeStatus = 'new' | 'not_fit' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already' | 'removed'
export const STATUSES: TrybeStatus[] = ['new', 'not_fit', 'drafted', 'sending', 'sent', 'failed', 'skipped', 'already', 'removed']

// ── WHAT THE CREATOR WANTS (Seb, 2026-10-06: "not just blindly message all
// brands") ─────────────────────────────────────────────────────────────────
// Categories and keywords. SCOUT uses them to search TRYBE; MVP then judges
// each brand found against them from its TRYBE profile and its website, and
// only brands that fit reach the list and Ready to send.

/** How many brands a day MVP and SCOUT find and draft for the queue. */
export const DAILY_FIND = 20
/** How many unseen brands SCOUT reads in one search, so enough fit. */
export const SCAN_READ = 40

/** Categories offered as chips before any brand is read. TRYBE's own
 *  categories from the brands found are added to these on the page. */
export const CATEGORY_SUGGESTIONS = [
  'Beauty', 'Skincare', 'Hair Care', 'Health & Wellness', 'Supplements', 'Fitness',
  'Home', 'Kitchen', 'Food & Beverage', 'Pets', 'Baby & Kids', 'Fashion',
  'Jewelry & Accessories', 'Tech & Gadgets', 'Outdoors', 'Travel', 'Books & Education',
  'Faith', 'Crafts & Hobbies', 'Cleaning', 'Sleep', 'Personal Care',
]

/** A list of short terms from the page: trimmed, de-duplicated, capped. */
export function cleanTerms(raw: unknown, max = 12): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out: string[] = []
  for (const v of list) {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** The preferences a fit was judged against, as one comparable string. A
 *  brand judged under other preferences is judged again. */
export function prefsKey(categories: string[], keywords: string[]): string {
  const k = (a: string[]) => a.map(s => s.toLowerCase()).sort().join('|')
  return `${k(categories)}#${k(keywords)}`
}

export interface FitInput {
  id: string
  name: string
  categories: string[]
  about: string | null
  siteSummary: string
  siteProducts: string[]
}
export interface FitVerdict { id: string; fit: boolean; score: number; reason: string }

export const FIT_SYSTEM = `You decide which brands on TRYBE, a marketplace where brands pay creators for UGC videos, are worth a creator's outreach. The creator told you the categories and keywords they want to work in.

For each brand, judge from its TRYBE categories, its TRYBE about text and what its own website sells:
- fit: true only when what the brand actually sells sits inside one of the creator's categories or matches one of the keywords. A loose or one-word overlap is not a fit.
- score: 0 to 100, how strong the fit is.
- reason: one short sentence naming what the brand sells and why it does or does not fit. No dashes.

Use only the facts given. When the website could not be read, judge from TRYBE alone and say so in the reason.
Reply with ONLY a JSON array: [{"id":"...","fit":true,"score":80,"reason":"..."}], one entry per brand, same ids.`

export function fitUserPrompt(categories: string[], keywords: string[], brands: FitInput[]): string {
  const want = [
    categories.length ? `Categories: ${categories.join(', ')}` : '',
    keywords.length ? `Keywords: ${keywords.join(', ')}` : '',
  ].filter(Boolean).join('\n')
  const list = brands.map(b => [
    `id: ${b.id}`,
    `Name: ${b.name}`,
    b.categories.length ? `TRYBE categories: ${b.categories.join(', ')}` : '',
    b.about ? `TRYBE about: ${b.about.slice(0, 500)}` : '',
    b.siteProducts.length ? `Products on their website: ${b.siteProducts.slice(0, 10).join(' | ')}` : '',
    b.siteSummary ? `Website: ${b.siteSummary.slice(0, 900)}` : '(website not read)',
  ].filter(Boolean).join('\n')).join('\n\n')
  return `--- THE CREATOR WANTS ---\n${want}\n\n--- BRANDS ---\n${list}`
}

/** The model's verdicts, checked: one per brand asked about, nothing else.
 *  A brand the answer left out gets no verdict (and is asked about again). */
export function parseFit(text: string, ids: string[]): FitVerdict[] {
  const m = String(text || '').match(/\[[\s\S]*\]/)
  if (!m) return []
  let arr: unknown
  try { arr = JSON.parse(m[0]) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const out: FitVerdict[] = []
  for (const v of arr) {
    const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const id = String(r.id ?? '')
    if (!ids.includes(id) || out.some(o => o.id === id)) continue
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)))
    out.push({ id, fit: r.fit === true, score, reason: String(r.reason ?? '').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, 240) })
  }
  return out
}

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
export function tidyDraft(text: string, max = 1000): string {
  // LINE BREAKS ARE KEPT: paragraphs and the sign-off's own lines go out as
  // written. Only runs of blank lines and stray spaces at line ends go.
  let t = String(text || '')
    .replace(/\r\n?/g, '\n')
    // TRYBE shows plain text: a markdown link goes out as its address.
    .replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g, '$2')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .replace(/ +- +/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
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

// THE CREATOR'S OWN WORDS (Seb, 2026-10-07: "those are not good messages
// out to brands"). Drafts that rebuilt the message around the brand's catalog
// read like a scraper: "FloofyPups covers everything a dog parent reaches for
// daily, from the ZoomieBall and Quack Snack puzzle feeder to...". A cold
// first message is the creator's core message nearly word for word, with a
// short warm greeting to the brand by name on top and a sign-off. Seb's model:
//
//   Hi (BRAND NAME), we're excited to be focusing on Trybe and so glad to
//   have found you here.
//
//   <core message, paragraph by paragraph, brand name swapped in>
//
//   Speak soon,
//   Seb and Michelle
export const DRAFT_SYSTEM = (bannedRule: string) => `You write the first message a content creator sends to a brand on TRYBE, a marketplace where brands pay creators for UGC videos. The brand reads this one message and decides whether to accept the creator.

The creator wrote a CORE MESSAGE. It is their message in their own voice, and the brand gets it nearly word for word. Your part is small:
1. Open with one short, warm greeting line to the brand by name, the way a person writes on TRYBE. For example: "Hi Gnawnu, we're excited to be focusing on TRYBE and so glad to have found you here." Word it a little differently from brand to brand. It may name in a few plain words what the brand makes ("your dog toys"), but never list products, never describe their catalog or website back to them, and never single out one product.
2. Then the core message as written: the same sentences, in the same order, with the same claims and links. Change only these:
   - a brand name in it that is not this brand (it was written for another brand): use this brand's name;
   - a product category in it that does not fit this brand (for example "pet products" for a kitchen brand): name this brand's kind of product instead;
   - a phrase like "your brand" may become this brand's name.
   Do not reword, shorten, reorder or add to anything else.
3. If the core message ends with a sign-off, keep it word for word on its own lines. If it has none and the creator facts give the creator's name, end with "Speak soon," and the name on the next line. Never invent a name.
Use the core message's voice: "we" if it says we, "I" if it says I.
Layout: a blank line between the greeting, each paragraph of the core message, and the sign-off. Keep the core message's own line breaks. Write links as plain URLs, never [text](url).
Plain text: no subject line, no hashtags, no markdown, no emoji unless the core message has them. NEVER invent facts: no numbers, results or claims beyond the core message and creator facts. Never write a year.
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
    b.siteProducts.length ? `Some products on their website (only to know what kind of brand this is, never to list): ${b.siteProducts.slice(0, 8).join(' | ')}` : '',
    b.siteSummary ? `From their website (background only):\n${b.siteSummary.slice(0, 600)}` : '(Their website could not be read. Work from the TRYBE details only, and do not pretend to know their products.)',
  ].filter(Boolean)
  return `--- CORE MESSAGE ---\n${f.coreMessage.trim()}\n\n--- CREATOR FACTS ---\n${f.creator.length ? f.creator.join('\n') : '(none beyond the core message)'}\n\n--- BRAND ---\n${brandLines.join('\n')}`
}
