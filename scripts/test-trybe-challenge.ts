// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The challenge tracker, from the owner's NOBL bounty: 300 approved videos by
// November 30 for $10,000, which is $33.33 a video. On November 20: 57
// approved, 8 turned down, 32 waiting, and NOBL takes about 3 days to decide,
// so the real last day to send is November 27, not November 30.

import { readFileSync, existsSync } from 'node:fs'
import { readChallenge, readChallenges, daysUntil, dayOf, STATE_WORDS, type Challenge, type ChallengeSub } from '../lib/trybe-challenge'
import { FREE_ACTIONS } from '../lib/trybe-free'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const DAY = 86_400_000
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime()
const NOW = at('2026-11-20')
const nobl: Challenge = { id: 'nobl-2026-11-30', brandId: 'nobl', brand: 'NOBL', target: 300, deadline: '2026-11-30', startsOn: '2026-11-01', reward: 10000 }

// 57 approved, sent November 1 to 12, each decided 3 days later; 8 turned down
// in the same days; 32 waiting, sent in the last 4 days.
const subs: ChallengeSub[] = []
for (let i = 0; i < 57; i++) { const t = at('2026-11-01') + (i % 12) * DAY; subs.push({ status: 'approved', at: t, decidedAt: t + 3 * DAY }) }
for (let i = 0; i < 8; i++) { const t = at('2026-11-02') + i * DAY; subs.push({ status: 'rejected', at: t, decidedAt: t + 3 * DAY }) }
for (let i = 0; i < 32; i++) subs.push({ status: 'pending', at: NOW - ((i % 4) + 0.5) * DAY })

const r = readChallenge(nobl, subs, NOW)
check('counts what TRYBE says: 57 approved, 32 waiting, 8 turned down', r.approved === 57 && r.pending === 32 && r.rejected === 8 && r.sent === 97)
check('the approval rate is from the brand’s own answers: 57 of 65', r.approvalRate != null && r.approvalRate.toFixed(3) === (57 / 65).toFixed(3))
check('NOBL takes 3 days to decide, from its decisions and what waits now', r.lagDays === 3 && r.lagFrom === 'both')
check('the real cutoff is November 27, not November 30', r.cutoff === '2026-11-27' && r.daysToCutoff === 8 && r.daysLeft === 11)
check('about 28 of the 32 waiting will likely count', Math.round(r.likelyFromQueue) === 28)
check('246 more videos to send by the cutoff, 31 a day', r.toSend === 246 && r.perDay != null && Math.ceil(r.perDay) === 31)
check('the last 7 days ran at 4.6 a day, so it is behind', r.pace7.toFixed(1) === '4.6' && r.state === 'behind' && STATE_WORDS[r.state] === 'Behind')
check('the reward pays $33.33 a video if hit', r.perVideoIfHit != null && r.perVideoIfHit.toFixed(2) === '33.33')
check('it says the cutoff in plain words', r.says.some((x) => x.startsWith('NOBL takes about 3 days to decide') && x.includes('Send by Nov 27, not Nov 30')))
check('it says the pace needed against the pace you have', r.says.some((x) => x === 'To reach 300 you need about 246 more videos by Nov 27: 31 a day. Your last 7 days: 4.6 a day.'))
check('it says what waits and how much of it will count', r.says[0] === '57 of 300 approved. 32 waiting; at your approval rate of 88%, about 28 of those will count.')
check('it says the reward per video', r.says.some((x) => x === 'If you hit it: $10,000 for 300 approved, $33.33 a video on top of what each one earns.'))
check('no dashes in what it says', !/[–—]|\s-\s/.test(r.says.join(' ')))

// On track: the same challenge at a pace that gets there.
const busy = [...subs, ...Array.from({ length: 250 }, (_, i) => ({ status: 'pending' as const, at: NOW - (i % 7) * DAY - 3600_000 }))]
const rb = readChallenge(nobl, busy, NOW)
check('sending fast enough is on track', rb.state === 'on_track')

// Only the window counts.
const outside: ChallengeSub[] = [...subs, { status: 'approved', at: at('2026-10-20') }, { status: 'approved', at: at('2026-12-02') }]
check('videos sent before the start or after the last day do not count', readChallenge(nobl, outside, NOW).approved === 57)

// Reached.
const hit = Array.from({ length: 300 }, (_, i): ChallengeSub => ({ status: 'approved', at: at('2026-11-02') + (i % 15) * DAY, decidedAt: at('2026-11-04') + (i % 15) * DAY }))
const rh = readChallenge(nobl, hit, NOW)
check('300 approved is reached, and says the reward', rh.state === 'done' && rh.toSend === 0 && rh.says.some((x) => x.startsWith('Target reached: 300 approved. $10,000 for 300, $33.33 a video.')))

// Out of time: past the cutoff, before the deadline.
const late = readChallenge(nobl, subs, at('2026-11-29'))
check('past the cutoff with videos still needed is out of time, even before the deadline', late.state === 'out_of_time' && late.daysLeft === 2 && late.says.some((x) => x.startsWith('The last day to send was')))

