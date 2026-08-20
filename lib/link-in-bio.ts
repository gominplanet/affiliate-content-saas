// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared types + helpers for the Link in Bio ("Shop Grid") feature: a public,
// hosted affiliate storefront page at /shop/<handle>.

export interface LinkPage {
  id: string
  user_id: string
  handle: string
  title: string | null
  bio: string | null
  avatar_url: string | null
  theme: string
  published: boolean
  clicks: number
  // Custom main CTA button under the header (label + destination).
  cta_label?: string | null
  cta_url?: string | null
  // Optional advertisement insert (legacy single-ad from mig 235; superseded by
  // kind='ad' item tabs in mig 236 — kept for back-compat, no longer rendered).
  ad_enabled?: boolean
  ad_image_url?: string | null
  ad_title?: string | null
  ad_subtitle?: string | null
  ad_url?: string | null
  // Editable section headings (blank → renderer default).
  heading_stories?: string | null
  heading_ads?: string | null
  heading_more?: string | null
  // Custom accent hex — overrides the theme preset's accent when set.
  accent?: string | null
}

// ── Retailer detection (for the "Buy now from <retailer>" CTA) ──────────────
// Match the destination URL's host first (most reliable); fall back to the
// item's `source` tag, then to an ASIN (which implies Amazon). Returns null when
// the retailer can't be determined (e.g. a wrapped geni.us link with no ASIN) —
// the caller shows a generic "Shop now" then.
const RETAILER_HOSTS: Array<[RegExp, string]> = [
  [/amazon\.|amzn\.|a\.co\//i, 'Amazon'],
  [/walmart\./i, 'Walmart'],
  [/target\.com/i, 'Target'],
  [/bestbuy\./i, 'Best Buy'],
  [/etsy\./i, 'Etsy'],
  [/ebay\./i, 'eBay'],
  [/homedepot\./i, 'Home Depot'],
  [/lowes\./i, "Lowe's"],
  [/wayfair\./i, 'Wayfair'],
  [/chewy\./i, 'Chewy'],
  [/costco\./i, 'Costco'],
  [/macys\./i, "Macy's"],
  [/sephora\./i, 'Sephora'],
  [/ulta\./i, 'Ulta'],
  [/nike\./i, 'Nike'],
  [/newegg\./i, 'Newegg'],
]

export function retailerForItem(it: { url?: string | null; asin?: string | null; source?: string | null }): string | null {
  const url = it.url || ''
  for (const [re, name] of RETAILER_HOSTS) if (re.test(url)) return name
  const src = it.source || ''
  for (const [re, name] of RETAILER_HOSTS) if (re.test(src)) return name
  if (it.asin) return 'Amazon' // an ASIN is always an Amazon product
  return null
}

/** The product-tile CTA label: "Buy now from Amazon" etc., else "Shop now". */
export function shopCtaLabel(it: { url?: string | null; asin?: string | null; source?: string | null }): string {
  const r = retailerForItem(it)
  return r ? `Buy now from ${r}` : 'Shop now'
}

export interface LinkPageItem {
  id: string
  page_id: string
  kind: string           // 'product' (grid tile) | 'link' (icon pill) | 'ad' (tab)
  title: string
  subtitle: string | null
  icon: string | null    // platform slug for links (see LINK_ICONS)
  image_url: string | null
  url: string
  asin: string | null
  source: string
  position: number
  hidden: boolean
  in_story: boolean      // product tile is "live in my story right now"
  badge?: string | null  // ad tab: discount pill, e.g. "$20 Off"
  code?: string | null   // ad tab: promo code, e.g. "mvp2026"
  clicks: number
}

// Brand-link presets: the platforms creators most want on a link-in-bio page.
// `color` tints the icon/button accent; `label` is the default button text; the
// icon glyph is mapped to a lucide component in the UI (keyed by `slug`).
export interface LinkPreset { slug: string; label: string; color: string; placeholder: string }
export const LINK_PRESETS: LinkPreset[] = [
  { slug: 'youtube',   label: 'YouTube',   color: '#FF0000', placeholder: 'https://youtube.com/@yourchannel' },
  { slug: 'instagram', label: 'Instagram', color: '#E4405F', placeholder: 'https://instagram.com/yourhandle' },
  { slug: 'tiktok',    label: 'TikTok',    color: '#111114', placeholder: 'https://tiktok.com/@yourhandle' },
  { slug: 'website',   label: 'My blog',   color: '#0EA5E9', placeholder: 'https://yourblog.com' },
  { slug: 'x',         label: 'X',         color: '#111114', placeholder: 'https://x.com/yourhandle' },
  { slug: 'facebook',  label: 'Facebook',  color: '#1877F2', placeholder: 'https://facebook.com/yourpage' },
  { slug: 'pinterest', label: 'Pinterest', color: '#E60023', placeholder: 'https://pinterest.com/yourhandle' },
  { slug: 'threads',   label: 'Threads',   color: '#111114', placeholder: 'https://threads.net/@yourhandle' },
]
export function presetFor(slug: string | null | undefined): LinkPreset {
  return LINK_PRESETS.find((p) => p.slug === slug) || { slug: 'link', label: 'Link', color: '#7C3AED', placeholder: 'https://…' }
}

// Theme presets — page background + card + text, tuned for a phone-first bio
// page. Kept as inline colors so the public page needs no Tailwind config.
export interface LinkTheme {
  key: string
  label: string
  bg: string        // page background (CSS)
  text: string      // header text on the page background
  sub: string       // secondary header text
  accent: string    // "Shop now" button + accents (product tiles are always white)
}

export const LINK_THEMES: LinkTheme[] = [
  { key: 'light',  label: 'Light',  bg: 'linear-gradient(180deg,#f4f4f7 0%,#e9e9ee 100%)', text: '#111114', sub: '#6b6b70', accent: '#7C3AED' },
  { key: 'dark',   label: 'Dark',   bg: 'linear-gradient(180deg,#141418 0%,#0b0b0e 100%)', text: '#f5f5f7', sub: '#a1a1aa', accent: '#8b5cf6' },
  { key: 'sunset', label: 'Sunset', bg: 'linear-gradient(160deg,#F97316 0%,#DB2777 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: '#DB2777' },
  { key: 'forest', label: 'Forest', bg: 'linear-gradient(160deg,#059669 0%,#064e3b 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', accent: '#059669' },
  { key: 'ocean',  label: 'Ocean',  bg: 'linear-gradient(160deg,#0ea5e9 0%,#4f46e5 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.9)', accent: '#4F46E5' },
]

export function themeFor(key: string | null | undefined): LinkTheme {
  return LINK_THEMES.find((t) => t.key === key) || LINK_THEMES[0]
}

/** Normalize a desired handle to a safe URL slug (a–z, 0–9, hyphen). */
export function normalizeHandle(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

// Reserved so a bio handle can never shadow an app route under /s/… or leak a
// confusing URL.
const RESERVED_HANDLES = new Set(['api', 'admin', 'app', 's', 'shop', 'new', 'edit', 'settings', 'null', 'undefined'])

/** Is this a usable handle? (length + charset + not reserved) */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,29}$/.test(handle) && !RESERVED_HANDLES.has(handle)
}
