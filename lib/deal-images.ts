// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DEAL PICTURES AND DEAL STORY IMAGES, MADE BY MVP (Seb, 2026-10-28: "move
// those two away from Cloudinary as well"). Cloudinary disabled MVP's account
// for going over its usage limits. Until now it drew:
//   - the square DEAL CARD posted to Facebook, Threads, LinkedIn, Telegram and
//     Bluesky (product on white, framed on dark, a purple hook at the top, a
//     supporting line under it, a brand chip at the bottom, the logo in the
//     corner); without it those posts fell back to the plain product photo;
//   - the 9:16 deal STORY for Instagram (the product on white, framed on dark,
//     the logo and handle at the top, a purple headline, and a tilted white
//     LINK IN BIO sticker near the bottom); without it no Story went out.
// MVP draws both itself now, to the same layout, colours and sizes, with the
// text in Arimo bold (shaped like the Arial Cloudinary used), and keeps the
// result in its own storage. The same inputs give the same file, so a deal
// posted twice is drawn once.

import { createHash } from 'node:crypto'
import { drawTextPill, drawableText } from '@/lib/text-pill'
import { assertPublicHttpUrl } from '@/lib/ssrf-guard'

const DARK = '#0e0e11'
const PURPLE = '#7C3AED'
const INK = '#111114'

/** The words, trimmed to fit. Cloudinary dropped %, commas and slashes
 *  (they broke its URLs, so "50% OFF" read "50 OFF"); MVP draws them. */
export function dealText(s: string | null | undefined, max: number): string {
  return drawableText(s).slice(0, max).trim()
}

async function fetchImage(url: string, timeoutMs = 20_000): Promise<Buffer | null> {
  try {
    assertPublicHttpUrl(url, { allowHttp: true })
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0)' } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 100 ? buf : null
  } catch { return null }
}

/** The product fitted inside a w x h white box. */
async function productOnWhite(img: Buffer, w: number, h: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp(img).flatten({ background: '#ffffff' }).resize(w, h, { fit: 'contain', background: '#ffffff' }).png().toBuffer()
}

/** A logo cut to a circle of this size, or null when it cannot be read. */
async function roundLogo(url: string | null | undefined, size: number): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null
  const img = await fetchImage(url, 10_000)
  if (!img) return null
  try {
    const { default: sharp } = await import('sharp')
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`)
    return await sharp(img).resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  } catch { return null }
}

type Layer = { input: Buffer; left: number; top: number }
const centred = (frameW: number, w: number) => Math.max(0, Math.round((frameW - w) / 2))

export type DealCardOpts = { headline?: string; subline?: string; brandName?: string; logoUrl?: string }

/** The 1080x1080 deal card as a JPEG, or null when the product image cannot
 *  be read. Cloudinary's layout: product padded to 940 on white, framed on
 *  dark; logo 92 round at 44,44; hook 72 on purple 56 from the top; the
 *  supporting line 38 on white at 148; the brand chip 34 on ink 48 from the
 *  bottom. */
export async function drawDealCard(productImageUrl: string, opts: DealCardOpts = {}): Promise<Buffer | null> {
  const img = await fetchImage(productImageUrl)
  if (!img) return null
  const { default: sharp } = await import('sharp')
  const S = 1080
  const layers: Layer[] = [{ input: await productOnWhite(img, 940, 940), left: 70, top: 70 }]
  const logo = await roundLogo(opts.logoUrl, 92)
  if (logo) layers.push({ input: logo, left: 44, top: 44 })
  const headline = dealText(opts.headline, 22).toUpperCase()
  let below = 56
  if (headline) {
    const p = await drawTextPill(headline, { fontPx: 72, color: '#ffffff', background: PURPLE, radius: 14, letterSpacing: 2, maxWidth: S - 240 })
    layers.push({ input: p.png, left: centred(S, p.width), top: 56 })
    below = 56 + p.height
  }
  const subline = dealText(opts.subline, 40)
  if (subline) {
    const p = await drawTextPill(subline, { fontPx: 38, color: INK, background: '#ffffff', radius: 10, maxWidth: S - 160 })
    layers.push({ input: p.png, left: centred(S, p.width), top: Math.max(148, below + 10) })
  }
  const brand = dealText(opts.brandName, 28)
  if (brand) {
    const p = await drawTextPill(brand, { fontPx: 34, color: '#ffffff', background: INK, radius: 20, maxWidth: S - 160 })
    layers.push({ input: p.png, left: centred(S, p.width), top: S - 48 - p.height })
  }
  return sharp({ create: { width: S, height: S, channels: 3, background: DARK } }).composite(layers).jpeg({ quality: 90 }).toBuffer()
}

// The chain-link icon from the Story's LINK IN BIO sticker.
const LINK_ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111114" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>').toString('base64')}`

/** The white LINK IN BIO sticker, 520 wide, tilted 5 degrees as Cloudinary
 *  drew it, as a transparent PNG. */
export async function drawLinkSticker(): Promise<{ png: Buffer; width: number; height: number }> {
  const { default: sharp } = await import('sharp')
  const pill = await drawTextPill('LINK IN BIO', { fontPx: 50, color: INK, background: '#ffffff', radius: 36, letterSpacing: 2, padY: 40, padX: 40, icon: { src: LINK_ICON, width: 62, height: 62, gap: 20 } })
  const sized = await sharp(pill.png).resize({ width: 520 }).png().toBuffer()
  const { data, info } = await sharp(sized).rotate(-5, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true })
  return { png: data, width: info.width, height: info.height }
}

