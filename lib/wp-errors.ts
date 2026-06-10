// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared detection for the WordPress "stored post id no longer exists" error.
// When we update a post by a stored wordpress_post_id and that post was deleted
// on the WP site (or the DB drifted), WP returns 404 rest_post_invalid_id
// "Invalid post ID". blog/generate self-heals (creates a fresh post); the other
// single-post routes use this to return a clear, actionable message instead of a
// cryptic raw WP error. See [[support_wp_stale_post_id_404]].

/** True when a WP error means "that post id doesn't exist on the site anymore". */
export function isStalePostError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '')
  return /rest_post_invalid_id|invalid post id|"status":\s*404/i.test(m)
}

/** User-facing message for a post whose WordPress copy was deleted. */
export const WP_STALE_POST_MESSAGE =
  'This post no longer exists on WordPress — it looks like it was deleted there. Re-generate it from the video to recreate it.'
