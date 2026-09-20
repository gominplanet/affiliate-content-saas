// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// When each video in a batch goes public.
//
// HOW MANY A DAY IS PERSONAL. Seb posts three a day; somebody else posts one.
// So a batch carries the TIMES OF DAY rather than a count, and the number of
// slots is the videos-per-day. Three slots means three a day, at those hours,
// and video eleven lands on day four.
//
// THE ZONE IS NOT A DISPLAY DETAIL. YouTube's publishAt is an absolute instant.
// A creator who picks 09:00 means nine o'clock where they live, so without
// their zone their videos go public at 09:00 UTC, which is five in the morning
// in Toronto and eight in the evening in Sydney. Worse, an offset captured once
// breaks the moment the clocks change: the creator still means nine o'clock.
// So the zone is stored, and every slot is resolved against the zone AT THAT
// DATE.
//
// Pure, with no I/O, so the rules are pinned by tests rather than discovered by
// a creator whose launch went out overnight.

/** A slot, as the creator wrote it: "09:00", "13:30". */
export type Slot = string

export interface SchedulePlan {
  /** IANA zone, e.g. 'America/Toronto'. */
  timezone: string
  /** One per video per day, in the order they should be used. */
  slots: Slot[]
  /** The first day anything goes out, as YYYY-MM-DD in the creator's zone. */
  startOn: string
}

/** How many minutes past midnight a slot is, or null when it is not a time. */
export function parseSlot(slot: Slot): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((slot || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** Slots the creator actually gave, cleaned and in time order.
 *
 *  SORTED, because the order they were typed is not the order of the day, and
 *  an unsorted list would publish the 18:00 video before the 09:00 one and make
 *  the board's ordering disagree with reality. Duplicates dropped for the same
 *  reason: two videos at the same minute is not a cadence. */
export function normalizeSlots(slots: Slot[] | null | undefined): Slot[] {
  const seen = new Set<number>()
  const out: Array<{ m: number; s: Slot }> = []
  for (const raw of (slots ?? [])) {
    const m = parseSlot(raw)
    if (m === null || seen.has(m)) continue
    seen.add(m)
    out.push({ m, s: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })
  }
  out.sort((a, b) => a.m - b.m)
  return out.map((o) => o.s)
}

/**
 * What a zone's offset from UTC is at a given instant, in milliseconds.
 *
 * Intl is the only thing in the platform that knows the rules, so the offset is
 * read back out of a formatted date rather than assumed from a table that would
 * be wrong the next time a government moves its clocks.
 */
function offsetMsAt(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  // `hour` comes back as 24 at midnight under hour12:false in some engines.
  const asIfUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
  return asIfUtc - at.getTime()
}

/**
 * The instant at which a wall-clock time in a zone actually occurs.
 *
 * TWO PASSES, because the offset depends on the instant and the instant depends
 * on the offset. The first guess uses the offset at the naive UTC reading; if
 * that lands on the other side of a daylight-saving change the offset is read
 * again and applied. Without the second pass, every launch scheduled across a
 * clock change goes out an hour wrong, which is exactly the kind of bug that is
 * invisible until somebody's video appears at 08:00.
 */
export function zonedTimeToInstant(
  year: number, month: number, day: number, minutesIntoDay: number, timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutesIntoDay / 60), minutesIntoDay % 60)
  const first = offsetMsAt(new Date(naive), timezone)
  let ts = naive - first
  const second = offsetMsAt(new Date(ts), timezone)
  if (second !== first) ts = naive - second
  return new Date(ts)
}

/** YYYY-MM-DD plus N days, staying on the calendar rather than adding 86400
 *  seconds, so a day that is 23 or 25 hours long does not shift the date. */
function addDays(ymd: string, days: number): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim())
  if (!m) return null
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const moved = new Date(base + days * 86_400_000)
  return { y: moved.getUTCFullYear(), m: moved.getUTCMonth() + 1, d: moved.getUTCDate() }
}

export interface ScheduledSlot {
  /** Zero-based position in the batch. */
  position: number
  /** The absolute instant, which is what YouTube is told. */
  at: Date
  /** The day and slot it landed on, for a screen that has to explain itself. */
  day: number
  slot: Slot
}

/**
 * Lay a batch out over the creator's cadence.
 *
 * Video 0 takes the first slot of the first day, video 1 the second slot, and
 * when the slots run out the next video starts the next day. Ten videos on
 * three slots a day finish on day four.
 *
 * Returns an empty list rather than guessing when the plan is unusable, because
 * scheduling a launch against a zone nobody recognised would put ten videos out
 * at the wrong hour and there is no undoing a published video.
 */
export function planSchedule(count: number, plan: SchedulePlan): ScheduledSlot[] {
  const slots = normalizeSlots(plan.slots)
  if (count <= 0 || slots.length === 0) return []
  // The date is also re-checked per item below, so this is the early exit
  // rather than the protection; both produce nothing, which is the point.
  if (!addDays(plan.startOn, 0)) return []
  try {
    // A zone Intl does not know THROWS rather than falling back, and this is
    // the one case where being wrong is silent and expensive: defaulting to UTC
    // would schedule ten videos at an hour the creator never chose, and a
    // published video cannot be unpublished.
    new Intl.DateTimeFormat('en-US', { timeZone: plan.timezone })
  } catch { return [] }

  const out: ScheduledSlot[] = []
  for (let i = 0; i < count; i++) {
    const day = Math.floor(i / slots.length)
    const slot = slots[i % slots.length]
    const date = addDays(plan.startOn, day)
    const minutes = parseSlot(slot)
    if (!date || minutes === null) continue
    out.push({ position: i, at: zonedTimeToInstant(date.y, date.m, date.d, minutes, plan.timezone), day, slot })
  }
  return out
}

/**
 * YouTube refuses a publishAt in the past, and a batch prepared yesterday is
 * launched today.
 *
 * So the plan is checked against the clock rather than trusted, and the answer
 * names the videos that would be rejected instead of letting the API reject
 * them one at a time with nothing on screen to connect the failures.
 */
export function slotsAlreadyPast(planned: ScheduledSlot[], now: Date = new Date()): ScheduledSlot[] {
  return planned.filter((p) => p.at.getTime() <= now.getTime())
}

/** Plain words for a cadence, so no screen invents its own. */
export function cadenceLabel(slots: Slot[] | null | undefined): string {
  const s = normalizeSlots(slots)
  if (s.length === 0) return 'No publishing times set yet'
  if (s.length === 1) return `One a day, at ${s[0]}`
  return `${s.length} a day, at ${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`
}
