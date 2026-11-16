// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The Top 100 board (Seb, 2026-11-16, after TrybeDaily's Top brands; layout
// D, "a little mix of everything"), worked out from the Top 100 MVP saves
// every day (lib/trybe-topdays).

import { readFileSync } from 'node:fs'
import { buildBoard, moversOf, raceOn, placesWords, moveWords, boardLine, whyLine, worthContacting, sparkOf, pointsFor, inTop, fellBy, BOARD_DAYS, type SavedDay } from '../lib/trybe-topboard'
import type { TopDayBrand } from '../lib/trybe-topdays'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const date = (i: number) => new Date(Date.UTC(2026, 9, 18 + i)).toISOString().slice(0, 10)
const dayOf = (i: number, brands: Record<string, number | null>): SavedDay => {
  const out: Record<string, TopDayBrand> = {}
  for (const [id, b] of Object.entries(brands)) if (b != null) out[id] = { v: 2, b, t10: b <= 10 ? 1 : 0 }
  return { date: date(i), day: { at: `${date(i)}T09:00:00.000Z`, entries: 120, brands: out } }
}

// 1. Points and the Top 100 itself
check('#1 earns 100 points and #100 earns 1', pointsFor(1) === 100 && pointsFor(100) === 1)
check('past #100 or off the list earns nothing', pointsFor(116) === 0 && pointsFor(null) === 0)
check('only places 1 to 100 are in the Top 100', inTop(1) && inTop(100) && !inTop(101) && !inTop(null) && !inTop(0))

// 2. A month of saved days
// steady: #3 every day, #1 on days 10 and 11.
// climber: #97 a week ago, #11 today.
// newbie: first in the Top 100 four days ago.
// faller: #28 a week ago, off the list today.
// back: in on days 0 to 15, out 16 to 25, back from day 26.
// deep: only ever past #100.
const saved: SavedDay[] = []
for (let i = 0; i < 30; i++) {
  if (i === 20) continue // a day MVP did not save
  saved.push(dayOf(i, {
    steady: i === 10 || i === 11 ? 1 : 3,
    climber: i <= 22 ? 97 : Math.max(11, 97 - (i - 22) * 13),
    newbie: i >= 26 ? 42 - (i - 26) : null,
    faller: i <= 22 ? 28 : i <= 25 ? 60 : null,
    back: i <= 15 || i >= 26 ? 50 : null,
    deep: 130,
  }))
}
// Saved twice on the last day: the later row is the one kept.
const again = dayOf(29, { steady: 2, climber: 11, newbie: 39, back: 50, deep: 130 })
again.day.at = `${date(29)}T18:00:00.000Z`
saved.push(again)
const board = buildBoard(saved.slice().reverse())
const by = (id: string) => board.brands.find((b) => b.id === id)!

check('the board stands on the saved days, oldest first', board.days.length === 29 && board.days[0] === date(0) && board.latest === date(29))
check('a day MVP did not save is counted as not saved', board.notSaved === 1)
check('the week compares with the saved day a week before the latest', board.weekDay === date(22))
check('a brand only ever past #100 is not on the board', !board.brands.some((b) => b.id === 'deep'))
check('a repeated date keeps the later read', by('steady').today === 2)
check('best score first', board.brands[0].id === 'steady')

const s = by('steady')
check('days in counts the saved days in the Top 100', s.daysIn === 29)
check('#1 days are counted', s.ones === 2 && s.best === 1)
check('the average place is over the days in', s.avg === 3)
check('a day not saved does not break a run', s.run === 29 && s.runNow === 29)
check('the score is the average points a saved day', Math.abs(s.score - Math.round(((27 * 98 + 2 * 100 - 98 + 99) / 29) * 10) / 10) < 0.05)
check('a brand in it every day is steady, not new', s.kind === 'steady' || s.kind === 'up')

const c = by('climber')
check('the climb is the places since the week day', c.then === 97 && c.today === 11 && c.move === 86 && c.kind === 'up')
check('the climb reads as places and a move', placesWords(c) === '#97 → #11' && moveWords(c) === '▲86')

const nb = by('newbie')
check('a brand first in the Top 100 this week is new', nb.kind === 'new' && moveWords(nb) === 'New' && placesWords(nb) === '#39 today')
check('new is said in words', boardLine(nb, board.days.length) === 'New to the Top 100 this week, at #39 today.')

