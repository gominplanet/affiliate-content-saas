// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TOP 100 BOARD (Seb, 2026-11-16, after TrybeDaily's Top brands: "MVP
// should be really the place where people go ... not only the winners, but
// like why they're winners, why these brands should be the ones that they
// contact"; then, of four layouts, "a little mix of everything"). Worked out
// from the Top 100 that MVP saves every day (lib/trybe-topdays): points per
// day, days in, #1 days, best and average place, longest run, this week's
// move, new to the board, back after a gap, and the race over the month.
//
// ONLY SAVED DAYS COUNT. A day with no saved row is "not saved", never "out
// of the Top 100": days in is out of the saved days, a run carries over a day
// that was not saved, and the board says how many days it stands on. Places
// past 100 (TRYBE's list runs to about 150) move a brand, but are not "in".
// Pure, so it is tested (scripts/test-trybe-topboard.ts).

import type { TopDay } from './trybe-topdays'
import type { PickReason } from './trybe-pick'

export const BOARD_DAYS = 30
export const WEEK_DAYS = 7
/** Out of the Top 100 for at least this many saved days, then back in. */
export const GAP_DAYS = 3
/** Where a brand off TRYBE's list is put when working out how far it fell. */
const OFF_LIST = 151

export interface SavedDay { date: string; day: TopDay }

/** In the Top 100 itself: a place from 1 to 100. */
export const inTop = (b: number | null | undefined): b is number => typeof b === 'number' && b >= 1 && b <= 100
/** Points for a day: #1 earns 100, #100 earns 1, anything else 0. */
export const pointsFor = (b: number | null | undefined): number => (inTop(b) ? 101 - b : 0)

export type BoardKind = 'new' | 'back' | 'up' | 'down' | 'steady' | 'out'

export interface BoardBrand {
  id: string
  /** Its best place on each saved day, oldest first; null when it was not on the list. */
  places: Array<number | null>
  /** Average points a saved day, 0 to 100 (every day at #1 is 100). */
  score: number
  daysIn: number
  ones: number
  best: number | null
  avg: number | null
  /** Longest run of saved days in a row in the Top 100. */
  run: number
  /** The run that reaches the latest saved day (0 when not in it now). */
  runNow: number
  /** Its best place on the latest saved day. */
  today: number | null
  /** Its videos in the list on the latest saved day, and in the top 10. */
  videos: number
  top10: number
  /** Its best place on the day the week's move compares with. */
  then: number | null
  /** Places climbed since then (negative when it fell); null when one side is missing. */
  move: number | null
  /** Back in after GAP_DAYS saved days out or more, within the last week. */
  back: boolean
  /** Saved days it was out before coming back (0 when not back). */
  gap: number
  kind: BoardKind
  firstIn: string | null
  lastIn: string | null
  /** Points so far on each saved day, oldest first: the race. */
  race: number[]
}

export interface Board {
  /** The saved days it is built on, oldest first. */
  days: string[]
  latest: string | null
  /** The saved day this week's moves compare with; null with under a week saved. */
  weekDay: string | null
  /** Days in the window that have no saved Top 100. */
  notSaved: number
  /** Every brand in the Top 100 on a saved day, best score first. */
  brands: BoardBrand[]
}

const dayNum = (d: string) => Math.round(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000)
const round1 = (n: number) => Math.round(n * 10) / 10

