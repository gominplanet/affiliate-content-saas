// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Shop Burner CTA sticker gallery.
 *
 * Pre-designed call-to-action box PNGs that get burned onto a vertical video
 * INSTEAD of plain text (Cloudinary fetches them by public URL and overlays).
 *
 * HOW TO ADD A STICKER (no DB, no upload pipeline):
 *   1. Drop a transparent PNG (~1080px wide, 9:16-friendly) into
 *      `public/cta-burner/<your-file>.png`.
 *   2. Add a line to CTA_STICKERS below.
 *   3. Commit + deploy — it appears in the gallery automatically.
 *
 * Why a code registry and not auto-listing: Next.js does NOT expose the
 * `public/` folder to the serverless filesystem at runtime (the CDN serves it),
 * so we can't `readdir` it. The registry is the source of truth; the files just
 * need to exist at the matching path.
 */

export type CtaStickerPosition = 'lower-third' | 'center' | 'bottom' | 'top' | 'lower-left' | 'lower-right'

export interface CtaSticker {
  /** Stable id (sent from the UI, resolved server-side). */
  id: string
  /** Shown under the thumbnail in the picker. */
  label: string
  /** Filename inside /public/cta-burner/. */
  file: string
  /** Where it sits on the 1080×1920 video (default lower-third). */
  position?: CtaStickerPosition
  /** Overlay width as a fraction of the video width (0–1, default 0.85). */
  widthPct?: number
}

/**
 * The global gallery. Empty until CTA box PNGs are designed + dropped into
 * public/cta-burner/. Add entries like:
 *   { id: 'link-in-bio', label: 'Link in bio', file: 'link-in-bio.png', position: 'lower-third' },
 *   { id: 'shop-now',    label: 'Shop now',    file: 'shop-now.png',    position: 'lower-third', widthPct: 0.8 },
 */
export const CTA_STICKERS: CtaSticker[] = [
  { id: 'buy-now',           label: 'Buy now (badge)',     file: 'buynowburner05.png', position: 'lower-left', widthPct: 0.52 },
  { id: 'shop-here',         label: 'Shop here (circle)',  file: 'buynowburner02.png', position: 'lower-left', widthPct: 0.5 },
  { id: 'shop-below-burst',  label: 'Shop below (burst)',  file: 'buynowburner01.png', position: 'lower-left', widthPct: 0.52 },
  { id: 'shop-below-bold',   label: 'Shop below (bold)',   file: 'buynowburner04.png', position: 'lower-left', widthPct: 0.45 },
  { id: 'shop-follow',       label: 'Shop & follow',       file: 'buynowburner03.png', position: 'lower-left', widthPct: 0.45 },
]

/** Absolute, publicly-fetchable URL for a sticker file (Cloudinary needs an
 *  absolute URL to fetch+overlay; the picker uses it for the thumbnail). */
const STICKER_BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/$/, '')
export function ctaStickerUrl(file: string): string {
  return `${STICKER_BASE}/cta-burner/${encodeURIComponent(file)}`
}

export function getCtaSticker(id: string): CtaSticker | undefined {
  return CTA_STICKERS.find(s => s.id === id)
}
