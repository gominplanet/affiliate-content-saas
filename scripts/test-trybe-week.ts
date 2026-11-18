// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The TRYBE week (Seb, 2026-10-13, after Alejandro): samples with boxes to
// tick, the brands you work with, and seven days planned from the boxes.

import { readFileSync } from 'node:fs'
import { planWeek, stageOf, brandsOf, weekText, stageCounts, weekSummary, laterDays, NEXT_STEP, UNDO_BOX, STAGE_ORDER, CHASE_DAYS, type Sample } from '../lib/trybe-week'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const DAY = 86_400_000
const now = Date.parse('2026-10-13T12:00:00Z')
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()
const s = (o: Partial<Sample> & { id: string }): Sample => ({ brand_id: null, brand_name: 'Oink', product: 'Vest', videos_planned: 3, requested_at: iso(1), received_at: null, filmed_at: null, submitted_at: null, has_ideas: false, ...o })
const names = (t: number, i: number) => `D${i}`

check('the stage is read from the boxes', stageOf(s({ id: 'a' })) === 'on_the_way' && stageOf(s({ id: 'a', received_at: iso(1) })) === 'to_film'
  && stageOf(s({ id: 'a', received_at: iso(2), filmed_at: iso(1) })) === 'to_submit' && stageOf(s({ id: 'a', submitted_at: iso(0) })) === 'done')

const week = planWeek([
  s({ id: 'old', product: 'Old vest', received_at: iso(9), has_ideas: true }),
  s({ id: 'new', product: 'New bottle', brand_name: 'Hydro', received_at: iso(1) }),
  s({ id: 'shot', product: 'Mat', received_at: iso(5), filmed_at: iso(1) }),
  s({ id: 'far', product: 'Socks', requested_at: iso(CHASE_DAYS + 2) }),
  s({ id: 'soon', product: 'Bag', requested_at: iso(2) }),
  s({ id: 'gone', product: 'Cap', received_at: iso(9), filmed_at: iso(8), submitted_at: iso(7) }),
], { perDay: 1, now, dayName: names })

const kinds = (i: number) => week[i].tasks.map((t) => `${t.kind}:${t.sampleId}`)
check('seven days, from today', week.length === 7 && week[0].date === '2026-10-13' && week[6].date === '2026-10-19')
check('the oldest sample is filmed first, and said late', kinds(0).includes('film:old') && !!week[0].tasks.find((t) => t.sampleId === 'old' && t.kind === 'film')?.late)
check('one sample a day: the next is filmed tomorrow, its ideas planned today', kinds(1).includes('film:new') && kinds(0).includes('ideas:new'))
check('a sample with ideas gets no planning task', !week.some((d) => d.tasks.some((t) => t.kind === 'ideas' && t.sampleId === 'old')))
check('filmed means submit today, and each film day is followed by its submission', kinds(0).includes('submit:shot') && kinds(1).includes('submit:old') && kinds(2).includes('submit:new'))
check('a sample asked a week ago and not here gets a message, a recent one does not', kinds(0).includes('chase:far') && !week.some((d) => d.tasks.some((t) => t.sampleId === 'soon')))
check('a submitted sample is out of the week', !week.some((d) => d.tasks.some((t) => t.sampleId === 'gone')))
check('Cole: the film task says how many videos', /Film 3 videos of Old vest for Oink/.test(week[0].tasks.find((t) => t.kind === 'film')?.text || ''))
const two = planWeek([s({ id: 'a', received_at: iso(3) }), s({ id: 'b', received_at: iso(2) }), s({ id: 'c', received_at: iso(1) })], { perDay: 2, now, dayName: names })
check('two a day puts two on the first day', two[0].tasks.filter((t) => t.kind === 'film').length === 2 && two[1].tasks.filter((t) => t.kind === 'film').length === 1)
const many = planWeek(Array.from({ length: 12 }, (_, i) => s({ id: `m${i}`, received_at: iso(12 - i) })), { perDay: 1, now, dayName: names })
check('more samples than days fill the week, and the rest are said once as next week, none dropped in silence', many.reduce((n, d) => n + d.tasks.filter((t) => t.kind === 'film' && t.sampleId).length, 0) === 7 && many[6].tasks.filter((t) => t.kind === 'film' && t.sampleId).length === 1 && many[6].tasks.some((t) => /^5 more samples on hand to film next week/.test(t.text)))
const both = planWeek([s({ id: 'o', brand_name: 'Oink', received_at: iso(2) })], { perDay: 1, now, dayName: names, pace: [{ brand: 'oink', sent: 0, target: 60 }] })
check('a day that films a focus brand counts toward its pace, never asked twice', /^Film 1 more video for oink/.test(both[0].tasks.find((t) => t.kind === 'volume')?.text || '') && both[1].tasks.some((t) => /^Film 4 videos for oink/.test(t.text)))
const b = brandsOf([s({ id: '1', brand_name: 'Oink' }), s({ id: '2', brand_name: 'oink', received_at: iso(1) }), s({ id: '3', brand_name: 'Hydro', submitted_at: iso(1) })])
check('brands are counted once each, with where their samples stand', b.length === 2 && b[0].name === 'Oink' && b[0].counts.on_the_way === 1 && b[0].counts.to_film === 1)
check('the week prints with a box per task and says an empty day', /\[ \] Film 3 videos/.test(weekText(week)) && /Nothing planned/.test(weekText(planWeek([], { perDay: 1, now, dayName: names }))))