export type StoryOpts = { headline?: string; handle?: string; logoUrl?: string }

/** The 1080x1920 deal Story as a JPEG, or null when the product image cannot
 *  be read. Cloudinary's layout: product padded to 960x1120 on white, framed
 *  on dark; logo 104 round, centred 80 from the top; handle 40 white under
 *  it; headline 54 on purple; the LINK IN BIO sticker 300 from the bottom. */
export async function drawStoryImage(productImageUrl: string, opts: StoryOpts = {}): Promise<Buffer | null> {
  const img = await fetchImage(productImageUrl)
  if (!img) return null
  const { default: sharp } = await import('sharp')
  const W = 1080, H = 1920
  const layers: Layer[] = [{ input: await productOnWhite(img, 960, 1120), left: 60, top: 400 }]
  const logo = await roundLogo(opts.logoUrl, 104)
  if (logo) layers.push({ input: logo, left: centred(W, 104), top: 80 })
  const handle = dealText(opts.handle, 30)
  let below = 0
  if (handle) {
    const top = logo ? 205 : 96
    const p = await drawTextPill(handle, { fontPx: 40, color: '#ffffff', maxWidth: W - 160 })
    layers.push({ input: p.png, left: centred(W, p.width), top })
    below = top + p.height
  }
  const headline = dealText(opts.headline, 40).toUpperCase()
  if (headline) {
    const planned = logo ? 270 : (handle ? 150 : 96)
    const p = await drawTextPill(headline, { fontPx: 54, color: '#ffffff', background: PURPLE, radius: 12, maxWidth: W - 160 })
    layers.push({ input: p.png, left: centred(W, p.width), top: Math.max(planned, below + 10) })
  }
  const sticker = await drawLinkSticker()
  layers.push({ input: sticker.png, left: centred(W, sticker.width), top: H - 300 - sticker.height })
  return sharp({ create: { width: W, height: H, channels: 3, background: DARK } }).composite(layers).jpeg({ quality: 90 }).toBuffer()
}

/** The storage name for these inputs: the same deal drawn twice is one file. */
export function dealImageKey(kind: 'card' | 'story', productImageUrl: string, opts: object): string {
  const h = createHash('sha1').update(JSON.stringify([kind, productImageUrl, opts, 'v1'])).digest('hex').slice(0, 24)
  return `deal-images/${kind}-${h}.jpg`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function save(admin: any, key: string, jpg: Buffer): Promise<string | null> {
  try {
    const { error } = await admin.storage.from('instagram-videos').upload(key, jpg, { contentType: 'image/jpeg', upsert: true, cacheControl: '86400' })
    if (error) { console.warn('[deal-images] not saved:', error.message); return null }
    return admin.storage.from('instagram-videos').getPublicUrl(key)?.data?.publicUrl ?? null
  } catch (e) {
    console.warn('[deal-images] not saved:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/** The deal card's public URL, drawn and saved by MVP, or null. */
export async function dealCardUrl(productImageUrl: string, opts: DealCardOpts = {}): Promise<string | null> {
  try {
    const jpg = await drawDealCard(productImageUrl, opts)
    if (!jpg) return null
    const { createAdminClient } = await import('@/lib/supabase/admin')
    return save(createAdminClient(), dealImageKey('card', productImageUrl, opts), jpg)
  } catch (e) {
    console.warn('[deal-images] deal card not drawn:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/** The deal Story's public URL, drawn and saved by MVP, or null. */
export async function storyImageUrl(productImageUrl: string, opts: StoryOpts = {}): Promise<string | null> {
  try {
    const jpg = await drawStoryImage(productImageUrl, opts)
    if (!jpg) return null
    const { createAdminClient } = await import('@/lib/supabase/admin')
    return save(createAdminClient(), dealImageKey('story', productImageUrl, opts), jpg)
  } catch (e) {
    console.warn('[deal-images] Story image not drawn:', e instanceof Error ? e.message : String(e))
    return null
  }
}
