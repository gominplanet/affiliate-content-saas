/**
 * Runtime feature flags.
 *
 * META APP REVIEW: APPROVED + LIVE (2026-06-15) for Facebook Pages, Instagram,
 * and Threads. The App-Review gate that hid these from the public while pending
 * has been retired — `metaEnabled` is now always on. (Historical: it was keyed
 * off NEXT_PUBLIC_META_ENABLED with an admin/reviewer allowlist exception; that
 * env var is now ignored and can be deleted from the environment.)
 *
 * Pinterest: APPROVED + LIVE (2026-06-16) — added to LIVE_SOCIAL below.
 * TikTok: APPROVED + LIVE (2026-06-22) — app is Live in Production with the
 * Content Posting API scopes video.upload AND video.publish granted, so direct
 * posting works (USE_INBOX_MODE=false in services/tiktok.ts). Added to
 * LIVE_SOCIAL below; no longer admin-only.
 */

/**
 * Meta-owned surfaces (Instagram, Threads, Facebook Pages) are approved + live.
 * Kept as a no-arg-tolerant function so existing call sites (which pass
 * { tier } / { email }) keep working without changes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function metaEnabled(_opts?: { tier?: string | null; email?: string | null }): boolean {
  return true
}

/**
 * Per-platform availability gate for the social integrations that aren't yet
 * universally live. Facebook / Instagram / Threads / Pinterest / TikTok are all
 * APPROVED → open to all (tier still decides eligibility via lib/tier
 * `tierAllowsSocial`).
 */
export type GatedSocialPlatform = 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'pinterest'
const LIVE_SOCIAL: ReadonlySet<GatedSocialPlatform> = new Set(['facebook', 'instagram', 'threads', 'pinterest', 'tiktok'])

/**
 * YouTube Shorts UPLOAD (publishing a video TO YouTube) gate. OFF by default:
 * it needs the sensitive `youtube.upload` OAuth scope, which requires Google
 * verification of the app AND every creator to reconnect YouTube to grant it.
 * Flip on by setting NEXT_PUBLIC_YOUTUBE_UPLOAD_ENABLED=true in Vercel ONLY after
 * Google verification is approved. NEXT_PUBLIC so the client (toggle visibility)
 * and the server (scope request + publish route) read the same flag.
 */
export function youtubeUploadEnabled(): boolean {
  return process.env.NEXT_PUBLIC_YOUTUBE_UPLOAD_ENABLED === 'true'
}

export function socialEnabled(
  platform: GatedSocialPlatform,
  opts?: { tier?: string | null; email?: string | null },
): boolean {
  if (LIVE_SOCIAL.has(platform)) return true // Meta 2026-06-15 · Pinterest 2026-06-16 · TikTok 2026-06-22
  // Fallback for any future not-yet-approved platform → admin-only.
  return opts?.tier === 'admin'
}

/**
 * Server-side Meta gate. Meta is approved + live, so this is now always true —
 * kept (async, same signature) so route call sites that `await` it are
 * unchanged. Tier/eligibility is still enforced separately by tierAllowsSocial.
 */
export async function metaEnabledForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  _supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _user: { id: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  return true
}
