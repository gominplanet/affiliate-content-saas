// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR'S OWN TRYBE TAB (SCOUT 1.53.2; Seb, 2026-10-19: "click here to
// open and log into your account. And then leave that in the background ...
// As long as nothing pops up, we're good").
//
// TRYBE's sign-in lives in a TRYBE page, so SCOUT works through the TRYBE tab
// the creator opened from MVP and left open: sends, the inbox, the brand
// list, analytics. SCOUT opens no window and no tab of its own for TRYBE.
// With no TRYBE tab open SCOUT does nothing and answers 'trybe-not-open',
// which MVP says in these words wherever it shows a TRYBE error, and the
// TRYBE page's setup card shows the button that opens one. Pure.

/** Where Open TRYBE goes: TRYBE's own brand list, which asks to sign in first
 *  when the creator is signed out. */
export const TRYBE_OPEN_URL = 'https://jointrybe.com/creator/discover'

export const TRYBE_NOT_OPEN = 'trybe-not-open'

export const TRYBE_NOT_OPEN_WORDS = 'TRYBE is not open in this Chrome. On MVP’s TRYBE page press Open TRYBE, sign in, and leave that tab open'

/** 'not-allowed': SCOUT has lost its OK for jointrybe.com in this Chrome
 *  (SCOUT reinstalled by hand, or the site removed in Chrome's settings), so
 *  it can neither look for a TRYBE tab nor open one until Chrome asks again. */
export type TrybeTabState = 'open' | 'signed-out' | 'closed' | 'unknown' | 'not-allowed'

/** SCOUT's error, in words when it means no TRYBE tab is open. */
export function trybeTabError<T extends string | null | undefined>(error: T): T | string {
  return error === TRYBE_NOT_OPEN ? TRYBE_NOT_OPEN_WORDS : error
}

/** The setup card's words for each state. */
export function trybeTabWords(state: TrybeTabState): { ok: string; todo: string } {
  return {
    ok: 'Open and signed in. Leave that tab open while you work in other tabs: SCOUT sends your requests and reads your TRYBE through it, and opens nothing else.',
    todo: state === 'signed-out'
      ? 'Your TRYBE tab is open but signed out. Sign in there, then leave the tab open.'
      : state === 'not-allowed'
        ? 'SCOUT is not allowed on TRYBE in this Chrome, so it cannot open or use a TRYBE tab. Press Allow SCOUT on TRYBE at the top of this page.'
      : state === 'unknown'
        ? 'SCOUT did not say whether TRYBE is open. Open TRYBE, sign in, and leave that tab open.'
        : 'Press Open TRYBE, sign in, then leave that tab open while you work in other tabs. SCOUT sends your requests and reads your TRYBE through it, and opens no window of its own.',
  }
}
