// Human-friendly schedule-time formatting with an EXPLICIT timezone label.
//
// Schedules are picked in the browser's local timezone (a <input
// type="datetime-local">) and stored as UTC. When we render them back we were
// showing the local wall-clock time with NO timezone, so users couldn't tell
// which zone a time was in (Scott's confusion). These helpers always append the
// viewer's timezone abbreviation (e.g. "EDT" / "EST" / "PST"), so an ET creator
// sees "Aug 4, 3:00 PM EDT" and there's no ambiguity.

/** The viewer's timezone abbreviation for the given instant (DST-aware:
 *  "EDT" in summer, "EST" in winter). '' if it can't be determined. */
export function tzAbbrev(d: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d)
    return parts.find((p) => p.type === 'timeZoneName')?.value || ''
  } catch {
    return ''
  }
}

/** Local date+time with the timezone abbreviation appended. */
export function formatScheduleTime(
  input: string | number | Date,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
): string {
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return ''
  const base = d.toLocaleString(undefined, opts)
  const tz = tzAbbrev(d)
  return tz ? `${base} ${tz}` : base
}
