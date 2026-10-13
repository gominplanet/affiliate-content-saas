// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The TRYBE week (Seb, 2026-10-13, after Alejandro): samples with boxes to
// tick, the brands you work with, and seven days planned from the boxes.

import { readFileSync } from 'node:fs'
import { planWeek, stageOf, brandsOf, weekText, CHASE_DAYS, type Sample } from '../lib/trybe-week'

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
check('more samples than days pile on the last day, none dropped', many.reduce((n, d) => n + d.tasks.filter((t) => t.kind === 'film').length, 0) === 12)
const b = brandsOf([s({ id: '1', brand_name: 'Oink' }), s({ id: '2', brand_name: 'oink', received_at: iso(1) }), s({ id: '3', brand_name: 'Hydro', submitted_at: iso(1) })])
check('brands are counted once each, with where their samples stand', b.length === 2 && b[0].name === 'Oink' && b[0].counts.on_the_way === 1 && b[0].counts.to_film === 1)
check('the week prints with a box per task and says an empty day', /\[ \] Film 3 videos/.test(weekText(week)) && /Nothing planned/.test(weekText(planWeek([], { perDay: 1, now, dayName: names }))))

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
check('the TRYBE page has the This week tab', /\{ id: 'week', label: 'This week'/.test(read('components/labs/TrybeOutreach.tsx')))
const mig = read('supabase/migrations/427_trybe_samples.sql')
check('migration 427 is safe to run twice', /create table if not exists public\.trybe_samples/.test(mig) && /drop policy if exists/.test(mig) && /create index if not exists/.test(mig))

if (failures.length) {
  console.error('❌ trybe week guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ trybe week guard passed')
