// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HUNTR'S FIVE AND KEIGHLY'S FOUR (Seb, 2026-10-14). Review speed from
// members' own videos, one tap lists, the best new brands, hooks winning on
// TRYBE, a verdict word; Road to 500, a 250 a month goal, "didn't run? move
// on", and a mix of big and small brands. Each says what it does not know.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSubmissions, reviewOf, reviewWords } from '../lib/trybe-mybrands'
import { poolBrands, type MemberRow } from '../lib/trybe-changes'
import { verdictOf, VERDICT_WORDS } from '../lib/trybe-pick'
import { readFilters, filterCheck, readDirStats, mixPick, mixOf, sizeOf, stageOf, sentOf, roadWords, ROAD_GOAL, FAST_REVIEW_DAYS } from '../lib/trybe-finder'
import { firstHook, readTopWords, readHooksBody, keepHooks, hooksBlock } from '../lib/trybe-hooks'
import { goalOf, MONTHLY_GOAL } from '../lib/trybe-week'
import { notRunning, NO_TOTALS, type AdVideo } from '../lib/trybe-ads'
import type { Judged, MyBrand } from '../lib/trybe-mybrands'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const D = 86_400_000
const now = Date.parse('2026-10-14T12:00:00Z')

// ── 1. Review speed ──
const subs = readSubmissions({ data: [
  { id: 's1', status: 'APPROVED', submittedAt: '2026-10-01T00:00:00Z', reviewedAt: '2026-10-03T00:00:00Z' },
  { id: 's2', status: 'REJECTED', submittedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' },
  { id: 's3', status: 'APPROVED', submittedAt: '2026-09-20T00:00:00Z', approvedAt: '2026-09-23T00:00:00Z' },
  { id: 's4', status: 'PENDING_APPROVAL', submittedAt: '2026-09-25T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z' },
] })
check('a decision time is read only for decided videos', subs[0].decidedAt === Date.parse('2026-10-03T00:00:00Z') && subs[3].decidedAt === null)
const rv = reviewOf(subs, now)
check('review speed is the middle number of days, and slow counts videos still waiting past a week', rv.days === 3 && rv.n === 3 && rv.slow === 1 && rv.recent === 4, JSON.stringify(rv))
const rows: MemberRow[] = ['a', 'b', 'c', 'd', 'e'].map((u, i) => ({ user_id: u, brand_id: 'B', approved: 4, rejected: 1, earnings: 100, review_days: 2 + i, review_n: 3, slow: 1, recent: 5 }))
const pool = poolBrands(rows).get('B')!
check('members\' review speed shows with 5 members, each counted once', pool.reviewDays === 4 && Math.abs((pool.slowShare as number) - 0.2) < 1e-9)
check('fewer than 5 members show no review speed', poolBrands(rows.slice(0, 4)).get('B')!.reviewDays == null)
check('review speed in words: fast, slow, or not shown', reviewWords({ reviewDays: 2, slowShare: 0.05 })?.tone === 'good' && /about 2 days/.test(reviewWords({ reviewDays: 2 })!.text) && reviewWords({ reviewDays: 12 })?.tone === 'bad' && reviewWords({ reviewDays: null, slowShare: null }) === null)

// ── 2. One tap lists, through the filters ──
const base = { perVideo: null, creators: 10, stats: readDirStats({}), earningsBucket: null, amazon: null, starred: false }
const f = readFilters({ spending: true, newOnly: true, fastReview: true })
check('spending, new and fast deciders filter; not read is listed after, never hidden', filterCheck({ ...base, spending: true, isNew: true, reviewDays: FAST_REVIEW_DAYS }, f).pass
  && !filterCheck({ ...base, spending: false, isNew: true, reviewDays: 2 }, f).pass && filterCheck({ ...base, spending: null, isNew: true, reviewDays: null }, f).unknown.length === 2
  && !filterCheck({ ...base, spending: true, isNew: false, reviewDays: 2 }, f).pass)
const C = read('components/labs/TrybeFinderControls.tsx')
check('the lists: Untapped, New on TRYBE, Big spenders, Fast deciders, Pays $25+', ['Untapped', 'New on TRYBE', 'Big spenders', 'Fast deciders', 'Pays $25+ a video'].every(l => C.includes(`label: '${l}'`)))

// ── 3. The best new brands ──
const R = read('app/api/labs/trybe/route.ts')
check('new brands are looked up directly, so none outside the search is missed', /if \(filters\.newOnly\) \{\s*let q = admin\.from\('trybe_directory'\)\.select\(COLS\)\.gte\('first_seen_at'/.test(R))
check('What changed opens with the best new brands, ranked by Best bets', /<TrybeBestNew scoutOpens=\{scoutOpens\}/.test(read('components/labs/TrybeChanges.tsx')) && /sort: 'picks', limit: 5, filters: \{ newOnly: true \}/.test(read('components/labs/TrybeBestNew.tsx')))
check('the Today list says how many new brands landed', /item\('trybe_new'/.test(read('lib/today-list.ts')))

// ── 4. Hooks winning on TRYBE ──
check('a hook is the first sentence, cut at a word', firstHook('[Scene 1] Stop scrolling if your back hurts. Here is why.') === 'Stop scrolling if your back hurts.' && firstHook('too short') === null && (firstHook('x '.repeat(200)) || '').length <= 160)
const tw = readTopWords({ data: [{ rank: 2, submissionId: 'sub-a', brandName: 'Glow', caption: 'I almost returned this serum until day three.' }, { rank: 1, submissionId: 'sub-b', brand: { id: 'z', name: 'Zap' } }] })
check('the Top 100\'s own words are read when it carries them', tw[0].text === 'I almost returned this serum until day three.' && tw[1].text === null && tw[1].brandName === 'Zap')
const hooks = keepHooks(readHooksBody([{ submissionId: 'a', brandName: 'Glow', rank: 3, text: 'Glow fixed my skin in a week. Then more.' }, { submissionId: 'b', brandName: 'Zap', rank: 1, text: 'Nobody tells you this about desk fans.' }, { submissionId: 'b', rank: 1, text: 'Nobody tells you this about desk fans.' }]))
check('hooks keep best rank first, once each', hooks.length === 2 && hooks[0].rank === 1)
const block = hooksBlock(hooks, 'Breezy')
check('Make videos learns the style and never names another brand', !/Glow/.test(block) && /the brand fixed my skin/.test(block) && /Never copy their words/.test(block))
check('every video plan reads them, and only an admin\'s read is kept', /\$\{hooksText \? `\\n\\n\$\{hooksText\}` : ''\}/.test(R) && /if \(action === 'top100_hooks'\) \{[\s\S]{0,300}if \(tier !== 'admin'\)/.test(R))

// ── 5. The verdict ──
check('Strong pick, Worth a look, Skip, and too little read is not a skip', verdictOf(45, 3) === 'strong' && verdictOf(20, 3) === 'look' && verdictOf(5, 3) === 'skip' && verdictOf(-30, 1) === 'unknown' && VERDICT_WORDS.unknown === 'Too little read')

// ── Keighly: Road to 500 ──
const mb = (name: string, submitted: number | null): MyBrand => ({ id: name, name, logo: null, earnings: 0, submitted, approved: 0, pending: 0, rejected: 0, enrolledAt: null, programs: [] })
const j = (b: MyBrand): Judged => ({ brand: b, verdict: 'early', why: '', rate: null, exactRate: false, perVideo: null })
check('Road to 500 counts every video sent, and not known is not 0', ROAD_GOAL === 500 && sentOf([j(mb('a', 120)), j(mb('b', 22)), j(mb('c', null))]) === 142 && sentOf([j(mb('a', null))]) === null && stageOf([j(mb('a', 120))]).sent === 120)
check('the road in words', /142 of 500 videos sent, 358 to go/.test(roadWords(142) || '') && /past 500/.test(roadWords(512) || '') && roadWords(null) === null)
check('the stage card shows it', /Road to \{ROAD_GOAL\}/.test(read('components/labs/TrybeStage.tsx')))

// ── Keighly: 250 a month ──
const g = goalOf(142)
check('the goal is 250 a month, with a weekly and batch pace', MONTHLY_GOAL === 250 && g.left === 108 && g.perWeek === 59 && g.perBatch === 20 && /142 of 250/.test(g.says) && /goal met/.test(goalOf(260).says))
check('This week shows the goal, and a failed read is said', /<TrybeGoal canRead=\{canRead\} \/>/.test(read('components/labs/TrybeWeek.tsx')) && /could not read your last 30 days/.test(read('components/labs/TrybeGoal.tsx')))

// ── Keighly: didn't run? move on ──
const v = (id: string, brand: string, impressions: number | null, earned = 0, live: boolean | null = false): AdVideo => ({ ...NO_TOTALS, id, title: null, brand, brandId: brand, thumbnail: null, live, impressions, earned })
const nr = notRunning([v('1', 'Glow', 0), v('2', 'Glow', 0), v('3', 'Glow', 900, 20), v('4', 'Zap', 0), v('5', 'Quiet', null)], 30)
check('videos with no ad results are grouped by brand; no numbers is never "did not run"', nr.length === 2 && nr[0].brand === 'Glow' && /new hook or angle/.test(nr[0].says) && /None of your 1 video for Zap ran/.test(nr[1].says) && !nr.some(x => x.brand === 'Quiet'))

// ── Keighly: a mix ──
const ranked = Array.from({ length: 20 }, (_, i) => ({ id: i, c: i < 14 ? 300 : 10 }))
const picked = mixPick(ranked, 10, x => x.c)
check('each batch keeps at least 40% small brands when there are enough, in rank order', picked.length === 10 && picked.filter(x => sizeOf(x.c) === 'small').length >= 4 && picked.every((x, i, a) => i === 0 || a[i - 1].id < x.id))
check('your mix says when you ask too few small brands', /Only 0% of the brands you asked are small/.test(mixOf(Array(12).fill(300)).says || '') && mixOf([300, 10]).says === null)
check('the daily find keeps the mix', /const pick = mixPick\(scored, want/.test(R))

check('migration 431 is safe to run twice', /add column if not exists review_days/.test(read('supabase/migrations/431_trybe_review_speed.sql')))

if (failed) { console.error(`\n${failed} TRYBE Huntr/Keighly check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