// WHERE YOUR SAMPLES STAND (Seb, 2026-11-18: "a total mess ... harder and
// harder to understand what we've received, what we've shot")
const board = [
  s({ id: 'w1', requested_at: iso(CHASE_DAYS + 1) }), s({ id: 'w2', requested_at: iso(1) }),
  s({ id: 'h1', received_at: iso(8), videos_planned: 2 }), s({ id: 'h2', received_at: iso(1), videos_planned: 3 }),
  s({ id: 'f1', received_at: iso(4), filmed_at: iso(1), videos_planned: 4 }),
  s({ id: 'd1', received_at: iso(9), filmed_at: iso(8), submitted_at: iso(2) }), s({ id: 'd2', received_at: iso(90), filmed_at: iso(80), submitted_at: iso(70) }),
]
const c = stageCounts(board, now)
check('the stages are counted in the order a sample moves', STAGE_ORDER.join(',') === 'on_the_way,to_film,to_submit,done')
check('samples and videos per stage, late ones counted', c.on_the_way.samples === 2 && c.on_the_way.late === 1 && c.to_film.samples === 2 && c.to_film.videos === 5 && c.to_film.late === 1 && c.to_submit.samples === 1 && c.to_submit.videos === 4)
check('submitted is counted this month and in all', c.done.samples === 2 && c.done.thisMonth === 1)
check('the week in one sentence, in the order you act', weekSummary(c) === '2 samples here to film (5 videos), 1 sample filmed to submit, 2 on the way, 1 late and 1 submitted this month.')
check('an empty list and a list all submitted say so', weekSummary(stageCounts([], now)) === 'No samples yet.' && /^Every sample is submitted/.test(weekSummary(stageCounts([board[6]], now))))
check('one next step per stage, and one box back', NEXT_STEP.on_the_way.box === 'received' && NEXT_STEP.to_film.box === 'filmed' && NEXT_STEP.to_submit.box === 'submitted' && UNDO_BOX.to_film === 'received' && UNDO_BOX.done === 'submitted')
const paced = planWeek([], { perDay: 1, now, dayName: names, pace: [{ brand: 'Oink', sent: 0, target: 60 }] })
check('the monthly pace is said today, not again on each later day', paced[0].tasks.some((t) => t.kind === 'volume') && laterDays(paced).length === 6 && laterDays(paced).every((d) => !d.tasks.some((t) => t.kind === 'volume')))

// Wiring
const route = read('app/api/labs/trybe/samples/route.ts')
check('ticking a later box ticks the earlier ones, unticking clears the later ones', /order\.slice\(0, at \+ 1\)\.forEach/.test(route) && /order\.slice\(at\)\.forEach\(\(f\) => \{ patch\[f\] = null \}\)/.test(route))
check('every query is the owner\'s own', (route.match(/\.eq\('user_id', ownerId\)/g) || []).length >= 3 && /user_id: ownerId, brand_name/.test(route) && /\.eq\('user_id', g\.ownerId\)/.test(route))
check('without migration 427 it says so, never an empty list', /Samples need migration 427 in Supabase first/.test(route) && /needsMigration/.test(route) && /tier === 'admin' \? 'Samples need migration 427/.test(route))
const main = read('app/api/labs/trybe/route.ts')
check('a sample\'s ideas are planned about its product and kept on the sample', /from\('trybe_samples'\)\.update\(\{ ideas:/.test(main) && /const product = sample \? String\(sample\.product\)/.test(main))
const ui = read('components/labs/TrybeWeek.tsx')
check('the page reads the list and says when it could not', /setLoadError/.test(ui) && /Try again/.test(ui))
check('the rows are not a component made inside the page (that closed ideas mid-plan)', !/const SampleRow = /.test(ui) && /sampleRow\(r\)/.test(ui))
check('This week opens on where the samples stand, then today, then the samples, then the month, then downloads', (() => {
  const at = (re: RegExp) => ui.search(re)
  const order = [at(/weekSummary\(counts\)/), at(/STAGE_ORDER\.map\(tile\)/), at(/ Today<\/p>/), at(/ Your samples<\/p>/), at(/>Your month<\/p>/), at(/>Print and download<\/p>/)]
  return order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1]))
})())
check('each sample has one next step and an undo, not three loose boxes', /NEXT_STEP\[st\]/.test(ui) && /tick\(r, next\.box, true\)/.test(ui) && /tick\(r, undo, false\)/.test(ui) && !/type="checkbox" checked=\{on\}/.test(ui))
check('the month is one card, the goal drawn inside it', /<TrybeGoal canRead=\{canRead\} bare \/>/.test(ui) && /bare = false/.test(read('components/labs/TrybeGoal.tsx')))
check('the TRYBE page has the This week tab', /\{ id: 'week', label: 'This week'/.test(read('components/labs/TrybeOutreach.tsx')))
const mig = read('supabase/migrations/427_trybe_samples.sql')
check('migration 427 is safe to run twice', /create table if not exists public\.trybe_samples/.test(mig) && /drop policy if exists/.test(mig) && /create index if not exists/.test(mig))

if (failures.length) {
  console.error('❌ trybe week guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ trybe week guard passed')
