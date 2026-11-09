// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CREATOR'S OWN TIKTOK VIDEOS, READ INTO ONE SHAPE (Seb, 2026-11-09: TrybeDaily
// "can scan user's tiktok accounts and retrieve their videos and match them to
// brands and products on trybe.. possible?"; "build both, but we're going to
// use Scout to start").
//
// Two ways in, one shape out:
//
//   SCOUT       TikTok's own answers to the creator's profile page, kept as the
//               page received them (extension/tiktok-videos-hook.js) and handed
//               to MVP as they were. Read here, on MVP's server, so a change on
//               TikTok's side is fixed in MVP without a new SCOUT.
//   OFFICIAL    TikTok's video list API (scope video.list, lib/tiktok-video-list),
//               once TikTok approves the scope. It carries no product tags.
//
// NOTHING IS GUESSED. A field TikTok did not send is null, never 0: a video
// whose view count was not sent is not a video with no views. A product tag is
// kept only when TikTok's answer says what the product is (a title or a shop),
// so "with a product" counts what was really there. Pure.

export interface TikTokProductTag {
  /** TikTok Shop's product id, when the answer carries one. */
  id: string | null
  title: string | null
  /** The shop or seller the tag names. */
  shop: string | null
}

export interface TikTokVideo {
  id: string
  /** The video on TikTok: https://www.tiktok.com/@handle/video/<id>. */
  url: string
  caption: string
  /** Lowercased, without the #. */
  hashtags: string[]
  /** Lowercased handles the caption tags, without the @. */
  mentions: string[]
  postedAt: string | null
  views: number | null
  likes: number | null
  /** TikTok's cover picture. Its address expires after some days; the page
   *  hides a broken one and the next scan brings a fresh one. */
  cover: string | null
  duration: number | null
  products: TikTokProductTag[]
}

export const CAPTION_MAX = 2200
const LIST_MAX = 40

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A TikTok handle as typed or pasted: "@Gomin.Reviews", a profile link, or a
 *  bare name. Null when it cannot be a handle (2 to 24 letters, digits, _ or .). */
export function cleanHandle(raw: unknown): string | null {
  let s = String(raw ?? '').trim()
  const m = s.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i)
  if (m) s = m[1]
  s = s.replace(/^@+/, '').trim().toLowerCase()
  return /^[a-z0-9_.]{2,24}$/.test(s) && !/^\.|\.$/.test(s) ? s : null
}

