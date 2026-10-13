// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE day by day, members together, and what's working (Seb, 2026-10-13,
// after looking at TrybeDaily).

import { readFileSync } from 'node:fs'
import { directoryChanges, adsChange, poolBrands, changeLine, POOL_MIN } from '../lib/trybe-changes'
import { readTopEntries, hookType, hookCounts, openingLine, middleHalf } from '../lib/trybe-working'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. What changed
const prev = new Map<string, { pay_text?: string | null; left_at?: string | null }>([
  ['a', { pay_text: '10% of sales' }], ['b', { pay_text: '$50 per video', left_at: '2026-10-10T00:00:00Z' }], ['c', { pay_text: null }],
])
const ch = directoryChanges([{ brand_id: 'a', pay_text: '15% of sales' }, { brand_id: 'b', pay_text: '$50 per video' }, { brand_id: 'c', pay_text: '5%' }, { brand_id: 'n', pay_text: '$80 per video' }], prev, false)
check('a pay change is caught with before and after', ch.some((c) => c.brand_id === 'a' && c.kind === 'pay' && c.before === '10% of sales' && c.after === '15% of sales'))
check('a brand seen again after leaving is back, and unchanged pay is not a change', ch.some((c) => c.brand_id === 'b' && c.kind === 'back') && !ch.some((c) => c.brand_id === 'b' && c.kind === 'pay'))
check('pay first shown is not a change', !ch.some((c) => c.brand_id === 'c'))
check('a brand MVP never saw is new, with its pay', ch.some((c) => c.brand_id === 'n' && c.kind === 'new' && c.after === '$80 per video'))
check('nothing is new while MVP first fills its copy', !directoryChanges([{ brand_id: 'n', pay_text: null }], new Map(), true).length)
check('Meta ads: none to some, or half again and 5 more', adsChange(null, 3) && adsChange(0, 1) && adsChange(10, 15) && !adsChange(10, 14) && !adsChange(4, 6) && !adsChange(5, 0))
check('each change reads in plain words', /from 10% of sales to 15% of sales/.test(changeLine({ kind: 'pay', before: '10% of sales', after: '15% of sales' })) && /Started running Meta ads \(3 active\)/.test(changeLine({ kind: 'ads', before: '0', after: '3' })))

// 2. Members together: never one member's numbers
const row = (u: string, approved: number, rejected: number, earnings: number | null, brand = 'x') => ({ user_id: u, brand_id: brand, approved, rejected, earnings })
const four = poolBrands([row('1', 5, 5, 100), row('2', 5, 5, 100), row('3', 5, 5, 100), row('4', 5, 5, 100)]).get('x')!
check(`fewer than ${POOL_MIN} members shows nothing, and says why`, four.approvalRate == null && four.payPerApproved == null && /4 so far/.test(four.why || ''))
const five = poolBrands([row('1', 6, 4, 120), row('2', 5, 5, 100), row('3', 4, 6, 80), row('4', 5, 5, 100), row('5', 5, 5, 100)]).get('x')!
check('five members show the approval rate and pay per approved video', five.members === 5 && Math.abs((five.approvalRate ?? 0) - 0.5) < 1e-9 && Math.abs((five.payPerApproved ?? 0) - 20) < 1e-9 && five.why === null)
const big = poolBrands([row('1', 90, 10, 900), row('2', 5, 5, 50), row('3', 5, 5, 50), row('4', 5, 5, 50), row('5', 5, 5, 50)]).get('x')!
check('one member more than half of it: nothing shows', big.approvalRate == null && big.payPerApproved == null && /one member is most/.test(big.why || ''))
const noPay = poolBrands([row('1', 5, 5, null), row('2', 5, 5, null), row('3', 5, 5, null), row('4', 5, 5, null), row('5', 5, 5, null)]).get('x')!
check('approval without pay when nobody shared earnings', noPay.approvalRate != null && noPay.payPerApproved == null)

