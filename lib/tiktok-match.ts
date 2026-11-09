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
// "Glow" or "Pure" would match half of TikTok; a name like that, or one of
// three letters or fewer, only counts with a stronger sign, and is otherwise
// a "maybe" the page shows apart, never as a match. Pure.

import type { TikTokVideo } from './tiktok-videos'

export type MatchKind = 'product_tag' | 'mention' | 'hashtag' | 'name' | 'product'
export type Sureness = 'sure' | 'likely' | 'maybe'

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
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}
export const squash = (s: string | null | undefined) => norm(s).replace(/ /g, '')

// Words a company name carries that no caption does.
const SUFFIX = /\s+(inc|llc|ltd|limited|co|corp|corporation|company|official|store|shop|brand|brands|usa|us)$/
export function brandName(name: string): string {
  let n = norm(name)
  for (let i = 0; i < 3 && SUFFIX.test(n); i++) n = n.replace(SUFFIX, '')
  return n.replace(/^the\s+/, '').trim()
}

// Everyday words brands are named after. Alone, they say nothing.
const EVERYDAY = new Set(('glow pure bloom simple fresh happy smart home love life live good great best daily basic basics natural organic clean beauty baby kids pet pets dog cat cats dogs family health wellness fit fitness active style studio lab labs co one true wild free real bright clear calm soft sweet gold golden silver black white blue green red pink rose luxe lux nova luna sol sun moon star stars ocean wave waves mint honey sugar salt spice glam chic bold kind rise shine spark vibe vibes zen bliss joy hope grace pure via go now new next prime plus pro max ultra mega mini tiny little big bee bear fox wolf lion owl hive nest root roots leaf seed tree forest earth terra aqua hydro core flow form shape body skin hair face nails lips eyes care heal well kitchen cook chef bake grill garden plant plants flower flowers coffee tea juice water snack snacks treat treats bar bars box boxes bag bags cup mug bottle bottles light lights lamp tech gear tools tool kit kits hub link links play toy toys game games art craft paper print ink pen book books note notes travel trip camp outdoor outdoors sport sports run walk ride bike yoga mat mats sleep dream dreams rest relax comfort cozy warm cool ice fire storm rain snow cloud air wind').split(' '))

/** Whether a brand's name, alone in a caption, is enough to say it is the brand. */
export function nameIsDistinct(name: string): boolean {
  const n = brandName(name)
  const s = n.replace(/ /g, '')
  if (s.length < 4) return false
  const words = n.split(' ')
  if (words.length === 1) return s.length >= 5 && !EVERYDAY.has(s)
  // Two everyday words together ("Pure Glow") are still a name people write.
  return s.length >= 6 && !words.every((w) => EVERYDAY.has(w) || w.length <= 2)
}

/** A product name worth matching in a caption: three words or more, long
 *  enough that it cannot be a phrase anyone writes by chance. */
export function productKey(p: string): string | null {
  const n = norm(p).replace(/\b(\d+\s*(pack|pcs|count|ct|oz|ml|lb|lbs|inch|ft))\b/g, ' ').replace(/\s+/g, ' ').trim()
  const words = n.split(' ').filter(Boolean)
  if (words.length < 3 || n.length < 14) return null
  // Keep the first six words: store titles run on with sizes and colours.
  return words.slice(0, 6).join(' ')
}

