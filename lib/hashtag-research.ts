// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIVE HASHTAG RESEARCH, FOR EACH POST (Seb, 2026-10-20: "Do we actually go
// online to find and pick the winning hashtags? ... I love a hashtag that is
// anywhere between 10,000 and 200,000 searches. That usually hits well, way
// better than a hashtag like the word bike").
//
// Before, the engine only scored a fixed list (MVP's category tags, the
// writer's guesses, TikTok's trending list) against the few counts the nightly
// read happened to have: about 260 tags for every product there is. Now each
// post's possible tags are found from the product itself (what it is and the
// forms people tag it with, what people type into YouTube after its name, its
// brand, the writer's suggestions) and counted on YouTube there and then, from
// its public hashtag pages. Every count goes in the shared table, so the next
// member's post about the same thing has it at once. Instagram's counts need a
// signed-in browser: the tags are asked for (hashtag_wanted, migration 448)
// and SCOUT reads them quietly, through an Instagram tab the creator has open.
//
// BOUNDED: a few seconds at most, a count YouTube did not give is never taken
// as zero, and any failure leaves the pick to what MVP already knew.

import { hashify, deriveBrandTag } from '@/lib/hashtag-map'
import { productKinds, tagProblem, contentWords, type TrendTag } from '@/lib/hashtag-engine'
import { readYouTubeHashtag, youtubeSuggestions, saveTrends, type TrendRow } from '@/lib/hashtag-trends'

/** Tags counted live in one post, at once, and how long the post may wait. */
export const RESEARCH_MAX_READS = 16
export const RESEARCH_AT_ONCE = 8
/** YouTube pages read at once by one server, however many captions are being
 *  written (the scheduler writes 15 together): a caption that finds them all
 *  busy uses the counts MVP already has. */
export const YOUTUBE_IN_FLIGHT_MAX = 8
let inFlight = 0
export const RESEARCH_BUDGET_MS = 3500
/** A YouTube count is read again after a week; any count older than this is not used. */
export const YOUTUBE_RECOUNT_DAYS = 7
export const COUNT_FRESH_DAYS = 14

/** The forms a product is tagged with (#ebike, #ebikes, #ebikelife, #ebikereview). */
const FORMS = ['', 's', 'life', 'review', 'tips']
const LONGEST = 24
const NOT_A_WORD = new Set(['for', 'the', 'and', 'with', 'vs', 'versus', 'how', 'to', 'best', 'top', 'new', 'cheap', 'near', 'me', 'under', 'of', 'in', 'on', 'a', 'an', 'is', 'my'])

const usable = (t: string) => { const { tag, problem } = tagProblem(t); return !problem && tag.length - 1 <= LONGEST ? tag : null }

/** What to ask YouTube's search box about: what the product is, and the
 *  first two words of the product's name after its brand ("Jasion EB7 Fat
 *  Tire Electric Bike" -> "fat tire"). A video title is no seed ("Don't buy
 *  this"): only the product's name is. Pure. */
export function suggestionSeeds(text: string, product?: string | null): string[] {
  const { kinds } = productKinds(text)
  const name = String(product || '')
  const brandWord = (deriveBrandTag(name) || '').slice(1)
  const lead = (name.toLowerCase().match(/[a-z][a-z0-9-]*/g) || []).filter((w) => w.replace(/-/g, '') !== brandWord && !/\d/.test(w) && !NOT_A_WORD.has(w) && w.length >= 3)
  const seeds = [kinds[0], lead.slice(0, 2).join(' ')].map((s) => String(s || '').trim()).filter((s) => s.length >= 3)
  return Array.from(new Set(seeds)).slice(0, 2)
}

/** Searches people type, made into tags when they read as one: two or three
 *  real words ("fat tire ebike" -> #fattireebike). Pure. */
