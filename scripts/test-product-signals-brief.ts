// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the writer get MVP's own data, and can it ever leak a price?
//
// Two failures live here.
//
// The first is the one that made this module: MVP pays Keepa for price history,
// rank history and demand on every product it touches, and none of it reached
// the writer. A grep of services/claude and lib/blog-writer for "keepa",
// "salesRank", "priceAvg" and "monthlySold" returned nothing. The writer had the
// transcript, the listing title and the listing's own marketing bullets, which
// is why Google kept answering "I already have the listing".
//
// The second is the one that would be worse than the first. Amazon's Operating
// Agreement governs displaying prices: from the Product Advertising API, and
// refreshed or removed within 24 hours. Keepa is third-party. So no sentence
// this module produces may contain a price, ever, and that is checked here over
// every generated sentence rather than asked for in a prompt.
import { buildSignalBrief, containsPriceClaim, type KeepaFacts } from '../lib/product-signals-brief'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NOW = new Date('2026-09-17T12:00:00Z')
const fresh = '2026-09-16T12:00:00Z'
const stale = '2026-08-01T12:00:00Z'
const all = (b: ReturnType<typeof buildSignalBrief>) =>
  b.facts.map(f => f.text).join(' ') + ' ' + b.prompt

// ── the rule that makes everything else safe ────────────────────────────────
// Run over every sentence this module can produce, from a wide sweep of inputs.
{
  let leaked: string | null = null
  for (const now of [199, 999, 4999, 19999]) {
    for (const avg of [199, 999, 4999, 19999]) {
      for (const low of [99, 999, 4999]) {
        for (const rank of [12, 4200, 900000]) {
          for (const sold of [0, 60, 2000, 50000]) {
            const b = buildSignalBrief(
              { priceNowCents: now, priceAvg90Cents: avg, priceLowestCents: low,
                salesRank: rank, salesRankAvg90: 4200, salesRankCategory: 'Home & Kitchen', monthlySold: sold },
              { fetchedAt: fresh, now: NOW },
            )
            for (const f of b.facts) if (containsPriceClaim(f.text)) leaked = `${f.key}: ${f.text}`
          }
        }
      }
    }
  }
  check('no combination of inputs produces a price claim', leaked === null, leaked ?? '')
}

// ── the guard itself must actually catch things ─────────────────────────────
// A guard that never fires proves nothing about the sweep above.
{
  check('a dollar amount is caught', containsPriceClaim('It is $79 today.'))
  check('a pound amount is caught', containsPriceClaim('Just £59.99 right now.'))
  check('a bare decimal amount is caught', containsPriceClaim('Down to 24.99 this week.'))
  check('a currency code is caught', containsPriceClaim('Priced at 40 USD.'))
  check('a discount percentage is caught', containsPriceClaim('A full 30% off today.'))
  check('the word dollars is caught', containsPriceClaim('About forty dollars.'))
  check('a relative statement is NOT caught',
    !containsPriceClaim('Today it is a little below its usual price for the past three months.'))
  check('a sales rank is NOT caught',
    !containsPriceClaim('Amazon ranks it #1,234 in Home & Kitchen.'))
  check('a rank percentage move is NOT a price claim',
    !containsPriceClaim('It is selling better lately: #890 now against a 90 day average of #4,200.'))
}

// ── the signals actually say something ──────────────────────────────────────
{
  const cheap = buildSignalBrief(
    { priceNowCents: 7000, priceAvg90Cents: 10000 }, { fetchedAt: fresh, now: NOW })
  check('a genuine drop is stated', /well below/.test(all(cheap)), all(cheap))
  const dear = buildSignalBrief(
    { priceNowCents: 13000, priceAvg90Cents: 10000 }, { fetchedAt: fresh, now: NOW })
  check('and so is the opposite, which is the more useful one for a reader',
    /well above/.test(all(dear)), all(dear))
  const flat = buildSignalBrief(
    { priceNowCents: 10000, priceAvg90Cents: 10000 }, { fetchedAt: fresh, now: NOW })
  check('a normal price is called normal rather than dressed up as a deal',
    /about its usual price/.test(all(flat)), all(flat))
}