// 3. What's working
const top = readTopEntries({ data: [
  { rank: 1, submissionId: 's1', brand: { id: 'b1', name: 'Hume', logo: 'https://x/l.png' }, metadata: { thumbnailUrl: 'https://x/t.jpg', videoUrl: 'https://x/v.mp4', duration: 31 }, category: 'Fitness', creator: { name: 'Joe' } },
  { position: 2, brandName: 'Chef', durationMs: 1, duration: 42000 },
  { nothing: true },
] })
check('the Top 100 is read with brand, cover, video, category, creator and length', top.length === 2 && top[0].id === 's1' && top[0].brandName === 'Hume' && top[0].thumbnail === 'https://x/t.jpg' && top[0].video === 'https://x/v.mp4' && top[0].category === 'Fitness' && top[0].creator === 'Joe' && top[0].seconds === 31)
check('a length in milliseconds is read as seconds', top[1].seconds === 42 && top[1].rank === 2)
check('openings are sorted the way TrybeDaily counts them', hookType('These are way too expensive.') === 'other' && hookType('Are you still using this?') === 'question'
  && hookType('Top three ways to get rare cards.') === 'number' && hookType('The last thing you want to do is waste meat.') === 'viewer'
  && hookType("I'm going to explain our three fits.") === 'number' && hookType('I never thought this would work.') === 'story' && hookType('This is actually the best bottle.') === 'claim')
check('the opening line is the first sentence', openingLine('This is it. And more words after.') === 'This is it.')
const hc = hookCounts(['You need this.', 'Your skin will thank you.', 'Why is nobody talking about this?'])
check('counts are out of the openings read, most common first', hc[0].type === 'viewer' && hc[0].n === 2 && hc[0].of === 3)
check('the middle half needs 4 lengths', middleHalf([10, 20, 30]) === null && JSON.stringify(middleHalf([10, 20, 30, 40, 50])) === JSON.stringify({ low: 20, high: 40, n: 5 }))

// Wiring
const route = read('app/api/labs/trybe/route.ts')
check('changes are logged where MVP\'s copy is written: directory, tiers, left, Meta ads, Top 100', /directoryChanges\(rows, prev, !collectedBefore\)/.test(route) && /kind: 'tier'/.test(route) && /kind: 'left'/.test(route) && /adsChange\(was, n\)/.test(route) && /kind: 'top100'/.test(route) && /await logChanges\(admin, changes\)/.test(route))
check('a database without migration 428 still saves the copy', /Without migration 428 there is no left_at/.test(route) && /the copy is saved either way/.test(route))
check('a member who turned it off keeps nothing, and turning it off deletes what was kept', /if \(settings\.poolOptOut\) return NextResponse\.json\(\{ ok: true, kept: 0, optedOut: true \}\)/.test(route) && /from\('trybe_member_stats'\)\.delete\(\)\.eq\('user_id', ownerId\)/.test(route))
check('the combined numbers come only from poolBrands', /const pooled = poolBrands\(/.test(route) && !/from\('trybe_member_stats'\)\.select\('\*'\)/.test(route))
const mb = read('components/labs/TrybeMyBrands.tsx')
check('My brands sends its numbers only when included, and shows members together', /if \(!poolOptOut\) try \{ await post\(\{ action: 'my_stats'/.test(mb) && /<MembersLine/.test(mb) && /Include my results in members/.test(mb))
const page = read('components/labs/TrybeOutreach.tsx')
check('the page is called TRYBE, with What changed and What\'s working tabs', />\s*TRYBE\s*<\/h1>/.test(page) && /\{ id: 'changes', label: 'What changed'/.test(page) && /\{ id: 'working', label: 'What\\u2019s working'/.test(page))
check('the page has the Your week line and the setup check', /Your week/.test(page) && /Setup check/.test(page))
check('the menu says TRYBE', /label: 'TRYBE', gate: canUsePreview\('trybe_outreach'/.test(read('components/layout/DashboardShellV2.tsx')))
const mig = read('supabase/migrations/428_trybe_changes_and_pool.sql')
check('migration 428 is safe to run twice', !/create table (?!if not exists)/i.test(mig) && !/add column (?!if not exists)/i.test(mig) && /create index if not exists/.test(mig))

if (failures.length) {
  console.error('❌ trybe changes guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ trybe changes guard passed')
