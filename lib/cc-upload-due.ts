// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CC UPLOAD REMINDER (Seb, 2026-10-10: "give me a reminder on those days on
// my admin panel to upload CC zips"). Spot counts come mainly from the upload,
// and campaigns fill within days, so the two Amazon ZIPs go in every Monday
// and Thursday. Due from the start of each upload day, in Seb's time (AST, no
// daylight saving), until an upload has happened since. Pure.

export const CC_UPLOAD_DAYS = [1, 4] // Monday, Thursday
export const CC_UPLOAD_TZ_OFFSET_H = -4 // Atlantic Standard Time, all year
export const CC_LAST_UPLOAD_FLAG = 'cc_last_upload'

const DAY = 86_400_000

/** The start (as UTC ms) of the most recent upload day at or before `now`. */
export function lastUploadDayStart(now: number): number {
  const offset = CC_UPLOAD_TZ_OFFSET_H * 3600_000
  const local = new Date(now + offset)
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  for (let back = 0; back < 7; back++) {
    const d = new Date(midnightLocal - back * DAY)
    if (CC_UPLOAD_DAYS.includes(d.getUTCDay())) return d.getTime() - offset
  }
  return midnightLocal - offset
}

/** Whether an upload is due: none recorded since the start of the last upload day. */
export function ccUploadDue(lastUploadAt: string | null | undefined, now: number): { due: boolean; since: number } {
  const since = lastUploadDayStart(now)
  const last = lastUploadAt ? Date.parse(lastUploadAt) : NaN
  return { due: !Number.isFinite(last) || last < since, since }
}

/** "Monday" or "Thursday", for the day it became due. */
export function uploadDayName(since: number): string {
  return new Date(since + CC_UPLOAD_TZ_OFFSET_H * 3600_000).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

/** "3 days ago", "5 hours ago": how long since the last upload. */
export function uploadAgo(at: string, now: number): string {
  const h = Math.max(0, Math.round((now - Date.parse(at)) / 3600_000))
  if (h < 1) return 'less than an hour ago'
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.round(h / 24)} days ago`
}
