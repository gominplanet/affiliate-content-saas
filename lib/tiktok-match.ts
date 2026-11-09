// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH TRYBE BRANDS A CREATOR ALREADY FILMED ON TIKTOK (Seb, 2026-11-09).
//
// TrybeDaily's scan read Seb's 116 videos and matched 0 brands: it matches on
// the TikTok Shop product tag alone, and a reviewer's videos mostly carry
// none. MVP matches on everything the video says, strongest first, and says
// how it knows for each one:
//
//   product tag   the video's TikTok Shop tag names the brand's shop, or the
//                 product with the brand's name                       sure
//   mention       the caption tags the brand's TikTok account, as read from
//                 the brand's own website                              sure
//   hashtag       a hashtag that is the brand's name run together      likely
//   name          the caption says the brand's name                    likely
//   product       the caption names one of the brand's products, as listed
//                 on its store or on TRYBE                             likely
//
// A NAME THAT IS AN EVERYDAY WORD IS NEVER ENOUGH ALONE. A brand called
// "Glow" or "Pure" would match half of TikTok. Seb's first real scan
// (2026-11-09: "so many are wrong") matched Volume, Boost, Needed, Nights and
// The Goodbye Company ("say goodbye to hand cramps") on everyday words. So a
// brand's name is weighed against 102,293 English dictionary words
// (lib/common-english):
//
//   distinct   a name with a word no dictionary has (Lumineux, Olaplex):
//              said in a caption, it is the brand                    likely
//   as a name  every word is an everyday word (Ninja Kitchen, The Goodbye
//              Company): it counts only written as a name, each word
//              capitalised ("Goodbye Company", never "say goodbye")  likely
//   everyday   one everyday word (Volume, Boost, Needed): never enough
//              alone, from a caption or a hashtag                    maybe
//
// "The" and "Company" are taken off a name only when what is left is still
// distinct: "The Goodbye Company" is matched as "Goodbye Company", never as
// "goodbye". A product named in a caption counts only when its name has a
// word of its own ("CREAMi", "Atom One"), never a generic one ("stainless
// steel lemon squeezer"). Pure.

import type { TikTokVideo } from './tiktok-videos'
import { COMMON_ENGLISH } from './common-english'
import { isMatch, SURENESS_WORDS, type MatchKind, type Sureness } from './tiktok-match-words'

export { isMatch, SURENESS_WORDS }
export type { MatchKind, Sureness }

export interface MatchBrand {
  id: string
  name: string
  /** The brand's TikTok handle, as read from its website. */
  tiktokHandle?: string | null
  /** Its product names, from its store and its TRYBE product list. */
  products?: string[] | null
}

export interface MatchHow {
  kind: MatchKind
  videoId: string
  /** In words, for the page: what in the video matched. */
  text: string
  /** How many videos say the same thing (one line for them all). */
  count?: number
}

export interface BrandMatch {
  brandId: string
  name: string
  sureness: Sureness
  videoIds: string[]
  how: MatchHow[]
  newestAt: string | null
}

const RANK: Record<Sureness, number> = { sure: 3, likely: 2, maybe: 1 }
const KIND_RANK: Record<MatchKind, number> = { product_tag: 5, mention: 4, product: 3, name: 2, hashtag: 1 }

/** Lowercase plain letters and digits, single spaced, accents dropped. */
export function norm(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}
export const squash = (s: string | null | undefined) => norm(s).replace(/ /g, '')

// Words a company name carries that no caption does.
const SUFFIX = /\s+(inc|llc|ltd|limited|co|corp|corporation|company|official|store|shop|brand|brands|usa|us)$/
/** The name without "The" and company words ("Lumineux Oral Essentials Inc"
 *  is "lumineux oral essentials"). */
export function brandName(name: string): string {
  let n = norm(name)
  for (let i = 0; i < 3 && SUFFIX.test(n); i++) n = n.replace(SUFFIX, '')
  return n.replace(/^the\s+/, '').trim()
}

// Everyday words brands are named after that a dictionary list can miss
// (short forms, trade words).
const EVERYDAY = 'glow pure luxe lux nova luna sol zen vibe vibes glam chic terra aqua hydro co lab labs hub kit kits pro max mini mega ultra prime plus bee fox owl'.split(' ')
let common: Set<string> | null = null
/** Whether a word is an everyday English word (or an everyday brand word). */
export function isCommonWord(w: string): boolean {
  if (!common) common = new Set([...COMMON_ENGLISH.split(' '), ...EVERYDAY])
  return w.length < 4 || common.has(w)
}

export type NameStrength = 'distinct' | 'as-name' | 'everyday'
export interface NameForm {
  /** The words matched in a caption, lowercase. */
  phrase: string
  strength: NameStrength
}

