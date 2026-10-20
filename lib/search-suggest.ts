// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT PEOPLE ACTUALLY TYPE, from the search boxes themselves (Seb,
// 2026-10-20: "Can we just not have a simple search online that MVP does to
// make sure that the tags and the hashtags that we're using are not only
// legit, but useful and popular? ... We could build from what people
// actually type into YouTube search boxes, like actual real searches, and
// keep only the ones that match the video ... check the main keyword against
// Google search suggestion the same way").
//
// YouTube's and Google's search suggestions (suggestqueries.google.com) and
// Amazon's (completion.amazon.com): free, no key, no account. Each answer is
// remembered for everyone for a week (search_suggestions, migration 449), so
// the next member writing about the same thing gets it at once and MVP does
// not ask the same thing thousands of times. A box that did not answer is an
// empty list, never a guess, and is not remembered.
//
// matchesContent is the other half: a search is kept only when every real
// word in it is a word of the content (or a usual search word like "review"
// or "for adults"), so "fat tire ebike rack" never tags a video about the
// e-bike itself.

export type SuggestEngine = 'youtube' | 'google' | 'amazon'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
export const SUGGEST_TIMEOUT_MS = 3000
export const SUGGEST_REMEMBER_DAYS = 7
const YEAR = /\b(?:19|20)\d\d\b/

/** A search, cleaned to plain lowercase words. */
export function cleanSearch(s: string): string {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The seed as it is remembered (one row per engine and seed). */
export function seedKey(seed: string): string {
  return cleanSearch(seed).slice(0, 80)
}

async function ask(engine: SuggestEngine, seed: string): Promise<string[] | null> {
  const q = encodeURIComponent(seed)
  const url = engine === 'amazon'
    ? `https://completion.amazon.com/api/2017/suggestions?limit=11&prefix=${q}&alias=aps&mid=ATVPDKIKX0DER&site-variant=desktop&client-info=amazon-search-ui&lop=en_US&b2b=0&fresh=0&suggestion-type=KEYWORD`
    : `https://suggestqueries.google.com/complete/search?client=firefox&hl=en${engine === 'youtube' ? '&ds=yt' : ''}&q=${q}`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS) })
    if (!r.ok) return null
    const j = JSON.parse(await r.text()) as unknown
    const list = engine === 'amazon'
      ? ((j as { suggestions?: Array<{ type?: string; value?: string }> }).suggestions || []).filter((s) => s.type === 'KEYWORD').map((s) => s.value)
      : (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [])
    return (list as unknown[]).filter((s): s is string => typeof s === 'string').map(cleanSearch).filter((s) => s.length >= 3 && s.length <= 80 && !YEAR.test(s)).slice(0, 12)
  } catch { return null }
}

export interface Suggested { engine: SuggestEngine; seed: string; phrases: string[]; remembered: boolean; answered: boolean }

/** What the engine's search box suggests after these words, remembered for a
 *  week when `admin` (the service client) is given. Never throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function suggest(engine: SuggestEngine, seedRaw: string, admin?: any): Promise<Suggested> {
  const seed = seedKey(seedRaw)
  if (seed.length < 3) return { engine, seed, phrases: [], remembered: false, answered: false }
  if (admin) {
    try {
      const since = new Date(Date.now() - SUGGEST_REMEMBER_DAYS * 86_400_000).toISOString()
      const { data } = await admin.from('search_suggestions').select('phrases').eq('engine', engine).eq('seed', seed).gte('seen_at', since).maybeSingle()
      if (data && Array.isArray(data.phrases)) return { engine, seed, phrases: data.phrases as string[], remembered: true, answered: true }
    } catch { /* asked now, below */ }
  }
  const phrases = await ask(engine, seed)
  if (phrases && admin) {
    try { await admin.from('search_suggestions').upsert({ engine, seed, phrases, seen_at: new Date().toISOString() }, { onConflict: 'engine,seed' }) } catch { /* used for this post anyway */ }
  }
  return { engine, seed, phrases: phrases || [], remembered: false, answered: !!phrases }
}

