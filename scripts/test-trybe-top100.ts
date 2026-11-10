// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MY TOP 100 (Seb, 2026-11-05): "an all-encompassing button that if a user
// presses on it, MVP goes and searches the top 100 brands on TRYBE that would
// fit that particular user. Brands that they are not familiar with... make
// sure that these brands actually do have ad spend, any type of ad spend in
// the past 60 days, and also that they actually send samples."
//
// Pinned here: what counts as proof of ad spend and of samples, that a brand
// the creator already knows never makes the list, that every brand left out
// is counted by why, and that the page says what MVP read and left out.
import { readFileSync } from 'node:fs'
import { TOP100, SAMPLE_WAIT_DAYS, adSpendProof, samplesProof, sampleSignsByBrand, pushesOf, cleanProfile, readTop100Ask, activityDigest, activityCounts, catalogSamples, readCatalogSamples, CATALOG_READS_MAX, CATALOG_NAMES_MAX, CATALOG_REFRESH_CHUNK } from '../lib/trybe-top100'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const none = { metaCount: null, metaOwn: false, top100Hits: null, newVideos: null, days: null, tierUp: null }

// ── AD SPEND, ON META (Seb, 2026-11-06: "the ad spend can be measured as long
// as we see that they're spending money on meta ads. That's pretty simple.")
check('Meta ads running, the brand\'s own, prove ad spend, and say how many', (() => { const v = adSpendProof({ ...none, metaCount: 12, metaOwn: true }); return v.proven && /12 Meta ads running/.test(v.says.join()) })())
check('TRYBE\'s own signs are added to the words, never enough alone', (() => {
  const v = adSpendProof({ ...none, metaCount: 3, metaOwn: true, top100Hits: 2, newVideos: 9, days: 30, tierUp: true })
  return v.proven && /Top 100/.test(v.says.join()) && /9 creator videos approved in 30 days/.test(v.says.join()) && /payout tier/.test(v.says.join())
    && !adSpendProof({ ...none, top100Hits: 2, newVideos: 9, days: 30, tierUp: true }).proven
})())
check('no Meta count yet: to be counted, never left out for it', (() => { const v = adSpendProof(none); return !v.proven && v.why === 'notCounted' })())
check('a count that is not the brand\'s own (a common word) proves nothing', (() => { const v = adSpendProof({ ...none, metaCount: 500, metaOwn: false }); return !v.proven && v.why === 'unclear' })())
check('no Meta ads running is out', (() => { const v = adSpendProof({ ...none, metaCount: 0, metaOwn: true }); return !v.proven && v.why === 'noAds' })())

// ── SAMPLES ──────────────────────────────────────────────────────────────────
const sp = (trybe: boolean | null, received: number, waitingLong: number) => samplesProof({ trybe, received, waitingLong })

