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

// Where the finished clip is going, and how the viewer buys. This drives BOTH
// the ready-made platform badges below and the AI generator's per-combo prompt:
//   shop → the platform's in-app shop (TikTok orange cart / IG product tag),
//          badge points a DOWNWARD arrow at the on-screen buy button.
//   bio  → no in-app shop; badge says "LINK IN BIO" with a link icon.
export type CtaDestination = 'tiktok' | 'instagram'
export type CtaMode = 'shop' | 'bio'

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
  /** Set on the finalized platform badges so the gallery can group them. */
  destination?: CtaDestination
  mode?: CtaMode
}

/**
 * Finalized, on-brand platform badges (the six hand-picked designs). These are
 * ready to burn as-is AND double as the style references the AI generator is
 * conditioned on for each destination+mode, so a generated badge matches the
 * look of the real platform's shop UI. Grouped by destination × mode.
 */
export const PLATFORM_BADGES: CtaSticker[] = [
  // TikTok — Shop (downward arrow → TikTok orange cart)
  { id: 'tt-shop-bar',  label: 'TikTok Shop — bar',   file: 'tiktok-shop-001.png', destination: 'tiktok',    mode: 'shop', widthPct: 0.82 },
  { id: 'tt-shop-cart', label: 'TikTok Shop — cart',  file: 'tiktok-shop-002.png', destination: 'tiktok',    mode: 'shop', widthPct: 0.5 },
  // TikTok — Link in bio
  { id: 'tt-bio-tap',   label: 'TikTok — Tap to shop', file: 'tiktok-bio-001.png', destination: 'tiktok',    mode: 'bio',  widthPct: 0.82 },
  // Instagram — Shop (downward arrow → product tag)
  { id: 'ig-shop-bag',  label: 'Instagram Shop — bag', file: 'instagram-shop-001.png', destination: 'instagram', mode: 'shop', widthPct: 0.5 },
  // Instagram — Link in bio (Reels / Stories)
  { id: 'ig-bio-link',  label: 'Instagram — Link in bio', file: 'instagram-bio-001.png', destination: 'instagram', mode: 'bio', widthPct: 0.82 },
  { id: 'ig-bio-click', label: 'Instagram — Click here',  file: 'instagram-stories-001.png', destination: 'instagram', mode: 'bio', widthPct: 0.5 },
]

/** The finalized badges for a destination+mode — used as AI style references. */
export function platformBadges(destination: CtaDestination, mode: CtaMode): CtaSticker[] {
  return PLATFORM_BADGES.filter(b => b.destination === destination && b.mode === mode)
}

/**
 * The global gallery. Empty until CTA box PNGs are designed + dropped into
 * public/cta-burner/. Add entries like:
 *   { id: 'link-in-bio', label: 'Link in bio', file: 'link-in-bio.png', position: 'lower-third' },
 *   { id: 'shop-now',    label: 'Shop now',    file: 'shop-now.png',    position: 'lower-third', widthPct: 0.8 },
 */
// Position is chosen in the burner UI (lower-left / upper-left) and applies to
// whichever sticker is picked, so entries only carry size. Square badges
// (01–05, 500×500) sit ~half-width; the wide banners (06–017, 1536×1024 with
// transparent margins) read best a bit larger.
export const CTA_STICKERS: CtaSticker[] = [
  // Newest hand-added designs, pinned to the very top of the gallery. Wide
  // banners (transparent PNGs) — "Link in the description" in three colorways.
  { id: 'link-in-desc-1', label: 'Link in description — 1', file: 'link-in-description-1.png', widthPct: 0.78 },
  { id: 'link-in-desc-2', label: 'Link in description — 2', file: 'link-in-description-2.png', widthPct: 0.78 },
  { id: 'link-in-desc-3', label: 'Link in description — 3', file: 'link-in-description-3.png', widthPct: 0.78 },
  // Finalized platform badges first — the best-looking, on-brand picks.
  ...PLATFORM_BADGES,
  // Square badges
  { id: 'shop-below-burst',   label: 'Shop below — burst',   file: 'burner01.png', widthPct: 0.52 },
  { id: 'shop-here-circle',   label: 'Shop here — circle',   file: 'burner02.png', widthPct: 0.5 },
  { id: 'shop-follow',        label: 'Shop & follow',        file: 'burner03.png', widthPct: 0.45 },
  { id: 'shop-below-bold',    label: 'Shop below — bold',    file: 'burner04.png', widthPct: 0.45 },
  { id: 'buy-now-badge',      label: 'Buy now — badge',      file: 'burner05.png', widthPct: 0.52 },
  // Link in bio — wide banners
  { id: 'link-in-bio-gold',    label: 'Link in bio — gold',    file: 'burner06.png', widthPct: 0.78 },
  { id: 'link-in-bio-burst',   label: 'Link in bio — burst',   file: 'burner07.png', widthPct: 0.78 },
  { id: 'link-in-bio-pop',     label: 'Link in bio — pop',     file: 'burner08.png', widthPct: 0.78 },
  { id: 'link-in-bio-rainbow', label: 'Link in bio — rainbow', file: 'burner09.png', widthPct: 0.8 },
  { id: 'link-in-bio-sleek',   label: 'Link in bio — sleek',   file: 'burner010.png', widthPct: 0.8 },
  // Shop now here — wide banners
  { id: 'shop-now-here-yellow', label: 'Shop now here — yellow', file: 'burner011.png', widthPct: 0.78 },
  { id: 'shop-now-here-neon',   label: 'Shop now here — neon',   file: 'burner012.png', widthPct: 0.78 },
  { id: 'shop-now-here-stars',  label: 'Shop now here — stars',  file: 'burner013.png', widthPct: 0.8 },
  { id: 'shop-now-here-teal',   label: 'Shop now here — teal',   file: 'burner014.png', widthPct: 0.8 },
  // Shop now / Buy now — wide banners
  { id: 'shop-now-pop',        label: 'Shop now — pop',        file: 'burner015.png', widthPct: 0.72 },
  { id: 'buy-now-burst',       label: 'Buy now — burst',       file: 'burner016.png', widthPct: 0.72 },
  { id: 'shop-here-tag',       label: 'Shop here! — tag',      file: 'burner017.png', widthPct: 0.78 },
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