/** How a brand's name is matched (see the top of this file). */
export function nameForm(name: string): NameForm {
  const core = brandName(name)
  const words = core.split(' ').filter(Boolean)
  const distinct = (ws: string[]) => ws.some((w) => w.length >= 4 && !/^\d+$/.test(w) && !isCommonWord(w))
  if (words.length && distinct(words) && core.replace(/ /g, '').length >= 5) return { phrase: core, strength: 'distinct' }
  // Every word everyday: the fuller name, when it has more words, matched as a name.
  const full = norm(name).replace(/^the\s+/, '')
  const fullWords = full.split(' ').filter(Boolean)
  if (words.length >= 2) return { phrase: core, strength: 'as-name' }
  if (fullWords.length >= 2) return { phrase: full, strength: 'as-name' }
  return { phrase: core, strength: 'everyday' }
}

/** Whether a brand's name, alone in a caption, is enough to say it is the brand. */
export function nameIsDistinct(name: string): boolean {
  return nameForm(name).strength === 'distinct'
}

/** The phrase written as a name in the caption: each word starting with a
 *  capital ("Goodbye Company", "Ninja Kitchen"), whole words. */
export function writtenAsName(caption: string, phrase: string): boolean {
  const words = phrase.split(' ').filter(Boolean)
  if (!words.length) return false
  const part = (w: string) => `[${w[0].toUpperCase()}]${w.slice(1).split('').map((c) => /[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c).join('')}`
  return new RegExp(`(^|[^A-Za-z0-9])${words.map(part).join('[\\s\\-]+')}(?![A-Za-z0-9])`).test(caption)
}

/** A product name worth matching in a caption: three words or more, long
 *  enough that it cannot be a phrase anyone writes by chance, and with a word
 *  of its own (a model or product name), never all everyday words. */
export function productKey(p: string): string | null {
  const n = norm(p).replace(/\b(\d+\s*(pack|pcs|count|ct|oz|ml|lb|lbs|inch|ft))\b/g, ' ').replace(/\s+/g, ' ').trim()
  const words = n.split(' ').filter(Boolean)
  if (words.length < 3 || n.length < 14) return null
  // Keep the first six words: store titles run on with sizes and colours.
  const key = words.slice(0, 6)
  if (!key.some((w) => w.length >= 4 && !/^\d+$/.test(w) && !isCommonWord(w))) return null
  return key.join(' ')
}

interface Named { brand: MatchBrand; form: NameForm }
export interface MatchIndex {
  byHandle: Map<string, MatchBrand[]>
  bySquash: Map<string, Named[]>
  byFirstWord: Map<string, Named[]>
  byProductStart: Map<string, Array<{ brand: MatchBrand; key: string; original: string }>>
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }

/** The brands, indexed so thousands of them are checked against a video in a
 *  few lookups rather than one by one. */
export function buildIndex(brands: MatchBrand[]): MatchIndex {
  const idx: MatchIndex = { byHandle: new Map(), bySquash: new Map(), byFirstWord: new Map(), byProductStart: new Map() }
  for (const b of brands) {
    const h = String(b.tiktokHandle ?? '').trim().replace(/^@/, '').toLowerCase()
    if (/^[a-z0-9_.]{2,24}$/.test(h)) push(idx.byHandle, h, b)
    const form = nameForm(b.name)
    if (form.phrase.replace(/ /g, '').length < 3) continue
    const named = { brand: b, form }
    // The name run together, as a hashtag or a handle: the phrase, and the
    // whole name with its company words (#thegoodbyecompany).
    for (const s of new Set([form.phrase.replace(/ /g, ''), squash(b.name)])) if (s.length >= 4) push(idx.bySquash, s, named)
    push(idx.byFirstWord, form.phrase.split(' ')[0], named)
    const seen = new Set<string>()
    for (const p of (b.products || []).slice(0, 200)) {
      const key = productKey(p)
      if (!key || seen.has(key)) continue
      seen.add(key)
      push(idx.byProductStart, key.split(' ').slice(0, 2).join(' '), { brand: b, key, original: String(p).slice(0, 120) })
    }
  }
  return idx
}

const quote = (s: string) => `\u201C${s}\u201D`

/** What a name run together (a hashtag, an @handle) is worth: a distinct name,
 *  or an everyday one of two words or more (#ninjakitchen), is likely; one
 *  everyday word (#boost, #needed) is nothing at all: it is a tag anyone uses. */
const runTogether = (f: NameForm): Sureness | null => (f.strength === 'everyday' ? null : 'likely')

