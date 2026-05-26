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
