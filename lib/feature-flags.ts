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

/** Temporary App-Review allowlist — empty this (and flip NEXT_PUBLIC_META_ENABLED
 *  to true) once the app is approved for everyone. Lowercased. */
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