/** The address of a video on TikTok, from its handle and id. */
export function videoUrl(handle: string, id: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${encodeURIComponent(id)}`
}

/** Hashtags and @handles written in a caption. */
export function captionTags(caption: string): { hashtags: string[]; mentions: string[] } {
  const hashtags = Array.from(caption.matchAll(/#([\p{L}\p{N}_]{2,80})/gu)).map((m) => m[1].toLowerCase())
  const mentions = Array.from(caption.matchAll(/(?:^|[^\p{L}\p{N}_.])@([A-Za-z0-9_.]{2,24})/gu)).map((m) => m[1].toLowerCase().replace(/\.+$/, ''))
  return { hashtags, mentions }
}

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).slice(0, LIST_MAX)

/** A product tag, from one of TikTok's anchors or product objects. Null when
 *  it does not say what the product is. */
function productFrom(o: Record<string, unknown>): TikTokProductTag | null {
  let extra: Record<string, unknown> | null = null
  const ex = o.extra ?? o.extraInfo ?? o.extra_info
  if (typeof ex === 'string' && /^\s*[[{]/.test(ex)) {
    try {
      const parsed = JSON.parse(ex) as unknown
      extra = obj(Array.isArray(parsed) ? parsed[0] : parsed)
    } catch { extra = null }
  } else extra = obj(ex)
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = str(o[k]) ?? (extra ? str(extra[k]) : null)
      if (v) return v
    }
    return null
  }
  const id = pick('product_id', 'productId', 'productID', 'item_id')
  const title = pick('title', 'product_title', 'productTitle', 'product_name', 'productName', 'name', 'keyword')
  const shop = pick('shop_name', 'shopName', 'seller_name', 'sellerName', 'store_name', 'storeName', 'brand_name', 'brandName')
  // An anchor is a product tag only when it says it is one: a product id, a
  // shop, or a product-like kind. A place or an effect anchor is not.
  const kind = `${str(o.type) ?? ''} ${str(o.component_key) ?? ''} ${str(o.componentKey) ?? ''} ${str(o.schema) ?? ''} ${extra ? JSON.stringify(extra).slice(0, 400) : ''}`
  const productish = !!id || !!shop || /product|shop|ecom|commerce|anchor_shop/i.test(kind)
  if (!productish || (!title && !shop)) return null
  return { id, title: title ? title.slice(0, 200) : null, shop: shop ? shop.slice(0, 120) : null }
}

/** Every product tag in one of TikTok's video objects: its anchors, and any
 *  product list it carries, wherever TikTok put it (a few levels deep). */
export function productTags(item: unknown): TikTokProductTag[] {
  const out: TikTokProductTag[] = []
  const seen = new Set<string>()
  const add = (p: TikTokProductTag | null) => {
    if (!p) return
    const key = (p.id || `${p.title}|${p.shop}`).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  const walk = (v: unknown, depth: number, inProducts: boolean) => {
    if (depth > 5 || out.length >= 10) return
    if (Array.isArray(v)) { for (const x of v.slice(0, 30)) walk(x, depth + 1, inProducts); return }
    const o = obj(v)
    if (!o) return
    if (inProducts) add(productFrom(o))
    for (const [k, x] of Object.entries(o)) {
      if (k === 'author' || k === 'music' || k === 'video' || k === 'stats' || k === 'statsV2' || k === 'textExtra' || k === 'challenges') continue
      if (/anchor|product|shop|commerce|ecom/i.test(k)) walk(x, depth + 1, true)
      else if (inProducts) walk(x, depth + 1, true)
    }
  }
  walk(item, 0, false)
  return out
}

/** One video from the answers TikTok's own profile page receives (SCOUT). */
export function parseWebItem(raw: unknown, fallbackHandle: string): TikTokVideo | null {
  const o = obj(raw)
  if (!o) return null
  const id = str(o.id)
  if (!id || !/^\d{6,30}$/.test(id)) return null
  const author = obj(o.author)
  const handle = cleanHandle(author?.uniqueId) || fallbackHandle
  const caption = (str(o.desc) ?? '').slice(0, CAPTION_MAX)
  const fromCaption = captionTags(caption)
  const extraTags = arr(o.textExtra).map(obj).filter(Boolean) as Array<Record<string, unknown>>
  const challenges = arr(o.challenges).map(obj).filter(Boolean) as Array<Record<string, unknown>>
  const hashtags = uniq([
    ...fromCaption.hashtags,
    ...extraTags.map((t) => (str(t.hashtagName) ?? '').toLowerCase()),
    ...challenges.map((c) => (str(c.title) ?? '').toLowerCase()),
  ])
  const mentions = uniq([...fromCaption.mentions, ...extraTags.map((t) => cleanHandle(t.userUniqueId) ?? '')])
  const stats = obj(o.stats)
  const statsV2 = obj(o.statsV2)
  const video = obj(o.video)
  const created = num(o.createTime)
  return {
    id,
    url: videoUrl(handle, id),
    caption,
    hashtags,
    mentions,
    postedAt: created ? new Date(created * 1000).toISOString() : null,
    views: num(stats?.playCount) ?? num(statsV2?.playCount),
    likes: num(stats?.diggCount) ?? num(statsV2?.diggCount),
    cover: str(video?.cover) ?? str(video?.originCover) ?? str(video?.dynamicCover),
    duration: num(video?.duration),
    products: productTags(o),
  }
}

/** One video from TikTok's official video list API (scope video.list). */
export function parseOfficialVideo(raw: unknown, handle: string): TikTokVideo | null {
  const o = obj(raw)
  if (!o) return null
  const id = str(o.id)
  if (!id || !/^\d{6,30}$/.test(id)) return null
  const caption = [str(o.title), str(o.video_description)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('\n').slice(0, CAPTION_MAX)
  const tags = captionTags(caption)
  const created = num(o.create_time)
  const share = str(o.share_url)
  return {
    id,
    url: share && /^https:\/\/(www\.)?tiktok\.com\//i.test(share) ? share : videoUrl(handle, id),
    caption,
    hashtags: uniq(tags.hashtags),
    mentions: uniq(tags.mentions),
    postedAt: created ? new Date(created * 1000).toISOString() : null,
    views: num(o.view_count),
    likes: num(o.like_count),
    cover: str(o.cover_image_url),
    duration: num(o.duration),
    products: [],
  }
}

/** The videos in one answer TikTok's profile page received: its item list. */
export function itemsOfBody(body: unknown): unknown[] {
  const o = obj(body)
  if (!o) return []
  return arr(o.itemList ?? o.items ?? o.item_list)
}

/** What SCOUT read about the profile itself, kept only as far as it is sure. */
export interface TikTokProfile {
  handle: string
  name: string | null
  avatar: string | null
  /** The public video count TikTok shows on the profile. */
  videoCount: number | null
  privateAccount: boolean | null
}

export function cleanProfile(raw: unknown, handle: string): TikTokProfile {
  const o = obj(raw) ?? {}
  const avatar = str(o.avatar)
  return {
    handle,
    name: str(o.name)?.slice(0, 120) ?? null,
    avatar: avatar && /^https:\/\//i.test(avatar) ? avatar.slice(0, 1000) : null,
    videoCount: num(o.videoCount),
    privateAccount: typeof o.privateAccount === 'boolean' ? o.privateAccount : null,
  }
}

/** How many of these videos carry a product tag. */
export function withProductCount(videos: Array<Pick<TikTokVideo, 'products'>>): number {
  return videos.filter((v) => (v.products || []).length > 0).length
}
