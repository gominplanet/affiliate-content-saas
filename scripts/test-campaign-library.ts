// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the joined-campaign library tell a creator the truth about what they took
// on, and point at the right thing to do next?
//
// The page exists because MVP accepted campaigns silently, in bulk, as a side
// effect of sending a message. Someone could finish a session joined to
// thirty-four campaigns they never chose. The list has to be honest about what
// that produced, which means the two failures below are the ones to guard.
//
// Overclaiming: a campaign is never said to have earned money. Amazon reports
// per PRODUCT, across every link the creator has anywhere, and never says which
// post sent the buyer.
//
// Scolding: a campaign Amazon gave no end date for is not urgent, is not late,
// and must never be counted as missed.
import { buildCampaignLibrary, madeInWindow, daysUntil, type JoinedCampaign, type ContentPiece } from '../lib/campaign-library'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NOW = new Date('2026-09-06T12:00:00Z')
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10)

const blog = (at: string | null = null): ContentPiece => ({ kind: 'blog', url: 'https://x/p', title: 'A post', at })

function camp(over: Partial<JoinedCampaign> = {}): JoinedCampaign {
  return {
    asin: 'B000000001', campaignId: 'c1', brand: 'Brand', product: 'A Product',
    imageUrl: null, commissionPct: 10, priceCents: 4000,
    startsAt: inDays(-30), endsAt: inDays(20),
    joinedAt: inDays(-10), messagedAt: inDays(-10), detailsUrl: null,
    content: [], earned: null, ...over,
  }
}

// ── the states, and the two a green/red view would have to lie about ────────
{
  const lib = buildCampaignLibrary([
    camp({ asin: 'B000000001', product: 'Open, nothing made' }),
    camp({ asin: 'B000000002', product: 'Made', content: [blog(inDays(-5))] }),
    camp({ asin: 'B000000003', product: 'Paid', content: [blog(inDays(-5))], earned: { clicks: 40, orders: 3, cents: 1200 } }),
    camp({ asin: 'B000000004', product: 'Closed empty', endsAt: inDays(-3) }),
  ], NOW)
  const by = (p: string) => lib.rows.find(r => r.product === p)
  check('an open campaign with nothing made is due', by('Open, nothing made')?.state === 'due', by('Open, nothing made')?.state)
  check('content published makes it made', by('Made')?.state === 'made', by('Made')?.state)
  check('content plus money makes it earning', by('Paid')?.state === 'earning', by('Paid')?.state)
  check('a closed window with nothing made is missed', by('Closed empty')?.state === 'missed', by('Closed empty')?.state)
  check('the counts add up', lib.summary.joined === 4 && lib.summary.made === 2 && lib.summary.due === 1 && lib.summary.missed === 1,
    JSON.stringify(lib.summary))
}

// ── the list is a work queue, not an inventory ──────────────────────────────
// The first row is the answer to "what do I make next", and every other order
// buries it.
{
  const lib = buildCampaignLibrary([
    camp({ asin: 'B000000009', product: 'Earning', content: [blog()], earned: { clicks: 9, orders: 2, cents: 5000 } }),
    camp({ asin: 'B000000008', product: 'Closed', endsAt: inDays(-9) }),
    camp({ asin: 'B000000007', product: 'Due in 30' }),
    camp({ asin: 'B000000006', product: 'Due in 2', endsAt: inDays(2) }),
    camp({ asin: 'B000000005', product: 'Made', content: [blog()] }),
  ], NOW)
  check('the thing to make next is first', lib.rows[0].product === 'Due in 2', lib.rows.map(r => r.product).join(' > '))
  check('the other open one is second', lib.rows[1].product === 'Due in 30', lib.rows.map(r => r.product).join(' > '))
  check('nothing that closed empty is near the top',
    lib.rows[lib.rows.length - 1].product === 'Closed', lib.rows.map(r => r.product).join(' > '))
  check('and it names that campaign in the instruction',
    /Start with Due in 2/.test(lib.doThis), lib.doThis)
  check('with the deadline attached', /2 days left/.test(lib.doThis), lib.doThis)
  check('and what one sale is worth', /\$4 a sale/.test(lib.doThis), lib.doThis)
}

