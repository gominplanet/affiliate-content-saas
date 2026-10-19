// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DEALS HUB FILE IS READ IN THE BROWSER, A PIECE AT A TIME, AND NEVER
// UPLOADED (Seb, 2026-10-19: a 500 MB file from the Deals Hub). This holds the
// reader to it: rows cut across pieces come out whole, the columns are found
// whatever Amazon calls them, times are read in the right zone, the pool stays
// small, and the page sends MVP only the deals picked, each scheduled for its
// own start.

import { readFileSync } from 'node:fs'
import { CsvStream, mapColumns, readDeal, parseDealTime, toPct, asinFrom, DealPool, filterDeals, dealScore, MAX_PER_BATCH, type HubDeal } from '../lib/deals-hub-file'
import { hubSchedule, HUB_MAX_BATCH } from '../lib/deals-hub-socials'
import { knownDealLive } from '../lib/deal-quick-post'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

// ── CSV in pieces ───────────────────────────────────────────────────────────
{
  const csv = '﻿ASIN,Title,Start Time\r\nB0ABCDEF12,"Quest 3S, 128GB ""Bundle""",11/20/2026 4:00 AM PST\r\nB0ABCDEF13,"Two\nlines",2026-11-19 04:00:00\r\n\r\nB0ABCDEF14,Plain,2026-11-21T12:00:00Z'
  const whole = new CsvStream(); const a = [...whole.push(csv), ...whole.end()]
  check('a whole file reads as its rows, BOM and blank line dropped', a.length === 4 && a[0][0] === 'ASIN' && a[1][1] === 'Quest 3S, 128GB "Bundle"' && a[2][1] === 'Two\nlines' && a[3][2] === '2026-11-21T12:00:00Z', JSON.stringify(a))
  // Every possible cut point gives the same rows.
  let same = true
  for (let cut = 1; cut < csv.length; cut++) {
    const s = new CsvStream(); const b = [...s.push(csv.slice(0, cut)), ...s.push(csv.slice(cut)), ...s.end()]
    if (JSON.stringify(b) !== JSON.stringify(a)) { same = false; break }
  }
  check('a row cut between two pieces comes out the same, wherever the cut falls', same)
  // One character at a time, the hardest case.
  const s = new CsvStream(); const c: string[][] = []
  for (const ch of csv) c.push(...s.push(ch))
  c.push(...s.end())
  check('one character at a time gives the same rows', JSON.stringify(c) === JSON.stringify(a))
  const tabs = new CsvStream(); const t = [...tabs.push('ASIN\tStart Time\nB0ABCDEF12\t2026-11-20 04:00\n'), ...tabs.end()]
  check('a tab separated file is read too', t.length === 2 && t[1][0] === 'B0ABCDEF12')
  let threw = false
  try { const u = new CsvStream(); u.push('a,b\n"never closed,'); u.end() } catch { threw = true }
  check('a quote that never closes is an error, not a silent empty file', threw)
}

// ── the columns, whatever they are called ───────────────────────────────────
{
  const cc = mapColumns(['asin', 'asin_name', 'asin_url', 'star_rating', 'deal_start_datetime', 'deal_end_datetime', 'category_description', 'subcategory_description', 'deal_price', 'vrp', 'lowest_price_ytd', 'discount_pct', 'promotion_type', 'brand'])
  check('the Creator Connections file from June maps every column', cc.missing.length === 0 && cc.at.startsAt === 4 && cc.at.listPrice === 9 && cc.at.category === 6 && cc.at.subcategory === 7 && cc.at.title === 1, JSON.stringify(cc))
  const hub = mapColumns(['ASIN', 'Product Name', 'Category', 'Subcategory', 'Commission Rate', 'Deal Price', 'List Price', 'Discount', 'Deal Start Time (PST)', 'Deal End Time (PST)', 'Lowest Price YTD', 'Deal Type'])
  check('Deals Hub style headers map, with the time zone in the header', hub.missing.length === 0 && hub.at.commissionPct === 4 && hub.at.dealPrice === 5 && hub.at.listPrice === 6 && hub.at.startsAt === 8 && hub.at.endsAt === 9 && hub.at.lowestYtd === 10 && hub.tzHint === 'PST', JSON.stringify(hub))
  const linkOnly = mapColumns(['Product URL', 'Start Date'])
  check('a file with only a product link still has its ASIN', linkOnly.missing.length === 0)
  const none = mapColumns(['Foo', 'Bar'])
  check('a file without an ASIN or a start time says so', none.missing.includes('asin') && none.missing.includes('startsAt'))
  check('one column is never two fields', (() => { const m = mapColumns(['Price', 'Deal Price']); return m.at.dealPrice === 1 })())
}