// ── a lower rank number means MORE sales ────────────────────────────────────
// Getting this backwards is the one factual error here a reader could act on:
// it would tell someone a dying product is a hit.
{
  const climbing = buildSignalBrief({ salesRank: 890, salesRankAvg90: 4200 }, { fetchedAt: fresh, now: NOW })
  check('a falling rank NUMBER is reported as selling better',
    /selling better/.test(all(climbing)), all(climbing))
  const slipping = buildSignalBrief({ salesRank: 9000, salesRankAvg90: 4200 }, { fetchedAt: fresh, now: NOW })
  check('a rising rank NUMBER is reported as selling less',
    /selling less/.test(all(slipping)), all(slipping))
  check('and the direction is explained, because it is counterintuitive',
    /lower number means more sales/.test(all(climbing)), all(climbing))
  const steady = buildSignalBrief({ salesRank: 4300, salesRankAvg90: 4200 }, { fetchedAt: fresh, now: NOW })
  check('rank noise is not called a trend',
    !/selling better|selling less/.test(all(steady)), all(steady))
}

// ── stale price data is dropped, and the drop is reported ───────────────────
{
  const b = buildSignalBrief(
    { priceNowCents: 7000, priceAvg90Cents: 10000, salesRank: 900 },
    { fetchedAt: stale, now: NOW })
  check('a stale present-tense price claim is not made',
    !/Today it is/.test(all(b)), all(b))
  check('and the reason is recorded rather than the fact quietly vanishing',
    b.dropped.some(d => d.key === 'price-vs-usual' && /days old/.test(d.reason)),
    JSON.stringify(b.dropped))
  check('while rank survives, because a rank is not a price claim',
    /Amazon ranks it/.test(all(b)), all(b))
}

// ── an unknown age is not a young one ───────────────────────────────────────
{
  const b = buildSignalBrief(
    { priceNowCents: 7000, priceAvg90Cents: 10000 }, { fetchedAt: null, now: NOW })
  check('missing freshness is treated as too old, not as fresh',
    !/Today it is/.test(all(b)), all(b))
  check('and says so', b.dropped.some(d => /unknown age/.test(d.reason)), JSON.stringify(b.dropped))
}

// ── pure history never expires ──────────────────────────────────────────────
// It was true when observed and stays true, so staleness is not a reason to
// withhold it.
{
  const b = buildSignalBrief(
    { priceAvg90Cents: 10000, priceLowestCents: 6000 }, { fetchedAt: stale, now: NOW })
  check('how much the price moves survives stale data',
    /moves a lot/.test(all(b)), all(b))
  check('and still carries no price', !containsPriceClaim(all(b)), all(b))
}

