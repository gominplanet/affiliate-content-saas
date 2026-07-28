// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared types + helpers for the Link in Bio ("Shop Grid") feature: a public,
// hosted affiliate storefront page at /s/<handle>.

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
}

export interface LinkPageItem {
  id: string
  page_id: string
  title: string
  image_url: string | null
  url: string
  asin: string | null
  source: string
  position: number
  hidden: boolean
  clicks: number
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
const RESERVED_HANDLES = new Set(['api', 'admin', 'app', 's', 'new', 'edit', 'settings', 'null', 'undefined'])

/** Is this a usable handle? (length + charset + not reserved) */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,29}$/.test(handle) && !RESERVED_HANDLES.has(handle)
}