export interface MatchIndex {
  byHandle: Map<string, MatchBrand[]>
  bySquash: Map<string, MatchBrand[]>
  byFirstWord: Map<string, Array<{ brand: MatchBrand; name: string }>>
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
    const name = brandName(b.name)
    const s = name.replace(/ /g, '')
    if (s.length >= 3) push(idx.bySquash, s, b)
    if (name.length >= 3) push(idx.byFirstWord, name.split(' ')[0], { brand: b, name })
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

const quote = (s: string) => `“${s}”`

/** What in one video points at which brands. */
export function matchVideo(v: TikTokVideo, idx: MatchIndex): Array<{ brand: MatchBrand; how: MatchHow; sureness: Sureness }> {
  const out: Array<{ brand: MatchBrand; how: MatchHow; sureness: Sureness }> = []
  const add = (brand: MatchBrand, kind: MatchKind, sureness: Sureness, text: string) => out.push({ brand, sureness, how: { kind, videoId: v.id, text } })

  // 1. TikTok Shop product tags.
  for (const p of v.products || []) {
    const shop = squash(p.shop)
    const hits = new Set<MatchBrand>()
    if (shop.length >= 3) for (const b of [...(idx.bySquash.get(shop) || []), ...(idx.byHandle.get(shop) || [])]) hits.add(b)
    const title = ` ${norm(p.title)} `
    if (title.trim()) {
      for (const w of title.trim().split(' ')) {
        for (const c of idx.byFirstWord.get(w) || []) if (nameIsDistinct(c.brand.name) && title.includes(` ${c.name} `)) hits.add(c.brand)
      }
    }
    for (const b of Array.from(hits)) add(b, 'product_tag', 'sure', `It carries a TikTok Shop product tag: ${quote(p.title || p.shop || 'a product')}${p.shop && p.title ? `, sold by ${p.shop}` : ''}.`)
  }

  // 2. The caption tags the brand's account.
  for (const m of v.mentions || []) {
    for (const b of idx.byHandle.get(m) || []) add(b, 'mention', 'sure', `Your caption tags @${m}, the brand’s TikTok account.`)
    // A handle that is the brand's name run together, when MVP has not read the
    // brand's own handle: likely, not sure.
    for (const b of idx.bySquash.get(m.replace(/[._]/g, '')) || []) {
      if (b.tiktokHandle) continue
      add(b, 'mention', nameIsDistinct(b.name) ? 'likely' : 'maybe', `Your caption tags @${m}, which is the brand’s name.`)
    }
  }

  // 3. Hashtags that are the brand's name run together.
  for (const h of v.hashtags || []) {
    const s = squash(h)
    if (s.length < 4) continue
    for (const b of idx.bySquash.get(s) || []) add(b, 'hashtag', nameIsDistinct(b.name) ? 'likely' : 'maybe', `#${h} in your caption.`)
  }

  // 4. The brand's name in the caption, as whole words. Hashtags and @tags
  // are taken out first: they were weighed above, and one word must not count
  // twice (a "#glow" is not also a caption that says Glow).
  const cap = ` ${norm(v.caption.replace(/[#@][\p{L}\p{N}_.]+/gu, ' '))} `
  const words = cap.trim() ? cap.trim().split(' ') : []
  const firsts = new Set(words)
  for (const w of Array.from(firsts)) {
    for (const c of idx.byFirstWord.get(w) || []) {
      if (c.name.replace(/ /g, '').length < 4) continue
      if (!cap.includes(` ${c.name} `)) continue
      add(c.brand, 'name', nameIsDistinct(c.brand.name) ? 'likely' : 'maybe', `Your caption says ${quote(c.brand.name)}.`)
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

/** Every brand these videos point at, the surest first, with how MVP knows. */
export function matchVideos(videos: TikTokVideo[], idx: MatchIndex): BrandMatch[] {
  const by = new Map<string, BrandMatch & { kinds: Set<MatchKind> }>()
  for (const v of videos) {
    for (const hit of matchVideo(v, idx)) {
      const m = by.get(hit.brand.id) ?? { brandId: hit.brand.id, name: hit.brand.name, sureness: hit.sureness, videoIds: [], how: [], newestAt: null, kinds: new Set<MatchKind>() }
      if (RANK[hit.sureness] > RANK[m.sureness]) m.sureness = hit.sureness
      if (!m.videoIds.includes(v.id)) m.videoIds.push(v.id)
      // One line per video and kind, the strongest kinds first, at most eight.
      if (!m.how.some((h) => h.videoId === v.id && h.kind === hit.how.kind)) m.how.push(hit.how)
      m.kinds.add(hit.how.kind)
      if (v.postedAt && (!m.newestAt || v.postedAt > m.newestAt)) m.newestAt = v.postedAt
      by.set(hit.brand.id, m)
    }
  }
  // Each sign stands on its own: an everyday name seen as a hashtag and in a
  // caption is still the same everyday word, so it stays a maybe. Only a sign
  // that is likely or sure by itself makes the brand a match.
  const list = Array.from(by.values()).map(({ kinds: _kinds, ...m }) => {
    const how = m.how.sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind]).slice(0, 8)
    return { ...m, how }
  })
  return list.sort((a, b) => RANK[b.sureness] - RANK[a.sureness] || b.videoIds.length - a.videoIds.length || a.name.localeCompare(b.name))
}

/** The matches the page shows as matches: sure and likely. Maybes are shown
 *  apart and never counted as a brand you filmed. */
export const isMatch = (m: Pick<BrandMatch, 'sureness'>) => m.sureness !== 'maybe'

export const SURENESS_WORDS: Record<Sureness, { label: string; says: string }> = {
  sure: { label: 'Sure', says: 'The video’s product tag or your caption’s @tag points at this brand.' },
  likely: { label: 'Likely', says: 'Your caption names the brand or one of its products.' },
  maybe: { label: 'Maybe', says: 'The brand’s name is an everyday word, so it could be chance. Check the video.' },
}

// ── THE REQUEST TO A BRAND YOU FILMED (Seb, 2026-11-09: "request partnership
// with the brand ... all from there") ─────────────────────────────────────
// A request to a brand Match my TikTok matched says, in one line of MVP's own,
// that the creator already made a video with it, with the video's TikTok
// address. Written by MVP, not the request writer, so it is there every time,
// exact, and the writer's "keep the core message word for word" holds.

/** The line: "I already made a TikTok video featuring your Ninja CREAMi
 *  Deluxe: <url>", in the core message's voice (we or I). Null without a
 *  TikTok video address. Never a price: a product title's $ amount is dropped. */
export function filmedLine(o: { core: string; url: string | null | undefined; product?: string | null; brand: string }): string | null {
  const url = String(o.url || '').trim()
  if (!/^https:\/\/(www\.)?tiktok\.com\/@[^/\s]+\/video\/\d+/i.test(url)) return null
  const we = /\b(we|we're|we've|our|us)\b/i.test(o.core) && !/\b(I|I'm|I've|my)\b/.test(o.core)
  const product = String(o.product || '').replace(/\$\s?\d[\d,.]*/g, '').replace(/\s+/g, ' ').trim()
  const what = product && product.length <= 70 ? `your ${product}` : o.brand.trim() || 'your brand'
  return `${we ? 'We' : 'I'} already made a TikTok video featuring ${what}: ${url}`
}

/** The draft with the line after its greeting (its first paragraph). Left as
 *  it was when the address is already in it. */
export function withFilmedLine(draft: string, line: string | null): string {
  if (!line) return draft
  const url = line.slice(line.lastIndexOf(' ') + 1)
  if (draft.includes(url)) return draft
  const parts = draft.split(/\n\s*\n/)
  if (parts.length < 2) return `${draft.trim()}\n\n${line}`
  return [parts[0], line, ...parts.slice(1)].join('\n\n')
}
