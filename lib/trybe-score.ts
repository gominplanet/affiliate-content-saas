// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE'S OWN SCORE, IN ITS THREE PARTS (Seb, 2026-11-25, with arrae's TRYBE
// Score open: 46 overall; Submission reviews 16, slow; Launching ads 91,
// fast; Chat responsiveness 16, slow. "These do all have to be taken into
// consideration when MVP gives their recommendation." arrae was an MVP pick
// of 91.)
//
// The parts arrive with the brand details SCOUT reads from the creator's own
// TRYBE (/backend/api/creator/v2/brands/{id}/details). TRYBE does not publish
// its field names, so each part is found by what it means, inside a score
// object or a list of labelled scores, and only numbers that can be TRYBE's
// (0 to 100) count. A part not found stays unknown, never a guess.
//
// Pure, so it is tested (scripts/test-trybe-score.ts).

export interface TrybeScoreParts {
  /** Submission reviews: how fast it reviews the videos you send. */
  reviews: number | null
  /** Launching ads: how fast it runs approved videos as ads. */
  ads: number | null
  /** Chat responsiveness: how fast it answers messages. */
  chat: number | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? parseFloat(v) : NaN
  // A star rating (3.5 of 5) is not a part of 100: a fraction at 5 or under is
  // left out, so "reviewScore: 3.5" never reads as a review speed of 4.
  if (Number.isFinite(n) && n <= 5 && n % 1 !== 0) return null
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null
}

/** Which part a key or a label names. Pure. */
export function partOf(name: string): keyof TrybeScoreParts | null {
  const s = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  // Counts, totals, averages and stars are other numbers, whatever else the key says.
  if (/\b(count|total|stars?|average|avg)\b/.test(s)) return null
  if (/chat|respon|repl(y|ies)|messag|communicat/.test(s)) return 'chat'
  if (/submission|review|approv/.test(s)) return 'reviews'
  if (/launch|\bads?\b|advert/.test(s)) return 'ads'
  return null
}

const SCORE_KEY = /score|rating breakdown|breakdown|metrics/i

/** The three parts, from the brand details JSON, or null when none is there. Pure. */
export function readScoreParts(json: unknown): TrybeScoreParts | null {
  const out: TrybeScoreParts = { reviews: null, ads: null, chat: null }
  const set = (k: keyof TrybeScoreParts | null, v: unknown) => { const n = num(isObj(v) ? (v.value ?? v.score ?? v.percent) : v); if (k && n != null && out[k] == null) out[k] = n }
  // Look inside anything named like a score, up to four levels down.
  const visit = (v: unknown, inScore: boolean, depth: number) => {
    if (depth > 4) return
    if (Array.isArray(v)) {
      for (const x of v) {
        if (!isObj(x)) continue
        const label = [x.label, x.name, x.title, x.key, x.type, x.category].find((s) => typeof s === 'string') as string | undefined
        if (label && (inScore || SCORE_KEY.test(label) || partOf(label))) set(partOf(label), x.value ?? x.score ?? x.percent ?? x.points)
        visit(x, inScore, depth + 1)
      }
      return
    }
    if (!isObj(v)) return
    for (const [k, x] of Object.entries(v)) {
      const scoreHere = inScore || SCORE_KEY.test(k)
      // A key that names a part and says it is a score counts anywhere;
      // inside a score object any part name counts.
      if (scoreHere || /score/i.test(k)) set(partOf(k), x)
      if (isObj(x) || Array.isArray(x)) visit(x, scoreHere, depth + 1)
    }
  }
  visit(json, false, 0)
  return out.reviews == null && out.ads == null && out.chat == null ? null : out
}

/** A saved parts object, read safely. Pure. */
export function readSavedParts(raw: unknown): TrybeScoreParts | null {
  if (!isObj(raw)) return null
  const p = { reviews: num(raw.reviews), ads: num(raw.ads), chat: num(raw.chat) }
  return p.reviews == null && p.ads == null && p.chat == null ? null : p
}

/** Fast, okay or slow, the way TRYBE's own score window words it. Pure. */
export function partWord(n: number): 'Fast' | 'Okay' | 'Slow' {
  return n >= 70 ? 'Fast' : n >= 40 ? 'Okay' : 'Slow'
}

export const PART_LABEL: Record<keyof TrybeScoreParts, string> = { reviews: 'Reviews videos', ads: 'Launches ads', chat: 'Answers chats' }

// WHAT THE BRAND'S OWN PAGE SAYS, OVER MVP'S COPY OF TRYBE'S LIST (Seb,
// 2026-11-25, Chef Preserve: its page said 4.9 from 146 reviews and $500K+
// earned; MVP's lists said 22 reviews and paid out $50K+). The list copy is
// replaced whole by each admin collection, so what a page said is kept in its
// own column (trybe_page, migration 474) and laid over the row when brands
// are listed. Earnings all time never fall, so a lower figure never wins.

export interface TrybePageFacts {
  /** Stars of 5, from its page. */
  rating: number | null
  /** How many creators rated it, from its page. */
  reviews: number | null
  /** What its creators have earned, as TRYBE says it ("$500K+"). */
  earnings: string | null
}

const isNum = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null)

/** Page facts, read safely from a request or a saved column. Pure. */
export function readPageFacts(raw: unknown): TrybePageFacts | null {
  if (!isObj(raw)) return null
  const r = isNum(raw.rating, 5)
  const n = isNum(raw.reviews, 10_000_000)
  const e = typeof raw.earnings === 'string' && /\d/.test(raw.earnings) && raw.earnings.trim().length <= 20 ? raw.earnings.trim().replace(/\s*earned\s*$/i, '') : null
  const out = { rating: r != null && r > 0 ? Math.round(r * 10) / 10 : null, reviews: n != null ? Math.round(n) : null, earnings: e }
  return out.rating == null && out.reviews == null && out.earnings == null ? null : out
}

/** Dollars from an earnings label ("$500K+", "50k+"): the lower end. Pure. */
function labelDollars(raw: string | null | undefined): number | null {
  const m = String(raw || '').toLowerCase().replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*([km])?/)
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The directory row with what its own page said laid over it: its rating,
 *  its review count and its earnings (only when not lower). Pure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withPageFacts<T extends Record<string, any>>(row: T): T {
  const p = readPageFacts(row.trybe_page)
  if (!p) return row
  const out: Record<string, unknown> = { ...row }
  if (p.rating != null) out.rating = p.rating
  if (p.reviews != null) out.raw = { ...(isObj(row.raw) ? row.raw : {}), reviewCount: p.reviews, ...(p.rating != null ? { reviewRating: p.rating } : {}) }
  if (p.earnings && (labelDollars(p.earnings) ?? 0) >= (labelDollars(row.earnings_bucket) ?? 0)) out.earnings_bucket = p.earnings
  return out as T
}
