// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand recap: one message per brand, with every link the creator published
// for that brand's products (migration 379).
//
// The per-post "Share with brand" recap (lib/brand-recap.ts) sends one post's
// links. A creator who reviewed six of a brand's products on YouTube, their
// blog and four social platforms has thirty links for that brand, spread over
// weeks, and the brand is the one person who wants to see all of them at once.
// This is the pure half: which links count, how they group by brand, which are
// new since the last recap, and the message itself.
//
// WHAT COUNTS AS A LINK. The creator's own content, public, on a real address.
// Not the product's own Amazon page (the brand has it), not an mvpl.ink or
// other affiliate redirect (it points back at the product, not the content),
// and not a platform's home page standing in for a post whose address was not
// kept (the Instagram Story result is "https://www.instagram.com/").
//
// Isomorphic and dependency free: the API builds the groups, the page rebuilds
// the message as the creator ticks links on and off.

import { brandKey, brandDisplay } from '@/lib/brand-normalize'
import { CC_GROUP_BREAK } from '@/lib/brand-recap'
import { asinFromAmazonUrl } from '@/lib/asin'

export type ContentPlatform =
  | 'youtube' | 'blog' | 'x' | 'facebook' | 'instagram' | 'threads' | 'pinterest'
  | 'tiktok' | 'linkedin' | 'bluesky' | 'telegram' | 'amazon_video'

export const PLATFORM_LABEL: Record<ContentPlatform, string> = {
  youtube: 'YouTube', blog: 'Written review', x: 'X', facebook: 'Facebook', instagram: 'Instagram',
  threads: 'Threads', pinterest: 'Pinterest', tiktok: 'TikTok', linkedin: 'LinkedIn', bluesky: 'Bluesky',
  telegram: 'Telegram', amazon_video: 'Amazon video',
}
/** The order links read in: the long form first, then video, then socials. */
const PLATFORM_ORDER: ContentPlatform[] = ['youtube', 'blog', 'amazon_video', 'tiktok', 'instagram', 'facebook', 'x', 'threads', 'pinterest', 'linkedin', 'bluesky', 'telegram']

export interface ContentLink {
  asin: string
  platform: ContentPlatform
  url: string
  /** When it went live, when known. */
  at: string | null
  /** Set when the link is shown but something about it is uncertain. */
  note?: string | null
  /** Already in a recap that went to this brand. */
  sent?: boolean
}

export interface BrandProduct {
  asin: string
  name: string
  links: ContentLink[]
}

export interface BrandGroup {
  brandKey: string
  brand: string
  /** Creator Connections campaigns for this brand, for the send. */
  campaignIds: string[]
  products: BrandProduct[]
  linkCount: number
  /** Links not in any recap already sent to this brand. */
  newCount: number
  lastRecapAt: string | null
  newestAt: string | null
}

/** A platform name as the post routes and result rows spell it. */
export function contentPlatform(raw: string | null | undefined): ContentPlatform | null {
  const p = String(raw || '').toLowerCase().trim()
  if (p === 'twitter' || p === 'x') return 'x'
  if (p === 'fb' || p === 'facebook') return 'facebook'
  if (p === 'instagram' || p === 'instagram_reel' || p === 'instagram_feed' || p === 'ig') return 'instagram'
  if (p === 'youtube' || p === 'yt') return 'youtube'
  if (p === 'blog' || p === 'wordpress') return 'blog'
  if (p === 'amazon_video' || p === 'amazon-video') return 'amazon_video'
  if ((PLATFORM_ORDER as string[]).includes(p)) return p as ContentPlatform
  return null
}

const REDIRECTS = /(^|\.)(mvpl\.ink|geni\.us|gnz\.[a-z]+|bit\.ly|amzn\.to|a\.co|tinyurl\.com|rebrand\.ly|ow\.ly|buff\.ly)$/