export function tagsFromSearches(phrases: string[]): string[] {
  const out: string[] = []
  for (const p of phrases) {
    const words = String(p || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    if (!words.length || words.length > 3 || words.some((w) => NOT_A_WORD.has(w) || /^\d+$/.test(w))) continue
    const tag = usable(words.join(''))
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** Every tag worth counting for this post, the likeliest first: the brand,
 *  what the product is in the forms people tag it with, what people search
 *  for after its name, the writer's suggestions, then MVP's category tags. Pure. */
export function tagCandidates(input: { text: string; brand?: string | null; niches?: string[]; writer?: string[]; searches?: string[] }): string[] {
  const { cats, kinds } = productKinds(input.text, input.niches)
  const words = contentWords(input.text)
  const list: string[] = []
  const add = (t: string | null | undefined) => { const tag = t ? usable(t) : null; if (tag && !list.includes(tag)) list.push(tag) }
  add(deriveBrandTag(input.brand || ''))
  for (const k of kinds.slice(0, 2)) { const body = hashify(k).slice(1); for (const f of FORMS) add(f === 's' && body.endsWith('s') ? null : body + f) }
  for (const t of tagsFromSearches(input.searches || [])) add(t)
  // The writer's, when they are about the content (a word of it in the tag).
  for (const w of input.writer || []) { const body = hashify(w).slice(1); if (Array.from(words).some((x) => x.length >= 4 && body.includes(x))) add(w) }
  for (const c of cats) for (const t of [...c.niche, ...c.mid, ...c.broad]) add(t)
  return list.slice(0, 32)
}

export interface CountRow extends TrendTag { platform: string; seen_at?: string | null }
export interface Research {
  /** Every tag considered for the post. */
  candidates: string[]
  /** What each platform counted for them (fresh), the reads made now included. */
  counts: CountRow[]
  /** Counted on YouTube for this post, and how many YouTube answered. */
  asked: number
  read: number
}

const within = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

/** Find and count this post's tags. Never throws; on any failure it returns
 *  what it had. `admin` is the service client (shared table). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function researchTags(admin: any, input: { text: string; brand?: string | null; niches?: string[]; writer?: string[] }, opts: { budgetMs?: number; read?: typeof readYouTubeHashtag; suggest?: typeof youtubeSuggestions } = {}): Promise<Research> {
  const started = Date.now()
  const budget = opts.budgetMs ?? RESEARCH_BUDGET_MS
  const read = opts.read ?? readYouTubeHashtag
  const suggest = opts.suggest ?? youtubeSuggestions
  const searches = (await within(Promise.all(suggestionSeeds(input.text, input.brand).map((s) => suggest(s, 8))), 1500, [] as string[][])).flat()
  const candidates = tagCandidates({ ...input, searches })
  const out: Research = { candidates, counts: [], asked: 0, read: 0 }
  if (!candidates.length) return out

  // What is already counted, on any platform.
  try {
    const since = new Date(Date.now() - COUNT_FRESH_DAYS * 86_400_000).toISOString()
    const { data } = await within(Promise.resolve(admin.from('hashtag_trends').select('platform, tag, source, rank, posts, views, label, seen_at').in('tag', candidates).gte('seen_at', since).limit(400)), 1500, { data: null } as { data: null })
    out.counts = ((data || []) as CountRow[]).filter((r) => r && r.tag)
  } catch { /* counted now, below */ }

  // YouTube, now: each tag nobody counted this week, from its public page.
  const recount = Date.now() - YOUTUBE_RECOUNT_DAYS * 86_400_000
  const fresh = new Set(out.counts.filter((r) => r.platform === 'youtube' && r.seen_at && new Date(r.seen_at).getTime() >= recount).map((r) => r.tag))
  const todo = candidates.filter((t) => !fresh.has(t)).slice(0, RESEARCH_MAX_READS)
  const got: TrendRow[] = []
  let next = 0
  while (next < todo.length) {
    const left = budget - (Date.now() - started)
    if (left < 400) break
    const room = Math.min(RESEARCH_AT_ONCE, YOUTUBE_IN_FLIGHT_MAX - inFlight)
    if (room <= 0) break
    const batch = todo.slice(next, next + room)
    next += batch.length
    out.asked += batch.length
    inFlight += batch.length
    const reads = Promise.all(batch.map((t) => read(t)))
    void reads.catch(() => null).finally(() => { inFlight -= batch.length })
    const rows = await within(reads, left, [] as Array<TrendRow | null>)
    for (const r of rows) if (r) got.push(r)
  }
  out.read = got.length
  if (got.length) {
    try { await within(saveTrends(admin, got), 1500, { saved: 0, error: 'slow' }) } catch { /* used for this post anyway */ }
    const now = new Date().toISOString()
    out.counts = [...out.counts.filter((r) => !(r.platform === 'youtube' && got.some((g) => g.tag === r.tag))), ...got.map((g) => ({ ...g, platform: g.platform, seen_at: now }))]
  }

  // INSTAGRAM, ASKED FOR: the tags Instagram has not counted, unless YouTube
  // shows almost nobody uses them. SCOUT reads them quietly (migration 448).
  try {
    const igHas = new Set(out.counts.filter((r) => r.platform === 'instagram').map((r) => r.tag))
    const ytTiny = new Set(out.counts.filter((r) => r.platform === 'youtube' && typeof r.posts === 'number' && r.posts < 200).map((r) => r.tag))
    const wanted = candidates.filter((t) => !igHas.has(t) && !ytTiny.has(t)).slice(0, 20)
    if (wanted.length) {
      const now = new Date().toISOString()
      await within(Promise.resolve(admin.from('hashtag_wanted').upsert(wanted.map((tag) => ({ platform: 'instagram', tag, wanted_at: now })), { onConflict: 'platform,tag' })), 1000, null)
    }
  } catch { /* before migration 448 the background read uses the creator's own tags */ }
  return out
}

/** The counts split for one platform's pick: its own (the engine's trends)
 *  and the other platforms' (a weaker guide, said as such). Pure. */
export function splitCounts(counts: CountRow[], platform: string): { own: TrendTag[]; elsewhere: CountRow[] } {
  const own: TrendTag[] = []
  const elsewhere: CountRow[] = []
  for (const r of counts) {
    const t: TrendTag = { tag: r.tag, source: r.source, rank: r.rank ?? null, posts: r.posts ?? null, views: r.views ?? null, label: r.label ?? null }
    if (r.platform === platform) own.push(t)
    else elsewhere.push({ ...t, platform: r.platform })
  }
  return { own, elsewhere }
}
