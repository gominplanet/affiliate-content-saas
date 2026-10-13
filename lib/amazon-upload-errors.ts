// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What an Amazon upload failure means, in the creator's words.
//
// SCOUT reports Chrome's and Amazon's own sentences, and the board showed them
// as they came: "Could not establish connection. Receiving end does not exist."
// That is Chrome saying SCOUT's page script was not there. SCOUT now reads the
// tab's address and says "not signed in" itself when Amazon sent it to the
// sign-in page, so Chrome's sentence alone means the page went away part way.
// Each is said as such, with what fixes it. Anything not recognised is passed
// through untouched.
import { marketByDomain } from '@/lib/markets'

export function explainAmazonUpload(raw: string | null | undefined, domain: string): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  const country = marketByDomain(domain)?.country ?? domain
  const store = `amazon.${domain.replace(/^amazon\./, '')}`
  // SCOUT SAYS "not signed in" ITSELF when Amazon sent its tab to the sign-in
  // page: it reads the tab's address before each upload and after each reload.
  if (/^not signed in/i.test(s)) {
    return `SCOUT could not open Amazon ${country}'s upload page because this Chrome is not signed in to ${store} with your Creator account: open ${store}, sign in, then send again.`
  }
  // CHROME'S "Receiving end does not exist" is SCOUT losing the page part way
  // (it reloaded or stopped answering), not a sign-in: Seb's run of 16 sent 13
  // to the same store and called two of these "not signed in".
  if (/receiving end does not exist|could not establish connection/i.test(s)) {
    return `SCOUT lost contact with Amazon ${country}'s upload page part way (the page reloaded or stopped answering), so this video did not go. Nothing is listed there yet. If every video for ${country} fails like this, check you are still signed in to ${store}.`
  }
  if (/creator session token|ctx:dom:csrf|slatetoken/i.test(s)) {
    return `Signed in to ${store}, but Amazon did not open your Creator tools there. Open ${store}/create/post while signed in: if it asks you to join or finish setting up as a creator for ${country}, do that, then send again.`
  }
  if (/s3 put timed out|upload-video\].*timed out/i.test(s)) {
    return `The video took too long to reach Amazon ${country} and was stopped part way. Nothing is listed there yet; sending again starts it fresh.`
  }
  if (/^Could not open the Amazon Creator Hub tab/i.test(s)) {
    return `Chrome would not open a tab for Amazon ${country}. Send again; if it keeps happening, restart Chrome.`
  }
  return s
}

// ── WHICH FAILURES ARE WORTH TRYING AGAIN, AND WHEN ────────────────────────
//
// A failed listing used to be final until somebody pressed Send again, and the
// background never retried anything. Most failures seen are not final at all:
// a slow upload, a tab that was still loading, a sign-in that has since been
// done. So each failure is sorted, and all but Amazon's own refusals are tried
// again on a widening schedule, up to MAX_UPLOAD_TRIES, with the time of the
// next try on the row so the report can say it.

export type UploadFailureKind = 'signin' | 'creator' | 'transient' | 'refused'

export const MAX_UPLOAD_TRIES = 5

export function uploadFailureKind(raw: string | null | undefined): UploadFailureKind {
  const s = String(raw || '')
  if (/not signed in|not-signed-in|\/ap\/signin/i.test(s)) return 'signin'
  // Lost the page part way: tried again soon, like a slow upload.
  if (/receiving end does not exist|could not establish connection/i.test(s)) return 'transient'
  if (/creator session token|ctx:dom:csrf|slatetoken|not enrolled|not-enrolled/i.test(s)) return 'creator'
  if (/time[ds]? ?out|timed out|abort|network|failed to fetch|no response|did not report|503|502|500|504|429|throttl|temporar|try again|could not open the amazon creator hub tab|s3 put|still uploading/i.test(s)) return 'transient'
  return 'refused'
}

/** Minutes to wait before try number `tries + 1`, or null when it is final. */
const WAITS: Record<Exclude<UploadFailureKind, 'refused'>, number[]> = {
  transient: [10, 30, 120, 360],
  signin: [30, 120, 360, 720],
  creator: [30, 120, 360, 720],
}

export function nextUploadTry(kind: UploadFailureKind, triesSoFar: number, now = Date.now()): string | null {
  if (kind === 'refused' || triesSoFar >= MAX_UPLOAD_TRIES) return null
  const list = WAITS[kind]
  const mins = list[Math.min(triesSoFar - 1, list.length - 1)] ?? list[list.length - 1]
  return new Date(now + Math.max(1, mins) * 60_000).toISOString()
}
