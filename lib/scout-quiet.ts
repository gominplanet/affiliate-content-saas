// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT'S QUIET JOBS (SCOUT 1.50.2; Seb, 2026-10-17: "Make sure we don't have
// any pop-up windows or Scout being brought into the foreground while people
// are trying to work").
//
// TRYBE always runs out of sight (1.50.1). These four jobs came to the front
// on purpose, because Amazon's and YouTube Studio's pages barely draw in a
// hidden tab. SCOUT 1.50.2 can run each one in its own minimized window with
// the page told it is on screen. Whether that is enough for each page is only
// known by trying it on a real account, so:
//
//   - QUIET_FOR_EVERYONE says which jobs run quiet for every member. All off
//     until admin has tried each one.
//   - Admin tries a job on /admin/scout-quiet (kept in this browser only).
//   - When a job works quiet, its line here turns true: every member's SCOUT
//     follows on its next MVP page, with no new SCOUT and no store review.

export type QuietJob = 'pin' | 'cc' | 'amazon' | 'studio'

export const QUIET_JOBS: Array<{ id: QuietJob; label: string; what: string; test: string }> = [
  { id: 'pin', label: 'Comment pins', what: 'Pinning the first comment and On sale comments on YouTube.', test: 'Pin a comment from Encore or Co-Pilot and check it is pinned on the video.' },
  { id: 'cc', label: 'Creator Connections', what: 'Importing your campaigns, finding and accepting campaigns, and messaging brands.', test: 'Run Import from Creator Connections, and accept or message one campaign.' },
  { id: 'amazon', label: 'Amazon videos', what: 'Reading your videos in Amazon’s Manage Content and your Amazon Live replays.', test: 'Sync your Amazon videos and check the count matches Manage Content.' },
  { id: 'studio', label: 'YouTube Studio', what: 'Uploads through Studio (Bulk Amazon upload) and the Studio steps after Co-Pilot.', test: 'Upload one video with Bulk Amazon upload and check its title, tags, thumbnail and schedule in Studio.' },
]

/** Quiet for every member. Turn a job on only after admin has tried it. */
export const QUIET_FOR_EVERYONE: Record<QuietJob, boolean> = { pin: false, cc: false, amazon: false, studio: false }

/** Admin's own tries, in this browser only. */
export const QUIET_TEST_KEY = 'mvp_scout_quiet_test'
/** Sent on the page when admin changes a try, so SCOUT hears it at once. */
export const QUIET_CHANGED_EVENT = 'mvp-scout-quiet-changed'
/** Sent back with what SCOUT holds after it was told (null: it did not answer). */
export const QUIET_ANSWER_EVENT = 'mvp-scout-quiet-answer'
export type QuietAnswer = { version: string | null; installed: boolean; ready: boolean; asked: Record<QuietJob, boolean>; held: Record<string, boolean> | null }

/** What SCOUT is told: everyone's setting, and for admin their own tries on top. Pure. */
export function quietJobsFor(isAdmin: boolean, tries: Partial<Record<QuietJob, boolean>> | null): Record<QuietJob, boolean> {
  const out = { ...QUIET_FOR_EVERYONE }
  if (isAdmin && tries) for (const j of QUIET_JOBS) if (typeof tries[j.id] === 'boolean') out[j.id] = tries[j.id] as boolean
  return out
}

export function readQuietTries(): Partial<Record<QuietJob, boolean>> | null {
  try { const raw = window.localStorage.getItem(QUIET_TEST_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
