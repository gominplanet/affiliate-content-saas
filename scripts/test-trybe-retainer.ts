// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FROM SIX TRYBE STRATEGY VIDEOS (Seb, 2026-10-14: "build 1, 2, 3, and 4"):
// the retainer helper, hook rate against click rate, the sample guard, and
// the rate lock watch. Each says what it does not know, and MVP never sends
// a money ask for you.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { retainerReady, suggestAmount, retainerAsk, readRetainers, trackRetainer } from '../lib/trybe-retainer'
import { diagnose, remixOf, NO_TOTALS, type AdVideo } from '../lib/trybe-ads'
import { sampleGuard } from '../lib/trybe-week'
import { rateLockOf, payWentDown, readSubmissions } from '../lib/trybe-mybrands'
import { talksTerms, asksMoney } from '../lib/trybe-outreach'
import { pickVoice } from '../lib/trybe-voice'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const D = 86_400_000
const now = Date.parse('2026-10-14T12:00:00Z')

// ── 1. Retainers ──
check('ready: 25+ videos, 10+ approved and paid in 30 days', retainerReady({ id: 'a', name: 'Glow', submitted: 32, approved: 14, earnings: 640 }).ready
  && !retainerReady({ id: 'a', name: 'Glow', submitted: 32, approved: 14, earnings: 0 }).ready && /3 more videos/.test(retainerReady({ id: 'a', name: 'Glow', submitted: 22, approved: 14, earnings: 50 }).why)
  && !retainerReady({ id: 'a', name: 'Glow', submitted: null, approved: null, earnings: null }).ready)
check('the starting amount is 30 day pay plus a fifth, rounded up, never under $500', suggestAmount(640) === 800 && suggestAmount(100) === 500 && suggestAmount(null) === 500)
const ask = retainerAsk({ brand: 'Glow', sent30: 32, approved30: 14, amount: 800, videos: 30, kind: 'smart' })
check('the ask uses your real numbers and explains a smart retainer', /32 videos and 14 were approved/.test(ask) && /\$800 for 30 videos/.test(ask) && /top up/.test(ask) && !/[–—]/.test(ask))
check('the ask is never learned as your everyday voice', asksMoney(ask) && pickVoice([{ brand: 'Glow', text: ask, at: 1 }], []).length === 0)
check('a reply may still thank a brand for offering a retainer', !talksTerms('Thank you so much for the retainer offer, I would love to keep going!'))
check('saved retainers are read safely', readRetainers([{ brandId: 'b1', name: 'Glow', amount: 1000, videos: 30, kind: 'smart', startedAt: '2026-10-01T00:00:00Z' }, { brandId: '', amount: 5 }, 'x']).length === 1)
const r = readRetainers([{ brandId: 'b1', name: 'Glow', amount: 1000, videos: 30, kind: 'smart', startedAt: '2026-10-01T00:00:00Z' }])[0]
const tr = trackRetainer(r, { sentSince: 12, earned30: 640, now })
check('the tracker: days left, videos due and a pace, the top up so far', tr.daysLeft === 17 && tr.videosLeft === 18 && tr.perDay === 2 && tr.topUp === 360 && /top you up about \$360/.test(tr.says))
check('videos not counted are said, never 0 due', /could not count your videos/.test(trackRetainer(r, { sentSince: null, earned30: null, now }).says) && trackRetainer(r, { sentSince: null, earned30: null, now }).videosLeft === null)
check('MVP never sends the ask: copy only, and the route has no send for it', /never sends this for you/.test(read('components/labs/TrybeRetainers.tsx')) && !/sendInTrybeChat|requestTrybeSend/.test(read('components/labs/TrybeRetainers.tsx')))

// ── 2. Hook rate against click rate ──
const t = (hookRate: number | null, ctr: number | null, impressions: number | null = 5000) => ({ hookRate, ctr, impressions })
check('Colin\'s two cases: 55% hook with 0.1% clicks stops the wrong people; 28% with 1.5% wins', diagnose(t(55, 0.1)) === 'wrong_people' && diagnose(t(28, 1.5)) === 'winner')
check('a weak hook over a good body, too early, and not read', diagnose(t(12, 1.4)) === 'weak_hook' && diagnose(t(40, 2, 300)) === 'early' && diagnose(t(null, 1)) === null && diagnose(t(10, 0.2)) === 'weak')
const v = (id: string, title: string, hookRate: number, ctr: number): AdVideo => ({ ...NO_TOTALS, id, title, brand: 'Glow', brandId: 'g', thumbnail: null, live: true, hookRate, ctr, impressions: 9000 })
const remix = remixOf([v('1', 'Stop scrolling', 41, 0.6), v('2', 'Day 3 results', 18, 2.1), v('3', 'Unboxing', 22, 0.8)])
check('the remix: the best stopper\'s hook with the best clicker\'s body', !!remix && remix.hookFrom.id === '1' && remix.bodyFrom.id === '2' && /first 3 seconds of "Stop scrolling"/.test(remix.says))
check('no remix when one video is both', remixOf([v('1', 'A', 40, 2), v('2', 'B', 10, 0.5)]) === null)

// ── 3. The sample guard ──
const s = (received: boolean, filmed: boolean) => ({ received_at: received ? '2026-10-01' : null, filmed_at: filmed ? '2026-10-02' : null, submitted_at: null })
const few = sampleGuard([s(true, false), s(false, false), s(true, true)])
check('a few open samples say nothing', few.level === 'ok' && few.says === null)
const heavy = sampleGuard([...Array(6).fill(s(true, false)), ...Array(3).fill(s(false, false))])
check('5+ here and not filmed warns, with the counts', heavy.level === 'warn' && /6 samples here and not filmed, and 3 on the way/.test(heavy.says || ''))
check('10+ unfilmed is sample jail', sampleGuard(Array(11).fill(s(true, false))).level === 'stop')
check('This week and Find brands show it', /<TrybeSampleGuard samples=\{rows\} \/>/.test(read('components/labs/TrybeWeek.tsx')) && /<TrybeSampleGuard onFilm=/.test(read('components/labs/TrybeOutreach.tsx')))

// ── 4. The rate lock watch ──
check('pay that went down, up, or cannot be compared', payWentDown('$50 per video', '$30 per video') === true && payWentDown('10% of GMV', '15% of GMV') === false && payWentDown('$50 per video', '12% of GMV') === null)
const subs = readSubmissions({ data: [
  { id: 'p1', status: 'PENDING_APPROVAL', submittedAt: '2026-10-02T00:00:00Z' },
  { id: 'p2', status: 'PENDING_APPROVAL', submittedAt: '2026-10-12T00:00:00Z' },
  { id: 'a1', status: 'APPROVED', submittedAt: '2026-10-01T00:00:00Z' },
] })
const lock = rateLockOf(subs, { at: '2026-10-10T00:00:00Z', before: '$50 per video', after: '$30 per video' }, now)
check('only videos sent before the change, waiting, count; the oldest sets the 30 days', lock.pending.length === 1 && lock.pending[0].id === 'p1' && lock.daysLeft === 18 && lock.lower === true)
const MB = read('components/labs/TrybeMyBrands.tsx')
check('My brands shows it with the safe nudge, and a raise is not flagged', /Pay changed while your videos wait/.test(MB) && /lock\.lower !== false/.test(MB) && /The nudge asks about the videos, never the pay/.test(MB))

check('migration 432 is safe to run twice', /add column if not exists retainers jsonb/.test(read('supabase/migrations/432_trybe_retainers.sql')))

if (failed) { console.error(`\n${failed} TRYBE retainer/guard check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