// ── SAMPLES FROM THE BRAND'S PRODUCT LIST ON TRYBE (Seb's run, 2026-11-06:
// 147 of 164 left out because TRYBE's brand list does not say) ──────────────
{
  // As TRYBE's public product list answers (read live, 2026-11-06).
  const live = { success: true, data: [
    { title: 'Protein Hydrator', isActive: true, allowSamples: true },
    { title: 'Creatine Stick Packs (30 Count)', isActive: true, allowSamples: true },
    { title: 'Old Flavour', isActive: false, allowSamples: true },
    { title: 'Gift Card', isActive: true, allowSamples: false },
    { title: 'No word', isActive: true },
  ] }
  const c = catalogSamples(live)
  check('a product list counts active products, and only an explicit yes as open to samples', c.open === 2 && c.total === 4)
  check('an empty or odd answer counts nothing', catalogSamples({ success: true, data: [] }).total === 0 && catalogSamples(null).total === 0 && catalogSamples('x').total === 0)
  const open = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: c })
  check('a brand TRYBE\'s list does not flag, with products open to samples, passes and says how many', open.ok && !open.proven && /2 of its 4 products on TRYBE take sample requests/.test(open.says))
  const shut = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: { open: 0, total: 3 } })
  check('one whose products all refuse samples is left out as not taking them', !shut.ok && shut.why === 'off' && /none of its 3 products/.test(shut.says))
  const none = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: { open: 0, total: 0 } })
  check('one with no products on TRYBE is left out for that, never a yes and never "does not say"', !none.ok && none.why === 'none' && /lists no products on TRYBE/.test(none.says))
  // APPS ARE IN (Seb, 2026-11-06): nothing to ship, so no sample to wait for.
  const app = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: { open: 0, total: 0 }, digital: true })
  check('an app or online service passes, marked as an app, not as proven', app.ok && app.app === true && !app.proven && /an app or online service: nothing to ship/.test(app.says))
  const appNoRead = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: null, digital: true })
  check('an app passes without its product list read', appNoRead.ok && appNoRead.app === true)
  const appMissing = samplesProof({ trybe: null, received: 0, waitingLong: 2, products: null, digital: true })
  check('an app MVP creators asked and heard nothing from is still left out', !appMissing.ok && appMissing.why === 'missing')
  const physical = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: { open: 0, total: 0 }, digital: false })
  check('a physical brand with no products is not let in as an app', !physical.ok && physical.why === 'none')
  check('a product list not read is still not known', (() => { const u = samplesProof({ trybe: null, received: 0, waitingLong: 0, products: null }); return !u.ok && u.why === 'unknown' })())
  check('TRYBE\'s own flag and MVP creators still come first', !samplesProof({ trybe: false, received: 0, waitingLong: 0, products: c }).ok && samplesProof({ trybe: null, received: 1, waitingLong: 0, products: { open: 0, total: 3 } }).ok && !samplesProof({ trybe: null, received: 0, waitingLong: 1, products: c }).ok)
  check('a kept count reads back, a broken one does not', readCatalogSamples({ open: 2, total: 4 })?.open === 2 && readCatalogSamples({ open: 5, total: 4 }) === null && readCatalogSamples('x') === null)
  check('a ranking reads at most a few hundred product lists', CATALOG_READS_MAX > 0 && CATALOG_READS_MAX <= 400)
  // EVERY BRAND'S PRODUCTS, IN THE DAILY REFRESH (Seb, 2026-11-06).
  check('a product list keeps its active products\' names, once each, and they read back', (c.names || []).length > 0 && !(c.names || []).some((n, i, a) => a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) !== i)
    && JSON.stringify(readCatalogSamples({ open: 1, total: 2, names: ['Towel', 3, ''] })?.names) === '["Towel"]' && readCatalogSamples({ open: 1, total: 2 })?.names === undefined)
  check('names are kept to a short list', catalogSamples({ data: Array.from({ length: 60 }, (_, i) => ({ title: `P${i}`, isActive: true })) }).names?.length === CATALOG_NAMES_MAX)
}
check('MVP creators who got one prove it, whatever else', (() => { const v = sp(null, 3, 1); return v.ok && v.proven && /sent samples to 3 MVP creators/.test(v.says) })())
check('MVP creators who asked long ago and got nothing put it out', (() => { const v = sp(true, 0, 2); return !v.ok && v.why === 'missing' })())
check('TRYBE saying it takes no sample requests puts it out', (() => { const v = sp(false, 0, 0); return !v.ok && v.why === 'off' })())
check('TRYBE saying it takes them keeps it, marked as not yet proven by MVP creators', (() => { const v = sp(true, 0, 0); return v.ok && !v.proven && /no MVP creator has had one yet/.test(v.says) })())
check('nothing said either way puts it out', (() => { const v = sp(null, 0, 0); return !v.ok && v.why === 'unknown' })())
{
  const now = Date.parse('2026-11-05T12:00:00Z')
  const m = sampleSignsByBrand([
    { brand_id: 'a', requested_at: '2026-10-01T00:00:00Z', received_at: '2026-10-08T00:00:00Z' },
    { brand_id: 'a', requested_at: new Date(now - (SAMPLE_WAIT_DAYS + 1) * DAY).toISOString(), received_at: null },
    { brand_id: 'b', requested_at: new Date(now - (SAMPLE_WAIT_DAYS - 1) * DAY).toISOString(), received_at: null },
    { brand_id: null, requested_at: '2026-10-01T00:00:00Z', received_at: null },
  ], now)
  check('each brand\'s samples are counted: got, and waiting past three weeks', m.get('a')?.received === 1 && m.get('a')?.waitingLong === 1 && m.get('b')?.waitingLong === 0 && m.size === 2)
}