const f = by('faller')
check('a brand off the list today is out', f.kind === 'out' && f.today === null)
check('falling off the list counts as #151', fellBy(f) === 151 - 28 && moveWords(f) === 'Out' && placesWords(f) === '#28 → off the list')

const bk = by('back')
check('back after a gap: out for saved days, then in again this week', bk.back && bk.kind === 'back' && bk.gap === 9)
check('a gap counts saved days only', bk.gap === 9)
check('back is said with the days out', boardLine(bk, 29) === 'Back in the Top 100 after 9 saved days out, at #50 today.')
check('the longest run is the first stretch', bk.run === 16 && bk.runNow === 4)

// 3. Movers
const m = moversOf(board)
check('climbers: in the Top 100 now and up since the week day', m.climbers[0]?.id === 'climber' && m.climbers.every((x) => inTop(x.today) && (x.move ?? 0) > 0))
check('drops: in the Top 100 on the week day and lower now', m.drops[0]?.id === 'faller' && !m.drops.some((x) => x.id === 'climber'))
check('new to the board: only brands new this week', m.fresh.length === 1 && m.fresh[0].id === 'newbie')

// 4. The race
const r0 = raceOn(board, 0)
const rEnd = raceOn(board, board.days.length - 1)
check('the race on the first day is that day’s points', r0[0].b.id === 'steady' && r0[0].points === 98)
check('the race adds up the month', rEnd[0].points === s.race[s.race.length - 1] && rEnd.length <= 10)
check('a brand with no points yet is not in the race', !raceOn(board, 0).some((x) => x.b.id === 'newbie'))
check('the race can be filtered', raceOn(board, 28, 10, (b) => b.id !== 'steady')[0].b.id !== 'steady')

// 5. Why to contact
const why = whyLine(c, 29, [
  { text: 'In TRYBE’s Top 100 now (#11)', tone: 'good' },
  { text: 'Only 12 creators: you share the budget with almost nobody', tone: 'good' },
  { text: 'No Meta ads running now', tone: 'bad' },
  { text: 'Pays 10% of sales: enough to make the volume worth it', tone: 'good' },
  { text: 'Sends samples', tone: 'good' },
])
check('why: the board first, then two good reasons', why === 'Up 86 places this week, from #97 to #11. Only 12 creators: you share the budget with almost nobody. Pays 10% of sales: enough to make the volume worth it.')
check('why never repeats the Top 100 or a bad reason', !/Top 100 now|No Meta/.test(why))
check('why with no reasons is the board line alone', whyLine(s, 29, null) === boardLine(s, 29))

// 6. Worth contacting
const fit: Record<string, 'strong' | 'look' | 'skip'> = { climber: 'look', newbie: 'strong', back: 'skip', steady: 'strong' }
const picks = worthContacting(board, (id) => fit[id] ?? null, () => null)
check('worth contacting: rising, new or back, and a fit', picks.map((p) => p.id).join() === 'newbie,climber')
check('a steady brand is not "this week"', !picks.some((p) => p.id === 'steady'))
check('a skip is never worth contacting', !picks.some((p) => p.id === 'back'))
check('a brand you already asked is not worth contacting again', !worthContacting(board, (id) => fit[id] ?? null, (id) => (id === 'newbie' ? 'sent' : null)).some((p) => p.id === 'newbie'))
check('a brand with no fit read is left out, not guessed', worthContacting(board, () => null, () => null).length === 0)

// 7. Sparkline
const sp = sparkOf(s, 90, 26).split(' ')
check('one point per saved day', sp.length === 29)
check('a better place sits higher', parseFloat(by('climber').places.length ? sparkOf(c, 90, 26).split(' ').pop()!.split(',')[1] : '0') < parseFloat(sparkOf(c, 90, 26).split(' ')[0].split(',')[1]))

// 8. Edges
check('no saved days: an empty board, not a crash', buildBoard([]).brands.length === 0 && buildBoard([]).latest === null)
const short = buildBoard([dayOf(0, { a: 5 }), dayOf(2, { a: 4 })])
check('under a week saved: no week day and no moves', short.weekDay === null && short.brands[0].move === null && short.brands[0].kind === 'steady')
check('under a week saved: nothing is called new', !short.brands.some((b) => b.kind === 'new'))
const old = buildBoard([dayOf(0, { a: 5 }), dayOf(40, { a: 4 })])
check('days older than the window are left out', old.days.length === 1 && BOARD_DAYS === 30)

