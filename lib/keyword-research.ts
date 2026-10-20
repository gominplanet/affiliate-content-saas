// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Phase 2 keyword research — FREE-first, no paid APIs, no user accounts.
//
// Premise (user rule, 2026-06-11): an Amazon seller has ALREADY paid for keyword
// research. The listing TITLE is packed with the highest-converting buyer search
// terms (strongest signal); the "about this item" BULLETS are second. We mine
// those, then validate real search demand with FREE autocomplete endpoints
// (Amazon's own search box + Google Suggest) and pick the phrase with the best
// demand × product-fit. The chosen keyword is handed to the writer as a hard
// target instead of letting the model guess one.
//
// Sources — all free, no key, no user account:
//   • Amazon listing title + bullets — already scraped by fetchAmazonProduct()
//   • Amazon autocomplete (completion.amazon.com) — real buyer-intent demand
//   • Google autocomplete (suggestqueries.google.com) — broader search demand
//   • (optional) GSC queries — site winnability; passed in by callers that have
//     it (Phase 3). Phase 2 omits it.
//
// Everything is best-effort: any network failure degrades to title/bullet
// extraction so generation never blocks. Returns { primary: null } when there's
// nothing usable — callers then let the model derive its own keyword (old path).
//
// CONFIRMED BY A REAL SEARCH (Seb, 2026-10-20: "check the main keyword against
// Google search suggestion ... It'll expand our reach"). Every post, with an
// Amazon listing or only a video: a phrase Google's or Amazon's search box
// suggests, and that is about the content (every real word in it is a word
// of the listing, the video or its transcript), wins over one that only reads
// well; the result says which box confirmed it, or that none did. Answers are
// remembered for everyone for a week (lib/search-suggest, migration 449).

import { suggest, contentVocab, matchesContent, titleTopic } from '@/lib/search-suggest'

export interface GscQuerySignal {
  query: string
  impressions: number
  position: number
}

export interface KeywordResearchInput {
  amazonTitle?: string | null
  amazonBullets?: string[] | null
  videoTitle?: string | null
  brandName?: string | null
  /** Optional site-winnability signal (Phase 3 passes this; Phase 2 omits it). */
  gscQueries?: GscQuerySignal[] | null
  /** What the video says (transcript, description): a search is kept only
   *  when it is about the listing, the video or this. */
  contentText?: string | null
  /** The service client, so search answers are remembered for everyone. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin?: any
}

export interface KeywordCandidate {
  phrase: string
  score: number
  sources: string[]
}

export interface KeywordResearchResult {
  primary: string | null
  supporting: string[]
  candidates: KeywordCandidate[]
  /** The search boxes that suggest the primary (people type it); empty when
   *  none did, so an unconfirmed keyword never reads as a confirmed one. */
  confirmedBy: Array<'google' | 'amazon' | 'gsc'>
  /** Search boxes asked, and how many answered. */
  asked: number
  answered: number
}

// Generic words we never require for relevance, and units/sizes that are noise
// in a keyword phrase.
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'with', 'in', 'on', 'for', 'your', 'you', 'our', 'this', 'that', 'from', 'by', 'at', 'it', 'is', 'are', 'be', 'as', 'all', 'new', 'set', 'piece', 'pieces', 'size', 'color', 'colour', 'style', 'type', 'best', 'top', 'review', 'reviews', 'amazon', 'premium', 'professional', 'upgraded', 'portable'])
const UNITS = new Set(['inch', 'inches', 'cm', 'mm', 'ft', 'feet', 'lb', 'lbs', 'oz', 'kg', 'gram', 'grams', 'ml', 'liter', 'litre', 'watt', 'watts', 'volt', 'volts', 'hz', 'gb', 'tb', 'mb', 'ghz', 'mah', 'pack', 'count', 'pcs', 'pc'])

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
}

