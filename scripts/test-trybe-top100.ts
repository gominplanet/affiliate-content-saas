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
import { TOP100, SAMPLE_WAIT_DAYS, adSpendProof, samplesProof, sampleSignsByBrand, pushesOf, cleanProfile, readTop100Ask, activityDigest, activityCounts } from '../lib/trybe-top100'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const none = { metaAds: null, top100Hits: null, newVideos: null, days: null, tierUp: null }

// ── AD SPEND ─────────────────────────────────────────────────────────────────
check('Meta ads running prove ad spend, and say how many', adSpendProof({ ...none, metaAds: 12 }).proven && /12 Meta ads running/.test(adSpendProof({ ...none, metaAds: 12 }).says.join()))
check('a video in TRYBE\'s Top 100 proves it', adSpendProof({ ...none, top100Hits: 2 }).proven)
check('creator videos approved in the window prove it', adSpendProof({ ...none, newVideos: 9, days: 30 }).proven && /9 creator videos approved in 30 days/.test(adSpendProof({ ...none, newVideos: 9, days: 30 }).says.join()))
check('videos counted over more than 60 days do not', !adSpendProof({ ...none, newVideos: 9, days: 90 }).proven)
check('a payout tier that went up proves it', adSpendProof({ ...none, tierUp: true }).proven)
check('nothing known, or zero everywhere, proves nothing', !adSpendProof(none).proven && !adSpendProof({ metaAds: 0, top100Hits: 0, newVideos: 0, days: 30, tierUp: false }).proven)

// ── SAMPLES ──────────────────────────────────────────────────────────────────
const sp = (trybe: boolean | null, received: number, waitingLong: number) => samplesProof({ trybe, received, waitingLong })
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
check('the profile stands in for the typed niches, a hundred over a wide pool', /const top100 = readTop100Ask\(body\.top100\)/.test(R) && /const want = top100 \? TOP100/.test(R) && /const pool = top100 \|\|/.test(R))
check('the page\'s filters do not apply to it', /const filters = nameOnly \|\| top100 \? readFilters\(null\) : asked/.test(R))
check('a brand the creator knows never makes it: on their list, joined, or sampled', /if \(mineBy\.has\(id\) \|\| top100\.joined\.has\(id\) \|\| sampledMine\.has\(id\)\) \{ leftOut\.known\+\+; continue \}/.test(R))
check('no proven ad spend, no place', /if \(!spend\.proven\) \{ leftOut\.noSpend\+\+; continue \}/.test(R))
check('samples off, missing, or not said: no place, each counted', /if \(!sm\.ok\) \{ leftOut\[sm\.why === 'off' \? 'samplesOff' : sm\.why === 'missing' \? 'samplesMissing' : 'samplesUnknown'\]\+\+; continue \}/.test(R))
check('samples are read from every MVP creator\'s records, not only this one', /from\('trybe_samples'\)\.select\('brand_id, requested_at, received_at'\)\.in\('brand_id'/.test(R))
check('fit first, quality next, proven samples last', /0\.6 \* \(k\.x\.match \/ maxMatch\) \+ 0\.3 \* /.test(R))
check('each brand carries its proof, and the reply its left-out counts', /proof: proofBy\.get\(r\.brand_id\) \?\? null/.test(R) && /top100: top100Out,/.test(R))

// ── THE PAGE ─────────────────────────────────────────────────────────────────
const U = read('components/labs/TrybeOutreach.tsx')
check('one button runs it', /onClick=\{\(\) => void runTop100\(\)\}/.test(U) && /My top 100/.test(U))
check('the TRYBE brands they work with are read through SCOUT, and a failed read is said', /requestTrybeApi\('GET', '\/backend\/api\/creator\/v2\/brands\/stats\?period=all'\)/.test(U) && /could not leave those brands out/.test(U))
check('the list is searched with the profile', /top100: \{ categories: top100\.profile\.categories, keywords: top100\.profile\.keywords, joined: top100\.joined \}/.test(U))
check('what MVP read, looked for and left out is said', /MVP read \{read \|\| 'what you have'\}/.test(U) && /Left out of \{t\?\.considered\.toLocaleString\(\)\} that fit you/.test(U))
check('a list under 100 says why, never padded', /MVP never pads it with brands it cannot vouch for/.test(U))
check('tick all, then the usual Write messages', /Tick all \{free\.length\}/.test(U) && /Write \{livePick\.size\} message/.test(U))
check('each brand says its ad spend and samples', /Ad spend: \{b\.proof\.spend\.join\(', '\)\}/.test(U) && /Samples: \{b\.proof\.samples\}/.test(U))
check('back to the usual search', /Back to my search/.test(U))

if (fails.length) {
  console.error(`\n❌ trybe-top100: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-top100: 100 TRYBE brands new to the creator, from their own work, each proven on ad spend and samples, and what was left out said')
