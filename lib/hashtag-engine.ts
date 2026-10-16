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

export type TagSource = 'yours' | 'trend' | 'brand' | 'category' | 'members' | 'writer' | 'keyword'
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
  for (const w of String(text || '').toLowerCase().match(WORD) || []) {
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

/** Is this tag about this content? A word of the content inside the tag, or
 *  the tag inside a word of the content. Short words only match whole. */
export function aboutContent(tag: string, words: Set<string>): boolean {
  const body = tag.replace(/^#/, '').toLowerCase()
  if (words.has(body)) return true
  for (const w of words) {
    if (w.length >= 4 && body.includes(w)) return true
    if (body.length >= 5 && w.includes(body)) return true
  }
  return false
}

/** Pick the hashtags for one post. */
export function pickHashtags(input: TagInput): TagPick {
  const rule = TAG_RULES[input.platform]
  const want = Math.max(0, Math.min(rule.max, input.count ?? rule.max))
  const dropped: TagPick['dropped'] = []
  if (want === 0) return { tags: [], dropped, rule }

  const words = contentWords(`${input.text || ''} ${(input.niches || []).join(' ')} ${input.brand || ''}`)
  // A second category only when it is as strong as the first: one "gadget"
  // in an air fryer's text is not a reason for tech tags.
  const allCats = categoriesFor(`${input.text || ''} ${(input.niches || []).join(' ')}`, 2)
  const cats = allCats.filter((c, i) => i === 0 || c.score >= allCats[0].score)
  const catTags = new Set(cats.flatMap((c) => [...c.niche, ...c.mid, ...c.broad]).map((t) => hashify(t)))
  // WHAT IT IS: the category's own term the content names, longest first
  // ("air fryer" -> #airfryer), the tag people search for the product.
  const hay = ` ${String(input.text || '').toLowerCase()} `
  const kinds = cats.flatMap((c) => c.match.filter((m) => m.length >= 4 && new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay))).sort((a, b) => b.length - a.length)
  for (const k of kinds) catTags.add(hashify(k))
  const relevant = (tag: string) => aboutContent(tag, words) || catTags.has(tag)

  const out: PickedTag[] = []
  const seen = new Set<string>()
  let broadUsed = 0
  const trendBy = new Map((input.trends || []).map((t) => [hashify(t.tag), t] as const))
  // A tag the platform itself shows as a dead end is never used (the brand's
  // own tag excepted: brand tags are small and still the brand's).
  const deadBy = new Map((input.trends || []).filter((t) => trendStanding(t) === 'dead').map((t) => [hashify(t.tag), t] as const))
  const take = (raw: string | null | undefined, source: TagSource, why: string, opts: { needsRelevance?: boolean; broad?: boolean } = {}): boolean => {
    if (!raw || out.length >= want) return out.length >= want
    const { tag, problem } = tagProblem(raw)
    if (!tag || seen.has(tag)) return out.length >= want
    if (problem) { dropped.push({ tag, why: problem }); seen.add(tag); return false }
    if (opts.needsRelevance && !relevant(tag)) { dropped.push({ tag, why: 'not about this content' }); seen.add(tag); return false }
    const dead = deadBy.get(tag)
    if (dead && source !== 'brand') { dropped.push({ tag, why: dead.source === 'youtube' ? `almost no videos use it on YouTube (${compact(dead.posts || 0)})` : `almost no posts use it on Instagram (${compact(dead.posts || 0)})` }); seen.add(tag); return false }
    // One huge-reach tag at most: the rest reach the people who buy.
    if (opts.broad && broadUsed >= 1) return false
    if (opts.broad) broadUsed++
    seen.add(tag)
    // A tag that is also trending says so: that is the stronger reason.
    const tr = trendBy.get(tag)
    if (tr && trendStanding(tr) === 'active' && (source === 'category' || source === 'writer' || source === 'keyword')) out.push({ tag, source: 'trend', why: trendWhy(tr) })
    else out.push({ tag, source, why })
    return out.length >= want
  }

  const brandTag = deriveBrandTag(input.brand || '')
  const yours = (input.yours || []).filter((t) => t.avgLift >= 1.1).sort((a, b) => b.avgLift - a.avgLift)
  const members = (input.members || []).filter((t) => t.avgLift >= 1.1).sort((a, b) => b.avgLift - a.avgLift)
  const trends = (input.trends || []).filter((t) => relevant(hashify(t.tag)) && trendStanding(t) === 'active')
  function trendWhy(t: TrendTag): string { return t.label || (t.source === 'tiktok_cc' ? `trending on TikTok${t.rank ? ` (#${t.rank} this week)` : ''}` : t.source === 'youtube' ? `active on YouTube${t.posts ? ` (${compact(t.posts)} videos)` : ''}` : t.source === 'instagram' ? `active on Instagram${t.posts ? ` (${compact(t.posts)} posts)` : ''}` : 'trending') }
  const liftWhy = (who: string, t: TagStatLite) => `${who} ${t.avgLift.toFixed(1)}x reach over ${t.samples} post${t.samples === 1 ? '' : 's'}`

  for (const a of input.always || []) take(a, 'brand', 'one of your own tags')
  // One tag (Threads, X, Bluesky, Telegram): the most specific community tag.
  if (want === 1) {
    for (const t of yours) if (take(t.tag, 'yours', liftWhy('lifted your', t), { needsRelevance: true })) break
    for (const t of trends) if (take(t.tag, 'trend', trendWhy(t))) break
    for (const k of kinds) if (take(k, 'category', 'what the product is')) break
    for (const c of cats) if (take(c.niche[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`)) break
    for (const w of input.writer || []) if (take(w, 'writer', 'written for this post', { needsRelevance: true })) break
    take(brandTag, 'brand', "the product's brand")
    return { tags: out, dropped, rule }
  }

  // The mix: the brand, what proved itself, what is trending, the category's
  // specific tags, then the rest, with one broad tag at most.
  if (want >= 3) take(brandTag, 'brand', "the product's brand")
  take(kinds[0], 'category', 'what the product is')
  for (const t of yours.slice(0, 2)) take(t.tag, 'yours', liftWhy('lifted your', t), { needsRelevance: true })
  for (const t of trends.slice(0, 2)) take(t.tag, 'trend', trendWhy(t))
  for (const c of cats) take(c.niche[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`)
  for (const t of members.slice(0, 2)) take(t.tag, 'members', liftWhy('lifted members’', t), { needsRelevance: true })
  for (const w of input.writer || []) take(w, 'writer', 'written for this post', { needsRelevance: true })
  for (const c of cats) { take(c.mid[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`); take(c.niche[1], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags`) }
  if (want < 3) take(brandTag, 'brand', "the product's brand")
  for (const c of cats) take(c.broad[0], 'category', `MVP's ${c.key.replace(/-/g, ' ')} tags, for reach`, { broad: true })
  for (const n of input.niches || []) take(n, 'category', 'your niche', { needsRelevance: true })
  // Last: the content's own words, so a post is never left with nothing.
  if (out.length < rule.min) {
    for (const w of Array.from(words).filter((x) => x.length >= 5 && !/s$/.test(x)).slice(0, 6)) take(w, 'keyword', "from the content's own words")
  }
  return { tags: out, dropped, rule }
}

function compact(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

const TAG_TOKEN = /(?<![\w#\\])#([A-Za-z][A-Za-z0-9_]*)/g
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

/** The words for the screen: each tag and where it came from. */
export const SOURCE_WORDS: Record<TagSource, string> = {
  yours: 'Your results', trend: 'Trending', brand: 'Brand', category: 'Category', members: 'Members’ results', writer: 'Written for this post', keyword: 'From the content',
}
