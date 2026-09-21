// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which button to press next on the catalogue import, and what the buttons are
// called.
//
// WHY THIS FILE EXISTS. The upload finished and said, in green: Now click
// "Merge into live catalog" below. There was no button with that name. The
// button said "Add to live catalog", because its label changes with the
// add-only tick and the sentence pointing at it did not.
//
// That is the same dead end this codebase keeps producing in new places: the
// one instruction between somebody and the thing they wanted, pointing at
// empty space. The cause is always two pieces of code deciding the same thing
// separately, so the labels live here and both the sentence and the button read
// them.
//
// The second half is the harder one. There are two merge buttons and nothing
// said which to press, so the answer was "whichever you remember". A screen
// with two equal buttons and no recommendation has not finished being designed.

/** The main merge button's label. It changes with the add-only tick, which is
 *  exactly why nothing may hardcode it. */
export function mergeLabel(addOnly: boolean): string {
  return addOnly ? 'Add to live catalog' : 'Merge into live catalog'
}

/** The same job, handed to the server so the tab can be closed. */
export function backgroundLabel(addOnly: boolean): string {
  return addOnly ? 'Add in background' : 'Merge in background'
}

/** Everything that decides what is left to do. */
export interface ImportState {
  /** Files chosen but not yet sent to staging. */
  filesPicked: number
  /** The upload has finished and put rows in staging. */
  uploaded: boolean
  /** Staging definitely has nothing in it. Null means we could not tell, which
   *  is NOT the same as empty: that count times out on a large table and a null
   *  read as empty would tell somebody to upload again over a full staging. */
  stagingEmpty: boolean | null
  /** A merge is running in this tab. */
  merging: boolean
  /** A merge is running on the server, with or without this tab. */
  draining: boolean
  /** A merge has finished since this page was opened. */
  merged: boolean
  addOnly: boolean
}

export interface NextStep {
  /** The heading: what to do, in the fewest words. */
  title: string
  /** One line of why, or what is happening. */
  detail: string
  /** The exact label on the button to press, or null when there is nothing to
   *  press. NEVER a paraphrase: this string is rendered into the sentence AND
   *  onto the button, so they cannot drift. */
  button: string | null
  /** Nothing to do, so the screen can go quiet rather than nagging. */
  waiting: boolean
}

/**
 * The one thing to do next.
 *
 * ONE STEP, NEVER TWO. The whole complaint was not knowing which button, and an
 * answer that lists both is the same problem with more words. Where there is a
 * genuine choice, the recommended one is the button and the other is explained
 * in the detail line.
 */
export function nextStep(s: ImportState): NextStep {
  if (s.draining) {
    return {
      title: 'Nothing to do, it is running on the server',
      detail: 'You can close this tab. It finishes without you and the counts update when you come back.',
      button: null, waiting: true,
    }
  }
  if (s.merging) {
    return {
      title: 'Merging now',
      detail: 'Keep this tab open until it finishes, or start it in the background next time and walk away.',
      button: null, waiting: true,
    }
  }
  if (s.filesPicked > 0 && !s.uploaded) {
    return {
      title: 'Upload to staging',
      detail: `${s.filesPicked} ${s.filesPicked === 1 ? 'file' : 'files'} ready. Staging is a holding area, so nothing touches the live catalogue yet.`,
      button: 'Upload to staging', waiting: false,
    }
  }
  // STAGING HAS SOMETHING means there is a merge to do, whether or not the
  // upload happened in THIS visit. A page reopened after an upload yesterday
  // still has the same next step.
  if (s.stagingEmpty === false || (s.uploaded && s.stagingEmpty !== true)) {
    if (s.merged) {
      return {
        title: 'Done for this upload',
        detail: 'Staging still holds the rows, which is normal: merging flags them in place and next week’s upload clears them.',
        button: null, waiting: true,
      }
    }
    return {
      title: mergeLabel(s.addOnly),
      // THE RECOMMENDATION IS THE BUTTON, and the alternative is a sentence.
      // Two buttons of equal weight is what made this a memory test.
      detail: `This is the one to press. It takes a few minutes with the tab open. If you would rather walk away, press ${backgroundLabel(s.addOnly)} instead and the server finishes it.`,
      button: mergeLabel(s.addOnly), waiting: false,
    }
  }
  if (s.stagingEmpty === true) {
    return {
      title: 'Drop this week’s files',
      detail: 'Staging is empty, so there is nothing to merge yet. The two Amazon ZIPs, or the loose CSVs.',
      button: null, waiting: false,
    }
  }
  return {
    title: 'Checking what is staged',
    detail: 'The staged count is still coming back. Nothing is lost while this loads.',
    button: null, waiting: true,
  }
}
