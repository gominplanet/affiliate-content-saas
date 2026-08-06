// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The brain of the Daily CC Campaign Digest — pure, no-I/O helpers that turn a
// creator's history into an interest profile, score the shared CC catalog
// against it, apply learned thumbs feedback, and build/parse the LLM re-rank.
//
// Matching is HYBRID by design:
//   1. Cheap deterministic first pass here — niche/keyword overlap between the
//      campaign (name + brand) and the creator's blog + YouTube topics, blended
//      with the catalog's own opportunityScore (payout, trust, fullness, demand)
//      and reweighted by past thumbs.
//   2. A single LLM re-rank of the top candidates (in the route) picks the final
//      25 by genuine topical fit — the part keyword overlap misses.
//
// Keeping it pure means the route stays thin and this is trivially testable.

import { opportunityScore, type BrandTrust, type Fullness } from '@/lib/cc-intelligence'

// ── Interest profile ────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'at',
  'by', 'from', 'is', 'it', 'this', 'that', 'these', 'those', 'your', 'you',
  'best', 'top', 'new', 'review', 'reviews', 'unboxing', 'vs', 'how', 'why',
  'what', 'my', 'i', 'we', 'my', 'get', 'buy', 'amazon', 'video', 'youtube',
  'shorts', 'short', 'watch', 'part', 'ep', 'episode', 'official', 'full',
  '2024', '2025', '2026', 'day', 'days', 'off', 'deal', 'deals', 'sale',
])

/** Split free text into lowercase word tokens worth matching on. Keeps 3+ char
 *  words and standalone model-ish tokens; drops stopwords and pure numbers. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

export interface ProfileInput {
  niches?: (string | null)[] | null
  customCategories?: (string | null)[] | null
  videoTitles?: (string | null)[] | null
  videoTags?: (string | null)[] | null       // flattened tag strings
  videoCategories?: (string | null)[] | null
  blogTitles?: (string | null)[] | null
  blogKeywords?: (string | null)[] | null     // seo_keyword + affiliate_keywords, flattened
}

export interface InterestProfile {
  /** Declared niches/categories — the strongest, cleanest signal (weighted up). */
  categories: string[]
  /** Weighted keyword bag mined from content — token → weight. */
  keywords: Map<string, number>
  /** True when we have basically nothing to match on (new account). */
  isSparse: boolean
}

/** Build a per-user interest profile from declared niches + mined content. */
export function buildInterestProfile(input: ProfileInput): InterestProfile {
  const categories = uniqLower([
    ...(input.niches ?? []),
    ...(input.customCategories ?? []),
    ...(input.videoCategories ?? []),
  ])

  const keywords = new Map<string, number>()
  const add = (text: string | null | undefined, weight: number) => {
    for (const tok of tokenize(text)) keywords.set(tok, (keywords.get(tok) ?? 0) + weight)
  }
  // Declared categories are the highest-signal tokens.
  for (const c of categories) add(c, 5)
  // Keywords the creator actually targets in posts — strong intent.
  for (const k of input.blogKeywords ?? []) add(k, 4)
  for (const t of input.videoTags ?? []) add(t, 3)
  // Titles — plentiful but noisier.
  for (const t of input.videoTitles ?? []) add(t, 2)
  for (const t of input.blogTitles ?? []) add(t, 2)

  const isSparse = categories.length === 0 && keywords.size < 4
  return { categories, keywords, isSparse }
}

function uniqLower(arr: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of arr) {
    const v = (raw ?? '').trim().toLowerCase()
    if (v && !seen.has(v)) { seen.add(v); out.push(v) }
  }
  return out
}

// ── Overlap scoring ─────────────────────────────────────────────────────────

/** How well a campaign's text matches the creator's interests, 0..1.
 *  Rewards category hits heavily, then weighted keyword overlap. */
export function matchScore(campaignText: string, profile: InterestProfile): number {
  if (profile.isSparse) return 0.5 // nothing to match on — stay neutral, let opp score lead
  const hay = campaignText.toLowerCase()
  const toks = new Set(tokenize(campaignText))
  if (toks.size === 0) return 0

  // Category hit — a declared niche appears verbatim in the campaign text.
  let categoryHit = 0
  for (const c of profile.categories) {
    if (c.length >= 3 && hay.includes(c)) { categoryHit = 1; break }
  }

  // Weighted keyword overlap, normalized by the campaign's own token count so a
  // long campaign name can't win on volume alone.
  let overlap = 0
  let matched = 0
  for (const tok of toks) {
    const w = profile.keywords.get(tok)
    if (w) { overlap += w; matched++ }
  }
  const maxW = Math.max(...profile.keywords.values(), 1)
  const overlapNorm = Math.min(1, overlap / (maxW * 3)) // ~3 strong hits ⇒ saturated
  const breadth = Math.min(1, matched / 4)

  // Blend: a category hit alone is a strong match; keyword overlap fills in.
  return Math.min(1, categoryHit * 0.6 + overlapNorm * 0.3 + breadth * 0.1)
}

/** The text we match a catalog row against. */
export function campaignMatchText(row: { campaign_name?: string | null; brand_name?: string | null }): string {
  return `${row.campaign_name ?? ''} ${row.brand_name ?? ''}`.trim()
}

// ── Feedback realignment ────────────────────────────────────────────────────

export interface FeedbackAgg {
  /** Brand name (lowercased) → net thumbs (up − down). */
  brands: Map<string, number>
  /** Category token (lowercased) → net thumbs. */
  categories: Map<string, number>
}