/**
 * The link as it should be sent, or null when it is not the creator's content.
 * Pure. The URL is kept as it is apart from a trailing slash and a fragment,
 * so it still opens exactly what the platform returned.
 */
export function shareableUrl(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim()
  if (!/^https?:\/\//i.test(s)) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (REDIRECTS.test(host)) return null
  // A platform's front page is not a post.
  if ((u.pathname === '/' || u.pathname === '') && !u.search) return null
  // The product's own listing is the brand's page, not the creator's content.
  // Amazon's video pages (/vdp/) and storefront posts are content, so they stay.
  if (/(^|\.)amazon\.[a-z.]+$/.test(host) && !/\/vdp\//.test(u.pathname)) return null
  u.hash = ''
  return u.toString().replace(/\/$/, '')
}

/** The same post under two spellings is one link: compare without scheme,
 *  www, trailing slash or case in the host. */
export function linkKey(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    // One Amazon video is one /vdp/ page, whatever ?product= is on the link.
    if (/(^|\.)amazon\.[a-z.]+$/.test(host) && /^\/vdp\//.test(u.pathname)) return `${host}${u.pathname.replace(/\/$/, '').toLowerCase()}`
    return `${host}${u.pathname.replace(/\/$/, '')}${u.search}`
  } catch { return url.trim().toLowerCase() }
}

export interface BrandOfAsin {
  brand: string
  campaignIds: string[]
}

/**
 * Group the creator's links by the brand behind each product. Products with no
 * brand on Creator Connections are left out: there is no chat to send to.
 * Pure: the caller does the reads.
 */
export function groupByBrand(input: {
  links: ContentLink[]
  brandOf: Map<string, BrandOfAsin>
  names: Map<string, string>
  /** Every URL already in a recap that went, per brand key. */
  sent: Map<string, Set<string>>
  lastRecapAt: Map<string, string>
}): BrandGroup[] {
  const groups = new Map<string, BrandGroup & { seen: Set<string> }>()
  for (const l of input.links) {
    const asin = l.asin.toUpperCase()
    const b = input.brandOf.get(asin)
    if (!b) continue
    const key = brandKey(b.brand)
    if (!key) continue
    const url = shareableUrl(l.url)
    if (!url) continue
    let g = groups.get(key)
    if (!g) {
      g = { brandKey: key, brand: brandDisplay(b.brand) || b.brand, campaignIds: [], products: [], linkCount: 0, newCount: 0,
        lastRecapAt: input.lastRecapAt.get(key) ?? null, newestAt: null, seen: new Set() }
      groups.set(key, g)
    }
    for (const c of b.campaignIds) if (c && !g.campaignIds.includes(c)) g.campaignIds.push(c)
    const k = linkKey(url)
    // One post about two products (a comparison video) is listed under the
    // first, once. A brand does not need the same link twice.
    if (g.seen.has(k)) continue
    g.seen.add(k)
    let p = g.products.find((x) => x.asin === asin)
    if (!p) { p = { asin, name: input.names.get(asin) || asin, links: [] }; g.products.push(p) }
    const wasSent = !!input.sent.get(key)?.has(k)
    p.links.push({ ...l, asin, url, sent: wasSent })
    g.linkCount++
    if (!wasSent) g.newCount++
    if (l.at && (!g.newestAt || l.at > g.newestAt)) g.newestAt = l.at
  }
  const out = [...groups.values()].map(({ seen: _seen, ...g }) => {
    for (const p of g.products) p.links.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || (a.at || '').localeCompare(b.at || ''))
    g.products.sort((a, b) => newest(b).localeCompare(newest(a)))
    return g
  })
  // Brands with something new to send first, then the most recent work.
  return out.sort((a, b) => (b.newCount > 0 ? 1 : 0) - (a.newCount > 0 ? 1 : 0) || (b.newestAt || '').localeCompare(a.newestAt || ''))
}
const newest = (p: BrandProduct) => p.links.reduce((m, l) => (l.at && l.at > m ? l.at : m), '')

/** Is this link already in a recap sent to the brand? */
export function alreadySent(sent: Set<string> | undefined, url: string): boolean {
  return !!sent?.has(linkKey(url))
}

/** Shorten a long Amazon listing title to something a person would say. */
export function productShortName(title: string | null | undefined, asin: string): string {
  const t = String(title || '').trim()
  if (!t) return asin
  const cut = t.split(/\s*[,|(]\s*/)[0].split(/\s+(?:with|for|featuring)\s+/i)[0].trim()
  return (cut.length > 70 ? `${cut.slice(0, 67).trim()}...` : cut) || asin
}

export interface RecapMessageInput {
  brand: string
  products: Array<{ name: string; links: Array<{ platform: ContentPlatform; url: string }> }>
  /** Only links since the last recap, which changes the opening line. */
  sinceLast: boolean
  name: string
  site: string
}

function productBlocks(products: RecapMessageInput['products']): string[] {
  return products
    .filter((p) => p.links.length)
    .map((p) => [p.name, ...p.links.map((l) => `• ${PLATFORM_LABEL[l.platform]}: ${l.url}`)].join('\n'))
}

function opening(v: RecapMessageInput): string {
  const n = v.products.filter((p) => p.links.length).length
  const what = n === 1 ? 'your product' : `${n} of your products`
  return `Hi ${v.brand || 'there'} team,\n\n` + (v.sinceLast
    ? `Here is what I have published for ${what} since my last update:`
    : `I wanted to share everything I have published for ${what} so far. Here is where it is live:`)
}
const CLOSING = 'I am happy to keep featuring your products. If there is something new you would like covered, or anything you would like me to highlight, just let me know.'
const signoff = (v: RecapMessageInput) => ['Thanks so much,', v.name, v.site].filter((s) => String(s || '').trim()).join('\n')

/** The message to copy or email: plain text, blank lines between parts. */
export function buildBrandRecapMessage(v: RecapMessageInput): string {
  return [opening(v), ...productBlocks(v.products), CLOSING, signoff(v)].join('\n\n').trim()
}

/** Longest single Creator Connections message group this builds. No limit is
 *  documented, so the links are split at product boundaries well below the
 *  size where a chat box is likely to refuse. */
export const CC_GROUP_MAX_CHARS = 1500

/**
 * The Creator Connections version: the same message, with the group marker
 * SCOUT splits on between parts, so each part is sent as its own chat
 * message. Product blocks are packed into groups up to CC_GROUP_MAX_CHARS.
 */
export function buildBrandRecapCcMessage(v: RecapMessageInput): string {
  const packed: string[] = []
  let cur = ''
  for (const block of productBlocks(v.products)) {
    if (cur && cur.length + 2 + block.length > CC_GROUP_MAX_CHARS) { packed.push(cur); cur = block }
    else cur = cur ? `${cur}\n\n${block}` : block
  }
  if (cur) packed.push(cur)
  return [opening(v), ...packed, CLOSING, signoff(v)].filter((g) => g.trim()).join(`\n\n${CC_GROUP_BREAK}\n\n`)
}

/** How many chat messages a CC recap will be sent as. */
export function ccGroupCount(ccMessage: string): number {
  return ccMessage.split(CC_GROUP_BREAK).filter((s) => s.trim()).length
}

/**
 * A message the creator edited by hand, as Creator Connections groups. The
 * opening paragraph is its own group; the rest are packed at paragraph breaks
 * up to CC_GROUP_MAX_CHARS, so a long list never becomes one oversized box
 * and a short note never becomes a dozen separate messages.
 */
export function ccFromPlainText(text: string): string {
  const paras = String(text || '').split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
  if (paras.length <= 1) return paras[0] || ''
  const groups: string[] = []
  // "Hi X team," and the line after it read as one opening.
  const first = /,\s*$/.test(paras[0]) && paras.length > 2 ? `${paras.shift()}\n\n${paras.shift()}` : (paras.shift() as string)
  groups.push(first)
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + 2 + p.length > CC_GROUP_MAX_CHARS) { groups.push(cur); cur = p }
    else cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) groups.push(cur)
  return groups.join(`\n\n${CC_GROUP_BREAK}\n\n`)
}

