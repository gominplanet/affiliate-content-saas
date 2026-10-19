// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT SCOUT SEES WHILE IT WAITS FOR A GROUP POST (SCOUT 1.52.1; Seb,
// 2026-10-19: "it now has been over 15 minutes" on a line that only ever said
// "Waiting for your Group post"). A wait that is working and a wait that is
// stuck read the same, so the page now says which: the post box still open,
// Facebook still processing the video, the tab asleep, or the tab closed and
// SCOUT looking in the Group itself. Null when the watch says nothing more
// than it is watching (an older SCOUT). Pure.
import type { FacebookGroupPostStatus } from '@/lib/extension-frame'

export function clockWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

export function watchSays(st: FacebookGroupPostStatus | null | undefined, now: number): string | null {
  if (!st || st.state !== 'watching' || !st.ctx) return null
  const c = st.ctx
  const see = c.seeing
  if (!see) return null
  const since = c.started ? ` (${clockWords(now - c.started)} since the post was filled)` : ''
  if (c.mode === 'search') {
    if (see.foundNoLink) return 'SCOUT found your post in the Group and is reading its link. Nothing to do here.'
    if (see.error) return `The Facebook tab is closed, so SCOUT is looking for your post in the Group itself. Its last look did not work (${see.error}). It tries again by itself.`
    const n = see.searches ?? c.searches ?? 0
    const next = see.nextAt ? Math.max(0, Math.round((see.nextAt - now) / 60000)) : null
    const when = next === null ? '' : next <= 1 ? ' Next look in about a minute.' : ` Next look in about ${next} minutes.`
    return n
      ? `The Facebook tab is closed, so SCOUT is looking for your post in the Group itself. It has looked ${n} ${n === 1 ? 'time' : 'times'} and not found it yet${since}.${when} Nothing to do here: once it is up, MVP posts the Reel.`
      : `The Facebook tab is closed, so SCOUT will look for your post in the Group itself.${when} Nothing to do here.`
  }
  if ((see.readFails ?? 0) >= 3) {
    return see.asleep
      ? 'Chrome put the Facebook tab to sleep. SCOUT woke it up to read it again.'
      : 'SCOUT has not been able to read the Facebook tab for a while. Click on it once, or close it: SCOUT then looks for your post in the Group itself.'
  }
  if (see.seen) return 'Your post is up in the Group. SCOUT is reading its link.'
  if (see.processing) return `Facebook is still processing your video${since}. You can close the Facebook tab now: SCOUT finds the post in the Group once it is up, and MVP posts the Reel.`
  if (see.created) return `Facebook took your post and is getting it ready${since}. You can close the Facebook tab now: SCOUT finds the post in the Group once it is up, and MVP posts the Reel.`
  if (see.dialog) return `The post is still open in the Facebook tab${since}. Press Post there once the clip has finished uploading.`
  return `SCOUT is watching for your post in the Group${since}.`
}
