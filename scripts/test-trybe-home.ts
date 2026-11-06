// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TRYBE HOME (Seb, 2026-11-06: "I would like to wake up ... and see a
// different Tribe feature happening"). Pinned: days are counted in the right
// buckets, a week is compared with the week before, Meta ads movers are only
// brands that grew, pay raises and cuts are told apart from the figures, the
// pay index reads the market kind by kind and leaves out what it cannot read,
// and the home and its menu are the new TRYBE's, team only.
import { readFileSync } from 'node:fs'
import { dailySeries, windowTotals, adsMovers, payFigures, payMoves, payIndex, type ChangeRow } from '../lib/trybe-home'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 6, 12)
const at = (d: number) => new Date(NOW - d * DAY).toISOString()
const C = (brand_id: string, kind: string, before: string | null, after: string | null, d: number): ChangeRow => ({ brand_id, kind, before, after, at: at(d) })

{
  const s = dailySeries([C('a', 'new', null, null, 0), C('b', 'new', null, null, 0), C('c', 'new', null, null, 2), C('d', 'left', null, null, 1), C('e', 'new', null, null, 40)], ['new', 'left'], 30, NOW)
  check('each day in its own bucket, today last, outside the window left out', s.new.length === 30 && s.new[29] === 2 && s.new[27] === 1 && s.new.reduce((a, b) => a + b, 0) === 3 && s.left[28] === 1)
  const w = windowTotals([...Array(16).fill(0), 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2], 7)
  check('this week next to the week before', w.now === 14 && w.before === 7)
}
{
  const ch = [C('a', 'ads', '10', '20', 10), C('a', 'ads', '20', '45', 3), C('b', 'ads', '30', '12', 2), C('c', 'ads', '0', '8', 1), C('d', 'ads', '1', '90', 20)]
  const m = adsMovers(ch, 14, NOW)
  check('movers grow from their first count in the window to their last', m[0].brand_id === 'a' && m[0].from === 10 && m[0].to === 45 && m[0].gain === 35)
  check('a brand whose ads fell is not a mover, and one outside the window is not counted', !m.some((x) => x.brand_id === 'b') && !m.some((x) => x.brand_id === 'd'))
  check('a brand that started advertising counts from zero', m.find((x) => x.brand_id === 'c')?.gain === 8)
}
{
  check('pay figures read from TRYBE\'s words', JSON.stringify(payFigures('Videos: 6% of sales + $5 per approved post + 5% of ad spend')) === JSON.stringify({ flat: 5, gmv: 6, adSpend: 5, kinds: ['gmv', 'flat', 'adSpend'] }))
  const p = payMoves([C('a', 'pay', '$25 per approved video', '$45 per approved video', 1), C('b', 'pay', '20% of sales', '10% of sales', 2), C('c', 'pay', '12% of sales', '12% of sales on bundles only', 3), C('z', 'pay', '$1', '$2', 30)], 14, NOW)
  check('a raise, a cut and a change told apart from the figures', p.find((x) => x.brand_id === 'a')?.dir === 'up' && p.find((x) => x.brand_id === 'a')?.delta === '$25 to $45 a video' && p.find((x) => x.brand_id === 'b')?.dir === 'down' && p.find((x) => x.brand_id === 'c')?.dir === 'changed')
  check('newest first, and only the window', p[0].brand_id === 'a' && !p.some((x) => x.brand_id === 'z'))
}
{
  const ix = payIndex(['$40 per approved video', '$60 per approved video + 5% of ad spend', '10% of sales', '15% of sales', '12% of sales', null, 'call us', '900% of sales'])
  check('every kind of pay, how many brands, the middle and the typical range', ix.rows[0].kind === 'gmv' && ix.rows[0].brands === 3 && ix.rows[0].median === 12 && ix.rows.find((r) => r.kind === 'flat')?.median === 60)
  check('pay MVP cannot read is counted apart, an implausible figure kept out of the range', ix.brands === 8 && ix.read === 5 && ix.rows[0].brands === 3)
  check('flat fees spread across bands', ix.flatBands.find((b) => b.label === '$25 to $50')?.n === 1 && ix.flatBands.find((b) => b.label === '$50 to $100')?.n === 1)
}

const R = read('app/api/labs/trybe/route.ts')
check('one action counts the home, shared by every member and kept 20 minutes', /if \(action === 'home'\)/.test(R) && /const HOME_KEY = 'home_v1'/.test(R) && /< 20 \* 60_000/.test(R))
check('the pay index reads every listed brand and is kept 12 hours', /key: 'pay_index'/.test(R) && /< 12 \* 3_600_000/.test(R))
const U = read('components/labs/TrybeOutreach.tsx')
check('the new TRYBE opens on its home, with the new menu, and drops the old numbers row', /useState<Tab>\(preview \? 'find' : v2 \? 'home' : 'create'\)/.test(U) && /\? <TrybeNav tab=\{tab\}/.test(U) && /\{!preview && !v2 && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">/.test(U))
check('members keep the page they know', /: <TrybeMenu tab=\{tab\}/.test(U) && /\{tab === 'home' && v2 && <TrybeHome/.test(U))
const H = read('components/labs/TrybeHome.tsx')
check('every brand on the home opens its page', (H.match(/<BrandName id=/g) || []).length >= 4)
check('a count that failed says so, with a way to try again', /MVP could not count this week/.test(H) && /Try again/.test(H))
check('each section says the window it covers', /Last 14 days/.test(H) && /Last 7 days next to the 7 before/.test(H))

if (fails.length) {
  console.error(`\n❌ trybe-home: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-home: the TRYBE home counts what moved on TRYBE, week on week, from MVP\'s own copy, and every brand opens its page')