// ── THE CREATOR'S WORK ───────────────────────────────────────────────────────
check('social pushes are counted from the counts per network', pushesOf({ facebook: 2, threads: 1, x: { a: 1 } }) === 4 && pushesOf(3) === 3 && pushesOf(null) === 0)
{
  const p = cleanProfile({ summary: 'You review outdoor gear — mostly tents', categories: ['outdoors & camping', 'Nonsense', 'Pets'], keywords: ['Tent!', 'sleeping bag', 'ab', 'tent'] }, ['Outdoors & Camping', 'Pets', 'Beauty'])
  check('only TRYBE\'s own categories are kept, in TRYBE\'s spelling', JSON.stringify(p.categories) === JSON.stringify(['Outdoors & Camping', 'Pets']))
  check('product words are short, clean and once each', JSON.stringify(p.keywords) === JSON.stringify(['tent', 'sleeping bag']))
  check('the summary has no dashes', !/[–—]/.test(p.summary))
}
check('a top 100 search with nothing to search by is not one', readTop100Ask({ categories: [], keywords: [] }) === null && readTop100Ask(null) === null && readTop100Ask({ keywords: ['tent'], joined: ['x'] })?.joined.has('x') === true)
{
  const a = { posts: [{ title: 'Quiet post', pushes: 0 }, { title: 'Big post', pushes: 5 }], worksWith: [{ name: 'Acme', submitted: 3, earnings: 120 }], messaged: [], samples: [{ brand: 'Acme', product: 'Tent' }] }
  const d = activityDigest(a)
  check('the most pushed posts are read first', d.indexOf('Big post') < d.indexOf('Quiet post') && /pushed to social 5x/.test(d))
  check('what was read is counted for the page', JSON.stringify(activityCounts(a)) === JSON.stringify({ posts: 2, pushed: 1, worksWith: 1, submitted: 1, messaged: 0, samples: 1 }))
}
check('it is a hundred', TOP100 === 100)