/** Words a search adds without changing what it is about. Who it is for
 *  ("kids", "women") and what kind of video it is ("assembly", "unboxing")
 *  are not among them: those must be in the content to count. */
export const SEARCH_WORDS = new Set([
  'review', 'reviews', 'reviewed', 'best', 'top', 'vs', 'versus', 'worth', 'it', 'price', 'new', 'honest', 'real',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'with', 'for', 'to', 'is', 'my', 'your', 'you', 'should', 'i',
  'buy', 'buying', 'guide', 'tips', 'pros', 'cons', 'comparison', 'compared',
])

/** Every word of the content, joined hyphen words and singular and plural
 *  forms included, for matchesContent. Pure. */
export function contentVocab(text: string): Set<string> {
  const raw = String(text || '').toLowerCase().replace(/['’]/g, '')
  const out = new Set<string>()
  const add = (w: string) => {
    if (w.length < 2) return
    out.add(w)
    if (w.endsWith('es') && w.length > 4) out.add(w.slice(0, -2))
    if (w.endsWith('s') && w.length > 3) out.add(w.slice(0, -1))
    else out.add(`${w}s`)
  }
  for (const w of raw.match(/[a-z0-9]+/g) || []) add(w)
  for (const w of raw.match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) || []) add(w.replace(/-/g, ''))
  return out
}

/** Is this search about the content? Every word in it is a word of the
 *  content or a usual search word, and at least one is a real content word
 *  (not just "best review"). Pure. */
export function matchesContent(phrase: string, vocab: Set<string>): boolean {
  const words = cleanSearch(phrase).split(' ').filter(Boolean)
  if (!words.length || YEAR.test(phrase)) return false
  let real = 0
  for (const w of words) {
    if (vocab.has(w)) { if (!SEARCH_WORDS.has(w)) real++; continue }
    if (SEARCH_WORDS.has(w)) continue
    return false
  }
  return real > 0
}

/** Words a video title says that nobody searches with ("Don't buy this e-bike
 *  until you see it"): taken out before a title seeds a search. */
const SENTENCE_WORDS = new Set([
  'why', 'how', 'what', 'when', 'where', 'who', 'which', 'dont', 'cant', 'wont', 'isnt', 'didnt', 'doesnt', 'stop', 'never',
  'always', 'every', 'this', 'these', 'that', 'those', 'here', 'there', 'its', 'our', 'your', 'you', 'they', 'their', 'is', 'are',
  'was', 'were', 'do', 'does', 'did', 'should', 'would', 'could', 'will', 'can', 'must', 'before', 'after', 'until', 'see', 'watch',
  'look', 'meet', 'try', 'tried', 'buy', 'buying', 'bought', 'get', 'got', 'need', 'want', 'really', 'actually', 'finally', 'honest',
  'honestly', 'i', 'im', 'ive', 'my', 'me', 'we', 'us', 'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'it', 'be', 'so', 'just', 'now', 'yet', 'all', 'one', 'more', 'most', 'very', 'too', 'wow', 'omg', 'insane', 'crazy', 'shocking',
  'secret', 'truth', 'mistake', 'mistakes', 'regret', 'worth', 'vs', 'better', 'worst', 'best', 'top', 'new', 'review', 'unboxing',
])

/** A video title's searchable words, in order ("Don't Buy a Fat Tire E-Bike
 *  Until You See This" -> fat tire ebike). Pure. */
export function titleTopic(title: string, max = 4): string {
  const words = String(title || '').toLowerCase().replace(/['’]/g, '').replace(/\b([a-z0-9]+)-([a-z0-9]+)\b/g, '$1$2').match(/[a-z0-9]+/g) || []
  return words.filter((w) => !SENTENCE_WORDS.has(w) && !YEAR.test(w) && !/^\d+$/.test(w) && w.length >= 2).slice(0, max).join(' ')
}
