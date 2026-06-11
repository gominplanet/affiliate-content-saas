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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SUGGEST_TIMEOUT_MS = 3500
const AMAZON_US_MARKETPLACE = 'ATVPDKIKX0DER'

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

async function fetchGoogleSuggest(query: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    })
    if (!res.ok) return []
    // client=firefox returns ["query", ["s1","s2",...], ...] as JSON.
    const data = JSON.parse(await res.text())
    return Array.isArray(data?.[1]) ? (data[1] as unknown[]).filter((s): s is string => typeof s === 'string') : []
  } catch { return [] }
}

async function fetchAmazonSuggest(query: string): Promise<string[]> {
  try {
    const url = `https://completion.amazon.com/api/2017/suggestions?limit=11&prefix=${encodeURIComponent(query)}&alias=aps&mid=${AMAZON_US_MARKETPLACE}&site-variant=desktop&client-info=amazon-search-ui&lop=en_US&b2b=0&fresh=0&suggestion-type=KEYWORD`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data = await res.json() as { suggestions?: Array<{ type?: string; value?: string }> }
    return (data.suggestions || [])
      .filter(s => s.type === 'KEYWORD' && typeof s.value === 'string')
      .map(s => s.value as string)
  } catch { return [] }
}

/**
 * Research the best primary keyword (plus a few supporting phrases) for a post,
 * using only free sources. Safe to call on every generation — best-effort and
 * fully degradable. Returns { primary: null } when nothing usable surfaces.
 */
export async function researchKeyword(input: KeywordResearchInput): Promise<KeywordResearchResult> {
  const empty: KeywordResearchResult = { primary: null, supporting: [], candidates: [] }
  const title = input.amazonTitle || input.videoTitle || ''
  if (!title.trim()) return empty

  const rawTitleToks = meaningfulTokens(title, input.brandName)
  if (rawTitleToks.length === 0) return empty

  // Amazon listings LEAD WITH THE SELLER'S BRAND, which is coined ("PurRugs")
  // and not something buyers search — it must never become the keyword. Treat
  // the lead token as the probable seller brand (when enough category tokens
  // remain) and DENY it across every candidate. This is the fix for the
  // "purrugs dirt trapping" miss: strip the brand and the category phrase wins.
  // (input.brandName is the USER's brand, a different thing — also denied.)
  const sellerBrand = rawTitleToks.length >= 3 ? rawTitleToks[0] : null
  const titleToks = sellerBrand ? rawTitleToks.slice(1) : rawTitleToks
  const deny = new Set<string>(meaningfulTokens(input.brandName || ''))
  if (sellerBrand) deny.add(sellerBrand)

  // Seed phrases for autocomplete = the DE-BRANDED head bigram/trigram (closest
  // to the buyer-facing category). Capped to bound network calls.
  const seeds = Array.from(new Set([
    titleToks.slice(0, 2).join(' '),
    titleToks.length >= 3 ? titleToks.slice(0, 3).join(' ') : '',
  ].filter(Boolean)))

  // Fire all autocomplete calls in parallel — free, best-effort, time-boxed.
  const calls: Array<Promise<{ engine: 'amazon' | 'google'; list: string[] }>> = []
  for (const seed of seeds) {
    calls.push(fetchAmazonSuggest(seed).then(list => ({ engine: 'amazon' as const, list })))
    calls.push(fetchGoogleSuggest(seed).then(list => ({ engine: 'google' as const, list })))
  }
  const results = await Promise.all(calls)
  const amazonSug = new Set<string>()
  const googleSug = new Set<string>()
  for (const r of results) {
    const target = r.engine === 'amazon' ? amazonSug : googleSug
    for (const s of r.list) target.add(norm(s))
  }

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
  amazonSug.forEach(p => add(p, 'amazon-suggest', 4))                                          // real buyer-intent demand
  googleSug.forEach(p => add(p, 'google-suggest', 2.5))
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

  const ranked = Array.from(cand.values()).sort((a, b) => b.score - a.score)
  if (ranked.length === 0) return empty

  const primary = ranked[0].phrase
  const primaryToks = new Set(primary.split(' '))
  const supporting = ranked.slice(1)
    .filter(c => {
      // Keep only phrases that add NEW tokens beyond the primary (drop near-dupes).
      const toks = c.phrase.split(' ')
      return toks.some(t => !primaryToks.has(t))
    })
    .slice(0, 5)
    .map(c => c.phrase)

  return { primary, supporting, candidates: ranked.slice(0, 12) }
}