/** What SCOUT's refusal means, in words a creator can act on. */
export function ccSendReason(reason: string | null | undefined): string {
  const r = String(reason || '')
  if (r === 'not-installed') return 'Sending on Creator Connections needs the SCOUT extension. Copy the message instead.'
  if (r === 'timeout') return 'SCOUT did not answer in time, so MVP cannot tell whether it was sent. Check the brand chat before sending again.'
  if (r === 'no-campaign-for-asin' || r === 'no-campaign') return 'SCOUT found no Creator Connections campaign from this brand that you can message. Accept one of their campaigns, then send again, or copy the message and email it.'
  if (r === 'no-chat-unjoined' || r === 'no-message-button' || r === 'no-message-brand-button') return 'Amazon only opens the brand chat once you accept one of their campaigns. Accept one, then send again.'
  if (r === 'no-recipe') return 'SCOUT has not learned how to send on Creator Connections yet. Send one message to any brand by hand on Amazon, then try again.'
  return r ? `Amazon did not take the message (${r}). Copy it instead, or try again.` : 'The message was not sent. Copy it instead, or try again.'
}

/**
 * The public page of one of the creator's Amazon videos. The exact /vdp/ link
 * when Amazon gave one; otherwise built from Amazon's video id
 * (amzn1.vse.video.<32 hex>), whose code is the same 32 characters as a /vdp/
 * page. Only a video Amazon has published: a processing or rejected one has
 * no public page. `built` says the link was made rather than read. Pure.
 */
