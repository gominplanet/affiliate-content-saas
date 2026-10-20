// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE HASHTAG ENGINE (Seb, 2026-10-16: "whenever MVP is using hashtags or
// posting hashtags on anything we create, we should really have a great way,
// a perfect way, a bulletproof way to find the best hashtags for that
// particular content every time").
//
// Before this, about twenty places each invented their own rule: 15 to 25
// tags for an Instagram post (Instagram now allows 5), 18 to 22 for YouTube
// (which ignores every hashtag past 15), 2 to 3 for Threads (one topic tag a
// post), and fallbacks that shipped the very tags MVP calls spam. Now every
// place asks this one engine.
//
// The writer (AI) writes the words and may suggest tags; the engine picks the
// tags, from, in order of trust:
//   1. what lifted YOUR reach on this platform (Pulse, lib/pulse-rank)
//   2. what is trending on this platform AND is about this content
//      (lib/hashtag-trends: TikTok Creative Center, YouTube, Instagram)
//   3. MVP's category tags for the product (lib/hashtag-map), and its brand
//   4. what lifted other members' reach in the same niche
//   5. the writer's own suggestions, when they are about the content
// Every pick says where it came from, so the screen can show why. Pure: the
// data is loaded by lib/hashtag-data, never here.

import { SPAM, hashify, deriveBrandTag, categoriesFor } from '@/lib/hashtag-map'

export type TagPlatform =
  | 'instagram' | 'tiktok' | 'youtube' | 'youtube_short' | 'facebook' | 'facebook_group'
  | 'threads' | 'x' | 'bluesky' | 'linkedin' | 'pinterest' | 'telegram'

export interface PlatformRule {
  /** Discovery tags to aim for (the disclosure #ad is not one of them). */
  min: number
  max: number
  /** Hashtags the platform takes in all, #ad included; past it they are dropped. */
  hardMax: number
  /** Tags the disclosure adds that count toward hardMax (Instagram: #ad). */
  disclosure: number
  says: string
}

/** THE ONE RULEBOOK. Counts are each platform's own rule where it has one,
 *  else the range its own guidance gives. */
export const TAG_RULES: Record<TagPlatform, PlatformRule> = {
  instagram: { min: 3, max: 4, hardMax: 5, disclosure: 1, says: 'Instagram takes 5 hashtags a post: #ad and 4 that help people find it.' },
  tiktok: { min: 3, max: 5, hardMax: 6, disclosure: 0, says: '3 to 5 on TikTok: a few specific tags beat a long list.' },
  youtube: { min: 3, max: 5, hardMax: 15, disclosure: 0, says: '3 to 5 in a YouTube description; past 15, YouTube ignores them all.' },
  youtube_short: { min: 3, max: 5, hardMax: 15, disclosure: 0, says: '3 to 5 on a Short; past 15, YouTube ignores them all.' },
  facebook: { min: 0, max: 3, hardMax: 3, disclosure: 0, says: 'Up to 3 on Facebook, and none on a plain link post.' },
  facebook_group: { min: 0, max: 3, hardMax: 3, disclosure: 0, says: 'Up to 3 in a Facebook Group post.' },
  threads: { min: 1, max: 1, hardMax: 1, disclosure: 0, says: 'Threads links one topic tag a post.' },
  x: { min: 0, max: 1, hardMax: 2, disclosure: 0, says: 'One at most on X: tags take room from 280 characters.' },
  bluesky: { min: 0, max: 1, hardMax: 2, disclosure: 0, says: 'One at most on Bluesky.' },
  linkedin: { min: 2, max: 3, hardMax: 5, disclosure: 0, says: '3 on LinkedIn.' },
  pinterest: { min: 0, max: 3, hardMax: 5, disclosure: 0, says: 'A few on Pinterest; the words in the title and description do the work.' },
  telegram: { min: 0, max: 1, hardMax: 2, disclosure: 0, says: 'One at most on Telegram.' },
}

/** Each platform by name, for the words. */
export const PLATFORM_NAME: Record<TagPlatform, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', youtube_short: 'YouTube', facebook: 'Facebook', facebook_group: 'Facebook',
  threads: 'Threads', x: 'X', bluesky: 'Bluesky', linkedin: 'LinkedIn', pinterest: 'Pinterest', telegram: 'Telegram',
}