// ── times, prices, ASINs ────────────────────────────────────────────────────
{
  check('a time with its zone', parseDealTime('11/20/2026 4:00 AM AST') === Date.UTC(2026, 10, 20, 8, 0))
  check('a time with no zone is US Pacific, standard time in November', parseDealTime('2026-11-20 04:00:00') === Date.UTC(2026, 10, 20, 12, 0))
  check('and daylight time in July', parseDealTime('2026-07-08 03:00') === Date.UTC(2026, 6, 8, 10, 0))
  check('the header zone is used when the cell has none', parseDealTime('11/19/2026 4:00 AM', 'EST') === Date.UTC(2026, 10, 19, 9, 0))
  check('ISO with Z, an offset, 12 PM and 12 AM', parseDealTime('2026-12-01T03:59:00Z') === Date.UTC(2026, 11, 1, 3, 59) && parseDealTime('2026-11-20 04:00 -08:00') === Date.UTC(2026, 10, 20, 12, 0)
    && parseDealTime('11/20/2026 12:00 PM UTC') === Date.UTC(2026, 10, 20, 12, 0) && parseDealTime('11/20/2026 12:30 AM UTC') === Date.UTC(2026, 10, 20, 0, 30))
  check('a time it cannot read is null, never a wrong date', parseDealTime('next Tuesday') === null && parseDealTime('11/20/2026 4:00 AM XYZ') === null && parseDealTime('') === null)
  check('percentages written three ways', toPct('15%') === 15 && toPct('15') === 15 && toPct('0.15') === 15 && toPct('1.00%') === 1 && toPct('') === null)
  check('an ASIN from its column or from the link', asinFrom('b0abcdef12', '') === 'B0ABCDEF12' && asinFrom('', 'https://www.amazon.com/dp/B0ABCDEF12?tag=x') === 'B0ABCDEF12' && asinFrom('nope', '') === null)
}

// ── a row as a deal ─────────────────────────────────────────────────────────
{
  const map = mapColumns(['ASIN', 'Product Name', 'Category', 'Deal Price', 'List Price', 'Commission Rate', 'Start Time', 'End Time', 'Lowest Price YTD'])
  const r = readDeal(['B0ABCDEF12', 'Nex Playground', 'Video Games', '$209.99', '$299.00', '1.00%', '11/19/2026 4:00 AM AST', '12/01/2026 3:59 AM AST', '$234.99'], map)
  const d = 'deal' in r ? r.deal : null
  check('a row reads as its deal: prices, discount worked out, commission, times, below the year’s low',
    !!d && d.dealPrice === 209.99 && d.listPrice === 299 && d.discountPct === 30 && d.commissionPct === 1 && d.startsAt === Date.UTC(2026, 10, 19, 8, 0) && d.endsAt === Date.UTC(2026, 11, 1, 7, 59) && d.belowYtd, JSON.stringify(r))
  check('a row with no start time is skipped and counted, not dated today', 'skip' in readDeal(['B0ABCDEF12', 'X', 'Y', '', '', '', 'soon', '', ''], map))
}

