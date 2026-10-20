// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE TAGS FROM REAL YOUTUBE SEARCHES (Seb, 2026-10-20: "We could build
// from what people actually type into YouTube search boxes, like actual real
// searches, and keep only the ones that match the video").
//
// The tags field used to be whatever the writer guessed. Now MVP asks
// YouTube's own search box what people type after the product's kind, its
// brand and model, and the video's topic (lib/search-suggest), keeps each
// search only when it is about this video (every real word in it is a word
// of the video), and leads with those. The writer's tags follow only when
// they are about the video too. Inside YouTube's limit for the field.
// What happened is returned with the tags, so a box that did not answer
// never looks like tags that came from real searches.

import { suggest, matchesContent, contentVocab, titleTopic, cleanSearch } from '@/lib/search-suggest'
import { productKinds } from '@/lib/hashtag-engine'

/** YouTube takes 500 characters of tags in all; MVP stays under 450. */
export const YT_TAGS_MAX_CHARS = 450
export const YT_TAGS_MAX = 20

/** What to ask YouTube's search box about: what the product is, its brand
 *  and model ("jasion eb7"), the start of its name after the brand ("fat tire
 *  electric"), and the video's topic from its title. Pure. */
export function youtubeSeeds(input: { videoTitle?: string | null; productTitle?: string | null; productName?: string | null; text?: string | null }): string[] {
  const { kinds } = productKinds(`${input.productTitle || ''}\n${input.videoTitle || ''}\n${input.text || ''}`)
  const name = cleanSearch(input.productName || input.productTitle || '').split(' ').filter(Boolean)
  const brandModel = name.length >= 2 && /\d/.test(name[1]) ? name.slice(0, 2).join(' ') : ''
  const lead = name.filter((w, i) => i > 0 && !/\d/.test(w)).slice(0, 3).join(' ')
  return Array.from(new Set([kinds[0], brandModel, lead, titleTopic(input.videoTitle || '', 3)].map((s) => cleanSearch(s || '')).filter((s) => s.split(' ').length >= 1 && s.length >= 4))).slice(0, 4)
}

export interface TagResearch {
  tags: string[]
  /** Tags that are real YouTube searches, the writer's kept after them, and
   *  what the product is (its kind, brand and model, the video's topic) when
   *  YouTube did not answer. */
  fromSearches: number
  fromWriter: number
  fromProduct?: number
  /** The writer's tags left out, as not about this video. */
  notAbout: string[]
  /** Searches asked, and how many YouTube answered (remembered ones count). */
  asked: number
  answered: number
}

/** The tags, from what YouTube's box suggested for each seed (`lists`, in
 *  seed order) and the writer's, kept only when about the content. A search
 *  suggested for more than one seed comes first. Pure. */
export function pickYouTubeTags(lists: string[][], writer: string[], vocab: Set<string>): Omit<TagResearch, 'asked' | 'answered'> {
  const seenIn = new Map<string, number>()
  const order: string[] = []
  for (const list of lists) for (const p of new Set(list.map(cleanSearch))) {
    if (!p || p.split(' ').length > 6 || !matchesContent(p, vocab)) continue
    if (!seenIn.has(p)) order.push(p)
    seenIn.set(p, (seenIn.get(p) || 0) + 1)
  }
  const searches = order.map((p, i) => ({ p, i })).sort((a, b) => (seenIn.get(b.p)! - seenIn.get(a.p)!) || a.i - b.i).map((x) => x.p)
  const out: string[] = []
  let total = 0
  const add = (t: string): boolean => {
    if (out.includes(t) || out.length >= YT_TAGS_MAX || total + t.length + 1 > YT_TAGS_MAX_CHARS) return false
    out.push(t); total += t.length + 1
    return true
  }
  let fromSearches = 0
  for (const p of searches) if (add(p)) fromSearches++
  let fromWriter = 0
  const notAbout: string[] = []
  for (const raw of writer) {
    const t = cleanSearch(raw)
    if (!t || t.length > 60) continue
    if (!matchesContent(t, vocab)) { if (!notAbout.includes(t)) notAbout.push(t); continue }
    if (add(t)) fromWriter++
  }
  return { tags: out, fromSearches, fromWriter, notAbout }
}

/** Research a video's YouTube tags live. Never throws: with no answer from
 *  YouTube the writer's tags that are about the video are used, and it says so. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function researchYouTubeTags(admin: any, input: { videoTitle?: string | null; productTitle?: string | null; productName?: string | null; text?: string | null; writer?: string[] }): Promise<TagResearch> {
  const seeds = youtubeSeeds(input)
  const got = await Promise.all(seeds.map((s) => suggest('youtube', s, admin)))
  const vocab = contentVocab([input.videoTitle, input.productTitle, input.productName, input.text].filter(Boolean).join('\n'))
  const picked = pickYouTubeTags(got.map((g) => g.phrases), input.writer || [], vocab)
  return { ...picked, asked: seeds.length, answered: got.filter((g) => g.answered).length }
}

/** EVERY YOUTUBE TAGS FIELD GOES THROUGH HERE (Seb, 2026-10-20: "anything
 *  that MVP creates as far as tagging and hashtags ... runs through this kind
 *  of engine ... I don't want to hear from users that the hashtags are
 *  poor"). Real searches when YouTube answers in time; when it does not, the
 *  writer's tags that are about the video, then what the product is, and
 *  never a tag that is not about the video. Never throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function youtubeTagsFor(admin: any, input: Parameters<typeof researchYouTubeTags>[1], timeoutMs = 5000): Promise<TagResearch & { searched: boolean }> {
  const r = await Promise.race([
    researchYouTubeTags(admin, input).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
  ])
  if (r && r.fromSearches > 0) return { ...r, searched: true }
  return { ...offlineYouTubeTags(input), asked: r?.asked ?? 0, answered: r?.answered ?? 0, searched: false }
}

/** With no searches: the writer's tags about the video, then the product's
 *  kind, brand and model and the video's topic. Pure. */
export function offlineYouTubeTags(input: Parameters<typeof researchYouTubeTags>[1]): Omit<TagResearch, 'asked' | 'answered'> {
  const vocab = contentVocab([input.videoTitle, input.productTitle, input.productName, input.text].filter(Boolean).join('\n'))
  const picked = pickYouTubeTags([], input.writer || [], vocab)
  let fromProduct = 0
  let total = picked.tags.reduce((n, t) => n + t.length + 1, 0)
  for (const seed of youtubeSeeds(input)) {
    if (picked.tags.includes(seed) || picked.tags.length >= YT_TAGS_MAX || total + seed.length + 1 > YT_TAGS_MAX_CHARS || !matchesContent(seed, vocab)) continue
    picked.tags.push(seed); total += seed.length + 1; fromProduct++
  }
  return { ...picked, fromProduct }
}
