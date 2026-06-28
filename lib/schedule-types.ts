/**
 * Shared types + constants for the blog-post scheduling flow.
 *
 * Two scheduling modes are supported. Both generate the post NOW (so the
 * user gets immediate preview + the credit is consumed up front), but
 * differ in HOW the post becomes live at the scheduled time:
 *
 *   - 'wp-native': WordPress holds the post with status=future + post_date.
 *     WP's own cron flips it to publish. Most reliable (WP-native), but
 *     no preview-then-edit window past gen time without changing the
 *     post's status in /wp-admin (which voids the schedule).
 *
 *   - 'draft-flip': WordPress holds the post as a draft. Our cron worker
 *     (/api/cron/process-scheduled) PATCHes it to status=publish at the
 *     scheduled time. Lets the creator preview and edit between gen and
 *     publish without breaking the schedule (the cron just checks the
 *     scheduled_posts row, not the WP status).
 *
 * The cascade model:
 *   1. User picks ONE master time T.
 *   2. Blog goes live at T (via WP cron for wp-native, our cron for
 *      draft-flip).
 *   3. Social pushes fire at T + offset, one per chosen channel.
 *      Defaults below — link-driven socials get +5 min so the URL has
 *      a moment to settle in. Newsletter is NOT in this cascade — that
 *      has engagement signals before the email blast.
 */

import type { Social } from '@/lib/tier'

export type ScheduleMode = 'wp-native' | 'draft-flip'

/** Platforms whose scheduled publishing is supported by the cron worker
 *  (/api/cron/process-scheduled). Subset of Social — pinterest, instagram,
 *  and tiktok are handled via dedicated direct-publish routes that aren't
 *  hooked into the schedule cron yet, so they're excluded here. */
export type SchedulableSocial =
  | 'facebook'
  | 'threads'
  | 'twitter'
  | 'linkedin'
  | 'bluesky'
  | 'telegram'
  | 'pinterest'

/** Default minute offsets between the blog publish and each social push.
 *  Picked so the link is reliably live (+5 min beats WP-cron jitter)
 *  before any push that includes a link. Users can override per-channel
 *  in the Schedule modal's Advanced expansion. (Newsletter has its own
 *  flow in /newsletter — not in this cascade.) */
export const DEFAULT_SOCIAL_OFFSETS_MIN: Record<SchedulableSocial, number> = {
  facebook: 5,
  threads: 5,
  twitter: 5,
  linkedin: 5,
  bluesky: 5,
  telegram: 5,
  // Pinterest pins the blog's image and links back to the post — give the
  // blog a beat to be live first, same as the link socials.
  pinterest: 5,
}

// (Newsletter offset removed 2026-06-06 — newsletter has its own scheduler
// at /newsletter; mixing them here was confusing.)

/** Per-channel schedule entry — what the modal posts to schedule-publish. */
export interface SocialScheduleEntry {
  platform: SchedulableSocial
  /** Minutes after the blog-publish time this channel fires. Defaults
   *  to DEFAULT_SOCIAL_OFFSETS_MIN[platform] when omitted. */
  offsetMinutes?: number
  /** Pre-locked body text for the push (Pro users can edit before
   *  scheduling; trial-tier users send the auto-composed text). */
  bodyText: string
  /** Optional Pro multi-account selector — see scheduled_posts.social_account_id. */
  socialAccountId?: string | null
}

// Re-export Social so consumers don't need to import from both modules.
export type { Social }
