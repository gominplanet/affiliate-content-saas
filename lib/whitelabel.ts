// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// White-label config helpers. Reads the three integrations columns added
// in migration 088 and folds them into a single `WhitelabelConfig` object
// that the dashboard layout reads on every page render.
//
// The pattern: a Pro user's `integrations` row is already loaded on every
// authenticated dashboard render (for tier checks, usage counts, etc.), so
// adding these three columns to that row keeps the white-label read path
// to ZERO additional queries. The Sidebar pulls the integrations row, calls
// `whitelabelFromRow()`, gets back a resolved config, and renders the
// user's brand instead of MVP's. Defaults fall through cleanly so non-Pro
// users see the standard MVP Affiliate look with no extra branching in the UI.

/** The brand identity rendered into the dashboard. Every field has a sane
 *  default so a partial config (logo only, color only, etc.) still works. */
export interface WhitelabelConfig {
  /** URL of the logo image. When NULL the Sidebar renders the default
   *  word-mark (MVP Affiliate). */
  logoUrl: string | null
  /** Brand name shown next to the logo + in the browser tab title. */
  brandName: string
  /** Accent hex colour applied to primary buttons + links + active nav. */
  accentColor: string
  /** Convenience flag — true when ANY field has been customised. Useful
   *  for conditionally hiding "Powered by MVP Affiliate" footers. */
  isCustomised: boolean
}

const DEFAULT_BRAND_NAME = 'MVP Affiliate'
const DEFAULT_ACCENT = '#7C3AED'

/** Build a `WhitelabelConfig` from an `integrations` row. Tolerant of
 *  rows where some/all white-label fields are null. */
export function whitelabelFromRow(row: {
  whitelabel_logo_url?: string | null
  whitelabel_brand_name?: string | null
  whitelabel_accent_color?: string | null
  tier?: string | null
} | null | undefined): WhitelabelConfig {
  // Only Pro/admin tiers get any whitelabel — defensive in case the DB
  // somehow has these fields populated for a non-Pro row (e.g. user
  // downgraded after setting them). Keeps the rendering predictable.
  const tier = row?.tier ?? 'trial'
  const allowed = tier === 'pro' || tier === 'admin'

  const logoUrl = allowed ? (row?.whitelabel_logo_url || null) : null
  const brandName = allowed
    ? (row?.whitelabel_brand_name?.trim() || DEFAULT_BRAND_NAME)
    : DEFAULT_BRAND_NAME
  const accentColor = allowed
    ? (sanitizeHex(row?.whitelabel_accent_color) || DEFAULT_ACCENT)
    : DEFAULT_ACCENT

  return {
    logoUrl,
    brandName,
    accentColor,
    isCustomised: allowed && !!(row?.whitelabel_logo_url || row?.whitelabel_brand_name || row?.whitelabel_accent_color),
  }
}

/** Validate a hex colour string against the same constraint the DB enforces.
 *  Returns the normalised lowercase form, or null on invalid input. */
export function sanitizeHex(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) return null
  return trimmed.toLowerCase()
}
