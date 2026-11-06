// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MY TOP 100 (Seb, 2026-11-05): "an all-encompassing button that if a user
// presses on it, MVP goes and searches the top 100 brands on TRYBE that would
// fit that particular user. Brands that they are not familiar with... make
// sure that these brands actually do have ad spend, any type of ad spend in
// the past 60 days, and also that they actually send samples."
//
// MVP reads what the creator does (blog posts and how often each was pushed
// to social, the TRYBE brands they work with and submitted to, the brands
// they messaged, the samples they asked for), turns it into the TRYBE
// categories and words their brands sell, and ranks TRYBE's brands they have
// no tie with yet. A brand only makes the list with proof of ad spend and of
// samples, each said on the brand in words, and every brand left out is
// counted by the reason.
//
// Pure, so the search, the page and the tests read one copy.

export const TOP100 = 100
/** A sample asked for this long ago and still not arrived counts as not sent. */
export const SAMPLE_WAIT_DAYS = 21
const DAY = 86_400_000

// ── AD SPEND, PROVEN ON META ─────────────────────────────────────────────────
// (Seb, 2026-11-06: "the ad spend can be measured as long as we see that
// they're spending money on meta ads. That's pretty simple.") Meta ads
// running, counted in the last four weeks and the brand's own, is the proof.
// A brand MVP has not counted yet is counted (the page asks SCOUT), never
// left out for it. TRYBE's own signs are added to the words, never needed.

/** What MVP knows of a brand's spending on ads. */
export interface SpendSigns {
  /** Meta ads running, from a count in the last four weeks; null when none. */
  metaCount: number | null
  /** That count is the brand's own (not a common word's, lib/trybe-pick metaUsable). */
  metaOwn: boolean
  /** Videos of it in TRYBE's Top 100 (ranked by ad results); null when the Top 100 was not read. */
  top100Hits?: number | null
  /** Videos it approved in the window (each approved video runs as its ad); null when not known. */
  newVideos?: number | null
  /** The window those videos are counted over, in days. */
  days?: number | null
  /** Its payout tier on TRYBE went up in the last 30 days. */
  tierUp?: boolean | null
}

export type SpendVerdict =
  | { proven: true; says: string[] }
  | { proven: false; why: 'notCounted' | 'unclear' | 'noAds'; says: string[] }

/** Proof the brand spends on Meta ads, in words, or why not. Pure. */
export function adSpendProof(s: SpendSigns): SpendVerdict {
  if (s.metaCount == null) return { proven: false, why: 'notCounted', says: [] }
  if (!s.metaOwn) return { proven: false, why: 'unclear', says: [] }
  if (s.metaCount <= 0) return { proven: false, why: 'noAds', says: [] }
  const says = [`${s.metaCount} Meta ad${s.metaCount === 1 ? '' : 's'} running`]
  if ((s.top100Hits ?? 0) > 0) says.push(`in TRYBE's Top 100 ads`)
  if ((s.newVideos ?? 0) > 0 && (s.days ?? 0) > 0 && (s.days as number) <= 60) says.push(`${s.newVideos} creator video${s.newVideos === 1 ? '' : 's'} approved in ${s.days} days`)
  if (s.tierUp) says.push('payout tier went up this month')
  return { proven: true, says }
}

/** How many brands to send SCOUT to count on Meta in one round. */
export const META_ROUND = 40
/** Rounds of counting before the list is shown as it stands. */
export const META_ROUNDS_MAX = 8

// ── SAMPLES, PROVEN ──────────────────────────────────────────────────────────

/** What MVP knows of a brand and samples. */
export interface SampleSigns {
  /** TRYBE says it takes sample requests (true), does not (false), or does not say (null). */
  trybe: boolean | null
  /** MVP creators who asked it for a sample and got it. */
  received: number
  /** MVP creators who asked SAMPLE_WAIT_DAYS ago or more and have nothing. */
  waitingLong: number
  /** TRYBE's public product list for the brand: products open to sample
   *  requests, of its active products. Null when not read. */
  products?: CatalogSamples | null
  /** It sells an app, software or a service and no physical goods (lib/trybe-sells). */
  digital?: boolean
}

export type SampleVerdict =
  | { ok: true; proven: boolean; says: string; app?: boolean }
  | { ok: false; why: 'off' | 'missing' | 'none' | 'unknown'; says: string }

/** Whether a brand sends samples, as far as MVP can tell. Proven when MVP
 *  creators got one; taken on TRYBE's word when none has asked yet; out when
 *  TRYBE says no, when creators asked and nothing came, or when nothing at
 *  all says. Pure. */
