// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE SWITCH FOR EVERY TUTORIAL VIDEO in the app: the Tutorials page grid and
// the walkthrough videos on feature pages (PageHero media).
//
// Paused while the tutorials are re-recorded for the latest features. The
// Tutorials page shows a notice in their place. Set this to false (and update
// any video ids) to put them all back.
export const TUTORIAL_VIDEOS_PAUSED = true

/** THE LATEST VIDEO, pinned (Seb, 2026-11-10: "let's add the latest video
 *  to the latest pop up on mvp.. and inside of tutorials"). It plays first in
 *  the video column of the daily What's new card and sits at the top of
 *  Tutorials, whatever the channel's own list says: a live replay can be
 *  listed with no length for hours, and the card leaves those out. Change it
 *  to pin the next one; the title is the video's own on YouTube. */
export const LATEST_VIDEO = {
  id: 'PQbMeweELhA',
  title: 'Amazon Influencers & Trybe with MVP Features',
  kind: 'Live replay',
  published: '2026-11-10T00:52:43Z',
  description: 'Seb walks through MVP live, demos the latest tools and features, and answers questions about the Amazon Influencer Program, Amazon Associates, TRYBE, Creator Connections, product research and content creation.',
}

/** A walkthrough video id to show on a page, or null while videos are paused. */
export function walkthroughId(id: string | null | undefined): string | null {
  return TUTORIAL_VIDEOS_PAUSED || !id ? null : id
}
