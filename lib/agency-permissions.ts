// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Virtual Assistant permission constants, types, and pure helpers.
//
// Separated from `lib/agency.ts` because the latter uses `node:crypto`,
// which Next can't bundle for the client or edge runtime. This file has
// zero runtime dependencies so it's safe to import from anywhere:
// client components, edge middleware, route handlers, and the main
// agency lib (which re-exports everything from here).
//
// Anything that touches randomBytes / token generation / RLS-bypass DB
// reads belongs in `lib/agency.ts`. Anything that's a constant, type,
// or pure function over permissions belongs HERE.

/** All permission keys a Virtual Assistant can be granted. Owners (no
 *  agency parent) implicitly have all permissions. The blocked-for-VAs
 *  surfaces (BLOCKED_FOR_VAS in lib/agency-routes) are NEVER toggleable
 *  — there's no legitimate scenario where a VA should manage billing
 *  or the brand. */
export const VA_PERMISSION_KEYS = [
  'generate_posts',
  'publish_to_socials',
  'manage_newsletter',
  'youtube_copilot',
  'manage_videos',
  'view_analytics',
] as const

export type VaPermissionKey = (typeof VA_PERMISSION_KEYS)[number]

export type VaPermissions = Record<VaPermissionKey, boolean>

/** Default permissions for a NEW invite. Sensible "content VA" preset:
 *  the VA can produce + publish + manage videos but can't send to your
 *  newsletter list or see analytics. Owner can toggle in the invite UI. */
export const DEFAULT_VA_PERMISSIONS: VaPermissions = {
  generate_posts:     true,
  publish_to_socials: true,
  manage_newsletter:  false,
  youtube_copilot:    true,
  manage_videos:      true,
  view_analytics:     false,
}

/** Human-readable label + description for each permission. Used by the
 *  invite form + the member-edit panel. Keep label under 30 chars. */
export const VA_PERMISSION_META: Record<VaPermissionKey, { label: string; help: string }> = {
  generate_posts:     { label: 'Generate blog posts',     help: 'Can use the Content page and the blog generator.' },
  publish_to_socials: { label: 'Publish to socials',      help: 'Can post to Facebook, Instagram, TikTok, Threads, Pinterest, X, Bluesky, Telegram.' },
  manage_newsletter:  { label: 'Manage newsletter',       help: 'Can compose and send newsletter broadcasts. Off by default — you control the list.' },
  youtube_copilot:    { label: 'YouTube Co-Pilot',        help: 'Can generate YouTube titles, descriptions, tags, and thumbnails.' },
  manage_videos:      { label: 'Manage video library',    help: 'Can add, edit, and remove videos in the content library.' },
  view_analytics:     { label: 'View analytics & SEO',    help: 'Can see Analytics, SEO dashboard, and content performance reports.' },
}

/** Normalize a raw permissions value (from DB or request body) into a
 *  full VaPermissions object. Missing keys default to false (NOT to
 *  DEFAULT_VA_PERMISSIONS — a partial PATCH should never silently grant
 *  permissions the caller didn't explicitly set). */
export function normalizePermissions(raw: unknown): VaPermissions {
  const out: VaPermissions = { ...DEFAULT_VA_PERMISSIONS }
  for (const k of VA_PERMISSION_KEYS) out[k] = false
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    for (const k of VA_PERMISSION_KEYS) {
      if (typeof r[k] === 'boolean') out[k] = r[k] as boolean
    }
  }
  return out
}