// ── a campaign with no end date is not urgent, late, or missed ──────────────
// Amazon leaves the end date off often enough that reading a blank as an expiry
// would file live campaigns under regret.
{
  const lib = buildCampaignLibrary([camp({ endsAt: null })], NOW)
  check('no end date is not treated as expired', lib.rows[0].state === 'due', lib.rows[0].state)
  check('and not counted as urgent', lib.summary.urgent === 0, `${lib.summary.urgent}`)
  check('and the row says the date is missing rather than inventing one',
    /no end date/i.test(lib.rows[0].note), lib.rows[0].note)
  check('nothing claims a countdown', !/\d+ days left/.test(lib.rows[0].note), lib.rows[0].note)

  const dated = buildCampaignLibrary([camp({ endsAt: inDays(3) }), camp({ asin: 'B2', endsAt: null })], NOW)
  check('a dated campaign outranks an undated one in the queue',
    dated.rows[0].daysLeft === 3, JSON.stringify(dated.rows.map(r => r.daysLeft)))
}

// ── never say the campaign earned the money ─────────────────────────────────
// Amazon reports per product across every link the creator has anywhere. It does
// not say which post, video or storefront shelf sent the buyer.
{
  const lib = buildCampaignLibrary([
    camp({ content: [blog(inDays(-5))], earned: { clicks: 80, orders: 4, cents: 2500 } }),
  ], NOW)
  const text = `${lib.verdict} ${lib.doThis} ${lib.rows.map(r => r.note).join(' ')}`
  check('the money is credited to the product', /paid \$25 on this product/i.test(text), text)
  check('and never to the campaign or the post',
    !/(campaign|post|blog post|video) (earned|made|brought in)/i.test(text), text)
}

// ── content published after the window closed ───────────────────────────────
// The boosted rate did not apply to it, and a creator who does not know that
// will keep doing it.
{
  const late = buildCampaignLibrary([
    camp({ startsAt: inDays(-60), endsAt: inDays(-20), content: [blog(inDays(-5))] }),
  ], NOW)
  check('a late post is still content, not a miss', late.rows[0].state === 'made', late.rows[0].state)
  check('but it is flagged as outside the window', late.rows[0].madeInWindow === false, `${late.rows[0].madeInWindow}`)
  check('and the row says the boost did not apply',
    /boosted rate did not apply/i.test(late.rows[0].note), late.rows[0].note)

  const onTime = buildCampaignLibrary([
    camp({ startsAt: inDays(-60), endsAt: inDays(-20), content: [blog(inDays(-30))] }),
  ], NOW)
  check('a post inside the window is not flagged', onTime.rows[0].madeInWindow === true, `${onTime.rows[0].madeInWindow}`)
  check('and is not accused of being late',
    !/did not apply/i.test(onTime.rows[0].note), onTime.rows[0].note)

  // One post inside the window is enough, even alongside later ones.
  const mixed = camp({ startsAt: inDays(-60), endsAt: inDays(-20), content: [blog(inDays(-30)), blog(inDays(-2))] })
  check('one piece inside the window settles it', madeInWindow(mixed) === true)

  // Undated content is not assumed late.
  const undated = camp({ endsAt: inDays(-20), content: [blog(null)] })
  check('undated content is not judged either way', madeInWindow(undated) === null)
  const lib = buildCampaignLibrary([undated], NOW)
  check('and is not accused of missing the window', !/did not apply/i.test(lib.rows[0].note), lib.rows[0].note)
}

// ── an unsynced Amazon account is not an account that earned nothing ────────
{
  const unsynced = buildCampaignLibrary([camp({ content: [blog()] })], NOW)
  check('no earnings total is claimed when Amazon has never been read',
    unsynced.summary.earnedCents === null, `${unsynced.summary.earnedCents}`)
  check('and the row does not report a zero',
    !/\$0/.test(unsynced.rows[0].note), unsynced.rows[0].note)
  check('it says Amazon has reported nothing, which is the actual state',
    /Nothing from Amazon on this product yet/i.test(unsynced.rows[0].note), unsynced.rows[0].note)

  const synced = buildCampaignLibrary([
    camp({ content: [blog()], earned: { clicks: 12, orders: 0, cents: 0 } }),
  ], NOW)
  check('a synced account with no sales reports the clicks it does have',
    /12 clicks on this product so far, no sale yet/i.test(synced.rows[0].note), synced.rows[0].note)
  check('and its total is a real zero, not an absence', synced.summary.earnedCents === 0)
}