export type TagSource = 'yours' | 'trend' | 'measured' | 'brand' | 'category' | 'members' | 'writer' | 'keyword'
export interface PickedTag { tag: string; source: TagSource; why: string }
export interface TagStatLite { tag: string; samples: number; avgLift: number }
export interface TrendTag {
  tag: string
  /** Where it was read: tiktok_cc (TikTok Creative Center), youtube (its hashtag page), instagram (its tag page). */
  source: string
  rank?: number | null
  posts?: number | null
  views?: number | null
  label?: string | null
}

/** What a platform's own count says about a tag: 'dead' (almost nobody posts
 *  with it, so almost nobody browses it), 'crowd' (so many posts a new one is
 *  buried within minutes), or 'active'. 'unknown' when there is no count.
 *  TikTok Creative Center's list is trending by definition. */
export function trendStanding(t: Pick<TrendTag, 'source' | 'posts'>): 'dead' | 'active' | 'crowd' | 'unknown' {
  if (t.source === 'tiktok_cc') return 'active'
  if (typeof t.posts !== 'number' || !Number.isFinite(t.posts)) return 'unknown'
  if (t.source === 'youtube') return t.posts < 200 ? 'dead' : 'active'
  if (t.source === 'instagram') return t.posts < 2000 ? 'dead' : t.posts > 300_000_000 ? 'crowd' : 'active'
  return 'unknown'
}

/** THE SWEET SPOT (Seb, 2026-10-20: "I love a hashtag that is anywhere
 *  between 10,000 and 200,000 ... That usually hits well, way better than a
 *  hashtag like the word bike"). The platforms show how many posts use a tag,
 *  not how many people search it; posts are the count they give. */
export const SWEET_SPOT = { min: 10_000, max: 200_000 } as const
/** Past this a tag is a crowd: a new post is buried in minutes (#bike, 10M). */
export const CROWD_FROM = 10_000_000

export function inSweetSpot(posts: number | null | undefined): boolean {
  return typeof posts === 'number' && posts >= SWEET_SPOT.min && posts <= SWEET_SPOT.max
}

/** How good a tag's own count is for reaching buyers, from what the platform
 *  showed: 10K to 200K posts scores highest, then just around it (2K to 10K,
 *  200K to 1M), then a small tag, then a big one (1M to 10M); one MVP has no
 *  count for sits below those, a crowd lower still, and a dead end is never
 *  used. TikTok's own trend list is trending by definition. */
export function sizeScore(t: Pick<TrendTag, 'source' | 'posts' | 'rank'> | null | undefined): number {
  if (!t) return 1
  if (t.source === 'tiktok_cc') return (inSweetSpot(t.posts) ? 4 : 3) + 1 / Math.max(1, t.rank ?? 10)
  const st = trendStanding(t)
  if (st === 'dead') return -1
  if (typeof t.posts !== 'number' || !Number.isFinite(t.posts)) return 1
  const n = t.posts
  if (inSweetSpot(n)) return 4
  if ((n >= 2_000 && n < SWEET_SPOT.min) || (n > SWEET_SPOT.max && n <= 1_000_000)) return 3
  if (n < 2_000) return 1.2
  if (n < CROWD_FROM) return 1.5
  return 0.5
}

export interface TagInput {
  platform: TagPlatform
  /** Everything about the content: product title, description, script, niche words. */
  text: string
  brand?: string | null
  niches?: string[]
  /** The writer's own suggestions for this post. */
  writer?: string[]
  /** Pulse, this platform only. */
  yours?: TagStatLite[]
  members?: TagStatLite[]
  /** Trending on this platform (any topic: the engine keeps the relevant ones). */
  trends?: TrendTag[]
  /** Tags MVP found for this post (lib/hashtag-research): used when a
   *  platform's own count puts them in the sweet spot. */
  found?: string[]
  /** Counts read on the other platforms: a weaker guide, said as such, when
   *  this platform has none for a tag. */
  elsewhere?: Array<TrendTag & { platform?: string }>
  /** Tags the creator always wants (their brand, their series), kept first. */
  always?: string[]
  /** Fewer than the rule (0 = none: a Facebook link post). */
  count?: number
}

export interface TagPick { tags: PickedTag[]; dropped: Array<{ tag: string; why: string }>; rule: PlatformRule }

