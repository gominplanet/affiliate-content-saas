// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A LAUNCH GOES OUT AT THE HOUR THE CREATOR MEANT.
//
// YouTube's publishAt is an absolute instant. A creator who types 09:00 means
// nine o'clock where they live, so a batch scheduled without their zone goes
// public at 09:00 UTC: five in the morning in Toronto, eight at night in
// Sydney. There is no undoing a published video, and the failure is invisible
// until somebody notices their launch happened overnight.
//
// So this runs the real arithmetic against real zones, including across a
// daylight-saving change, rather than pinning the source text.
import {
  parseSlot, normalizeSlots, zonedTimeToInstant, planSchedule,
  slotsAlreadyPast, cadenceLabel, startsBeforeToday, todayIn } from '../lib/launch-schedule'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
/** What a zone's clock reads at an instant, for asserting on the thing that
 *  matters: what the creator will see, not what we computed. */
const wallClock = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(at)

// ── a slot is a time of day, or it is nothing ───────────────────────────────
{
  check('a normal time parses', parseSlot('09:00') === 540)
  check('and a late one', parseSlot('23:59') === 1439)
  check('a single-digit hour is allowed', parseSlot('9:30') === 570)
  for (const bad of ['', '24:00', '09:60', 'nine', '09', '9:5', '-1:00', '09:00:00']) {
    check(`"${bad}" is not a time`, parseSlot(bad) === null, `${parseSlot(bad)}`)
  }
}

// ── the slots are the cadence, so their order is the day's order ────────────
{
  // TYPED IN ANY ORDER. Unsorted, the 18:00 video would publish before the
  // 09:00 one and the board's ordering would disagree with what happened.
  check('slots come back in time order',
    normalizeSlots(['18:00', '09:00', '13:00']).join(',') === '09:00,13:00,18:00')
  check('duplicates are dropped',
    normalizeSlots(['09:00', '9:00', '09:00']).join(',') === '09:00',
    'two videos at the same minute is not a cadence')
  check('and rubbish is dropped rather than defaulted',
    normalizeSlots(['09:00', 'noon', '']).join(',') === '09:00',
    'a default would publish at an hour nobody chose')
  check('nothing usable gives nothing', normalizeSlots(['nope']).length === 0)
  check('null is survivable', normalizeSlots(null).length === 0)
}

// ── nine o'clock means nine o'clock, where the creator lives ────────────────
{
  // Toronto in September is UTC-4, so 09:00 local is 13:00 UTC.
  const t = zonedTimeToInstant(2026, 9, 22, 9 * 60, 'America/Toronto')
  check('a Toronto morning is not a UTC morning',
    t.toISOString() === '2026-09-22T13:00:00.000Z', t.toISOString())
  check('and it reads back as 09:00 on their own clock',
    wallClock(t, 'America/Toronto') === '22/09/2026, 09:00', wallClock(t, 'America/Toronto'))

  // Sydney is UTC+10 in September, so 09:00 local is the PREVIOUS day in UTC.
  const s = zonedTimeToInstant(2026, 9, 22, 9 * 60, 'Australia/Sydney')
  check('a zone ahead of UTC crosses back over midnight',
    s.toISOString() === '2026-09-21T23:00:00.000Z', s.toISOString())
  check('and still reads as 09:00 there',
    wallClock(s, 'Australia/Sydney') === '22/09/2026, 09:00', wallClock(s, 'Australia/Sydney'))

  check('UTC is left alone',
    zonedTimeToInstant(2026, 9, 22, 9 * 60, 'UTC').toISOString() === '2026-09-22T09:00:00.000Z')
}

