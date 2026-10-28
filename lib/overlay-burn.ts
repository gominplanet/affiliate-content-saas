// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE OVERLAY BURNER WITHOUT CLOUDINARY (Seb, 2026-10-28: "if we don't need
// the Cloudinary account, just make sure that people can do the burn and the
// stuff with Clip Factory as they used to"). Cloudinary disabled MVP's
// account for going over its usage limits, and every burn stopped with it.
//
// MVP's own render server now burns every overlay, looking as Cloudinary's
// did:
//   - a text caption is drawn here as an image, in the same four looks (white
//     on dark, black on white, yellow on dark, white with a shadow) in an
//     Arial-like bold face, then burned on like a sticker;
//   - the video is made 1080x1920 first (filled, centre cropped), as
//     Cloudinary did, so every Reel has the same frame;
//   - a caption or sticker lands on the same spot Cloudinary put it: the
//     same corner offsets, the same 0.75 scale for a preset spot, and a
//     dragged spot exactly where the preview showed it.
// Cloudinary is only a backup now, used when the render server cannot be
// reached and Cloudinary still works.

import { createHash } from 'node:crypto'
import { renderCta, type RenderCtaResult } from '@/lib/youtube-ingest'
import { drawTextPill, drawableText } from '@/lib/text-pill'

export type BurnPosition = 'lower-third' | 'bottom' | 'center' | 'top' | 'lower-left' | 'lower-right' | 'upper-left' | 'upper-right'
export type BurnStyle = 'white-pill' | 'black-pill' | 'yellow-pill' | 'white-shadow'

/** The Reel frame every burn is made in. */
export const FRAME_W = 1080
export const FRAME_H = 1920
/** Cloudinary's default caption size, in pixels of the 1080 frame. */
export const CAPTION_FONT_PX = 64
/** A sticker on a preset spot is drawn at three quarters of its width, as
 *  Cloudinary did ("a badge, not a banner"); a dragged one is drawn as is. */
export const PRESET_STICKER_SCALE = 0.75

/** The four caption looks, the same colours Cloudinary used. */
export function captionLook(style: BurnStyle | string | null | undefined): { color: string; background: string | null; radius: number; shadow: boolean } {
  switch (style) {
    case 'black-pill': return { color: '#000000', background: '#ffffff', radius: 24, shadow: false }
    case 'yellow-pill': return { color: '#ffd400', background: '#111111', radius: 20, shadow: false }
    case 'white-shadow': return { color: '#ffffff', background: null, radius: 0, shadow: true }
    case 'white-pill':
    default: return { color: '#ffffff', background: '#111111', radius: 20, shadow: false }
  }
}

/** Where Cloudinary anchored each spot on the 1080x1920 frame. */
export function spotOf(pos: BurnPosition | string | null | undefined): { gravity: 'south' | 'north' | 'center' | 'south_west' | 'south_east' | 'north_west' | 'north_east'; x: number; y: number } {
  switch (pos) {
    case 'bottom': return { gravity: 'south', x: 0, y: 130 }
    case 'center': return { gravity: 'center', x: 0, y: 0 }
    case 'top': return { gravity: 'north', x: 0, y: 220 }
    case 'lower-left': return { gravity: 'south_west', x: 40, y: 150 }
    case 'lower-right': return { gravity: 'south_east', x: 40, y: 150 }
    case 'upper-left': return { gravity: 'north_west', x: 60, y: 240 }
    case 'upper-right': return { gravity: 'north_east', x: 60, y: 240 }
    case 'lower-third':
    default: return { gravity: 'south', x: 0, y: 360 }
  }
}

/** The top-left corner of a w x h overlay on the frame, the way Cloudinary
 *  placed it for that spot, as fractions of the frame. Pure. */
export function topLeftFor(pos: BurnPosition | string | null | undefined, w: number, h: number): { xPct: number; yPct: number } {
  const { gravity, x, y } = spotOf(pos)
  const midX = (FRAME_W - w) / 2 + x
  const left = gravity === 'south_west' || gravity === 'north_west' ? x
    : gravity === 'south_east' || gravity === 'north_east' ? FRAME_W - w - x
    : midX
  const top = gravity.startsWith('south') ? FRAME_H - h - y
    : gravity.startsWith('north') ? y
    : (FRAME_H - h) / 2 + y
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  return { xPct: clamp(left, FRAME_W - w) / FRAME_W, yPct: clamp(top, FRAME_H - h) / FRAME_H }
}

/** Text the caption face can draw: Latin letters and punctuation. Emoji and
 *  other scripts are dropped, as Cloudinary's Arial layer dropped them. */