export function amazonVideoPage(aci: string | null | undefined, mediaUrl: string | null | undefined, state: string | null | undefined): { url: string; built: boolean } | null {
  if (state && !/publish|live|approved|active/i.test(state)) return null
  if (mediaUrl && /^https?:\/\/(www\.)?amazon\.[a-z.]+\/vdp\/[a-z0-9]+/i.test(mediaUrl)) return { url: mediaUrl, built: false }
  const m = /^amzn1\.vse\.video\.([0-9a-f]{32})$/i.exec(String(aci || '').trim())
  return m ? { url: `https://www.amazon.com/vdp/${m[1].toLowerCase()}`, built: true } : null
}

/**
 * Which products a YouTube video description links to: Amazon product links
 * (/dp/, /gp/product/, ?asin=) read directly, and MVP's own short links
 * (mvpl.ink/CODE, /go/CODE) through the creator's code-to-product list.
 * Pure. Codes it does not know are ignored rather than guessed.
 */
export function asinsInDescription(text: string | null | undefined, codeToAsin: Map<string, string>): string[] {
  const s = String(text || '')
  if (!s) return []
  const out = new Set<string>()
  // Every Amazon link, read by the shared parser, which finds the ASIN
  // anywhere in the path (amazon.com/Product-Name/dp/B0..., /gp/product/...).
  for (const m of s.matchAll(/https?:\/\/(?:[a-z0-9-]+\.)*amazon\.[a-z.]+\/[^\s"'<>)\]]+/gi)) { const a = asinFromAmazonUrl(m[0]); if (a) out.add(a) }
  for (const m of s.matchAll(/[?&]asin=([A-Z0-9]{10})\b/gi)) out.add(m[1].toUpperCase())
  for (const m of s.matchAll(/(?:mvpl\.ink|\/go)\/([A-Za-z0-9]{4,16})\b/g)) {
    const a = codeToAsin.get(m[1])
    if (a) out.add(a.toUpperCase())
  }
  return [...out].filter((a) => /^[A-Z0-9]{10}$/.test(a))
}