// Clean a stuffed listing title/bullet into category tokens: drop parentheticals,
// brand tokens, model numbers / sizes (anything containing a digit), units, and
// stopwords. What's left reads like the buyer-facing category words.
function meaningfulTokens(text: string, brand?: string | null): string[] {
  const t = (text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ')
  const brandToks = new Set(norm(brand || '').split(' ').filter(Boolean))
  return t.split(/\s+/).filter(tok =>
    tok.length >= 3 && !/\d/.test(tok) && !STOP.has(tok) && !UNITS.has(tok) && !brandToks.has(tok),
  )
}

// Contiguous 2- and 3-grams from a token list.
function ngrams(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`)
    if (i < tokens.length - 2) out.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
  }
  return out
}

/**
 * Research the best primary keyword (plus a few supporting phrases) for a post,
 * using only free sources. Safe to call on every generation — best-effort and
 * fully degradable. Returns { primary: null } when nothing usable surfaces.
 */
export async function researchKeyword(input: KeywordResearchInput): Promise<KeywordResearchResult> {
  const empty: KeywordResearchResult = { primary: null, supporting: [], candidates: [], confirmedBy: [], asked: 0, answered: 0 }
  // A video title is cleaned of the words nobody searches with first ("Don't
  // buy a fat tire e-bike until you see this" -> "fat tire ebike").
  const title = input.amazonTitle || titleTopic(input.videoTitle || '', 8)
  if (!title.trim()) return empty

  const rawTitleToks = meaningfulTokens(title, input.brandName)
  if (rawTitleToks.length === 0) return empty

  // Amazon listings LEAD WITH THE SELLER'S BRAND, which is coined ("PurRugs")
  // and not something buyers search — it must never become the keyword. Treat
  // the lead token as the probable seller brand (when enough category tokens
  // remain) and DENY it across every candidate. This is the fix for the
  // "purrugs dirt trapping" miss: strip the brand and the category phrase wins.
  // (input.brandName is the USER's brand, a different thing — also denied.)
  const sellerBrand = input.amazonTitle && rawTitleToks.length >= 3 ? rawTitleToks[0] : null
  const titleToks = sellerBrand ? rawTitleToks.slice(1) : rawTitleToks
  const deny = new Set<string>(meaningfulTokens(input.brandName || ''))
  if (sellerBrand) deny.add(sellerBrand)

  // Seed phrases for autocomplete = the DE-BRANDED head bigram/trigram (closest
  // to the buyer-facing category). Capped to bound network calls.
  const seeds = Array.from(new Set([
    titleToks.slice(0, 2).join(' '),
    titleToks.length >= 3 ? titleToks.slice(0, 3).join(' ') : '',
  ].filter(Boolean)))

  // Fire all autocomplete calls in parallel — free, best-effort, time-boxed,
  // remembered for a week (lib/search-suggest).
  const results = await Promise.all(seeds.flatMap((seed) => [suggest('amazon', seed, input.admin), suggest('google', seed, input.admin)]))
  const amazonSug = new Set<string>()
  const googleSug = new Set<string>()
  for (const r of results) {
    const target = r.engine === 'amazon' ? amazonSug : googleSug
    // A box always offers back the words it was asked: that echo is no sign
    // anyone searches the phrase, so only what it adds counts.
    for (const s of r.phrases) if (norm(s) !== norm(r.seed)) target.add(norm(s))
  }
  // What the content is about, for the searches: the listing, the video, its words.
  const vocab = contentVocab([input.amazonTitle, ...(input.amazonBullets || []), input.videoTitle, input.contentText].filter(Boolean).join('\n'))

  // Candidate pool: title n-grams + bullet n-grams + autocomplete suggestions
  // (+ optional GSC queries). Score by source weight, corroboration, and fit.
  const titleTokenSet = new Set(titleToks)
  const cand = new Map<string, KeywordCandidate>()
  const add = (raw: string, source: string, base: number) => {
    const phrase = norm(raw)
    const toks = phrase.split(' ').filter(Boolean)
    if (toks.length < 2 || toks.length > 5) return        // long-tail sweet spot
    if (toks.some(t => /\d/.test(t))) return               // skip model/size noise
    if (toks.some(t => deny.has(t))) return                // never the seller/user brand
    if (!toks.some(t => titleTokenSet.has(t))) return      // must be on-topic
    const e = cand.get(phrase) || { phrase, score: 0, sources: [] }
    e.score += base
    if (!e.sources.includes(source)) e.sources.push(source)
    cand.set(phrase, e)
  }

  ngrams(titleToks).forEach(p => add(p, 'amazon-title', 3))                                   // seller's strongest signal
  ;(input.amazonBullets || []).flatMap(b => ngrams(meaningfulTokens(b, input.brandName))).slice(0, 40).forEach(p => add(p, 'amazon-bullet', 1.5))
  // A search is used only when it is about this content (never "... rack" for the bike itself).
  amazonSug.forEach(p => { if (matchesContent(p, vocab)) add(p, 'amazon-suggest', 4) })         // real buyer-intent demand
  googleSug.forEach(p => { if (matchesContent(p, vocab)) add(p, 'google-suggest', 2.5) })
  for (const g of input.gscQueries || []) add(g.query, 'gsc', g.position <= 20 ? 3 : 1.5)     // site winnability (Phase 3)

  // Final adjustments: length sweet spot + multi-source corroboration bonus.
  for (const e of cand.values()) {
    const len = e.phrase.split(' ').length
    // Favor winnable long-tail (3–4 words) over generic 2-word category heads —
    // the heads are higher-competition and convert worse for an affiliate review.
    if (len === 3 || len === 4) e.score += 2
    else if (len === 2) e.score += 0.5
    if (e.sources.length >= 2) e.score += 1.5    // corroborated across sources
  }

  // A REAL SEARCH FIRST: when any candidate is one people type (a search box
  // suggested it, or Search Console saw it), the best of those is the
  // primary; a phrase that only reads well comes after them.
  const searched = (c: KeywordCandidate) => c.sources.some((x) => x === 'google-suggest' || x === 'amazon-suggest' || x === 'gsc')
  const ranked = Array.from(cand.values()).sort((a, b) => Number(searched(b)) - Number(searched(a)) || b.score - a.score)
  const asked = results.length
  const answered = results.filter((r) => r.answered).length
  if (ranked.length === 0) return { ...empty, asked, answered }

  const primary = ranked[0].phrase
  const confirmedBy = ([['google-suggest', 'google'], ['amazon-suggest', 'amazon'], ['gsc', 'gsc']] as const).filter(([src]) => ranked[0].sources.includes(src)).map(([, name]) => name)
  const primaryToks = new Set(primary.split(' '))
  const supporting = ranked.slice(1)
    .filter(c => {
      // Keep only phrases that add NEW tokens beyond the primary (drop near-dupes).
      const toks = c.phrase.split(' ')
      return toks.some(t => !primaryToks.has(t))
    })
    .slice(0, 5)
    .map(c => c.phrase)

  return { primary, supporting, candidates: ranked.slice(0, 12), confirmedBy: [...confirmedBy], asked, answered }
}