/** The board, from the saved days (any order; a date read twice keeps the later read). */
export function buildBoard(saved: SavedDay[]): Board {
  const byDate = new Map<string, TopDay>()
  for (const s of saved) {
    if (!s || typeof s.date !== 'string' || !s.day || typeof s.day !== 'object' || !s.day.brands) continue
    const d = s.date.slice(0, 10), had = byDate.get(d)
    if (!had || String(s.day.at || '') >= String(had.at || '')) byDate.set(d, s.day)
  }
  const all = Array.from(byDate.keys()).sort()
  if (!all.length) return { days: [], latest: null, weekDay: null, notSaved: 0, brands: [] }
  const latest = all[all.length - 1]
  const last = dayNum(latest)
  const days = all.filter((d) => dayNum(d) > last - BOARD_DAYS)
  const span = Math.min(BOARD_DAYS, last - dayNum(days[0]) + 1)
  const weekIdx = (() => { for (let i = days.length - 1; i >= 0; i--) if (dayNum(days[i]) <= last - WEEK_DAYS) return i; return -1 })()
  const rows = days.map((d) => byDate.get(d)!.brands)
  const ids = new Set<string>()
  for (const r of rows) for (const [id, b] of Object.entries(r)) if (b && typeof b.b === 'number') ids.add(id)
  const brands: BoardBrand[] = []
  for (const id of ids) {
    const places = rows.map((r) => (r[id] && typeof r[id].b === 'number' ? r[id].b : null))
    const ins = places.filter(inTop)
    // Never in the Top 100 itself (only past #100): not on the board.
    if (!ins.length) continue
    let run = 0, cur = 0
    for (const p of places) { cur = inTop(p) ? cur + 1 : 0; run = Math.max(run, cur) }
    const n = places.length
    let runNow = 0
    for (let i = n - 1; i >= 0 && inTop(places[i]); i--) runNow++
    // Back after a gap: the run up to today started after GAP_DAYS saved days out.
    let gap = 0, back = false
    if (runNow > 0 && runNow < n) {
      const start = n - runNow
      let j = start - 1
      while (j >= 0 && !inTop(places[j])) j--
      if (j >= 0 && start - 1 - j >= GAP_DAYS && last - dayNum(days[start]) < WEEK_DAYS) { gap = start - 1 - j; back = true }
    }
    const today = places[n - 1]
    const then = weekIdx >= 0 ? places[weekIdx] : null
    const move = then != null && today != null ? then - today : null
    const firstIdx = places.findIndex(inTop)
    const lastIdx = (() => { for (let i = n - 1; i >= 0; i--) if (inTop(places[i])) return i; return -1 })()
    // New: in it now, and in none of the saved days up to a week ago.
    const fresh = inTop(today) && weekIdx >= 0 && !places.slice(0, weekIdx + 1).some(inTop)
    const kind: BoardKind = !inTop(today) ? 'out' : fresh ? 'new' : back ? 'back' : move != null && move > 0 ? 'up' : move != null && move < 0 ? 'down' : 'steady'
    const race: number[] = []
    let sum = 0
    for (const p of places) { sum += pointsFor(p); race.push(sum) }
    const latestRow = rows[n - 1][id]
    brands.push({
      id, places, score: round1(sum / n), daysIn: ins.length, ones: ins.filter((p) => p === 1).length,
      best: ins.length ? Math.min(...ins) : null, avg: ins.length ? Math.round(ins.reduce((a, b) => a + b, 0) / ins.length) : null,
      run, runNow, today, videos: latestRow?.v ?? 0, top10: latestRow?.t10 ?? 0, then, move, back, gap, kind,
      firstIn: firstIdx >= 0 ? days[firstIdx] : null, lastIn: lastIdx >= 0 ? days[lastIdx] : null, race,
    })
  }
  brands.sort((a, b) => b.score - a.score || b.daysIn - a.daysIn || (a.best ?? 999) - (b.best ?? 999) || a.id.localeCompare(b.id))
  return { days, latest, weekDay: weekIdx >= 0 ? days[weekIdx] : null, notSaved: Math.max(0, span - days.length), brands }
}

/** How far it fell since the week's day: off the list counts as #151. */
export const fellBy = (b: BoardBrand): number => (b.then == null ? 0 : (b.today ?? OFF_LIST) - b.then)

/** This week's movers: biggest climbers, biggest drops, and new to the board. */
export function moversOf(board: Board, n = 5): { climbers: BoardBrand[]; drops: BoardBrand[]; fresh: BoardBrand[] } {
  const climbers = board.brands.filter((b) => b.move != null && b.move > 0 && inTop(b.today)).sort((a, b) => b.move! - a.move! || (a.today ?? 999) - (b.today ?? 999)).slice(0, n)
  const drops = board.brands.filter((b) => inTop(b.then) && fellBy(b) > 0).sort((a, b) => fellBy(b) - fellBy(a) || (a.then ?? 999) - (b.then ?? 999)).slice(0, n)
  const fresh = board.brands.filter((b) => b.kind === 'new').sort((a, b) => (a.today ?? 999) - (b.today ?? 999)).slice(0, n)
  return { climbers, drops, fresh }
}

/** The race on one saved day: the top `n` by points so far. */
export function raceOn(board: Board, idx: number, n = 10, only?: (b: BoardBrand) => boolean): Array<{ b: BoardBrand; points: number }> {
  const i = Math.max(0, Math.min(board.days.length - 1, idx))
  return board.brands.filter((b) => !only || only(b)).map((b) => ({ b, points: b.race[i] ?? 0 })).filter((x) => x.points > 0)
    .sort((x, y) => y.points - x.points || x.b.id.localeCompare(y.b.id)).slice(0, n)
}