/** Roll up the seen-ledger's thumbs into brand + category nets. */
export function aggregateFeedback(
  rows: { brand_name: string | null; category: string | null; feedback: string | null }[],
): FeedbackAgg {
  const brands = new Map<string, number>()
  const categories = new Map<string, number>()
  for (const r of rows) {
    if (r.feedback !== 'up' && r.feedback !== 'down') continue
    const delta = r.feedback === 'up' ? 1 : -1
    const b = (r.brand_name ?? '').trim().toLowerCase()
    if (b) brands.set(b, (brands.get(b) ?? 0) + delta)
    const c = (r.category ?? '').trim().toLowerCase()
    if (c) categories.set(c, (categories.get(c) ?? 0) + delta)
  }
  return { brands, categories }
}

/** A multiplier in ~[0.5, 1.5] from what the user has liked/disliked before.
 *  Down-thumbs on a brand or category suppress it; up-thumbs lift it. */
export function feedbackMultiplier(
  row: { brand_name?: string | null },
  matchedCategory: string | null,
  fb: FeedbackAgg,
): number {
  let m = 1
  const b = (row.brand_name ?? '').trim().toLowerCase()
  if (b && fb.brands.has(b)) m += clamp(fb.brands.get(b)! * 0.15, -0.4, 0.4)
  const c = (matchedCategory ?? '').trim().toLowerCase()
  if (c && fb.categories.has(c)) m += clamp(fb.categories.get(c)! * 0.12, -0.4, 0.4)
  return clamp(m, 0.5, 1.5)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// ── Combined pre-score (first pass) ─────────────────────────────────────────

/** Blend catalog opportunity (payout/trust/fullness/demand) with topical match
 *  and learned feedback into one first-pass score. Higher = surface sooner. */
export function preScore(input: {
  perSale: number | null
  commissionPct: number | null
  trust: BrandTrust
  fullness: Fullness
  daysLeft: number | null
  monthlySold: number | null
  match: number            // 0..1 from matchScore
  feedbackMult: number     // from feedbackMultiplier
}): number {
  const opp = opportunityScore({
    perSale: input.perSale,
    commissionPct: input.commissionPct,
    trust: input.trust,
    fullness: input.fullness,
    daysLeft: input.daysLeft,
    monthlySold: input.monthlySold,
  })
  // opp is roughly -30..80. Normalize to ~0..1 then blend 55% fit / 45% quality.
  const oppNorm = clamp((opp + 30) / 110, 0, 1)
  const blended = input.match * 0.55 + oppNorm * 0.45
  return Math.round(blended * input.feedbackMult * 1000) / 1000
}

/** The best category token that this campaign matched on (for the seen-ledger
 *  + realignment). Null when nothing matched. */
export function matchedCategory(campaignText: string, profile: InterestProfile): string | null {
  const hay = campaignText.toLowerCase()
  for (const c of profile.categories) if (c.length >= 3 && hay.includes(c)) return c
  // Fall back to the single highest-weight keyword that appears.
  let best: string | null = null
  let bestW = 0
  for (const tok of tokenize(campaignText)) {
    const w = profile.keywords.get(tok) ?? 0
    if (w > bestW) { bestW = w; best = tok }
  }
  return best
}

// ── LLM re-rank ─────────────────────────────────────────────────────────────

export interface RerankCandidate {
  campaignId: string
  name: string
  brand: string | null
  category: string | null
  commissionPct: number | null
  price: number | null
}

/** Build the re-rank prompt: hand the model the creator's interests + the
 *  shortlist, ask it to return the best-fit campaign ids in order. */
export function buildRerankPrompt(
  profile: InterestProfile,
  candidates: RerankCandidate[],
  take: number,
): { system: string; user: string } {
  const interests = [
    profile.categories.length ? `Niches/categories: ${profile.categories.join(', ')}` : '',
    profile.keywords.size
      ? `Recurring topics: ${topKeywords(profile.keywords, 20).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')

  const list = candidates
    .map((c, i) =>
      `${i + 1}. id=${c.campaignId} | ${c.name}${c.brand ? ` (brand: ${c.brand})` : ''}` +
      `${c.commissionPct != null ? ` | ${c.commissionPct}% commission` : ''}` +
      `${c.price != null ? ` | $${c.price.toFixed(0)}` : ''}`,
    )
    .join('\n')

  const system =
    'You are an affiliate-marketing strategist picking Amazon Creator Connections ' +
    'campaigns for one creator. Pick the campaigns whose PRODUCTS best fit what ' +
    'this creator makes content about — topical relevance is the priority, with ' +
    'commission and price as tie-breakers. Avoid picks unrelated to their niches. ' +
    `Return ONLY a JSON array of the ${take} best campaign ids, best first, e.g. ` +
    '["amzn1.campaign.abc","amzn1.campaign.def"]. No prose.'

  const user =
    `CREATOR INTERESTS\n${interests || '(sparse — infer from any signal available)'}\n\n` +
    `CANDIDATE CAMPAIGNS (${candidates.length})\n${list}\n\n` +
    `Return the top ${take} campaign ids as a JSON array, best fit first.`

  return { system, user }
}

/** Parse the model's JSON id array, keeping only ids we actually sent (so a
 *  hallucinated id can't leak in), de-duped and capped. Returns [] on garbage
 *  so the caller can fall back to the deterministic order. */
export function parseRerankResponse(text: string, validIds: Set<string>, take: number): string[] {
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of arr) {
      const id = String(raw).trim()
      if (validIds.has(id) && !seen.has(id)) { seen.add(id); out.push(id) }
      if (out.length >= take) break
    }
    return out
  } catch {
    return []
  }
}

function topKeywords(keywords: Map<string, number>, n: number): string[] {
  return [...keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}
