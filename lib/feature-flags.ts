/**
 * Runtime feature flags.
 *
 * metaEnabled — gates ALL Meta-owned integrations (Instagram, Threads,
 * Facebook Pages): the connect/OAuth flows, the publish routes, the Instagram
 * Burner, and the social pills in Library & Social Push. While the Meta app is
 * pending App Review we keep these hidden from the PUBLIC so nobody hits an
 * unauthorized/broken flow.
 *
 * EXCEPTION — App Review testability: while globally gated, the Meta surfaces
 * stay visible + usable for (a) admin-tier accounts and (b) the Meta App-Review
 * test account, so Meta's reviewer can actually exercise the flows from the
 * screencast. Pass the caller's tier and/or email so this applies:
 *   - client pages:  metaEnabled({ tier })               // admin sees it
 *   - server routes: metaEnabled({ email: user.email })  // reviewer sees it
 *
 * Controlled by NEXT_PUBLIC_META_ENABLED (client + server readable). Defaults
 * to ENABLED when unset; set it to the string "false" to gate the public.
 * Flip back to "true" (or remove) once the app is approved + Live.
 */

/**
 * Meta App-Review test account allowlist.
 *
 * Submitted to Meta as the "Test Account" in the app review form so the
 * reviewer can sign in to MVP and exercise the IG / FB / Threads OAuth
 * flows from the screencast. Email below logs in as a tier='admin' user
 * on the production DB so the reviewer sees every Meta-gated surface.
 *
 * Currently submitted: info@gominreviews.com  (admin tier, password
 * shared with Meta via the App Review submission form).
 *
 * Empty this list (and flip NEXT_PUBLIC_META_ENABLED to true) once the
 * Meta app is approved + Live for everyone. Lowercased.
 */
const META_REVIEW_EMAILS = ['info@gominreviews.com']

export function metaEnabled(opts?: { tier?: string | null; email?: string | null }): boolean {
  // Normal post-approval state: on for everyone.
  if (process.env.NEXT_PUBLIC_META_ENABLED !== 'false') return true
  // Globally gated, but let admins + the reviewer test account through so the
  // App-Review flows remain testable.
  if (opts?.tier === 'admin') return true
  if (opts?.email && META_REVIEW_EMAILS.includes(opts.email.trim().toLowerCase())) return true
  return false
}

/**
 * Per-platform admin gate for the FIVE social integrations the user wants
 * locked down while restructuring Pro tier: facebook, instagram, threads,
 * tiktok, pinterest. Everyone except admin sees them greyed-out in the
 * setup UI; non-admin OAuth-start hits get redirected to /pricing.
 *
 * Meta platforms (facebook, instagram, threads) ALSO let the Meta App-
 * Review test account through so the app-review screencast keeps working.
 * TikTok + Pinterest are pure admin-only.
 *
 * Useful for both client (pass tier + email at load time) and server.
 */
export type GatedSocialPlatform = 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'pinterest'
const META_PLATFORMS: ReadonlySet<GatedSocialPlatform> = new Set(['facebook', 'instagram', 'threads'])

export function socialEnabled(
  platform: GatedSocialPlatform,
  opts?: { tier?: string | null; email?: string | null },
): boolean {
  if (opts?.tier === 'admin') return true
  if (META_PLATFORMS.has(platform) && opts?.email && META_REVIEW_EMAILS.includes(opts.email.trim().toLowerCase())) return true
  return false
}

/**
 * Server-side gate that honors ADMIN tier in addition to the public flag and
 * the reviewer email. Server routes only have the user (not the tier) at the
 * check point, so this looks the tier up — letting ANY admin account do
 * everything with social (the App-Review reviewer is simply an admin). Short
 * circuits before the query in the common cases (flag on, or reviewer email),
 * so the extra read only happens while gated for a non-reviewer.
 */
export async function metaEnabledForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  user: { id: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_META_ENABLED !== 'false') return true
  if (!user?.id) return false
  if (user.email && META_REVIEW_EMAILS.includes(user.email.trim().toLowerCase())) return true
  try {
    const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
    return data?.tier === 'admin'
  } catch {
    return false
  }
}