/** "#97 → #11", "#28 → off the list", "#42 today". */
export function placesWords(b: BoardBrand): string {
  if (b.kind === 'new' || b.then == null) return b.today != null ? `#${b.today} today` : 'off the list today'
  return `#${b.then} → ${b.today != null ? `#${b.today}` : 'off the list'}`
}

/** The move as a short label: "▲86", "▼59", "New", "Back". */
export function moveWords(b: BoardBrand): string {
  if (b.kind === 'new') return 'New'
  if (b.back && (b.move == null || b.move <= 0)) return 'Back'
  if (b.move != null && b.move > 0) return `▲${b.move}`
  const f = fellBy(b)
  if (f > 0) return b.today == null ? 'Out' : `▼${f}`
  return 'Same'
}

/** What the board says about it in one sentence. */
export function boardLine(b: BoardBrand, saved: number): string {
  if (b.kind === 'new') return `New to the Top 100 this week, at #${b.today} today.`
  if (b.back) return `Back in the Top 100 after ${b.gap} saved day${b.gap === 1 ? '' : 's'} out, at #${b.today} today.`
  if (b.kind === 'up' && b.move != null) return `Up ${b.move} place${b.move === 1 ? '' : 's'} this week, from #${b.then} to #${b.today}.`
  if (b.kind === 'out') return b.lastIn ? `Out of the Top 100 today. In it on ${b.daysIn} of ${saved} saved days, best #${b.best}.` : 'Not in the Top 100 on a saved day.'
  return `In the Top 100 on ${b.daysIn} of ${saved} saved days, best #${b.best}${b.ones ? `, #1 on ${b.ones}` : ''}.`
}

/** Why to contact it: the board's line, then up to two of MVP's good reasons. */
export function whyLine(b: BoardBrand, saved: number, reasons: PickReason[] | null | undefined): string {
  const good = (reasons || []).filter((r) => r.tone === 'good' && !/Top 100/i.test(r.text)).slice(0, 2).map((r) => `${r.text.replace(/[.\s]+$/, '')}.`)
  return [boardLine(b, saved), ...good].join(' ')
}

/** Statuses that mean you already asked the brand, or it is on its way. */
export const ASKED = ['drafted', 'sending', 'sent', 'already'] as const
export const askedOf = (status: string | null | undefined) => !!status && (ASKED as readonly string[]).includes(status)
/** Statuses that take a brand off "worth contacting" for you. */
const DONE = ['drafted', 'sending', 'sent', 'already', 'skipped', 'removed', 'not_fit']

export type FitWord = 'strong' | 'look' | 'skip' | 'unknown'

/** Rising this week: new to the Top 100, back after a gap, or up 10 places or more. */
export const risingOf = (b: BoardBrand) => inTop(b.today) && (b.kind === 'new' || b.back || (b.kind === 'up' && (b.move ?? 0) >= 10))

/** Worth contacting this week: rising, a fit for you, not asked yet. Strong
 *  picks first, then brands in your niche, then the biggest moves. A brand
 *  whose fit is not read yet is left out, never guessed. */
export function worthContacting(board: Board, fitOf: (id: string) => FitWord | null, statusOf: (id: string) => string | null, n = 5, nicheOf?: (id: string) => boolean): BoardBrand[] {
  const rankFit = (f: FitWord | null) => (f === 'strong' ? 0 : f === 'look' ? 1 : 2)
  const niche = (id: string) => (nicheOf && nicheOf(id) ? 0 : 1)
  const lift = (b: BoardBrand) => (b.kind === 'new' || b.back ? 40 : b.move ?? 0)
  return board.brands
    .filter((b) => risingOf(b) && !DONE.includes(statusOf(b.id) || ''))
    .filter((b) => { const f = fitOf(b.id); return f === 'strong' || f === 'look' })
    .sort((a, b) => rankFit(fitOf(a.id)) - rankFit(fitOf(b.id)) || niche(a.id) - niche(b.id) || lift(b) - lift(a) || (a.today ?? 999) - (b.today ?? 999))
    .slice(0, n)
}

/** The 30 day line for a sparkline: higher is a better place, 0 when out. */
export function sparkOf(b: BoardBrand, w: number, h: number): string {
  const n = b.places.length
  if (!n) return ''
  return b.places.map((p, i) => {
    const x = n === 1 ? w / 2 : (i * w) / (n - 1)
    const y = h - 1 - (pointsFor(p) / 100) * (h - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