export function samplesProof(s: SampleSigns): SampleVerdict {
  if (s.received > 0) return { ok: true, proven: true, says: `sent samples to ${s.received} MVP creator${s.received === 1 ? '' : 's'}`, ...(s.digital ? { app: true } : {}) }
  if (s.waitingLong > 0) return { ok: false, why: 'missing', says: `${s.waitingLong} MVP creator${s.waitingLong === 1 ? '' : 's'} asked ${SAMPLE_WAIT_DAYS}+ days ago and got nothing` }
  // APPS ARE IN (Seb, 2026-11-06: "yes let apps in"). An app or online
  // service has nothing to ship, so there is no sample to wait for: it passes,
  // marked as an app so the page can show it apart at a glance.
  if (s.digital) {
    const p = s.products
    return { ok: true, proven: false, app: true, says: p && p.open > 0 ? `an app or online service, and ${p.open} of its ${p.total} product${p.total === 1 ? '' : 's'} on TRYBE take sample requests` : 'an app or online service: nothing to ship, so no sample to wait for' }
  }
  if (s.trybe === false) return { ok: false, why: 'off', says: 'does not take sample requests on TRYBE' }
  if (s.trybe === true) return { ok: true, proven: false, says: 'takes sample requests on TRYBE (no MVP creator has had one yet)' }
  // TRYBE'S LIST DOES NOT SAY FOR MOST BRANDS (Seb's run, 2026-11-06: 147 of
  // 164 left out for it), so the brand's own product list on TRYBE is read:
  // each product there is open to sample requests or not.
  const p = s.products
  if (p && p.open > 0) return { ok: true, proven: false, says: `${p.open} of its ${p.total} product${p.total === 1 ? '' : 's'} on TRYBE take sample requests (no MVP creator has had one yet)` }
  if (p && p.total > 0) return { ok: false, why: 'off', says: `none of its ${p.total} product${p.total === 1 ? '' : 's'} on TRYBE take sample requests` }
  // AN EMPTY PRODUCT LIST IS AN ANSWER (Seb's check, 2026-11-06: 45 of 599
  // read had none, Canva and Sand Cloud among them). TRYBE answers with no
  // products at all, not paused ones. Apps passed above; a brand left here
  // sells physical goods (or MVP cannot tell) and has nothing to ask for.
  if (p && p.total === 0) return { ok: false, why: 'none', says: 'lists no products on TRYBE, so there is nothing to ask a sample of' }
  return { ok: false, why: 'unknown', says: 'TRYBE does not say whether it sends samples' }
}

/** A brand's products on TRYBE, by whether each takes sample requests. */
export interface CatalogSamples { open: number; total: number; /** Its active products' names, up to CATALOG_NAMES_MAX. */ names?: string[] }

/** Product names kept per brand: enough to tell what it sells. */
export const CATALOG_NAMES_MAX = 20

/** TRYBE's public product list for a brand (GET /backend/api/public/brand/
 *  {id}/products), counted: active products, and those open to sample
 *  requests. Only an explicit yes counts as open. Pure. */
export function catalogSamples(json: unknown): CatalogSamples {
  const o = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const root = Array.isArray(o.data) ? o.data : o.data && typeof o.data === 'object' && Array.isArray((o.data as Record<string, unknown>).products) ? (o.data as Record<string, unknown>).products as unknown[] : Array.isArray(json) ? json : []
  let open = 0, total = 0
  const names: string[] = []
  for (const p of root as unknown[]) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (r.isActive === false) continue
    total++
    if (r.allowSamples === true) open++
    const name = String(r.title ?? r.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (name && names.length < CATALOG_NAMES_MAX && !names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names.length ? { open, total, names } : { open, total }
}

/** A kept catalogue count, read back; null when it is not one. Pure. */
export function readCatalogSamples(v: unknown): CatalogSamples | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : null)
  const open = n(o.open), total = n(o.total)
  if (open == null || total == null || open > total) return null
  const names = Array.isArray(o.names) ? o.names.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, CATALOG_NAMES_MAX) : []
  return names.length ? { open, total, names } : { open, total }
}

/** Product lists read in one call of the daily refresh, at most. */
export const CATALOG_REFRESH_CHUNK = 600

/** How long a brand's product list on TRYBE is trusted before it is read again. */
export const CATALOG_KEEP_DAYS = 7
/** Product lists read on TRYBE in one ranking, at most. */
export const CATALOG_READS_MAX = 300

/** Each brand's samples as MVP creators logged them: got, and long waiting. Pure. */
export function sampleSignsByBrand(rows: Array<{ brand_id: string | null; requested_at: string | null; received_at: string | null }>, now = Date.now()): Map<string, { received: number; waitingLong: number }> {
  const out = new Map<string, { received: number; waitingLong: number }>()
  for (const r of rows) {
    if (!r.brand_id) continue
    const m = out.get(r.brand_id) ?? { received: 0, waitingLong: 0 }
    if (r.received_at) m.received++
    else if (r.requested_at && now - Date.parse(r.requested_at) >= SAMPLE_WAIT_DAYS * DAY) m.waitingLong++
    out.set(r.brand_id, m)
  }
  return out
}

// ── WHAT THE CREATOR DOES ────────────────────────────────────────────────────

