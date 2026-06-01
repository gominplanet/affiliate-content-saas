/**
 * Defensive character cap for social-post bodies.
 *
 * Every social network rejects over-length posts. The Haiku/Sonnet prompts
 * ask for a target length but the model drifts. This helper hard-caps the
 * output at the platform's API limit so we never get a runtime rejection
 * like "Param text must be at most 500 characters long."
 *
 * Cuts at the last word boundary inside the cap and appends an ellipsis,
 * unless the cut would land too close to the start (then a clean slice).
 *
 * If `suffix` is provided, room is reserved for it and the suffix is
 * appended after the trim — useful for "(... text)\n\n#ad disclaimer".
 */
export function capSocialText(raw: string, maxChars: number, suffix = ''): string {
  const reserve = suffix.length
  const maxBody = Math.max(20, maxChars - reserve)
  const text = (raw ?? '').trim()
  if (text.length <= maxBody) {
    return suffix ? `${text}${suffix}` : text
  }
  const cut = text.slice(0, maxBody - 1) // leave room for an ellipsis
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > maxBody * 0.6 ? cut.slice(0, lastSpace) : cut) + '…'
  return suffix ? `${trimmed}${suffix}` : trimmed
}

/** Per-platform body caps (chars). Source: each platform's public API docs. */
export const SOCIAL_LIMITS = {
  twitter:  280,
  bluesky:  300,
  threads:  500,
  pinterest: 500,  // pin description
  linkedin: 3000,
  facebook: 63206, // effectively unlimited for our content
  telegram: 4096,
} as const

/* ─────────────────────────────────────────────────────────────────────
 * Per-post per-platform RE-PUBLISH cap
 *
 * Each blog_posts row carries a JSONB social_publish_counts map
 * tracking how many times the same post has been (re)published to
 * each platform. Hard-cap at SOCIAL_CAP to stop runaway re-publish
 * cost (each publish fires a fresh AI caption generation).
 * ────────────────────────────────────────────────────────────────── */

export const SOCIAL_CAP = 10
/** Warn the client one publish in advance so the 10th doesn't surprise. */
export const SOCIAL_WARN_AT = SOCIAL_CAP - 1

export type SocialPlatform =
  | 'facebook' | 'threads' | 'twitter' | 'linkedin'
  | 'bluesky' | 'telegram' | 'instagram' | 'pinterest'

/** Read the current count for `platform` off a blog_posts row.
 *
 * The signature accepts `unknown` for the counts column so it works with
 * BOTH the typed Supabase row (where the column is `Json`) and any old
 * hand-rolled shape that uses `Record<string, number>` directly. The
 * runtime guard inside handles whatever shape actually shows up. */
export function readSocialCount(
  row: { social_publish_counts?: unknown } | null | undefined,
  platform: SocialPlatform,
): number {
  const map = row?.social_publish_counts
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 0
  const n = (map as Record<string, unknown>)[platform]
  return typeof n === 'number' && n >= 0 ? n : 0
}

/** Bump the slot by 1 after a successful publish. Fire-and-forget. */
export async function incrementSocialCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  blogPostId: string,
  platform: SocialPlatform,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('blog_posts')
      .select('social_publish_counts')
      .eq('id', blogPostId)
      .single()
    const existing = (row?.social_publish_counts as Record<string, number> | null) || {}
    const next = { ...existing, [platform]: (existing[platform] || 0) + 1 }
    await supabase
      .from('blog_posts')
      .update({ social_publish_counts: next })
      .eq('id', blogPostId)
  } catch { /* never fail the publish on telemetry errors */ }
}

export interface SocialCapCheck {
  /** Current count BEFORE the publish about to happen. */
  count: number
  /** True if the user has already hit the cap (block the publish). */
  exceeded: boolean
  /** True when the upcoming publish will be the last allowed one. */
  willBeLast: boolean
}

export function evaluateSocialCap(currentCount: number): SocialCapCheck {
  return {
    count: currentCount,
    exceeded: currentCount >= SOCIAL_CAP,
    willBeLast: currentCount === SOCIAL_CAP - 1,
  }
}