// ── the pool stays small ────────────────────────────────────────────────────
{
  const mk = (i: number, cat: string, pct: number): HubDeal => ({ asin: `B0${String(i).padStart(8, '0')}`, title: `P${i}`, url: null, image: null, category: cat, subcategory: null, brand: null, dealPrice: 10, listPrice: 20, discountPct: pct, commissionPct: 1, startsAt: 1, endsAt: null, lowestYtd: null, dealType: null, rating: 4.5, reviews: 100, primeOnly: false, belowYtd: false })
  const pool = new DealPool(50)
  for (let i = 0; i < 20_000; i++) pool.add(mk(i, i % 2 ? 'Toys' : 'Kitchen', i % 97))
  const kept = pool.deals()
  check('twenty thousand deals keep fifty per category, the best ones, and every deal is still counted',
    kept.length === 100 && pool.counts.get('Toys') === 10_000 && kept.every((d) => (d.discountPct ?? 0) >= 90), `${kept.length}`)
  const now = Date.UTC(2026, 10, 1)
  const ended = { ...mk(1, 'Toys', 50), endsAt: now - 1 }
  const upcoming = { ...mk(2, 'Toys', 40), startsAt: now + 86_400_000 }
  const live = { ...mk(3, 'Toys', 60), startsAt: now - 1 }
  const f = filterDeals([ended, upcoming, live], { when: 'any' }, 'discount', now)
  check('an ended deal is never shown, and the sort is by discount', f.length === 2 && f[0].asin === live.asin)
  check('upcoming only and live only', filterDeals([upcoming, live], { when: 'upcoming' }, 'best', now)[0].asin === upcoming.asin && filterDeals([upcoming, live], { when: 'live' }, 'best', now)[0].asin === live.asin)
  check('a better discount scores higher', dealScore(mk(1, 'X', 40)) > dealScore(mk(1, 'X', 10)))
}