// ── the number that should change behaviour ─────────────────────────────────
// Thirty-four joined in one click, three ever made. Saying it plainly is the
// point of the page.
{
  const many = [
    ...Array.from({ length: 31 }, (_, i) => camp({ asin: `B${String(i).padStart(9, '0')}`, endsAt: inDays(10 + i) })),
    ...Array.from({ length: 3 }, (_, i) => camp({ asin: `C${String(i).padStart(9, '0')}`, content: [blog(inDays(-3))] })),
  ]
  const lib = buildCampaignLibrary(many, NOW)
  check('the split is stated, not implied by a chart',
    /joined 34 campaigns/i.test(lib.verdict) && /3 have content/i.test(lib.verdict), lib.verdict)
  check('and the reason it matters is said once',
    /pays nothing until something exists to link from/i.test(lib.doThis), lib.doThis)
}

// ── campaigns that closed empty are counted out loud ────────────────────────
{
  const lib = buildCampaignLibrary([
    camp({ asin: 'B1', endsAt: inDays(-4) }),
    camp({ asin: 'B2', endsAt: inDays(-9) }),
    camp({ asin: 'B3', endsAt: inDays(5) }),
  ], NOW)
  check('closed-empty campaigns are counted', lib.summary.missed === 2, `${lib.summary.missed}`)
  check('and named in the verdict', /2 closed before anything was made for them/i.test(lib.verdict), lib.verdict)
}

// ── nothing joined ──────────────────────────────────────────────────────────
{
  const lib = buildCampaignLibrary([], NOW)
  check('an empty library explains what joining is for', /boosted commission/i.test(lib.doThis), lib.doThis)
  check('and says messaging does not require it',
    /message any brand without joining/i.test(lib.doThis), lib.doThis)
  check('without calling the creator behind', !/should|need to|failing/i.test(lib.verdict), lib.verdict)
}

// ── a fully worked library is told so ───────────────────────────────────────
{
  const lib = buildCampaignLibrary([
    camp({ asin: 'B1', content: [blog()] }),
    camp({ asin: 'B2', content: [blog()], earned: { clicks: 3, orders: 1, cents: 900 } }),
  ], NOW)
  check('a library with content everywhere is recognised',
    /Every campaign you have joined has content/i.test(lib.verdict), lib.verdict)
  check('and is not handed a chore', /Nothing is waiting on you/i.test(lib.doThis), lib.doThis)
}

// ── the arithmetic ──────────────────────────────────────────────────────────
{
  check('days are counted in whole UTC days', daysUntil(inDays(5), NOW) === 5, `${daysUntil(inDays(5), NOW)}`)
  check('a closed window is negative', daysUntil(inDays(-2), NOW) === -2, `${daysUntil(inDays(-2), NOW)}`)
  check('a missing date is null, not zero', daysUntil(null, NOW) === null)
  check('an unparseable date is null', daysUntil('not a date', NOW) === null)

  const lib = buildCampaignLibrary([camp({ priceCents: 2999, commissionPct: 12 })], NOW)
  check('commission on one sale is worked out', lib.rows[0].perSaleCents === 360, `${lib.rows[0].perSaleCents}`)
  const half = buildCampaignLibrary([camp({ priceCents: null, commissionPct: 12 })], NOW)
  check('and is null rather than half a sum', half.rows[0].perSaleCents === null, `${half.rows[0].perSaleCents}`)
}

// ── content is described in the creator's words ─────────────────────────────
{
  const lib = buildCampaignLibrary([
    camp({ content: [blog(), { kind: 'amazon-video', url: null, title: null, at: null }, { kind: 'amazon-video', url: null, title: null, at: null }] }),
  ], NOW)
  check('every kind of content is counted and named',
    /1 blog post and 2 Amazon videos published/i.test(lib.rows[0].note), lib.rows[0].note)
  const jargon = /\b(ASIN|CPC|EPC|SKU|attribution|conversion rate)\b/
  const all = lib.rows.map(r => r.note).join(' ') + lib.verdict + lib.doThis
  check('no jargon reaches the page', !jargon.test(all), (all.match(jargon) || [])[0])
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