// 8b. Each video, day by day (kept from 2026-11-16)
const vday = (i: number, s: Record<string, Array<[string, number | null]>> | null): SavedDay => {
  const brands: Record<string, TopDayBrand> = { a: { v: 2, b: 5, t10: 1 } }
  if (s) for (const [id, list] of Object.entries(s)) brands[id] = { v: list.length, b: Math.min(...list.map((x) => x[1] ?? 999)), t10: 0, s: list }
  return { date: date(i), day: { at: `${date(i)}T09:00:00.000Z`, entries: 100, brands, ...(s ? { vids: Object.values(s).flat().length } : {}) } }
}
const vb = buildBoard([
  vday(0, null), vday(1, null),
  vday(2, { a: [['x1', 5], ['x2', 40]] }),
  vday(3, { a: [['x1', 3]] }),
  vday(4, { a: [['x1', 8], ['x3', 60]] }),
])
const va = vb.brands.find((b) => b.id === 'a')!
check('only days that kept videos count a video\u2019s days', vb.clipDays === 3 && vb.clipsSince === date(2))
check('a video\u2019s days, first and last day, best place and place today', JSON.stringify(va.clips[0]) === JSON.stringify({ id: 'x1', days: 3, first: date(2), last: date(4), best: 3, today: 8 }))
check('most days first', va.clips.map((c) => c.id).join() === 'x1,x2,x3' || va.clips.map((c) => c.id).join() === 'x1,x3,x2')
check('a video not in today\u2019s list has no place today', va.clips.find((c) => c.id === 'x2')?.today === null)
check('days saved before videos were kept have no clip days', buildBoard([vday(0, null)]).clipDays === 0 && buildBoard([vday(0, null)]).clipsSince === null)
check('the board answer leaves videos to the brand page', /clips: \[\] \}\)\)/.test(read('app/api/labs/trybe/route.ts')))
const dos = read('components/labs/TrybeDossier.tsx')
check('the brand page shows each video\u2019s days, and says when none were kept yet', /Its videos, day by day/.test(dos) && /MVP keeps each video in the Top 100 from the next daily read on/.test(dos) && /clipWords\(c\)/.test(dos))

// 9. Wiring
const route = read('app/api/labs/trybe/route.ts')
check('the route reads the saved days for the board', /action === 'top_board'/.test(route) && /like\('key', 'top:%'\)/.test(route))
check('the board answer says how many days it stands on', /notSaved/.test(read('components/labs/TrybeTopBoard.tsx')))
const page = read('components/labs/TrybeTopBoard.tsx')
check('fit comes from MVP’s own pick, the same as Find brands', /action: 'browse'/.test(page) && /verdictOf\(/.test(page))
check('a brand with no fit read says so', /Not read yet/.test(page))
check('every brand opens its brand page', /<BrandName /.test(page))
check('the TRYBE link names TRYBE', /TrybeLink/.test(page))
check('the board is behind Labs until it is opened', /trybe_top_board: 'admin'|trybe_top_board: 'labs'/.test(read('lib/labs-preview.ts')))
const nav = read('components/labs/TrybeNav.tsx')
check('the board has its own page under Find brands', /label: 'Top 100', icon: Trophy, tabs: \['top100'\]/.test(nav))

const dossier = read('components/labs/TrybeDossier.tsx')
check('the brand page shows its days on the board', /<OnTheBoard ob=\{d\.onBoard\}/.test(dossier) && /Days in/.test(dossier) && /Longest run/.test(dossier) && /Back after a gap/.test(dossier))
check('a brand page whose saved days could not be read says so', /could not read the days it saved/.test(dossier))
check('a day not saved is never shown as out', /A day not saved is not a square/.test(dossier))
check('the brand page gets its board from the same saved days', /onBoard: 'error' in tb \? null/.test(route))
check('a new Top 100 read refreshes the board', /topBoardCache = null/.test(route))
check('the board is checked on the server too', /canUsePreview\('trybe_top_board', tier\)/.test(route))

if (failures.length) {
  console.error(`test-trybe-topboard: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-topboard: all checks passed')