/** What in one video points at which brands. */
export function matchVideo(v: TikTokVideo, idx: MatchIndex): Array<{ brand: MatchBrand; how: MatchHow; sureness: Sureness }> {
  const out: Array<{ brand: MatchBrand; how: MatchHow; sureness: Sureness }> = []
  const add = (brand: MatchBrand, kind: MatchKind, sureness: Sureness, text: string) => out.push({ brand, sureness, how: { kind, videoId: v.id, text } })

  // 1. TikTok Shop product tags: the shop's name, or a distinct brand name in the product's.
  for (const p of v.products || []) {
    const shop = squash(p.shop)
    const hits = new Set<MatchBrand>()
    if (shop.length >= 3) {
      for (const n of idx.bySquash.get(shop) || []) hits.add(n.brand)
      for (const b of idx.byHandle.get(shop) || []) hits.add(b)
    }
    const title = ` ${norm(p.title)} `
    if (title.trim()) {
      for (const w of title.trim().split(' ')) {
        for (const n of idx.byFirstWord.get(w) || []) if (n.form.strength === 'distinct' && title.includes(` ${n.form.phrase} `)) hits.add(n.brand)
      }
    }
    for (const b of Array.from(hits)) add(b, 'product_tag', 'sure', `It carries a TikTok Shop product tag: ${quote(p.title || p.shop || 'a product')}${p.shop && p.title ? `, sold by ${p.shop}` : ''}.`)
  }

  // 2. The caption tags the brand's account.
  for (const m of v.mentions || []) {
    for (const b of idx.byHandle.get(m) || []) add(b, 'mention', 'sure', `Your caption tags @${m}, the brand\u2019s TikTok account.`)
    // A handle that is the brand's name run together, when MVP has not read the
    // brand's own handle: likely at best, not sure.
    for (const n of idx.bySquash.get(m.replace(/[._]/g, '')) || []) {
      const sure = runTogether(n.form)
      if (n.brand.tiktokHandle || !sure) continue
      add(n.brand, 'mention', sure, `Your caption tags @${m}, which is the brand\u2019s name.`)
    }
  }

  // 3. Hashtags that are the brand's name run together.
  for (const h of v.hashtags || []) {
    const s = squash(h)
    if (s.length < 4) continue
    for (const n of idx.bySquash.get(s) || []) { const sure = runTogether(n.form); if (sure) add(n.brand, 'hashtag', sure, `#${h} in your caption.`) }
  }

  // 4. The brand's name in the caption, as whole words. Hashtags and @tags
  // are taken out first: they were weighed above, and one word must not count
  // twice (a "#glow" is not also a caption that says Glow).
  const plain = v.caption.replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
  const cap = ` ${norm(plain)} `
  const words = cap.trim() ? cap.trim().split(' ') : []
  for (const w of Array.from(new Set(words))) {
    for (const n of idx.byFirstWord.get(w) || []) {
      if (n.form.phrase.replace(/ /g, '').length < 4 || !cap.includes(` ${n.form.phrase} `)) continue
      if (n.form.strength === 'distinct') add(n.brand, 'name', 'likely', `Your caption says ${quote(n.brand.name)}.`)
      else if (n.form.strength === 'as-name' && writtenAsName(plain, n.form.phrase)) add(n.brand, 'name', 'likely', `Your caption writes ${quote(n.brand.name)} as a name.`)
      // An everyday word is only worth a look when it is written as a name
      // ("Volume", not "volume"); otherwise it is not listed at all.
      else if (n.form.strength === 'as-name' || writtenAsName(plain, n.form.phrase)) add(n.brand, 'name', 'maybe', `Your caption uses ${quote(n.form.phrase)}, which is also this brand\u2019s name.`)
    }
  }

  // 5. One of the brand's products by name.
  for (let i = 0; i + 1 < words.length; i++) {
    for (const c of idx.byProductStart.get(`${words[i]} ${words[i + 1]}`) || []) {
      if (cap.includes(` ${c.key} `)) add(c.brand, 'product', 'likely', `Your caption names its product ${quote(c.original)}.`)
    }
  }
  return out
}

/** Every brand these videos point at, the surest first, with how MVP knows.
 *  The same words from several videos are one line with a count. */
export function matchVideos(videos: TikTokVideo[], idx: MatchIndex): BrandMatch[] {
  const by = new Map<string, BrandMatch>()
  for (const v of videos) {
    for (const hit of matchVideo(v, idx)) {
      const m = by.get(hit.brand.id) ?? { brandId: hit.brand.id, name: hit.brand.name, sureness: hit.sureness, videoIds: [], how: [], newestAt: null }
      if (RANK[hit.sureness] > RANK[m.sureness]) m.sureness = hit.sureness
      if (!m.videoIds.includes(v.id)) m.videoIds.push(v.id)
      const same = m.how.find((h) => h.kind === hit.how.kind && h.text === hit.how.text)
      if (same) { if (same.videoId !== v.id) same.count = (same.count ?? 1) + 1 }
      else m.how.push({ ...hit.how, count: 1 })
      if (v.postedAt && (!m.newestAt || v.postedAt > m.newestAt)) m.newestAt = v.postedAt
      by.set(hit.brand.id, m)
    }
  }
  // Each sign stands on its own: an everyday name seen as a hashtag and in a
  // caption is still the same everyday word, so it stays a maybe. Only a sign
  // that is likely or sure by itself makes the brand a match.
  const list = Array.from(by.values()).map((m) => ({ ...m, how: m.how.sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || (b.count ?? 1) - (a.count ?? 1)).slice(0, 8) }))
  return list.sort((a, b) => RANK[b.sureness] - RANK[a.sureness] || b.videoIds.length - a.videoIds.length || a.name.localeCompare(b.name))
}

/** When the matching rules last changed: matches kept from before are worked
 *  out again on the next look (lib/tiktok-library matchesStale). */
export const MATCH_RULES_AT = '2026-11-09T15:15:00Z'

export { filmedLine, withFilmedLine } from './tiktok-match-words'