// ── missing data produces nothing, not a guess ──────────────────────────────
{
  const empty = buildSignalBrief({}, { fetchedAt: fresh, now: NOW })
  check('no data means no facts', empty.facts.length === 0)
  check('and no prompt block at all', empty.prompt === '')
  check('with the absence explained', empty.dropped.some(d => /no price history/.test(d.reason)))

  const zeros = buildSignalBrief(
    { priceNowCents: 0, priceAvg90Cents: 0, salesRank: 0, monthlySold: 0 },
    { fetchedAt: fresh, now: NOW })
  check('zeros are absence, not values', zeros.facts.length === 0, JSON.stringify(zeros.facts))

  const tinyDemand = buildSignalBrief({ monthlySold: 3 }, { fetchedAt: fresh, now: NOW })
  check('three sales is not a demand signal worth stating', tinyDemand.facts.length === 0)

  // Keepa uses negatives as sentinels for "no data" on some fields. Read as a
  // value, a negative rank renders as "#-1", which is a number a reader would
  // see and could not make sense of.
  const negatives = buildSignalBrief(
    { salesRank: -1, salesRankAvg90: -1, monthlySold: -1, priceNowCents: -1, priceAvg90Cents: -1 },
    { fetchedAt: fresh, now: NOW })
  check('a negative sentinel is absence, not a value', negatives.facts.length === 0,
    JSON.stringify(negatives.facts))
  check('and no fact ever renders a negative number',
    !/#-|-\d+ bought/.test(all(negatives)), all(negatives))
}

// ── the prompt forbids converting these into a price ────────────────────────
{
  const b = buildSignalBrief(
    { priceNowCents: 7000, priceAvg90Cents: 10000, salesRank: 900 }, { fetchedAt: fresh, now: NOW })
  check('the writer is told never to turn these into an amount',
    /Never convert these into a price/.test(b.prompt), b.prompt)
  check('and told why the live price belongs behind the link',
    /wrong the moment it changes/.test(b.prompt))
  check('and told not to list them as their own section',
    /do not give them their own section/i.test(b.prompt))
  check('the block explains why this data is the point of the page',
    /cannot see any of it/.test(b.prompt))
}

// ── the signals reach the writer at all ─────────────────────────────────────
// The original failure: MVP had this data and the prompt never saw it.
{
  const strip = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const PROMPT = strip(readFileSync(join(__dirname, '..', 'services/claude/index.ts'), 'utf8'))
  check('the comment stripper works',
    strip('  // signalBrief\nreal code').indexOf('signalBrief') === -1)
  check('the writer prompt now carries the product signals',
    /\$\{signalBlock\}/.test(PROMPT),
    'MVP paid for this data and the writer never saw a byte of it')
  check('the no-prices checklist rule is still there',
    /No specific prices, dollar amounts, or discount percentages/.test(PROMPT))

  const ROUTE = strip(readFileSync(join(__dirname, '..', 'app/api/blog/generate/route.ts'), 'utf8'))
  check('the route fetches the signals for the product being written about',
    /fetchKeepaBasicsCached\(admin, \[asinOverride\]\)/.test(ROUTE))
  check('cache-first, so a product MVP has seen before costs nothing',
    /from '@\/lib\/keepa-cache'/.test(ROUTE))
  check('the row\'s AGE is read, not assumed',
    /\.select\('fetched_at'\)/.test(ROUTE),
    'a present-tense price claim off undated data is the thing to avoid')
  check('and both reach the writer',
    /keepaFacts,\n\s+keepaFetchedAt,/.test(ROUTE))
  check('Keepa being down never blocks generation',
    /keepa signals unavailable/.test(ROUTE))
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: a price reaching a sentence. The failure that matters most.
  broke('a leaked dollar amount is caught', containsPriceClaim('It is $79 today.'))
  broke('a leaked bare amount is caught', containsPriceClaim('Down to 24.99.'))

  // Break 2: the rank direction inverted, which would call a dying product a hit.
  broke('an inverted rank trend is caught',
    /selling better/.test(all(buildSignalBrief({ salesRank: 890, salesRankAvg90: 4200 }, { fetchedAt: fresh, now: NOW })))
    && /selling less/.test(all(buildSignalBrief({ salesRank: 9000, salesRankAvg90: 4200 }, { fetchedAt: fresh, now: NOW }))))

  // Break 3: treating unknown freshness as fresh.
  broke('an unknown age treated as fresh is caught',
    !/Today it is/.test(all(buildSignalBrief({ priceNowCents: 7000, priceAvg90Cents: 10000 }, { fetchedAt: null, now: NOW }))))

  // Break 4: stale data still making a claim about today.
  broke('a stale present-tense claim is caught',
    !/Today it is/.test(all(buildSignalBrief({ priceNowCents: 7000, priceAvg90Cents: 10000 }, { fetchedAt: stale, now: NOW }))))

  // Break 5: a negative sentinel read as a value, which renders "#-1" to a reader.
  broke('a negative sentinel treated as a rank is caught',
    buildSignalBrief({ salesRank: -1, salesRankAvg90: -1 }, { fetchedAt: fresh, now: NOW }).facts.length === 0)

  // Break 6: rank noise promoted to a trend.
  broke('a 2% rank wobble called a trend is caught',
    !/selling better|selling less/.test(all(buildSignalBrief({ salesRank: 4300, salesRankAvg90: 4200 }, { fetchedAt: fresh, now: NOW }))))

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ product-signals-brief: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ product-signals-brief: the writer gets MVP\'s own data, and no path through it can state a price')