export interface Activity {
  posts: Array<{ title: string | null; keyword?: string | null; words?: unknown; pushes?: number }>
  /** TRYBE brands they work with (TRYBE's own stats), with what they sell. */
  worksWith: Array<{ name: string; categories?: string[]; submitted?: number | null; earnings?: number | null }>
  /** Brands they messaged through MVP, with what they sell. */
  messaged: Array<{ name: string; categories?: string[] }>
  samples: Array<{ brand: string; product: string }>
}

/** How many of each MVP read, for the page to say. Pure. */
export function activityCounts(a: Activity): { posts: number; pushed: number; worksWith: number; submitted: number; messaged: number; samples: number } {
  return {
    posts: a.posts.length,
    pushed: a.posts.filter((p) => (p.pushes ?? 0) > 0).length,
    worksWith: a.worksWith.length,
    submitted: a.worksWith.filter((b) => (b.submitted ?? 0) > 0).length,
    messaged: a.messaged.length,
    samples: a.samples.length,
  }
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** The creator's work, short, for the AI to read: what they write about
 *  (pushed posts first), the brands they earn with, message and sample. Pure. */
export function activityDigest(a: Activity): string {
  const words = (w: unknown) => (Array.isArray(w) ? w.map((x) => clip(x, 40)).filter(Boolean).slice(0, 4).join(', ') : clip(w, 80))
  const posts = [...a.posts].sort((x, y) => (y.pushes ?? 0) - (x.pushes ?? 0)).slice(0, 120)
    .map((p) => `- ${clip(p.title, 110)}${p.keyword ? ` [${clip(p.keyword, 50)}]` : ''}${words(p.words) ? ` (${words(p.words)})` : ''}${(p.pushes ?? 0) > 0 ? ` pushed to social ${p.pushes}x` : ''}`)
  const works = [...a.worksWith].sort((x, y) => (y.earnings ?? 0) - (x.earnings ?? 0) || (y.submitted ?? 0) - (x.submitted ?? 0)).slice(0, 60)
    .map((b) => `- ${clip(b.name, 60)}${b.categories?.length ? ` (${b.categories.slice(0, 3).join(', ')})` : ''}${b.submitted ? `, ${b.submitted} videos submitted` : ''}${b.earnings ? `, $${Math.round(b.earnings)} earned` : ''}`)
  const messaged = a.messaged.slice(0, 80).map((b) => `- ${clip(b.name, 60)}${b.categories?.length ? ` (${b.categories.slice(0, 3).join(', ')})` : ''}`)
  const samples = a.samples.slice(0, 60).map((s) => `- ${clip(s.product, 80)} from ${clip(s.brand, 50)}`)
  return [
    `BLOG POSTS (${a.posts.length}, the most pushed to social first):\n${posts.join('\n') || '(none)'}`,
    `TRYBE BRANDS THEY WORK WITH (${a.worksWith.length}):\n${works.join('\n') || '(none)'}`,
    `BRANDS THEY MESSAGED ON TRYBE (${a.messaged.length}):\n${messaged.join('\n') || '(none)'}`,
    `SAMPLES THEY ASKED FOR (${a.samples.length}):\n${samples.join('\n') || '(none)'}`,
  ].join('\n\n')
}

export interface Top100Profile {
  /** One plain sentence to the creator: what MVP sees they make content about. */
  summary: string
  /** TRYBE's own categories, at most 6. */
  categories: string[]
  /** Product words their brands sell, at most 15. */
  keywords: string[]
}

/** An AI answer held to TRYBE's categories and short product words. Pure. */
export function cleanProfile(raw: unknown, trybeCategories: string[]): Top100Profile {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const known = new Map(trybeCategories.map((c) => [c.toLowerCase(), c]))
  const cats = Array.isArray(o.categories) ? o.categories.map((c) => known.get(String(c ?? '').trim().toLowerCase())).filter((c): c is string => !!c) : []
  const kws = Array.isArray(o.keywords) ? o.keywords.map((k) => clip(k, 30).toLowerCase().replace(/[^\p{L}\p{N} &'-]/gu, '').trim()).filter((k) => k.length >= 3) : []
  const summary = clip(o.summary, 220).replace(/\s*[–—]\s*/g, ', ').replace(/\s+-\s+/g, ', ')
  return { summary, categories: Array.from(new Set(cats)).slice(0, 6), keywords: Array.from(new Set(kws)).slice(0, 15) }
}

/** How many times a post went out to social, from its per-network counts. Pure. */
export function pushesOf(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v))
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.values(v as Record<string, unknown>).reduce<number>((t, x) => t + pushesOf(x), 0)
  return 0
}

/** What the search is sent for My top 100: the profile's categories and
 *  words, and the TRYBE brands the creator works with (left out). Null when
 *  it is not a top 100 search. Pure. */
export function readTop100Ask(v: unknown): { categories: string[]; keywords: string[]; joined: Set<string> } | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const list = (x: unknown, n: number) => (Array.isArray(x) ? x.map((s) => clip(s, 60)).filter(Boolean).slice(0, n) : [])
  const categories = list(o.categories, 6), keywords = list(o.keywords, 15)
  if (!categories.length && !keywords.length) return null
  return { categories, keywords, joined: new Set(list(o.joined, 2000)) }
}