// Not known stays not known, never on track.
const few: ChallengeSub[] = [{ status: 'approved', at: at('2026-11-05') }, { status: 'approved', at: at('2026-11-06') }, { status: 'pending', at: at('2026-11-19') }]
const rf = readChallenge(nobl, few, NOW)
check('under 5 answers the approval rate is not known, so how many to send is not known', rf.approvalRate === null && rf.toSend === null && rf.perDay === null && rf.state === 'unknown')
check('and it says so', rf.says.some((x) => /approval rate with it is not known yet/.test(x)))
const quiet: ChallengeSub[] = Array.from({ length: 10 }, (_, i): ChallengeSub => ({ status: i < 8 ? 'approved' : 'rejected', at: at('2026-11-05') }))
const rq = readChallenge(nobl, quiet, NOW)
check('no decision dates and nothing waiting: the lag is not known, and the state is not on track', rq.lagDays === null && rq.lagFrom === null && rq.state === 'unknown' && rq.says.some((x) => /cannot tell yet how long NOBL takes to decide/.test(x)))
check('the rate falls back to everything the brand answered when the challenge has under 5', (() => {
  const older: ChallengeSub[] = [...Array.from({ length: 6 }, (): ChallengeSub => ({ status: 'approved', at: at('2026-09-05') })), { status: 'rejected', at: at('2026-09-06') }, { status: 'pending', at: at('2026-11-18') }]
  const x = readChallenge(nobl, older, NOW)
  return x.approvalRate != null && x.approvalRate.toFixed(3) === (6 / 7).toFixed(3) && x.approved === 0
})())

// A video stuck from before the challenge does not set the lag.
const stuck: ChallengeSub[] = [...subs, ...Array.from({ length: 40 }, (): ChallengeSub => ({ status: 'pending', at: at('2026-08-01') }))]
check('old stuck videos from before the start do not push the cutoff back', readChallenge(nobl, stuck, NOW).lagDays === 3)
check('with nothing waiting from the challenge, the queue as a whole says how long', readChallenge({ ...nobl, startsOn: '2026-11-19' }, [{ status: 'pending', at: NOW - 5.2 * DAY }], NOW).lagDays === 6)

// Revisions wait too.
const rev: ChallengeSub[] = [...subs, { status: 'other', rawStatus: 'REVISION_REQUESTED', at: NOW - DAY }]
check('a video in revision is waiting, and said', (() => { const x = readChallenge(nobl, rev, NOW); return x.revision === 1 && x.says[0].includes('32 waiting and 1 in revision') })())

// Days.
check('days until counts today and stops at 0 once past', daysUntil('2026-11-20', NOW) === 1 && daysUntil('2026-11-30', NOW) === 11 && daysUntil('2026-11-19', NOW) === 0)
check('a time reads as its day', dayOf(NOW) === '2026-11-20')

// Saved challenges are checked.
const saved = readChallenges([
  nobl,
  { ...nobl, id: 'x', brandId: 'b', brand: 'B', target: 0 },
  { ...nobl, id: 'y', brandId: 'c', brand: 'C', deadline: 'soon' },
  { ...nobl, id: 'z', brandId: 'd', brand: 'D', startsOn: '2026-12-05' },
  { ...nobl, id: 'w', brandId: 'e', brand: 'E', reward: -5 },
  'junk', null,
])
check('only good challenges are kept; a bad reward is dropped, not the challenge', saved.length === 2 && saved[0].id === 'nobl-2026-11-30' && saved[1].brand === 'E' && saved[1].reward === null)
check('at most 12 are kept', readChallenges(Array.from({ length: 20 }, (_, i) => ({ ...nobl, id: `c-${i}x`, brandId: `b${i}` }))).length === 12)
check('not a list reads as none', readChallenges(null).length === 0 && readChallenges({}).length === 0)

// Wired in.
const route = read('app/api/labs/trybe/route.ts')
check('the route reads and saves challenges, checked, and names migration 471 when it is missing', /action === 'challenges'/.test(route) && /challenges: list/.test(route) && /readChallenges\(data\?\.challenges\)/.test(route) && /migration 471/.test(route))
check('TRYBE Free has it too', FREE_ACTIONS.has('challenges'))
check('migration 471 adds the column, safe to run twice', existsSync('supabase/migrations/471_trybe_challenges.sql') && /add column if not exists challenges jsonb/.test(read('supabase/migrations/471_trybe_challenges.sql')))
const ui = read('components/labs/TrybeChallenges.tsx')
check('the card reads each brand through SCOUT with enough pages for the target', /readBrandSubs\(c\.brandId, pagesFor\(c\.target\)\)/.test(ui) && /export async function readBrandSubs\(brandId: string, pages = SUB_PAGES\)/.test(read('components/labs/TrybeMyBrands.tsx')))
check('a failed read is said, never a count of zero', /Not read, so where this stands is not known/.test(ui) && /const x = loaded && !loaded\.error \? readChallenge/.test(ui))
check('a read that stopped short is said', /older ones from this challenge were not read, so the approved count may be low/.test(ui))
check('before 471 the list is kept in this browser, and the card says so', /Kept in this browser only for now/.test(ui) && /writeLocal\(next\)/.test(ui))
check('every request has a deadline', /AbortSignal\.timeout\(/.test(ui))
check('it is on TRYBE Home, under your stage', /<TrybeStage canRead=\{canMyBrands\} onGo=\{go\} \/><TrybeChallenges canRead=\{canMyBrands\} \/>/.test(read('components/labs/TrybeOutreach.tsx')))
check('no dashes in the card copy', !/[–—]/.test(ui.replace(/\/\/.*$/gm, '')))

if (failures.length) {
  console.error(`test-trybe-challenge: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-challenge: all checks passed')