// ── and it still means nine o'clock after the clocks change ─────────────────
//
// THE TWO-PASS CASE. The offset depends on the instant and the instant depends
// on the offset, so a single pass puts every slot on the far side of a clock
// change an hour out. Nobody notices until a video appears at 08:00.
{
  // North America ends DST on 1 November 2026: before it Toronto is UTC-4,
  // after it UTC-5. Same wall clock, different absolute instants.
  const before = zonedTimeToInstant(2026, 10, 30, 9 * 60, 'America/Toronto')
  const after = zonedTimeToInstant(2026, 11, 5, 9 * 60, 'America/Toronto')
  check('09:00 before the change is 13:00 UTC',
    before.toISOString() === '2026-10-30T13:00:00.000Z', before.toISOString())
  check('09:00 after the change is 14:00 UTC',
    after.toISOString() === '2026-11-05T14:00:00.000Z', after.toISOString())
  check('so the creator sees 09:00 on both days',
    wallClock(before, 'America/Toronto').endsWith('09:00')
    && wallClock(after, 'America/Toronto').endsWith('09:00'),
    `${wallClock(before, 'America/Toronto')} / ${wallClock(after, 'America/Toronto')}`)

  // Europe changes a week earlier, which is the case a hardcoded rule gets
  // wrong precisely because it looks like the American one.
  const lon = zonedTimeToInstant(2026, 10, 27, 9 * 60, 'Europe/London')
  check('London had already changed by 27 October',
    lon.toISOString() === '2026-10-27T09:00:00.000Z', lon.toISOString())

  // ── THE SLOTS THAT ACTUALLY NEED THE SECOND PASS ────────────────────────
  //
  // A 09:00 slot never exercises it: the naive UTC reading and the real
  // instant land on the same side of every transition, so one pass is already
  // right and a test built only on 09:00 proves nothing about the second.
  // These are the ones that break it, and they are ordinary: an early slot on
  // the morning the clocks move.
  //
  // Sydney puts its clocks FORWARD at 02:00 on 4 October 2026, so 01:00 that
  // day is still AEST (+10) and falls at 15:00Z the day before. One pass reads
  // the offset at 01:00Z, which is already AEDT (+11), and lands an hour early.
  const syd = zonedTimeToInstant(2026, 10, 4, 60, 'Australia/Sydney')
  check('an early slot on the morning Sydney springs forward',
    syd.toISOString() === '2026-10-03T15:00:00.000Z', syd.toISOString())
  check('and it reads back as 01:00 there',
    wallClock(syd, 'Australia/Sydney') === '04/10/2026, 01:00', wallClock(syd, 'Australia/Sydney'))

  // Toronto springs forward at 02:00 on 8 March 2026, so 03:00 is the first
  // hour of EDT (-4) and falls at 07:00Z. One pass reads EST (-5) and lands an
  // hour late.
  const tor = zonedTimeToInstant(2026, 3, 8, 3 * 60, 'America/Toronto')
  check('and the first hour after Toronto springs forward',
    tor.toISOString() === '2026-03-08T07:00:00.000Z', tor.toISOString())
  check('which reads back as 03:00 there',
    wallClock(tor, 'America/Toronto') === '08/03/2026, 03:00', wallClock(tor, 'America/Toronto'))
}

// ── ten videos, three a day, lands on day four ──────────────────────────────
{
  const plan = { timezone: 'America/Toronto', slots: ['09:00', '13:00', '18:00'], startOn: '2026-09-22' }
  const out = planSchedule(10, plan)
  check('every video got a slot', out.length === 10, `${out.length}`)
  check('the first three are day one', out.slice(0, 3).every((o) => o.day === 0))
  check('the fourth starts day two', out[3].day === 1 && out[3].slot === '09:00')
  check('the tenth is on day four', out[9].day === 3 && out[9].slot === '09:00',
    `day ${out[9].day} at ${out[9].slot}`)
  check('they are in ascending order',
    out.every((o, i) => i === 0 || o.at.getTime() > out[i - 1].at.getTime()),
    'a cadence that goes backwards publishes the wrong video first')
  check('and each one reads as its own slot on the creator’s clock',
    wallClock(out[0].at, plan.timezone) === '22/09/2026, 09:00'
    && wallClock(out[2].at, plan.timezone) === '22/09/2026, 18:00'
    && wallClock(out[3].at, plan.timezone) === '23/09/2026, 09:00',
    `${wallClock(out[0].at, plan.timezone)} | ${wallClock(out[2].at, plan.timezone)} | ${wallClock(out[3].at, plan.timezone)}`)

  // ONE A DAY is the other creator, and the common case.
  const daily = planSchedule(4, { timezone: 'Europe/Paris', slots: ['17:30'], startOn: '2026-09-22' })
  check('one a day is four consecutive days',
    daily.length === 4 && daily.every((o, i) => o.day === i && o.slot === '17:30'))

  // A BATCH THAT SPANS A CLOCK CHANGE. Ten videos one a day from 28 October
  // crosses the American change, and the creator means 09:00 throughout.
  const spans = planSchedule(10, { timezone: 'America/Toronto', slots: ['09:00'], startOn: '2026-10-28' })
  check('a batch crossing a clock change keeps the same hour every day',
    spans.every((o) => wallClock(o.at, 'America/Toronto').endsWith('09:00')),
    spans.map((o) => wallClock(o.at, 'America/Toronto')).join(' | '))
}

// ── an unusable plan schedules NOTHING ──────────────────────────────────────
//
// There is no undoing a published video, so a plan that cannot be honoured must
// produce no schedule rather than a guess at what the creator might have meant.
{
  check('no slots, no schedule',
    planSchedule(5, { timezone: 'UTC', slots: [], startOn: '2026-09-22' }).length === 0)
  check('unparseable slots, no schedule',
    planSchedule(5, { timezone: 'UTC', slots: ['lunchtime'], startOn: '2026-09-22' }).length === 0)
  check('a zone nobody recognises schedules nothing',
    planSchedule(5, { timezone: 'Mars/Olympus', slots: ['09:00'], startOn: '2026-09-22' }).length === 0,
    'defaulting to UTC would put ten videos out at the wrong hour with nothing on screen to say so')
  check('a start date that is not a date schedules nothing',
    planSchedule(5, { timezone: 'UTC', slots: ['09:00'], startOn: 'tomorrow' }).length === 0)
  check('and zero videos is not an error',
    planSchedule(0, { timezone: 'UTC', slots: ['09:00'], startOn: '2026-09-22' }).length === 0)
}