export function drawableCaption(text: string): string {
  return drawableText(text) || 'LINK IN BIO'
}

/** The caption drawn as a transparent PNG at its size on the 1080 frame. */
export async function drawCaption(text: string, style: BurnStyle | string | null | undefined, fontPx = CAPTION_FONT_PX): Promise<{ png: Buffer; width: number; height: number }> {
  const look = captionLook(style)
  return drawTextPill(drawableCaption(text), { fontPx, color: look.color, background: look.background, radius: look.radius, shadow: look.shadow, maxWidth: FRAME_W - 120 })
}

/** A sticker's height over its width, read from the image itself. */
async function aspectOf(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const { default: sharp } = await import('sharp')
    const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    return m.width && m.height ? m.height / m.width : null
  } catch { return null }
}

export type BurnSpec = {
  /** The caption, when no sticker is used. */
  text: string
  position?: BurnPosition | string | null
  style?: BurnStyle | string | null
  /** A designed CTA box (PNG), burned instead of the caption. */
  stickerUrl?: string | null
  /** Sticker width as a share of the frame width (default 0.85). */
  stickerWidthPct?: number | null
  /** A dragged spot: the overlay's top-left as fractions of the frame. */
  placement?: { xPct: number; yPct: number } | null
  /** Seconds the overlay stays on screen from the start; 0 = the whole video. */
  durationSec?: number | null
}

/** Saves the drawn caption where the render server can fetch it. Injected so
 *  the drawing and placing can be tested without storage. */
export type SaveCaption = (png: Buffer, key: string) => Promise<string | null>

/** The render server request for this burn: what to burn and exactly where. */
export async function burnRequest(spec: BurnSpec, save: SaveCaption, userId: string): Promise<Parameters<typeof renderCta>[1] | { error: string }> {
  const dur = Number(spec.durationSec)
  const timing = { startSec: 0, endSec: Number.isFinite(dur) && dur > 0 ? dur : 86_400 }
  const free = spec.placement && Number.isFinite(spec.placement.xPct) && Number.isFinite(spec.placement.yPct)
    ? { xPct: Math.min(1, Math.max(0, spec.placement.xPct)), yPct: Math.min(1, Math.max(0, spec.placement.yPct)) }
    : null
  if (spec.stickerUrl) {
    const widthPct = Math.min(0.95, Math.max(0.1, (spec.stickerWidthPct ?? 0.85) * (free ? 1 : PRESET_STICKER_SCALE)))
    let spot = free
    if (!spot) {
      const aspect = await aspectOf(spec.stickerUrl)
      if (aspect) spot = topLeftFor(spec.position, widthPct * FRAME_W, widthPct * FRAME_W * aspect)
    }
    return {
      text: '', style: 'lowerthird', ...timing, frame: 'reel', kind: 'burn', stickerUrl: spec.stickerUrl, widthPct,
      ...(spot ? spot : { position: spec.position || 'lower-left' }),
    }
  }
  let drawn
  try { drawn = await drawCaption(spec.text, spec.style) } catch (e) {
    return { error: `the caption could not be drawn (${e instanceof Error ? e.message : String(e)})` }
  }
  const key = `${userId}/caption-${createHash('sha1').update(`${spec.style}|${drawableCaption(spec.text)}|${CAPTION_FONT_PX}`).digest('hex').slice(0, 20)}.png`
  const url = await save(drawn.png, key)
  if (!url) return { error: 'the caption image could not be saved' }
  return {
    text: '', style: 'lowerthird', ...timing, frame: 'reel', kind: 'burn', stickerUrl: url,
    widthPct: drawn.width / FRAME_W,
    ...(free ?? topLeftFor(spec.position, drawn.width, drawn.height)),
  }
}

/** Saves a drawn caption to the public instagram-videos bucket. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function storageSaver(admin: any): SaveCaption {
  return async (png, key) => {
    try {
      const { error } = await admin.storage.from('instagram-videos').upload(key, png, { contentType: 'image/png', upsert: true, cacheControl: '86400' })
      if (error) return null
      return admin.storage.from('instagram-videos').getPublicUrl(key)?.data?.publicUrl ?? null
    } catch { return null }
  }
}

/** Burns the overlay on MVP's render server, looking as Cloudinary's did. */
export async function burnOnRenderServer(videoUrl: string, spec: BurnSpec, o: { userId: string; save: SaveCaption; timeoutMs: number }): Promise<RenderCtaResult> {
  const req = await burnRequest(spec, o.save, o.userId)
  if ('error' in req) return { ok: false, reason: req.error }
  return renderCta(videoUrl, req, o.userId, o.timeoutMs)
}