// ── the page: in the browser, never uploaded, one picked deal at a time ─────
{
  const UI = readFileSync('components/deals/DealsHubImport.tsx', 'utf8')
  check('the file is read in the browser in pieces', /file\.stream\(\)\.getReader\(\)/.test(UI) && /new TextDecoder\(\)/.test(UI) && /new CsvStream\(\)/.test(UI))
  check('the file itself is never sent anywhere', !/FormData/.test(UI) && !/body: file/.test(UI))
  check('each picked deal is one deal post, scheduled for its own start, with its own prices and end', /fetch\('\/api\/deals'/.test(UI) && /dealStartsAt: new Date\(d\.startsAt( as number)?\)\.toISOString\(\)/.test(UI) && /scheduledAt/.test(UI) && /manualDealEnd/.test(UI) && /dealPrices:/.test(UI))
  check('a batch is capped', MAX_PER_BATCH <= 25 && /MAX_PER_BATCH/.test(UI))
  check('a file it cannot read lists the columns it found', /Columns in your file:/.test(UI))
  check('a batch stops when the monthly posts run out, and says so', /limit_reached|quota/.test(UI))
  const ROUTE = readFileSync('app/api/deals/route.ts', 'utf8')
  check('the deals route takes the deal prices from the member’s own file', /dealPrices\?: \{ sale\?: number; was\?: number; pct\?: number \}/.test(ROUTE) && /fileDealPrices\(body\.dealPrices\)/.test(ROUTE))
  const PAGE = readFileSync('app/(dashboard)/deals/page.tsx', 'utf8')
  check('the importer is behind Labs while it is tested', /canUsePreview\('deals_import', tier\)/.test(PAGE) && /<DealsHubImport/.test(PAGE))
}

// ── social first (Seb, 2026-10-19: "we should really focus on social media
// pushes from there. So Pinterest, Facebook, Instagram") ────────────────────
{
  const now = Date.UTC(2026, 10, 1, 12)
  const bf = new Date(Date.UTC(2026, 10, 20, 12)).toISOString()
  const end = new Date(Date.UTC(2026, 11, 1, 8)).toISOString()
  const deal = (asin: string, startsAt: string, endsAt: string | null = end) => ({ asin, title: asin, startsAt, endsAt })
  const plan = hubSchedule([deal('B0AAAAAAA1', bf), deal('B0AAAAAAA2', bf), deal('B0AAAAAAA3', bf)], 15, now)
  const at = plan.scheduled.map((x) => Date.parse(x.at))
  check('deals that start together go out at the start, then fifteen minutes apart', at.length === 3 && at[0] === Date.parse(bf) && at[1] - at[0] === 15 * 60_000 && at[2] - at[1] === 15 * 60_000, JSON.stringify(plan))
  const live = hubSchedule([deal('B0AAAAAAA4', new Date(now - 86_400_000).toISOString())], 15, now)
  check('a deal already live goes out two minutes from now, never in the past', Date.parse(live.scheduled[0].at) === now + 120_000)
  const ended = hubSchedule([deal('B0AAAAAAA5', new Date(now - 2 * 86_400_000).toISOString(), new Date(now - 1000).toISOString())], 15, now)
  check('an ended deal is not queued, and says so', !ended.scheduled.length && /already ended/.test(ended.skipped[0]?.reason || ''))
  const tight = hubSchedule([deal('B0AAAAAAA6', bf, new Date(Date.parse(bf) + 20 * 60_000).toISOString()), deal('B0AAAAAAA7', bf, new Date(Date.parse(bf) + 20 * 60_000).toISOString())], 15, now)
  check('a deal whose turn would come after it ends is not queued, and says why', tight.scheduled.length === 1 && /after the deal ends/.test(tight.skipped[0]?.reason || ''))
  check('a deal picked twice is queued once', hubSchedule([deal('B0AAAAAAA8', bf), deal('B0AAAAAAA8', bf)], 15, now).scheduled.length === 1)
  check('a social batch is capped too', HUB_MAX_BATCH <= 30)
  check('live by the file\'s own window: not before it starts, not after it ends',
    !knownDealLive({ startsAt: bf, endsAt: end }, Date.parse(bf) - 5 * 60_000) && knownDealLive({ startsAt: bf, endsAt: end }, Date.parse(bf)) && !knownDealLive({ startsAt: bf, endsAt: end }, Date.parse(end)))

  const QP = readFileSync('lib/deal-quick-post.ts', 'utf8')
  check('a scheduled Deals Hub deal is posted by its own window, not skipped for being off Deal Radar',
    /if \(requireLiveDeal && !knownDealLive\(known\)\) return/.test(QP) && QP.indexOf('const known = input.knownDeal') < QP.indexOf("if (!deal) {\n    // Scheduled posts"))
  const CRON = readFileSync('app/api/cron/process-deal-schedules/route.ts', 'utf8')
  check('the cron passes the file\'s deal, and says whether it ended or had not started', /knownDeal: row\.deal_known \?\? null/.test(CRON) && /The deal ended on Amazon/.test(CRON) && /had not started on Amazon/.test(CRON))
  const ROUTE = readFileSync('app/api/deals/hub-socials/route.ts', 'utf8')
  check('the queue is Deal Radar\'s own, each row carrying the file\'s deal', /from\('deal_scheduled_posts'\)\.insert\(rows\)/.test(ROUTE) && /deal_known: \{/.test(ROUTE) && /hubSchedule\(deals, intervalMins\)/.test(ROUTE))
  check('a missing migration 445 says so instead of a generic error', /migration 445/.test(ROUTE))
  check('the daily spam cap applies', /DAILY_SCHEDULE_CAP = 50/.test(ROUTE))
  check('it is Labs only on the server too', /canUsePreview\('deals_import', tier\)/.test(ROUTE))
  check('only a post not yet sent can be cancelled', /\.eq\('status', 'pending'\)\.select\('id'\)/.test(ROUTE))
  check('migration 445 is safe to run twice', /add column if not exists deal_known jsonb/.test(readFileSync('supabase/migrations/445_deal_known.sql', 'utf8')))
  const UI = readFileSync('components/deals/DealsHubImport.tsx', 'utf8')
  check('social is the main action, blog posts the second', /Post \$\{picked\.size \|\| ''\} deal/.test(UI) && /Write blog posts instead/.test(UI) && UI.indexOf('scheduleSocials()}') < UI.indexOf('writePosts()}'))
  check('what happened to each queued post is shown: posted, failed with why, or not sent', /Your Deals Hub social posts/.test(UI) && /q\.error_message/.test(UI) && /Not posted on/.test(UI))
}

if (failures.length) {
  console.error(`\n❌ deals-hub-file: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ deals-hub-file: read in the browser a piece at a time, every column found or named, the best deals kept, each post scheduled for its deal')