// ── THE SEARCH ───────────────────────────────────────────────────────────────
const R = read('app/api/labs/trybe/route.ts')
check('the work is read by the strongest model, with a held answer shape, counted', /const TOP100_MODEL = 'claude-opus-5-5'/.test(R) && /if \(action === 'top100_profile'\)/.test(R) && /feature: 'trybe_top100_profile'/.test(R) && /required: \['summary', 'categories', 'keywords'\]/.test(R))
check('it is held to the member\'s AI spend allowance', /if \(action === 'top100_profile'\) \{\s*const spend = await spendGate\(userId, tier\)/.test(R))
check('blog posts, social pushes, messages, TRYBE brands and samples are all read', /select\('title, seo_keyword, affiliate_keywords, social_publish_counts'\)/.test(R) && /from\('trybe_brands'\)\.select\('brand_id, status'\)/.test(R) && /body\.myBrands/.test(R) && /from\('trybe_samples'\)\.select\('brand_name, product'\)/.test(R))
check('nothing to read is said, not guessed', /MVP has nothing of yours to read yet/.test(R))
check('the profile stands in for the typed niches, a hundred over a wide pool', /const top100 = readTop100Ask\(body\.top100\)/.test(R) && /const want = top100 \? TOP100/.test(R) && /const pool = top100 \? 2400 :/.test(R))
check('the page\'s filters do not apply to it', /const filters = nameOnly \|\| top100 \? readFilters\(null\) : asked/.test(R))
check('a brand the creator knows never makes it: on their list, joined, or sampled', /const isKnown = \(id: string\) => mineBy\.has\(id\) \|\| top100\.joined\.has\(id\) \|\| sampledMine\.has\(id\)/.test(R) && /if \(isKnown\(id\)\) \{ leftOut\.known\+\+; continue \}/.test(R))
check('no Meta ads, or a count not its own, no place, each counted', /else if \(spend\.why === 'unclear'\) leftOut\.metaUnclear\+\+/.test(R) && /else leftOut\.noMetaAds\+\+/.test(R))
check('not counted on Meta yet: handed to the page to count, best fits first', /if \(spend\.why === 'notCounted'\) \{ leftOut\.notCounted\+\+; toCount\.push\(x\) \}/.test(R) && /toCount\.sort\(\(a, b\) => fitOf\(b\) - fitOf\(a\)\)/.test(R) && /toCount: toCount\.slice\(0, 300\)/.test(R))
{
  const at = R.indexOf("if (action === 'catalog_refresh') {")
  const block = R.slice(at, R.indexOf("if (action === 'daily_refresh') {"))
  const L = read('lib/trybe-catalog-refresh.ts')
  check('the daily refresh reads every listed brand\'s products, team only, from MVP\'s server, gently', at > 0
    && /if \(tier !== 'admin'\)/.test(block) && /refreshCatalogs\(admin, \{ chunk: CATALOG_REFRESH_CHUNK, budgetMs: 45_000, workers: 4/.test(block)
    && /\.is\('left_at', null\)/.test(L) && /\.gte\('updated_at', since\)/.test(L) && /todo\.slice\(0, o\.chunk\)/.test(L) && CATALOG_REFRESH_CHUNK > 0 && CATALOG_REFRESH_CHUNK <= 1000)
  check('TRYBE asking to slow down stops every reader at once, and is said', /res\.status === 429 \|\| res\.status === 403\) \{ halt = true/.test(L) && /refused: stats\.refused > 0/.test(L) && !/async function readSampleCatalogs/.test(R))
  const C = read('app/api/cron/trybe-products/route.ts')
  const crons = (JSON.parse(read('vercel.json')).crons || []) as Array<{ path: string; schedule: string }>
  check('the overnight job reads products whether or not anyone is at a computer, a few passes each early morning', /Bearer \$\{secret\}/.test(C) && /refreshCatalogs\(admin/.test(C) && /if \(r\.refused\) \{ sum\.refused = true; break \}/.test(C)
    && /key: 'products_overnight'/.test(C) && crons.some((c) => c.path === '/api/cron/trybe-products' && c.schedule === '5,35 7-9 * * *'))
  check('product names on TRYBE help tell what a brand sells', /catalogBy\.get\(String\(x\.r\.brand_id\)\)\?\.names/.test(R))
  const O = read('components/labs/TrybeOutreach.tsx')
  check('Products on TRYBE is its own step, after the brand list and before Meta ads, and says what it did',
    O.indexOf("{ id: 'list', label:") < O.indexOf("{ id: 'products', label: 'Products on TRYBE'") && O.indexOf("{ id: 'products', label: 'Products on TRYBE'") < O.indexOf("{ id: 'meta', label: 'Meta ads'")
    && /api\(\{ action: 'catalog_refresh' \}, \{ retry: true \}\)/.test(O) && /TRYBE asked MVP to slow down/.test(O) && /could not be read this time/.test(O))
}
check('samples are checked before Meta, so no brand is counted that would be left out anyway', R.indexOf("const sm = samplesProof({ trybe: statsBy.get(id)?.samples") < R.indexOf('const spend = adSpendProof({'))
check('samples off, missing, or not said: no place, each counted', /else leftOut\[sm\.why === 'off' \? 'samplesOff' : sm\.why === 'missing' \? 'samplesMissing' : 'samplesUnknown'\]\+\+/.test(R))
check('no products on TRYBE is its own count, said on the page', /else if \(sm\.why === 'none'\) leftOut\.samplesNone\+\+/.test(R) && /list no products on TRYBE to ask a sample of/.test(read('components/labs/TrybeOutreach.tsx')))
check('apps are told to the page, counted, and need no product list read', /digital: digitalOf\(id\)/.test(R) && /if \(isKnown\(id\) \|\| digitalOf\(id\)\) return false/.test(R) && /app: !!sm\.app/.test(R) && /apps: kept\.slice\(0, TOP100\)\.filter\(k => k\.app\)\.length/.test(R))
{
  const O = read('components/labs/TrybeOutreach.tsx'), T = read('components/labs/TrybeBrandTable.tsx'), UI = read('components/labs/trybe-ui.tsx')
  check('apps show apart at a glance: blue card, blue row, and a chip in words', /export const APP = \{ color: '#2563EB'/.test(UI) && /export function AppChip/.test(UI)
    && /b\.proof\?\.app \? APP\.line/.test(O) && /\{b\.proof\?\.app && <AppChip \/>\}/.test(O) && /shown in blue: nothing to ship/.test(O)
    && /isApp \? APP\.soft/.test(T) && /inset 3px 0 0 \$\{APP\.color\}/.test(T) && /App, none needed/.test(T))
}
check('samples are read from every MVP creator\'s records, not only this one', /from\('trybe_samples'\)\.select\('brand_id, requested_at, received_at'\)\.in\('brand_id'/.test(R))
check('fit first, quality next, proven samples last', /0\.6 \* \(x\.match \/ maxMatch\) \+ 0\.3 \* /.test(R) && /\(b\.proven \? 0\.1 : 0\)/.test(R))
check('each brand carries its proof, and the reply its left-out counts', /proof: proofBy\.get\(r\.brand_id\) \?\? null/.test(R) && /top100: top100Out,/.test(R))

// ── THE PAGE ─────────────────────────────────────────────────────────────────
const U = read('components/labs/TrybeOutreach.tsx')
check('one button runs it', /onClick=\{\(\) => void runTop100\(\)\}/.test(U) && /My top 100/.test(U))
check('the TRYBE brands they work with are read through SCOUT, and a failed read is said', /stats\?period=\$\{period\}/.test(U) && /await stats\('all'\)/.test(U) && /could not leave those brands out/.test(U))
check('a full list that timed out falls back to the last 30 days, then the list read last time, each said', /await stats\('30d'\)/.test(U) && /localStorage\.setItem\(KEPT/.test(U) && /you worked with in the last 30 days/.test(U) && /it read on \$\{new Date\(kept\.at\)\.toLocaleDateString\(\)\}/.test(U))
check('the list is searched with the profile', /top100: \{ categories: top100\.profile\.categories, keywords: top100\.profile\.keywords, joined: top100\.joined \}/.test(U))
check('what MVP read, looked for and left out is said', /MVP read \{read \|\| 'what you have'\}/.test(U) && /Left out of \{t\?\.considered\.toLocaleString\(\)\} that fit you/.test(U))
check('a list under 100 says why, never padded', /MVP never pads it with brands it cannot vouch for/.test(U))
check('tick all, then the usual Write messages', /Tick all \{free\.length\}/.test(U) && /Write \{livePick\.size\} message/.test(U))
check('each brand says its ad spend and samples', /Ad spend: \{b\.proof\.spend\.join\(', '\)\}/.test(U) && /Samples: \{b\.proof\.samples\}/.test(U))
check('back to the usual search', /Back to my search/.test(U))
check('the brands not counted on Meta are counted by SCOUT, a round at a time, until 100 pass', /for \(let round = 0; round < META_ROUNDS_MAX; round\+\+\)/.test(U) && /if \(!t \|\| t\.kept >= TOP100 \|\| top100Stop\.current \|\| leftRef\.current\) break/.test(U) && /await readMetaAds\(batch\.map/.test(U))
check('the count can be stopped, showing the list as it stands', /Stop and show what I have/.test(U))
check('a count SCOUT could not make is said, not guessed', /Meta ads: \$\{metaNote\}/.test(U))
check('a ranking that did not come back is said, never the usual search under a "Your top" heading', /if \(!t\) \{/.test(U) && /Your top 100 did not come back/.test(U) && /The list below is your usual search, not your top 100/.test(U))
check('the usual search waits while My top 100 ranks, so the two never race', /if \(!hasDirectory \|\| top100Busy\) return/.test(U))
check('what was read says when it was only the latest', /postsCapped: posts\.length >= 300/.test(R) && /your latest /.test(U))
check('brands TRYBE\'s list does not flag are read from TRYBE\'s public product list, best fits first, kept a week', /jointrybe\.com\/backend\/api\/public\/brand\/\$\{encodeURIComponent\(id\)\}\/products/.test(read('lib/trybe-catalog-refresh.ts')) && /readSampleCatalogs\(toRead\.slice\(0, CATALOG_READS_MAX\)/.test(R) && /key: `samples:\$\{id\}`/.test(R) && /\.sort\(\(a, b\) => b\.match - a\.match\)/.test(R))
check('a product list not read in time is counted apart and read on the next round, never a no', /leftOut\.samplesNotRead\+\+/.test(R) && /samplesToRead,/.test(R) && /if \(!t\.toCount\?\.length\) \{ if \(moreSamples\) continue; break \}/.test(U) && /not checked for samples yet/.test(U))
check('Find brands\' Sends samples filter and every brand card use the product lists too, read live when the filter is on', /stats: statsWith\(x\.r\.brand_id\), earningsBucket/.test(R) && /\.map\(x => String\(x\.r\.brand_id\)\), filters\.samples === true\)/.test(R) && /stats: statsBy\.has\(r\.brand_id\) \? statsWith\(r\.brand_id\) : null/.test(R))
check('a product list that could not be kept is logged, not swallowed', /if \(ke\) console\.warn\('\[trybe\] product lists not kept:'/.test(R))
check('the panel says how the brands that fit were found', /funnel: \{ found: searched\.got, listed: rows\.length, fit: matchedAll\.length \}/.test(R) && /MVP's search of TRYBE found/.test(U))
check('an empty top 100 never says the brand list is empty', /No brand passed every check for your top 100 yet/.test(U))
check('the page says the rule in its words: running Meta ads', /is running Meta ads, and sends samples/.test(U) && /running no Meta ads/.test(U) && /not checked on Meta yet/.test(U))

if (fails.length) {
  console.error(`\n❌ trybe-top100: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-top100: 100 TRYBE brands new to the creator, from their own work, each proven on ad spend and samples, and what was left out said')
