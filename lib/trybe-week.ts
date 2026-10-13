// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR'S TRYBE WEEK (Seb, 2026-10-13, after Alejandro). The brands they
// work with, the samples each one is sending, boxes to tick as a sample
// arrives, is filmed and is submitted, and a plan for the next seven days
// built from those boxes:
//   - a sample that arrived gets a filming day, oldest first, so nothing
//     sits on a shelf; Cole's rule: two or three videos to start with a brand;
//   - before filming, its video ideas (from the brand's brief and website);
//   - filmed means submit it the next day;
//   - a sample asked for a week ago and not here gets a polite "when does it
//     ship" message.
// Pure, so the plan is tested (scripts/test-trybe-week.ts).

export interface Sample {
  id: string
  brand_id: string | null
  brand_name: string
  product: string
  videos_planned: number
  requested_at: string
  received_at: string | null
  filmed_at: string | null
  submitted_at: string | null
  /** The sample's own video ideas, when made. */
  has_ideas: boolean
}

export type Stage = 'on_the_way' | 'to_film' | 'to_submit' | 'done'

export function stageOf(s: Pick<Sample, 'received_at' | 'filmed_at' | 'submitted_at'>): Stage {
  if (s.submitted_at) return 'done'
  if (s.filmed_at) return 'to_submit'
  if (s.received_at) return 'to_film'
  return 'on_the_way'
}

export const STAGE_WORDS: Record<Stage, string> = {
  on_the_way: 'On the way', to_film: 'Here, to film', to_submit: 'Filmed, to submit', done: 'Submitted',
}

/** Days after asking before a missing sample is worth a message. */
export const CHASE_DAYS = 7
/** Days a sample may sit unfilmed before it reads as late. */
export const LATE_DAYS = 7

export type TaskKind = 'ideas' | 'film' | 'submit' | 'chase'
export interface Task { kind: TaskKind; sampleId: string; brand: string; product: string; text: string; late?: boolean }
export interface Day { date: string; label: string; tasks: Task[] }

const DAY = 86_400_000
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
const daysSince = (iso: string | null, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : 0)

/** The next seven days, from today. `perDay`: samples filmed a day (1 to 3).
 *  Pure: `now` and the day names come in. */
export function planWeek(samples: Sample[], opts: { perDay: number; now?: number; dayName?: (t: number, i: number) => string } = { perDay: 1 }): Day[] {
  const now = opts.now ?? Date.now()
  const perDay = Math.max(1, Math.min(3, Math.round(opts.perDay || 1)))
  const name = opts.dayName ?? ((t: number, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(t).toLocaleDateString(undefined, { weekday: 'long' })))
  const days: Day[] = Array.from({ length: 7 }, (_, i) => ({ date: ymd(now + i * DAY), label: name(now + i * DAY, i), tasks: [] }))
  const open = samples.filter((s) => stageOf(s) !== 'done')

  // Filmed: submit today.
  for (const s of open.filter((x) => stageOf(x) === 'to_submit')) {
    days[0].tasks.push({ kind: 'submit', sampleId: s.id, brand: s.brand_name, product: s.product, text: `Submit your ${s.product} videos to ${s.brand_name} on TRYBE` })
  }
  // Here: oldest first, `perDay` a day; each one's ideas the day before
  // filming (or the same day for today's), and its submission the day after.
  const toFilm = open.filter((x) => stageOf(x) === 'to_film').sort((a, b) => Date.parse(a.received_at || '') - Date.parse(b.received_at || ''))
  toFilm.forEach((s, i) => {
    const d = Math.min(6, Math.floor(i / perDay))
    const n = Math.max(1, Math.min(10, s.videos_planned || 3))
    const late = daysSince(s.received_at, now) >= LATE_DAYS
    if (!s.has_ideas) days[Math.max(0, d - 1)].tasks.push({ kind: 'ideas', sampleId: s.id, brand: s.brand_name, product: s.product, text: `Get video ideas for ${s.product} (${s.brand_name})` })
    days[d].tasks.push({ kind: 'film', sampleId: s.id, brand: s.brand_name, product: s.product, late,
      text: `Film ${n} video${n === 1 ? '' : 's'} of ${s.product} for ${s.brand_name}${late ? ` (here ${daysSince(s.received_at, now)} days)` : ''}` })
    if (d + 1 <= 6) days[d + 1].tasks.push({ kind: 'submit', sampleId: s.id, brand: s.brand_name, product: s.product, text: `Edit and submit the ${s.product} videos to ${s.brand_name}` })
  })
  // Asked a week ago and not here: ask when it ships, today.
  for (const s of open.filter((x) => stageOf(x) === 'on_the_way' && daysSince(x.requested_at, now) >= CHASE_DAYS)) {
    days[0].tasks.push({ kind: 'chase', sampleId: s.id, brand: s.brand_name, product: s.product, text: `Ask ${s.brand_name} when the ${s.product} sample ships (asked ${daysSince(s.requested_at, now)} days ago)` })
  }
  return days
}

/** The brands in play, with where their samples stand. */
export function brandsOf(samples: Sample[]): Array<{ name: string; brandId: string | null; counts: Record<Stage, number> }> {
  const m = new Map<string, { name: string; brandId: string | null; counts: Record<Stage, number> }>()
  for (const s of samples) {
    const key = (s.brand_id || s.brand_name).toLowerCase()
    const e = m.get(key) || { name: s.brand_name, brandId: s.brand_id, counts: { on_the_way: 0, to_film: 0, to_submit: 0, done: 0 } }
    e.counts[stageOf(s)]++
    m.set(key, e)
  }
  return Array.from(m.values()).sort((a, b) => (b.counts.to_film + b.counts.to_submit) - (a.counts.to_film + a.counts.to_submit) || a.name.localeCompare(b.name))
}

/** The week as text, to copy or print. */
export function weekText(days: Day[]): string {
  return ['YOUR TRYBE WEEK', ...days.map((d) => `${d.label.toUpperCase()} (${d.date})\n${d.tasks.length ? d.tasks.map((t) => `[ ] ${t.text}`).join('\n') : 'Nothing planned'}`)].join('\n\n')
}