const YEAR = /(?:19|20)\d\d/
/** A usable tag, or why not. Never: spam, a year, all digits, a stub or a sentence. */
export function tagProblem(raw: string): { tag: string; problem: string | null } {
  const tag = hashify(raw)
  const body = tag.slice(1)
  if (!tag || body.length < 3) return { tag, problem: 'too short' }
  if (body.length > 30) return { tag, problem: 'too long to read' }
  if (/^\d+$/.test(body)) return { tag, problem: 'only a number' }
  if (YEAR.test(body)) return { tag, problem: 'has a year in it' }
  if (SPAM.has(body)) return { tag, problem: 'generic tag that reaches nobody in particular' }
  if (body === 'sponsored') return { tag, problem: 'disclosure, added separately' }
  return { tag, problem: null }
}

const WORD = /[a-z][a-z0-9]{2,}/g
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'your', 'you', 'our', 'are', 'from', 'have', 'has', 'its', 'can', 'all', 'new', 'best', 'top', 'get', 'how', 'why', 'what', 'who', 'one', 'out', 'use', 'now', 'more', 'most', 'just', 'like', 'make', 'made', 'into', 'over', 'review', 'video', 'amazon', 'link', 'bio', 'shop', 'buy'])
/** The content's words, singular and plural, for the relevance check. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>()
  // "E-Bike" is tagged #ebike: a hyphenated word counts joined, as well as in parts.
  const joined = (String(text || '').toLowerCase().match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) || []).map((w) => w.replace(/-/g, '')).join(' ')
  for (const w of `${String(text || '').toLowerCase()} ${joined}`.match(WORD) || []) {
    if (STOP.has(w)) continue
    out.add(w)
    if (w.endsWith('es') && w.length > 4) out.add(w.slice(0, -2))
    if (w.endsWith('s') && w.length > 3) out.add(w.slice(0, -1))
    else out.add(`${w}s`)
  }
  // Two words run together, as hashtags are written ("air fryer" -> airfryer).
  const list = String(text || '').toLowerCase().match(WORD) || []
  for (let i = 0; i + 1 < list.length; i++) if (!STOP.has(list[i]) && !STOP.has(list[i + 1])) out.add(list[i] + list[i + 1])
  return out
}

/** The pairs contentWords runs together ("air fryer" -> airfryer). */
function wordPairs(text: string): Set<string> {
  const out = new Set<string>()
  const list = String(text || '').toLowerCase().match(WORD) || []
  for (let i = 0; i + 1 < list.length; i++) if (!STOP.has(list[i]) && !STOP.has(list[i + 1])) out.add(list[i] + list[i + 1])
  return out
}

/** Is this tag about this content? A word of the content inside the tag, or
 *  the tag inside a word of the content. Short words only match whole. */
/** Words a hashtag adds to a product without changing what it is about
 *  (#airfryerrecipes, #cleaninghacks, #skincareroutine). */
const ADD_ON = new Set(['recipe', 'recipes', 'hack', 'hacks', 'tip', 'tips', 'tok', 'review', 'reviews', 'finds', 'ideas', 'idea', 'routine', 'essentials', 'lover', 'lovers', 'life', 'tutorial', 'tricks', 'tested', 'test', 'setup', 'goals', 'care', 'day', 'daily', 'time', 'season', 'must', 'haves', 'unboxing', 'tiktok', 'check', 'challenge'])

/** A TRENDING tag is about this content only when it is made of the
 *  content's own words, with at most add-ons like "recipes" or "hacks", and
 *  at least one real word of the content in it. #cordlessvacuum is about a
 *  cordless vacuum; #cordlessblower is not, though it shares "cordless". */
