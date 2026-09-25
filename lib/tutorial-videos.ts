// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE SWITCH FOR EVERY TUTORIAL VIDEO in the app: the Tutorials page grid and
// the walkthrough videos on feature pages (PageHero media).
//
// Paused while the tutorials are re-recorded for the latest features. The
// Tutorials page shows a notice in their place. Set this to false (and update
// any video ids) to put them all back.
export const TUTORIAL_VIDEOS_PAUSED = true

/** A walkthrough video id to show on a page, or null while videos are paused. */
export function walkthroughId(id: string | null | undefined): string | null {
  return TUTORIAL_VIDEOS_PAUSED || !id ? null : id
}
