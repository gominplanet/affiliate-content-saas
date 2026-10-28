// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHY A BURN FAILED, IN WORDS (Seb, 2026-10-12: Clip Factory said "Could not
// burn the caption: [object Object]" on a 3:41 clip). The Cloudinary SDK
// rejects with plain objects ({ message, http_code } or { error: {...} }),
// never an Error, so `String(e)` printed "[object Object]" and the real reason
// was lost. cloudErrorText reads the message out of any of those shapes;
// burnErrorMessage turns the known causes (too big, too slow) into what the
// creator can do about it, and passes anything else through as it came.
// Imports nothing. Tested in scripts/test-burn-error.

/** The message inside whatever Cloudinary (or anything else) threw. */
export function cloudErrorText(e: unknown): string {
  if (e == null) return 'unknown error'
  if (typeof e === 'string') return e || 'unknown error'
  if (e instanceof Error) return e.message || e.name || 'unknown error'
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>
    const inner = o.error && typeof o.error === 'object' ? o.error as Record<string, unknown> : null
    const msg = (typeof o.message === 'string' && o.message)
      || (inner && typeof inner.message === 'string' && inner.message)
      || (typeof o.error === 'string' && o.error)
      || ''
    const code = o.http_code ?? inner?.http_code
    if (msg) return code != null && !String(msg).includes(String(code)) ? `${msg} (${code})` : String(msg)
    try { const j = JSON.stringify(e); if (j && j !== '{}') return j.slice(0, 300) } catch { /* fall through */ }
    return 'unknown error'
  }
  return String(e)
}

/** Cloudinary turned the video down for its size or took too long with it:
 *  the cases MVP's own render server can take over. */
export function cloudinaryRefusedSize(raw: string | null | undefined): boolean {
  const r = String(raw || '')
  return /file size too large|too large to process|maximum is \d+|exceeds.*(size|limit)|request timeout|timeouterror|\(499\)|timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(r)
}

/** Cloudinary turned MVP itself away, not the video (Seb, 2026-10-28,
 *  Alejandro: "Could not burn the overlay: cloud_name is disabled (401)"):
 *  the account switched off, its keys refused, or its plan used up. Every
 *  burn goes to MVP's own render server while that lasts. */
export function cloudinaryAccountDown(raw: string | null | undefined): boolean {
  const r = String(raw || '')
  return /cloud_name is disabled|account (is )?(disabled|suspended|blocked)|invalid (api_key|cloud_name|signature)|unknown api_key|api_secret mismatch|\((401|403|420|429)\)|quota|credits? (limit|exceeded|used)|usage limit|rate limit/i.test(r)
}

/** A burn MVP's own render server can take over: Cloudinary refused the
 *  file's size or time, or refused MVP's account. */
export function cloudinaryHandOff(raw: string | null | undefined): boolean {
  return cloudinaryRefusedSize(raw) || cloudinaryAccountDown(raw)
}

const SHORTER = 'Use a shorter clip (under about 90 seconds works best), or press "Skip and publish as is" to post it without the overlay.'

/** What the creator sees when the burn did not work. */
export function burnErrorMessage(raw: string | null | undefined): string {
  const r = String(raw || '').trim()
  if (cloudinaryAccountDown(r)) {
    return 'The overlay burner MVP uses is unavailable right now. This is on MVP\'s side, not your video, and the team has been told. Press "Skip and publish as is" to post it without the overlay, or try again later.'
  }
  if (/file size too large|too large to process|maximum is \d+|exceeds.*(size|limit)/i.test(r)) {
    return `This video is too big for the overlay burner. ${SHORTER}`
  }
  if (/request timeout|timeouterror|\(499\)|timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(r)) {
    return /timeout after \d+s/i.test(r)
      ? `The overlay burner was still working on this video when MVP stopped waiting. Long clips take the longest. ${SHORTER}`
      : `Sending this video to the overlay burner took too long. Long clips take the longest. ${SHORTER}`
  }
  return `Could not burn the overlay: ${r || 'unknown error'}`
}