export function madeOfContent(tag: string, words: Set<string>): boolean {
  const body = tag.replace(/^#/, '').toLowerCase()
  if (!body || words.has(body)) return !!body
  // Fewest pieces first; reach[i] = the tag up to i is covered, and whether a real content word is in it.
  const reach: Array<{ ok: boolean; real: boolean }> = Array.from({ length: body.length + 1 }, () => ({ ok: false, real: false }))
  reach[0] = { ok: true, real: false }
  for (let i = 0; i < body.length; i++) {
    if (!reach[i].ok) continue
    for (let j = i + 3; j <= body.length; j++) {
      const piece = body.slice(i, j)
      const real = piece.length >= 4 && words.has(piece)
      if (real || ADD_ON.has(piece) || (piece.length >= 3 && words.has(piece))) {
        const next = { ok: true, real: reach[i].real || real }
        if (!reach[j].ok || (next.real && !reach[j].real)) reach[j] = next
      }
    }
  }
  return reach[body.length].ok && reach[body.length].real
}

/** Little words a tag may run in between the real ones (#catsofinstagram). */
const JOIN = new Set(['of', 'in', 'on', 'my', 'to', 'up', 'at', 'for', 'the', 'and', 'with', 'insta', 'instagram', 'gram', 'gear', 'love', 'finds'])

/** How many words a tag runs together, read with the content's own words,
 *  the usual add-ons and the category's terms (#fattireebikecommute is fat,
 *  tire, ebike, commute: 4). The fewest pieces that cover the whole tag, or
 *  null when it cannot be read that way. Pure. */
export function wordsInTag(tag: string, vocab: Set<string>): number | null {
  const body = tag.replace(/^#/, '').toLowerCase()
  if (!body) return null
  const cost: number[] = Array(body.length + 1).fill(Infinity)
  cost[0] = 0
  for (let i = 0; i < body.length; i++) {
    if (cost[i] === Infinity) continue
    for (let j = i + 2; j <= body.length; j++) {
      const piece = body.slice(i, j)
      if (vocab.has(piece) || ADD_ON.has(piece) || JOIN.has(piece) || STOP.has(piece)) cost[j] = Math.min(cost[j], cost[i] + 1)
    }
  }
  return cost[body.length] === Infinity ? null : cost[body.length]
}

/** A tag nobody searches for, because it is a phrase with its spaces taken
 *  out, or null when it reads as a tag. For tags MVP did not vet itself (the
 *  writer's, a niche the creator typed, the content's own words): a category
 *  or trending tag has proved people use it. */
export function phraseProblem(tag: string, vocab: Set<string>): string | null {
  const body = tag.replace(/^#/, '')
  const n = wordsInTag(tag, vocab)
  if (n != null && n >= 4) return `${n} words run together: nobody searches for that`
  if (body.length > 18) return 'too long: nobody searches for a tag that long'
  return null
}

export function aboutContent(tag: string, words: Set<string>): boolean {
  const body = tag.replace(/^#/, '').toLowerCase()
  if (words.has(body)) return true
  for (const w of words) {
    if (w.length >= 4 && body.includes(w)) return true
    if (body.length >= 5 && w.includes(body)) return true
  }
  return false
}

/** The product's categories (a second only when it is as strong as the
 *  first: one "gadget" in an air fryer's text is not a reason for tech tags)
 *  and WHAT IT IS: the category's own terms the content names, longest first
 *  ("air fryer" -> #airfryer), the tag people search for the product. Pure. */
export function productKinds(text: string, niches?: string[]): { cats: ReturnType<typeof categoriesFor>; kinds: string[] } {
  const allCats = categoriesFor(`${text || ''} ${(niches || []).join(' ')}`, 2)
  const cats = allCats.filter((c, i) => i === 0 || c.score >= allCats[0].score)
  const hay = ` ${String(text || '').toLowerCase()} `
  const kinds = cats.flatMap((c) => c.match.filter((m) => m.length >= 4 && new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay))).sort((a, b) => b.length - a.length)
  return { cats, kinds }
}

/** Pick the hashtags for one post. */
export function pickHashtags(input: TagInput): TagPick {
  const rule = TAG_RULES[input.platform]
  const want = Math.max(0, Math.min(rule.max, input.count ?? rule.max))
  const dropped: TagPick['dropped'] = []
  if (want === 0) return { tags: [], dropped, rule }

  const words = contentWords(`${input.text || ''} ${(input.niches || []).join(' ')} ${input.brand || ''}`)
  const { cats, kinds } = productKinds(input.text, input.niches)
  const catTags = new Set(cats.flatMap((c) => [...c.niche, ...c.mid, ...c.broad]).map((t) => hashify(t)))
  for (const k of kinds) catTags.add(hashify(k))
  const relevant = (tag: string) => aboutContent(tag, words) || catTags.has(tag)

  const out: PickedTag[] = []
  const seen = new Set<string>()
  let broadUsed = 0
  const pairs = wordPairs(`${input.text || ''} ${(input.niches || []).join(' ')}`)
  const trendBy = new Map((input.trends || []).map((t) => [hashify(t.tag), t] as const))
  // A tag the platform itself shows as a dead end is never used (the brand's
  // own tag excepted: brand tags are small and still the brand's).
  const deadBy = new Map((input.trends || []).filter((t) => trendStanding(t) === 'dead').map((t) => [hashify(t.tag), t] as const))
  // What another platform counted, for a tag this one has no count for.
  const elseBy = new Map<string, TrendTag>()
  for (const t of input.elsewhere || []) { const k = hashify(t.tag); if (typeof t.posts === 'number' && (!elseBy.has(k) || sizeScore(t) > sizeScore(elseBy.get(k)))) elseBy.set(k, t) }
  const here = PLATFORM_NAME[input.platform]
  /** A tag's count and how good it is: this platform's own, else another's
   *  (a little lower, and said as such). Null when nobody counted it. */
  const countOf = (tag: string): { row: TrendTag; score: number; own: boolean; why: string } | null => {
    const own = trendBy.get(tag)
    if (own && (typeof own.posts === 'number' || own.source === 'tiktok_cc')) return { row: own, score: sizeScore(own), own: true, why: trendWhy(own) }
    const other = elseBy.get(tag)
    if (other) return { row: other, score: trendStanding(other) === 'dead' ? 0.8 : sizeScore(other) - 0.25, own: false, why: `${trendWhy(other)}; not counted on ${here} yet` }
    return null
  }
  // A crowd (#bike, 10M posts) waits: used only when nothing else is left.
  const deferred: Array<{ raw: string; source: TagSource; why: string; opts: TakeOpts }> = []
  const deferredSet = new Set<string>()
  // The pieces a tag may be read in: the content's single words (not the
  // pairs contentWords runs together, which would hide a phrase) and the
  // category's own tags and terms.
  const vocab = new Set<string>(Array.from(contentWords(`${input.text || ''} ${(input.niches || []).join(' ')}`)).filter((w) => !hasPair(w)))
  for (const t of catTags) vocab.add(t.slice(1))
  for (const c of cats) for (const m of c.match) for (const w of m.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 2) vocab.add(w)
  function hasPair(w: string) { return pairs.has(w) }
  type TakeOpts = { needsRelevance?: boolean; broad?: boolean; unvetted?: boolean; last?: boolean }
  const take = (raw: string | null | undefined, source: TagSource, why: string, opts: TakeOpts = {}): boolean => {
    if (!raw || out.length >= want) return out.length >= want
    const { tag, problem } = tagProblem(raw)
    if (!tag || seen.has(tag)) return out.length >= want
    if (problem) { dropped.push({ tag, why: problem }); seen.add(tag); return false }
    // A phrase with its spaces taken out is not a tag anyone browses, unless
    // MVP's own lists or the platform's trend list say people use it.
    const phrase = opts.unvetted && !catTags.has(tag) && !((countOf(tag)?.score ?? 0) >= 3) ? phraseProblem(tag, vocab) : null
    if (phrase) { dropped.push({ tag, why: phrase }); seen.add(tag); return false }
    if (opts.needsRelevance && !relevant(tag)) { dropped.push({ tag, why: 'not about this content' }); seen.add(tag); return false }
    const dead = deadBy.get(tag)
    if (dead && source !== 'brand') { dropped.push({ tag, why: dead.source === 'youtube' ? `almost no videos use it on YouTube (${compact(dead.posts || 0)})` : `almost no posts use it on Instagram (${compact(dead.posts || 0)})` }); seen.add(tag); return false }
    const counted = countOf(tag)
    if (counted && counted.row.source !== 'tiktok_cc' && (counted.row.posts ?? 0) >= CROWD_FROM && source !== 'brand' && !opts.last) {
      if (!deferredSet.has(tag)) { deferredSet.add(tag); deferred.push({ raw: tag, source, why, opts }) }
      return false
    }
    // One huge-reach tag at most: the rest reach the people who buy.
    if (opts.broad && broadUsed >= 1) return false
    if (opts.broad) broadUsed++
    seen.add(tag)
    deferredSet.delete(tag)
    // A tag that is also trending says so: that is the stronger reason.
    const tr = trendBy.get(tag)
    // Only TikTok's own trend list makes a tag "Trending"; a count Instagram
    // or YouTube showed is said beside the reason it was picked, as is a
    // count from another platform when this one has none.
    if (tr && trendStanding(tr) === 'active' && (source === 'category' || source === 'writer' || source === 'keyword')) {
      if (tr.source === 'tiktok_cc') out.push({ tag, source: 'trend', why: trendWhy(tr) })
      else out.push({ tag, source, why: `${why}; ${trendWhy(tr)}` })
    } else if (counted && source !== 'measured' && source !== 'trend' && !why.includes(counted.why)) out.push({ tag, source, why: `${why}; ${counted.why}` })
    else out.push({ tag, source, why })
    return out.length >= want
  }

  const brandTag = deriveBrandTag(input.brand || '')
  const yours = (input.yours || []).filter((t) => t.avgLift >= 1.1).sort((a, b) => b.avgLift - a.avgLift)
  const members = (input.members || []).filter((t) => t.avgLift >= 1.1).sort((a, b) => b.avgLift - a.avgLift)
  const trends = (input.trends || []).filter((t) => (madeOfContent(hashify(t.tag), words) || catTags.has(hashify(t.tag))) && trendStanding(t) === 'active')
    .sort((a, b) => sizeScore(b) - sizeScore(a))
  const trendSource = (t: TrendTag): TagSource => (t.source === 'tiktok_cc' ? 'trend' : 'measured')
  // MVP's category tags in the order the platforms' own counts favour: the
  // busy middle first, unchecked next, crowds last (dead ones never).
  // A dead end in the list is said in dropped, with its count, never used.
  const bySize = (list: string[]) => list.map((t, i) => ({ t, i, s: sizeScore(trendBy.get(hashify(t))) })).sort((a, b) => b.s - a.s || a.i - b.i)
    .filter((x) => { if (x.s < 0) take(x.t, 'category', ''); return x.s >= 0 }).map((x) => x.t)
  function trendWhy(t: TrendTag): string { return t.label || (t.source === 'tiktok_cc' ? `trending on TikTok${t.rank ? ` (#${t.rank} this week)` : ''}` : t.source === 'youtube' ? `active on YouTube${t.posts ? ` (${compact(t.posts)} videos)` : ''}` : t.source === 'instagram' ? `active on Instagram${t.posts ? ` (${compact(t.posts)} posts)` : ''}` : 'trending') }
  const liftWhy = (who: string, t: TagStatLite) => `${who} ${t.avgLift.toFixed(1)}x reach over ${t.samples} post${t.samples === 1 ? '' : 's'}`
  // IN THE SWEET SPOT, MEASURED: every tag this post could use (what it is,
  // MVP's category tags, what research found, the writer's) that a platform
  // counted at 10K to 200K posts, or just around it, and that is made of the
  // content's own words. This platform's count first, the nearest to the
  // middle of the range first.
  const MID = Math.sqrt(SWEET_SPOT.min * SWEET_SPOT.max)
  const measured = Array.from(new Set([...kinds, ...catTags, ...(input.found || []), ...(input.writer || [])].map((t) => hashify(t)).filter(Boolean)))
    .map((tag) => ({ tag, c: countOf(tag) }))
    .filter((x): x is { tag: string; c: NonNullable<ReturnType<typeof countOf>> } => !!x.c && x.c.score >= 3 && (madeOfContent(x.tag, words) || catTags.has(x.tag)))
    .sort((a, b) => b.c.score - a.c.score || Number(b.c.own) - Number(a.c.own) || Math.abs(Math.log((a.c.row.posts || MID) / MID)) - Math.abs(Math.log((b.c.row.posts || MID) / MID)))
  const takeMeasured = (limit: number) => {
    let n = 0
    for (const x of measured) {
      if (n >= limit) break
      const before = out.length
      const full = take(x.tag, x.c.own && x.c.row.source === 'tiktok_cc' ? 'trend' : 'measured', x.c.why)
      if (out.length > before) n++
      if (full) break
    }
  }

  for (const a of input.always || []) take(a, 'brand', 'one of your own tags')
  // One tag (Threads, X, Bluesky, Telegram): the most specific community tag.
  if (want === 1) {
    for (const t of yours) if (take(t.tag, 'yours', liftWhy('lifted your', t), { needsRelevance: true })) break
    takeMeasured(1)
    for (const t of trends) if (take(t.tag, trendSource(t), trendWhy(t))) break
    for (const k of kinds) if (take(k, 'category', 'what the product is')) break
    for (const c of cats) if (take(bySize(c.niche)[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`)) break
    for (const w of input.writer || []) if (take(w, 'writer', 'written for this post', { needsRelevance: true, unvetted: true })) break
    take(brandTag, 'brand', "the product's brand")
    for (const d of deferred) if (!out.length && deferredSet.has(d.raw)) take(d.raw, d.source, d.why, { ...d.opts, last: true })
    return { tags: out, dropped, rule }
  }

  // The mix: the brand, what proved itself, what the platforms counted in
  // the sweet spot, what is trending, the category's specific tags, then the
  // rest. A huge tag only when its count is in range.
  if (want >= 3) take(brandTag, 'brand', "the product's brand")
  for (const t of yours.slice(0, 2)) take(t.tag, 'yours', liftWhy('lifted your', t), { needsRelevance: true })
  takeMeasured(want)
  take(kinds[0], 'category', 'what the product is')
  // Up to three tags the platforms themselves vouch for, when they are about the post.
  for (const t of trends.slice(0, 3)) take(t.tag, trendSource(t), trendWhy(t))
  for (const c of cats) take(bySize(c.niche)[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`)
  for (const t of members.slice(0, 2)) take(t.tag, 'members', liftWhy('lifted members’', t), { needsRelevance: true })
  for (const w of input.writer || []) take(w, 'writer', 'written for this post', { needsRelevance: true, unvetted: true })
  for (const c of cats) { take(bySize(c.mid)[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`); take(bySize(c.niche)[1], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`) }
  if (want < 3) take(brandTag, 'brand', "the product's brand")
  // The huge general tag (#bike, #cycling) "for reach" only when a platform
  // counted it in range: a crowd buries a new post, an unknown may be one.
  for (const c of cats) if ((countOf(hashify(c.broad[0] || ''))?.score ?? 0) >= 3) take(c.broad[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags, for reach`, { broad: true })
  for (const n of input.niches || []) take(n, 'category', 'your niche', { needsRelevance: true, unvetted: true })
  // Last: the content's own words, so a post is never left with nothing.
  if (out.length < rule.min) {
    for (const w of Array.from(words).filter((x) => x.length >= 5 && !/s$/.test(x)).slice(0, 6)) take(w, 'keyword', "from the content's own words", { unvetted: true })
  }
  // A crowd only when the post would otherwise be short of the platform's least.
  for (const d of deferred) if (out.length < rule.min && deferredSet.has(d.raw)) take(d.raw, d.source, d.why, { ...d.opts, last: true })
  for (const d of deferred) if (deferredSet.has(d.raw)) { const c = countOf(d.raw); dropped.push({ tag: d.raw, why: `a crowd: ${c ? c.why : 'too many posts'}, so a new post is buried in minutes` }) }
  return { tags: out, dropped, rule }
}

function compact(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

// A tag may start with digits when a letter follows ("#2026deals" is a tag,
// and its year takes it out; "#1 pick" is not one).
const TAG_TOKEN = /(?<![\w#\\])#((?:[A-Za-z]|\d+[A-Za-z])[A-Za-z0-9_]*)/g
const isDisclosure = (body: string) => /^(ad|sponsored)$/i.test(body)

/** The hashtags a writer put in a caption (not the disclosure). */
export function writerTags(text: string): string[] {
  return Array.from(String(text || '').matchAll(TAG_TOKEN)).map((m) => m[1]).filter((b) => !isDisclosure(b)).map((b) => `#${b.toLowerCase()}`)
}

/** A caption with the writer's tags taken out: lines of nothing but tags go,
 *  a tag inside a sentence keeps its word ("love my #airfryer" -> "love my
 *  airfryer"). The disclosure #ad / #sponsored stays where it is. */
export function withoutTags(text: string): string {
  const lines = String(text || '').split('\n').map((line) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean)
    const onlyTags = tokens.length > 0 && tokens.every((t) => /^#[A-Za-z0-9_]+[.,!]?$/.test(t))
    if (onlyTags) return tokens.filter((t) => isDisclosure(t.replace(/^#|[.,!]$/g, ''))).join(' ')
    return line.replace(TAG_TOKEN, (m, body: string) => (isDisclosure(body) ? m : body))
  })
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The caption with exactly these tags on its last line, and within maxChars
 *  when given: tags are dropped from the end to fit, never the words. */
export function withTags(text: string, tags: string[], opts: { maxChars?: number | null } = {}): string {
  const body = withoutTags(text)
  const list = tags.slice()
  const join = () => (list.length ? `${body}\n\n${list.join(' ')}` : body)
  if (opts.maxChars) while (list.length && join().length > opts.maxChars) list.pop()
  return join()
}

/** THE SAFETY NET every post goes through before it is sent: tags
 *  deduplicated (any case), spam and years out, and no more than the
 *  platform takes, the disclosure #ad counted and always kept. */
export function fitHashtags(text: string, platform: TagPlatform): string {
  const rule = TAG_RULES[platform]
  const seen = new Set<string>()
  let topical = 0
  const room = rule.hardMax - rule.disclosure
  const src = String(text || '')
  // A tag taken out of the run of tags that ends a line goes; one taken out
  // of the middle of a sentence keeps its word ("love my #airfryer daily"
  // stays "love my airfryer daily").
  const inSentence = (at: number, len: number) => {
    const end = src.indexOf('\n', at)
    const rest = src.slice(at + len, end < 0 ? src.length : end).trim()
    return rest.length > 0 && rest.split(/\s+/).some((t) => !/^#[A-Za-z0-9_]+[.,!]?$/.test(t))
  }
  const out = src.replace(TAG_TOKEN, (m, body: string, at: number) => {
    if (isDisclosure(body)) return m
    const key = body.toLowerCase()
    if (seen.has(key) || tagProblem(body).problem || topical >= room) return inSentence(at, m.length) ? body : ''
    seen.add(key); topical++
    return m
  })
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+#/g, '\n#').replace(/\n{3,}/g, '\n\n').trim()
}

export type SizeTone = 'sweet' | 'near' | 'small' | 'big' | 'crowd' | 'trend' | 'none'
/** One tag's size for the screen, from what the platforms counted: this
 *  platform's own count first, else another's, said as such; 'none' when
 *  nobody counted it, never a guess. Pure. */
export function sizeWords(counts: Array<{ platform: string; source: string; posts: number | null; rank?: number | null }>, platform: TagPlatform): { tone: SizeTone; text: string } {
  const here = platform === 'youtube_short' ? 'youtube' : platform === 'facebook_group' ? 'facebook' : platform
  const counted = counts.filter((c) => typeof c.posts === 'number' && Number.isFinite(c.posts))
  const row = counted.find((c) => c.platform === here) || counted.sort((a, b) => sizeScore(b) - sizeScore(a))[0]
  if (!row) {
    const trend = counts.find((c) => c.source === 'tiktok_cc')
    return trend ? { tone: 'trend', text: `trending on TikTok${trend.rank ? ` (#${trend.rank})` : ''}` } : { tone: 'none', text: 'not counted yet' }
  }
  const n = row.posts as number
  const name = row.platform === 'youtube' ? 'YouTube' : row.platform === 'instagram' ? 'Instagram' : row.platform === 'tiktok' ? 'TikTok' : row.platform
  const text = `${compact(n)} ${row.platform === 'youtube' ? 'videos' : 'posts'} on ${name}`
  const tone: SizeTone = inSweetSpot(n) ? 'sweet' : (n >= 2_000 && n < SWEET_SPOT.min) || (n > SWEET_SPOT.max && n <= 1_000_000) ? 'near' : n < 2_000 ? 'small' : n < CROWD_FROM ? 'big' : 'crowd'
  return { tone, text }
}

/** The words for the screen: each tag and where it came from. */
export const SOURCE_WORDS: Record<TagSource, string> = {
  yours: 'Your results', trend: 'Trending', measured: 'Checked on the platform', brand: 'Brand', category: 'Category', members: 'Members’ results', writer: 'Written for this post', keyword: 'From the content',
}