// ── YouTube refuses a publishAt in the past ─────────────────────────────────
//
// A batch prepared yesterday is launched today, so the plan is checked against
// the clock. Named up front rather than discovered as the API rejects them one
// at a time with nothing connecting the failures.
{
  const plan = { timezone: 'UTC', slots: ['09:00', '18:00'], startOn: '2026-09-22' }
  const out = planSchedule(4, plan)
  const now = new Date('2026-09-22T12:00:00.000Z')
  const past = slotsAlreadyPast(out, now)
  check('the slots already gone are named',
    past.length === 1 && past[0].position === 0,
    `${past.map((p) => p.position).join(',')}`)
  check('and the ones still to come are left alone',
    slotsAlreadyPast(out, new Date('2026-09-01T00:00:00.000Z')).length === 0)
  check('a slot exactly now counts as past',
    slotsAlreadyPast(out, out[0].at).length >= 1,
    'YouTube rejects it, so treating it as fine schedules a launch that never happens')
}

// ── the screen says the cadence in words ────────────────────────────────────
{
  check('one a day reads naturally',
    cadenceLabel(['09:00']) === 'One a day, at 09:00', cadenceLabel(['09:00']))
  check('three a day lists them',
    cadenceLabel(['09:00', '18:00', '13:00']) === '3 a day, at 09:00, 13:00 and 18:00',
    cadenceLabel(['09:00', '18:00', '13:00']))
  check('and nothing set says so',
    cadenceLabel([]) === 'No publishing times set yet')
  check('no dash punctuation in the words a creator reads',
    !/[—–]/.test([cadenceLabel(['09:00']), cadenceLabel(['09:00', '13:00']), cadenceLabel([])].join(' ')))
}

// ── a time that has gone today means NOW, a day that has gone is a mistake ──
//
// Seb: "we should be able to launch and upload right away.. not only starting
// the next day". The earliest first day was tomorrow, so finishing a batch at
// nine in the morning meant waiting a day to put anything out.
//
// The line is the DATE, not the time. A slot that went by this morning is one
// video going out now, which is a thing somebody asks for. A first day of last
// Tuesday is ten videos going public at once, which nobody asks for and cannot
// be undone.
{
  const at = (iso: string) => new Date(iso)

  check('earlier today is not "before today"',
    !startsBeforeToday('2026-09-21', 'America/Toronto', at('2026-09-21T23:00:00Z')),
    'refusing today is what made tomorrow the earliest anything could go out')
  check('yesterday is',
    startsBeforeToday('2026-09-20', 'America/Toronto', at('2026-09-21T23:00:00Z')),
    'a week-old first day would put every video public at once')
  check('and tomorrow is not',
    !startsBeforeToday('2026-09-22', 'America/Toronto', at('2026-09-21T23:00:00Z')))

  // DECIDED IN THE CREATOR'S ZONE, not the server's. At 23:00 in Toronto it is
  // already tomorrow in UTC, and a server comparing UTC dates would refuse a
  // start date that is perfectly good where they are standing.
  check('the day is read in the creator’s own timezone',
    todayIn('America/Toronto', at('2026-09-22T02:00:00Z')) === '2026-09-21'
    && todayIn('UTC', at('2026-09-22T02:00:00Z')) === '2026-09-22',
    'a creator in Auckland is a day ahead of a server in Virginia')
  check('and a zone nobody recognises does not throw',
    /^\d{4}-\d{2}-\d{2}$/.test(todayIn('Not/AZone')),
    'a bad zone must not take the launch route down with it')

  // THE SLOTS THEMSELVES still have to be listed, because the screen says which
  // videos are going out immediately rather than springing it on anybody.
  {
    const planned = planSchedule(2, {
      slots: ['09:00', '21:00'], startOn: '2026-09-21', timezone: 'America/Toronto',
    })
    const past = slotsAlreadyPast(planned, at('2026-09-21T18:00:00Z')) // 14:00 Toronto
    check('a slot gone today is listed, and a later one is not',
      past.length === 1 && past[0].slot === '09:00',
      `${past.length} past: ${past.map(p => p.slot).join(',')}`)
  }
}

if (failures.length) {
  console.error(`\n❌ launch-schedule: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launch-schedule: a launch goes out at the hour the creator meant, in their own zone, on both sides of a clock change')
