// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE day by day, members together, and what's working (Seb, 2026-10-13,
// after looking at TrybeDaily).

import { readFileSync } from 'node:fs'
import { directoryChanges, adsChange, poolBrands, changeLine, POOL_MIN } from '../lib/trybe-changes'
import { readTopEntries, hookType, hookCounts, openingLine, middleHalf } from '../lib/trybe-working'
import { checkHook } from '../lib/trybe-hook'
import { pickScore, creatorProgramOf } from '../lib/trybe-pick'
import { planWeek, perDayNeeded, MONTHLY_TARGET } from '../lib/trybe-week'
import { VIDEO_PLAN_SYSTEM } from '../lib/trybe-playbook'
import { readPromotedProducts, briefFetchUrl, briefFromBody } from '../lib/trybe-brand-page'

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

// 4. Lukas Pakter's playbook (TRYBE's co-founder, Seb 2026-10-13: "do all 4")
{
  const vp = VIDEO_PLAN_SYSTEM('')
  check('video ideas talk to the viewer, never look like an ad, and name a background that pops', /WRITE FOR THE VIEWER/.test(vp) && /IT MUST NOT LOOK LIKE AN AD/.test(vp) && /THE BACKGROUND SELLS/.test(vp))

  const DAY = 86_400_000
  const now = Date.parse('2026-10-13T12:00:00')
  check('30 a month: the videos a day still needed this month', MONTHLY_TARGET === 30 && perDayNeeded({ brand: 'A', sent: 11, target: 30 }, now) === 1 && perDayNeeded({ brand: 'A', sent: 0, target: 60 }, now) === 4 && perDayNeeded({ brand: 'A', sent: 30, target: 30 }, now) === 0)
  const wk = planWeek([], { perDay: 1, now, dayName: (_t, i) => `D${i}`, pace: [{ brand: 'Oink', sent: 11, target: 30 }, { brand: 'Done', sent: 31, target: 30 }] })
  check('the week gets a filming task a day for a focus brand behind its target, none for one at it', wk.every((d) => d.tasks.some((t) => t.kind === 'volume' && /Oink \(11 of 30 sent this month\)/.test(t.text))) && !wk.some((d) => d.tasks.some((t) => /Done/.test(t.text))))
  const endOfMonth = planWeek([], { perDay: 1, now: Date.parse('2026-10-29T12:00:00'), dayName: (_t, i) => `D${i}`, pace: [{ brand: 'Oink', sent: 0, target: 30 }] })
  check('the pace stops at the end of the month', endOfMonth[0].tasks.length === 1 && endOfMonth[6].tasks.length === 0 && /Film 10 videos/.test(endOfMonth[0].tasks[0].text))
  void DAY

  const p = creatorProgramOf('We pay monthly retainers to our top creators, run weekly creator calls and have a Discord.')
  check('a brand\'s own words say retainers, coaching and a Discord', p.retainer && p.coaching && p.discord && !creatorProgramOf('Premium cotton tees.').retainer)
  const good = pickScore({ totalCreators: 30, metaAds: null, top100Hits: null, tiktokShop: null, commissionPct: 12, program: p })
  const low = pickScore({ totalCreators: 30, metaAds: null, top100Hits: null, tiktokShop: null, commissionPct: 3, program: null })
  check('Best bets ranks up 10% or more and a brand that invests, down a low commission', good.score > low.score && good.reasons.some((r) => /Pays 12% of sales/.test(r.text)) && good.reasons.some((r) => /retainers/.test(r.text)) && good.reasons.some((r) => /Discord/.test(r.text)) && low.reasons.some((r) => r.tone === 'bad' && /3% of sales/.test(r.text)))

  const greet = checkHook('Hey guys, so today I want to show you my favourite shirt.')
  check('a greeting opening is flagged', greet.notes.some((n) => n.tone === 'bad' && /greeting/.test(n.text)))
  const me = checkHook('I love wearing this to the gym. I wear it every day and I think it is my favourite. My friends love it.')
  check('an "I" opening is flagged, with the counts', me.notes.some((n) => /about you \(I, me, my\)/.test(n.text)) && me.iCount >= 4 && me.youCount === 0)
  const ad = checkHook('Introducing the new Oink vest, link in bio.', 'Oink')
  check('an ad-like opening and the brand in the first line are flagged', ad.notes.some((n) => n.tone === 'bad' && /sounds like an ad/.test(n.text)) && ad.notes.some((n) => /Oink is named in the first line/.test(n.text)))
  const clean = checkHook('If you hate a hot gym, you need to feel this fabric.')
  check('a clean opening says so', clean.ok && clean.notes.length === 1 && clean.notes[0].tone === 'good')
  check('a long first sentence is flagged', checkHook('This is the shirt that you will want to wear every single day of the week because it is just so very comfortable and cool.').notes.some((n) => /words\. Hooks that stop the scroll/.test(n.text)))
  const r = read('app/api/labs/trybe/route.ts')
  check('new openings are checked by the same rules before they are offered', /action === 'hook_fix'/.test(r) && /const kept = lines\.filter\(l => !checkHook\(l, brandName\)/.test(r) && /commissionPct: readPay\(r\.pay_text\)\.percent/.test(r))
  const ui = read('components/labs/TrybeOutreach.tsx')
  check('the hook check is on What\'s working, and Best bets shows up to 6 reasons', /tab === 'working' && <TrybeHookCheck \/>/.test(ui) && /slice\(0, 6\)\.map\(r =>/.test(ui))
  const wkUi = read('components/labs/TrybeWeek.tsx')
  check('This week shows the month per focus brand, read from TRYBE, and says when it could not', /Your month/.test(wkUi) && /readBrandSubs\(id\)/.test(wkUi) && /could not read: /.test(wkUi) && /planWeek\(samples, \{ perDay, pace \}\)/.test(wkUi))
}

// 5. The product on hand, the brief openable, every tab in sight (Seb, 2026-10-13)
{
  const pr = readPromotedProducts({ data: { brand: { name: 'Audien', promoteThese: [{ id: 'p1', name: 'Audien Clarity (TikTok)', imageUrl: 'https://x/c.png', price: 49 }, { product: { title: 'Atom Air' } }, 'Ion Series', { name: 'Audien Clarity (TikTok)' }] } } })
  check('the products a brand promotes are read, with picture and price, each once', pr.length === 3 && pr[0].name === 'Audien Clarity (TikTok)' && pr[0].image === 'https://x/c.png' && pr[0].price === '$49' && pr[1].name === 'Atom Air' && pr[2].name === 'Ion Series')
  check('no products is an empty list, not a guess', readPromotedProducts({ data: { name: 'X' } }).length === 0)
  check('a Google Doc brief is read as plain text', briefFetchUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit') === 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=txt')
  const html = briefFromBody('text/html', '<html><style>x{}</style><h2>The Story</h2><p>Everything about the Atom Air is light. The fit. The price.</p><ul><li>Audien Atom Air &amp; more</li></ul></html>')
  check('an HTML brief becomes its words', !!html.text && /Everything about the Atom Air is light/.test(html.text) && /- Audien Atom Air & more/.test(html.text) && !/<|x\{\}/.test(html.text))
  check('a PDF or an empty page says why, never pretends', /PDF/.test(briefFromBody('application/pdf', '').why || '') && /almost no words/.test(briefFromBody('text/html', '<div></div>').why || ''))
  const r = read('app/api/labs/trybe/route.ts')
  check('MVP opens a brief link with every redirect checked', /action === 'brief_read'/.test(r) && /redirect: 'manual'/.test(r) && /assertPublicHttpUrl\(next\)/.test(r))
  check('the plan is about the product on hand', /THE PRODUCT ON HAND: \$\{product\}/.test(r))
  const vi = read('components/labs/TrybeVideoIdeas.tsx')
  check('planning starts by picking the product you have, with the brief to read and open', /Which product do you have on hand\?/.test(vi) && /Open the brief document/.test(vi) && /Creative Brief is on that page/.test(vi) && /makePlan\(\(other\.trim\(\) \|\| chosen\)/.test(vi))
  const ui = read('components/labs/TrybeOutreach.tsx')
  check('every tab is in sight: they wrap, never scroll sideways', /<div className="flex flex-wrap gap-x-1">/.test(ui) && !/min-w-max/.test(ui))
}

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
