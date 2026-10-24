// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE, after TrybeDaily's Today, What's Working, Creators and Brands (Seb,
// 2026-10-17: "Do one, two, four, five, six, seven, eight, ten"): most active
// brands, any day of What changed, top creators, the Meta ads gallery, the
// category filter, payouts and TikTok Shop in Find brands, compare, and the
// brands off TRYBE's Discover list.

import { readFileSync } from 'node:fs'
import { activeKeys, activeRows, activeBy, rankActive, categoryCounts, tierWentUp, latestTierChanges, VIDEOS_LEAD_MIN } from '../lib/trybe-active'
import { topCreators } from '../lib/trybe-creators'
import { readTopEntries } from '../lib/trybe-working'
import { readAdCard, readCardsBody, adDate, safePreview, mergeGallery, galleryStats, sortAds, adDays, ranDays, closingLine, GALLERY_MAX, GALLERY_FRESH_DAYS, ADS_PER_BRAND, brandsWithAds, nextToRead, type MetaAd } from '../lib/trybe-adsgallery'
import { compareRows } from '../lib/trybe-compare'
import { filterCheck, readFilters, FILTER_WORDS, readDirStats } from '../lib/trybe-finder'
import { BROWSE_SORTS } from '../lib/trybe-outreach'
import { changeDay, changeDays } from '../lib/trybe-changes'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── 1. Most active brands ────────────────────────────────────────────────────
const pick = activeKeys(['snap:2026-10-14', 'snap:2026-10-17', 'snap:2026-10-16', 'snap:2026-10-15', 'bad'])
check('the newest copy, the day before, and the oldest within 30 days are compared', pick?.latest === 'snap:2026-10-17' && pick?.prev === 'snap:2026-10-16' && pick?.base === 'snap:2026-10-14' && pick?.days === 3)
check('one copy only: no window, never a made up one', (() => { const p = activeKeys(['snap:2026-10-17']); return p?.base === null && p?.days === null && p?.prev === null })())
check('the copy closest to 30 days back is the base', activeKeys(['snap:2026-10-17', 'snap:2026-09-10', 'snap:2026-09-18', 'snap:2026-10-16'])?.base === 'snap:2026-09-18')
const rows = activeRows(
  { a: [120, null], b: [40, null], c: [10, null], d: [null, null], e: [5, null] },
  { a: [118, null], b: [40, null] },
  { a: [100, null], b: [30, null], c: [10, null], d: [5, null] },
)
check('creators joined over the window and since the day before', rows.find((r) => r.brand_id === 'a')?.joined === 20 && rows.find((r) => r.brand_id === 'a')?.joinedDay === 2)
check('a brand not in the older copy has no change, not all new', rows.find((r) => r.brand_id === 'e')?.joined === null)
check('a count TRYBE did not give is not a change', rows.find((r) => r.brand_id === 'd')?.joined === null)
const ranked = rankActive(rows, activeBy(rows))
check('ranked by creators joined; nothing moved is left out, never called quiet', ranked.map((r) => r.brand_id).join(',') === 'a,b')
check('creators lead while copies carry no video counts', activeBy(rows) === 'creators')
const vids = Array.from({ length: VIDEOS_LEAD_MIN }, (_, i) => ({ brand_id: `v${i}`, creators: 1, joined: 0, joinedDay: 0, videos: i, videosDay: 0 }))
check('videos lead once enough brands have a count for the window', activeBy(vids) === 'videos' && rankActive(vids, 'videos')[0].brand_id === `v${VIDEOS_LEAD_MIN - 1}`)
const cats = categoryCounts([{ categories: ['Skincare', 'Wellness'] }, { categories: ['skincare'] }, { categories: [] }])
check('a brand counts in every category TRYBE lists for it', cats[0].name === 'Skincare' && cats[0].n === 2 && cats.some((c) => c.name === 'Wellness' && c.n === 1))
check('a payout tier went up only when both read as dollars', tierWentUp('$80K+', '$200K+') && !tierWentUp('$200K+', '$80K+') && !tierWentUp(null, '$200K+') && !tierWentUp('lots', '$1K+'))
const tiers = latestTierChanges([{ brand_id: 'x', before: '$50K+', after: '$200K+', at: '2026-10-16' }, { brand_id: 'x', before: '$10K+', after: '$50K+', at: '2026-10-01' }])
check('the newest tier change per brand is kept', tiers.get('x')?.after === '$200K+' && tiers.get('x')?.up === true)

// ── 2. Any day of What changed ───────────────────────────────────────────────
const days = changeDays([{ at: '2026-10-17T10:00:00' }, { at: '2026-10-17T11:00:00' }, { at: '2026-10-15T09:00:00' }])
check('days with changes, newest first, with how many', days.length === 2 && days[0].day === '2026-10-17' && days[0].n === 2 && changeDay('2026-10-15T09:00:00') === '2026-10-15')

// ── 4. Top creators ──────────────────────────────────────────────────────────
const entries = readTopEntries({ data: [
  { submissionId: 's1', rank: 3, brandId: 'b1', brandName: 'BYLT', creator: { name: 'Elijah Lucero', handle: '@elijah', avatarUrl: 'https://cdn.example.com/e.jpg' }, thumbnailUrl: 'https://cdn.example.com/1.jpg' },
  { submissionId: 's2', rank: 1, brandId: 'b2', brandName: 'MUNICIPAL', creator: { name: 'Elijah Lucero', handle: 'elijah' } },
  { submissionId: 's3', rank: 2, brandId: 'b1', brandName: 'BYLT', creator: { name: 'Brandie Barron', gmvBucket: '$300K+' } },
  { submissionId: 's4', rank: 4, brandId: 'b3', brandName: 'Nuuds' },
] })
check('the creator handle, picture and TRYBE sales range are read when sent', entries[0].creatorHandle === 'elijah' && entries[0].creatorAvatar === 'https://cdn.example.com/e.jpg' && entries[2].creatorSales === '$300K+')
const creators = topCreators(entries)
check('videos are grouped by creator, most first, then best place', creators.length === 2 && creators[0].name === 'Elijah Lucero' && creators[0].videos === 2 && creators[0].best === 1)
check('each creator lists the brands once, and the videos best first', creators[0].brands.map((b) => b.name).join(',') === 'BYLT,MUNICIPAL' && creators[0].clips[0].rank === 1)
check('a video with no creator is left out, not filed as Unknown', !creators.some((c) => /unknown/i.test(c.name)) && creators.reduce((n, c) => n + c.videos, 0) === 3)
check('a sales range shows only when TRYBE sends it', creators[1].sales === '$300K+' && creators[0].sales === null)

// ── 5. The Meta ads gallery ──────────────────────────────────────────────────
const card = { text: 'Active\nLibrary ID: 1234567890123456\nStarted running on Sep 12, 2026\nPlatforms\nThis ad has multiple versions\nSee ad details\nHume Health\nSponsored\nThese are way too expensive. But here is why I wear one every day.\nAnd the band lasts a week.\nHUMEHEALTH.COM\nBand 2.0\nShop now', video: true, preview: 'https://scontent-lax3-1.xx.fbcdn.net/v/t39/abc.jpg?x=1' }
const ad = readAdCard(card, 'b9', 'Hume Health', '2026-10-17T12:00:00.000Z')!
check('a card reads into an ad: its ID, start date, page and words', ad.id === '1234567890123456' && ad.started === '2026-09-12' && ad.page === 'Hume Health' && /way too expensive/.test(ad.body) && !/HUMEHEALTH/.test(ad.body) && !/Shop now/.test(ad.body))
check('its opening line is the first sentence', ad.opening === 'These are way too expensive.')
check('video and several versions are read; not a paid partnership', ad.video && ad.versions && !ad.paid)
const paid = readAdCard({ text: 'Library ID: 9999999999\nStarted running on 3 Oct 2026\nJess Reviews\nSponsored\nPaid partnership with Hume Health\nI tried it for 30 days.\nLearn more', video: false, preview: null }, 'b9', 'Hume Health', '2026-10-17T12:00:00.000Z')!
check('a paid partnership with a creator is read, run by the creator’s page', paid.paid && paid.page === 'Jess Reviews' && paid.started === '2026-10-03' && paid.opening === 'I tried it for 30 days.')
check('a card without a Library ID is not kept', readAdCard({ text: 'Sponsored\nSomething', video: false, preview: null }, 'b', 'B', '2026-10-17') === null)
check('dates in both orders, and September written out', adDate('Sep 12, 2026') === '2026-09-12' && adDate('12 Sep 2026') === '2026-09-12' && adDate('September 2, 2026') === '2026-09-02' && adDate('soon') === null)
check('only Meta’s own image servers are shown', !!safePreview('https://scontent.xx.fbcdn.net/a.jpg') && safePreview('https://evil.example/a.jpg') === null && safePreview('http://scontent.xx.fbcdn.net/a.jpg') === null)
check('cards from SCOUT are read safely and capped', readCardsBody([{ text: 'x', preview: 'https://evil.example/p.jpg' }, { text: '' }, 5, null]).length === 1 && readCardsBody([{ text: 'x', preview: 'https://evil.example/p.jpg' }])[0].preview === null && readCardsBody(Array.from({ length: 40 }, () => ({ text: 'x' }))).length === ADS_PER_BRAND * 2)
const mk = (id: string, brandId: string, readAt: string, started: string | null = '2026-10-01', extra: Partial<MetaAd> = {}): MetaAd => ({ id, brandId, brand: brandId, page: null, startedText: null, started, body: 'b', opening: 'o', paid: false, video: false, versions: false, preview: null, readAt, ...extra })
const g1 = mergeGallery(null, 'b1', 'B1', [mk('1', 'b1', '2026-10-16'), mk('2', 'b1', '2026-10-16')], 2, '2026-10-16')
const g2 = mergeGallery(g1, 'b1', 'B1', [mk('3', 'b1', '2026-10-17')], 1, '2026-10-17')
check('a brand read again has its ads replaced, not added to', g2.ads.length === 1 && g2.ads[0].id === '3' && g2.brands.b1.count === 1)
check('the gallery keeps at most GALLERY_MAX ads', (() => {
  let g = null as ReturnType<typeof mergeGallery> | null
  for (let i = 0; i < 70; i++) g = mergeGallery(g, `b${i}`, `B${i}`, Array.from({ length: 8 }, (_, k) => mk(`${i}-${k}`, `b${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`)), 8, '2026-10-17')
  return g!.ads.length === GALLERY_MAX
})())
const nowT = Date.parse('2026-10-17T00:00:00Z')
const st = galleryStats([mk('a', 'b', 'x', '2026-10-07', { paid: true, video: true }), mk('b', 'b', 'x', '2026-09-27'), mk('c', 'b', 'x', null)], 2, nowT)
check('tiles: the middle ad’s age, paid and video shares', st.medianDays === 15 && st.dated === 2 && Math.abs((st.paidShare ?? 0) - 1 / 3) < 1e-9 && st.ads === 3 && st.brands === 2)
check('no ads is not 0%: the shares are not known', galleryStats([], 0, nowT).paidShare === null && galleryStats([], 0, nowT).medianDays === null)
const sorted = sortAds([mk('n', 'b', 'x', '2026-10-15'), mk('o', 'b', 'x', '2026-08-01'), mk('w', 'b', 'x', '2026-10-10', { opening: '' })], 'longest', nowT)
check('running longest first, and newest first', sorted[0].id === 'o' && sortAds(sorted, 'newest', nowT)[0].id === 'n' && sortAds(sorted, 'opening', nowT)[2].id === 'w')
// LONGEST RUNNING (Seb, 2026-10-24: "brands running the longest ad on meta
// means the video is working and the hook and cta is selling").
check('the button and the site it leads to are read from the card', ad.cta === 'Shop now' && ad.link === 'humehealth.com')
check('the closing line is the last sentence, when there is more than one', closingLine('These are way too expensive. But here is why. Shop the band today.') === 'Shop the band today.' && closingLine('One line only.') === null)
check('days running are counted to the read, never past it', ranDays({ started: '2026-08-01', readAt: '2026-09-01T00:00:00Z' }, Date.parse('2026-10-24T00:00:00Z')) === 31)
{
  const long = mk('long', 'b1', '2026-10-20T00:00:00Z', '2026-03-01'), short = mk('short', 'b2', '2026-10-20T00:00:00Z', '2026-10-15')
  const g = mergeGallery({ at: '', brands: {}, ads: [short, long] }, 'b3', 'B3', [mk('mid', 'b3', '2026-10-21T00:00:00Z', '2026-07-01')], 1, '2026-10-21T00:00:00Z')
  check('the longest running are kept first', g.ads.map((a) => a.id).join(',') === 'long,mid,short')
  const stale = mergeGallery({ at: '', brands: {}, ads: [mk('old', 'b1', '2026-07-01T00:00:00Z', '2026-01-01')] }, 'b3', 'B3', [], 0, '2026-10-21T00:00:00Z')
  check(`an ad not read again in ${GALLERY_FRESH_DAYS} days is let go`, stale.ads.length === 0)
  const st2 = galleryStats([long, short], 2, Date.parse('2026-10-24T00:00:00Z'))
  check('the tiles count the ads that ran 30 days or more and name the longest', st2.longRun === 1 && st2.longest?.days === 233 && st2.longest?.brand === 'b1')
}
{
  const gal = read('components/labs/TrybeAdsGallery.tsx')
  check('the section opens on running longest, videos only, and says why', /useState<AdSort>\('longest'\)/.test(gal) && /const \[videosOnly, setVideosOnly\] = useState\(true\)/.test(gal) && /A brand keeps paying for an ad that sells/.test(gal) && /longest running Meta ads/.test(gal))
  check('each card shows its hook, how it ends and its button', /Hook /.test(gal) && /Ends with /.test(gal) && /Button:/.test(gal))
}
// THE WHOLE EXAMPLE (Seb, 2026-10-24: "when i click on watch example i can
// always only see the first 3 seconds").
{
  const { readTopEntries } = require('../lib/trybe-working') as typeof import('../lib/trybe-working')
  const e = readTopEntries({ data: [{ brandName: 'B', id: 's1', previewVideoUrl: 'https://cdn.x/p.mp4', video: { hookClipUrl: 'https://cdn.x/h.mp4', url: 'https://cdn.x/full.mp4' }, thumbnailUrl: 'https://cdn.x/t.jpg', tiktokUrl: 'https://www.tiktok.com/@a/video/1' }] })[0]
  check('every video link is kept, the whole file before a preview or a hook clip', e.video === 'https://cdn.x/full.mp4' && (e.videos || []).map((v) => v.from).join(',') === 'video.url,previewVideoUrl,video.hookClipUrl')
  check('a page link or a picture is never a video', !(e.videos || []).some((v) => /tiktok|\.jpg/.test(v.url)))
  const W = read('components/labs/TrybeWorking.tsx')
  check('Watch this example plays in the page, trying each link until one is long enough', /function ExamplePlayer\(/.test(W) && /onClick=\{\(\) => setPlaying\(e\)\}/.test(W) && /if \(at \+ 1 < links\.length\) setAt\(at \+ 1\)/.test(W) && !/href=\{e\.video/.test(W))
  check('a clip is said as a clip, never as the video', /TRYBE shares only the first \{Math\.round\(len as number\)\} seconds of this video/.test(W))
  check('kept reads from before are read again', /mvp\.trybe\.working\.v3/.test(W))
}
// SCOUT 1.53.8: the longest running of up to 30 per brand, not the first 8.
{
  const BG = read('extension/background.js')
  check('SCOUT scrolls for more of a brand\'s ads and sends the 8 that started earliest', /const LOOK = 30, KEEP = 8/.test(BG) && /window\.scrollTo\(0, document\.body\.scrollHeight\)/.test(BG) && /sort\(\(a, b\) => a\.t - b\.t \|\| a\.i - b\.i\)\.slice\(0, KEEP\)/.test(BG) && /cardsSeen: seen/.test(BG))
  const many = Array.from({ length: 12 }, (_, k) => mk(`m${k}`, 'b7', '2026-10-20T00:00:00Z', `2026-0${1 + (k % 9)}-01`))
  check('MVP keeps a brand\'s longest running too, whatever SCOUT sent', mergeGallery(null, 'b7', 'B7', many, 12, '2026-10-20T00:00:00Z').ads.every((a) => a.started! <= '2026-08-01'))
  const MR = read('components/labs/metaAdsRead.ts')
  check('the team\'s read says which ads were copied', /SCOUT looked at \$\{run\.looked\}/.test(MR) && /copies the first 8 ads Meta shows for each brand/.test(MR))
}
check('days running from the start date', adDays('2026-10-07', nowT) === 10 && adDays(null, nowT) === null)

// ── 7. Payouts and TikTok Shop in Find brands ───────────────────────────────
const base = { perVideo: null, creators: 10, stats: readDirStats({}), earningsBucket: null, amazon: null, starred: false }
check('On TikTok Shop: on passes, off is hidden, not checked is listed after', filterCheck({ ...base, tiktokShop: true }, readFilters({ tiktokShop: true })).pass
  && !filterCheck({ ...base, tiktokShop: false }, readFilters({ tiktokShop: true })).pass
  && filterCheck({ ...base, tiktokShop: null }, readFilters({ tiktokShop: true })).unknown.includes('tiktokShop'))
check('Payout tier went up: a log that could not be read is not known', filterCheck({ ...base, tierUp: true }, readFilters({ tierUp: true })).pass
  && !filterCheck({ ...base, tierUp: false }, readFilters({ tierUp: true })).pass
  && filterCheck({ ...base, tierUp: null }, readFilters({ tierUp: true })).unknown.includes('tierUp'))
check('the new filters have words and are read from the page', !!FILTER_WORDS.tiktokShop && !!FILTER_WORDS.tierUp && readFilters({ tiktokShop: 'yes' }).tiktokShop === false)
check('Highest total payouts is a sort', (BROWSE_SORTS as readonly string[]).includes('payouts'))
const route = read('app/api/labs/trybe/route.ts')
const browse = route.slice(route.indexOf("if (action === 'browse') {"), route.indexOf("// ── FINDER: stars, priorities, pass"))
check('payouts sort by TRYBE’s range, then most creators', /sort === 'payouts' \? payoutOrder\(b\) - payoutOrder\(a\) \|\| \(b\.r\.total_creators \?\? -1\) - \(a\.r\.total_creators \?\? -1\)/.test(browse) && /bucketDollars\(x\.r\.earnings_bucket\)/.test(browse))
check('each brand carries its range, a rise, TikTok Shop and the Top 100', /earnings_bucket: r\.earnings_bucket \?\? null/.test(browse) && /tier_up:/.test(browse) && /tiktok_shop: tiktokShopOf\(r\)/.test(browse) && /top100_hits: topRead/.test(browse))
check('brands whose tier went up are added to the pool, like New only', /filters\.tierUp && tierLog/.test(browse) && /tierUp: tierLog \? !!tierLog\.get\(x\.r\.brand_id\)\?\.up : null/.test(browse))
const controls = read('components/labs/TrybeFinderControls.tsx')
check('the toolbar has both toggles, and the card both chips', /tiktokShop: 'On TikTok Shop', tierUp: 'Payout tier went up'/.test(controls) && /export function PaidOutChip/.test(controls) && /export function TikTokShopChip/.test(controls) && /tiktokShop: false, tierUp: false/.test(controls))

// ── 8. Compare ───────────────────────────────────────────────────────────────
const cmp = compareRows([
  { brand_id: '1', name: 'A', pay_est: { dollars: 40, short: '$40 a video' }, total_creators: 12, earnings_bucket: '$10K+', tiktok_shop: false, top100_hits: 2 },
  { brand_id: '2', name: 'B', pay_est: { dollars: 25, short: '$25 a video' }, total_creators: 300, earnings_bucket: '$200K+', tiktok_shop: true, top100_hits: 2 },
  ])
const one = compareRows([{ brand_id: '1', name: 'A', pay_est: { dollars: 40, short: '$40 a video' } }, { brand_id: '2', name: 'B', pay_est: null }])
const row = (l: string) => cmp.find((r) => r.label === l)!
check('higher pay and fewer creators are better', row('Per approved video').best === 0 && row('Creators').best === 0 && row('Paid out on TRYBE').best === 1)
check('not on TikTok Shop is better; a tie has no better', row('TikTok Shop').best === 0 && row('In TRYBE’s Top 100').best === null)
check('"Not known" is never the better one, and one figure alone is not "better"', row('Pays creators a month').best === null && row('Pays creators a month').values.every((v) => v === 'Not known') && one.find((r) => r.label === 'Per approved video')!.best === null)
const outreach = read('components/labs/TrybeOutreach.tsx')
check('Find brands has Compare on each card and the side by side view', /<CompareButton on=\{compare\.some/.test(outreach) && /<TrybeCompare brands=\{compare\}/.test(outreach) && /COMPARE_MAX/.test(outreach))

// ── 1, 2 and 10 on the page; 5 and 10 on the server ─────────────────────────
const changes = read('components/labs/TrybeChanges.tsx')
check('What changed has its three views and the Day pick', /<TrybeActive /.test(changes) && /<TrybeOffDiscover /.test(changes) && /aria-label="Pick a day"/.test(changes) && /Earlier days: read 14 days/.test(changes))
check('the Your week line keeps 7 days when 14 are read', /if \(\(days \?\? 7\) === 7\) onRead\?\.\(c\)/.test(changes))
const active = route.slice(route.indexOf("if (action === 'active') {"), route.indexOf("if (action === 'off_discover') {"))
check('the board is shared and per member only for what is yours', /activeBoard\(admin\)/.test(active) && /status: statusBy\.get/.test(active) && /like\('key', 'snap:%'\)/.test(route.slice(route.indexOf('async function activeBoard'), route.indexOf('async function activeBoard') + 1500)))
check('brands TRYBE no longer lists are left off the board', /!info\.get\(r\.brand_id\)!\.left_at/.test(route))
const off = route.slice(route.indexOf("if (action === 'off_discover') {"), route.indexOf("if (action === 'meta_gallery') {"))
check('off Discover: your joined brands are put right first, then both kinds read', /healJoined\(admin, body\.joined, now\)/.test(off) && /not\('left_at', 'is', null\)/.test(off) && /eq\('raw->>isListed', 'false'\)/.test(off) && /unlistedError/.test(off))
const meta = route.slice(route.indexOf("if (action === 'meta_ads') {"), route.indexOf("if (action === 'kickoff' || action === 'followup') {"))
check('ads are kept for every member from the MVP team’s reads only', /tier === 'admin' && withCards\.length/.test(meta) && /mergeGallery\(g, id, nm, ads, n, now\)/.test(meta))
check('a brand with ads whose cards were not read keeps its earlier ads', /if \(!ads\.length && n !== 0\) \{ cardsMissed\+\+; continue \}/.test(meta))

// ── 4, 5, 6 on What's working ────────────────────────────────────────────────
const working = read('components/labs/TrybeWorking.tsx')
check('What’s working has one Category pick that narrows the tab', /aria-label="Category"/.test(working) && /const entries = useMemo\(\(\) => \(data\?\.entries \|\| \[\]\)\.filter\(\(e\) => !cat/.test(working) && /hookCounts\(lineList\)/.test(working) && /topCreators\(entries\)/.test(working))
check('Top creators and the ads gallery are on the tab, the gallery even without SCOUT', /Top creators in TRYBE&rsquo;s Top 100/.test(working) && (working.match(/\{gallery\}/g) || []).length >= 3)
// Seb, 2026-10-19: "this takes too long and i'm not sure i get the value".
// The words come from the shared copy in one answer, not 40 SCOUT reads.
const trybeRoute = read('app/api/labs/trybe/route.ts')
check('What’s working reads the Top 100 words from MVP’s shared copy in one answer', /action: 'top_lines', ids/.test(working) && !/submissions\/\$\{encodeURIComponent\(todo\[i\]\.id/.test(working) && /if \(action === 'top_lines'\)/.test(trybeRoute) && /from\('trybe_top_scripts'\)\.select\('submission_id,hook,script,state'\)\.in\('submission_id', ids\)/.test(trybeRoute))
check('it says how many had words and how many are still being transcribed', /openings MVP has the words for/.test(working) && /more are being transcribed/.test(working))
const galleryUi = read('components/labs/TrybeAdsGallery.tsx')
check('the gallery says who reads it and when nothing was copied', /only an admin’s read adds to them|only an admin's read adds/.test(galleryUi) && /No ads copied yet/.test(galleryUi) && /SCOUT_META_CARDS_MIN_VERSION/.test(galleryUi))

// ── SCOUT 1.51.0 ─────────────────────────────────────────────────────────────
const bg = read('extension/background.js')
check('SCOUT copies the words of up to 8 ad cards when asked (the 8 running longest since 1.53.8)', /async function metaAdsReadInPage\(withCards\)/.test(bg) && /Library ID:/.test(bg) && /if \(out\.length >= max\) break/.test(bg) && /const LOOK = 30, KEEP = 8/.test(bg) && /args: \[cards === true\]/.test(bg) && /cards: msg\.cards === true/.test(bg))
check('MVP asks for the cards, and an older SCOUT is said as one', /\.\.\.\(cards \? \{ cards: true \} : \{\}\)/.test(read('lib/extension-frame.ts')) && /only reads the counts: SCOUT 1\.51\.0/.test(read('components/labs/metaAdsRead.ts')))
check('SCOUT copies ad cards from 1.51.0', /SCOUT_META_CARDS_MIN_VERSION = '1\.51\.0'/.test(read('lib/scout-version.ts')))

// ── Words ────────────────────────────────────────────────────────────────────
for (const f of ['components/labs/TrybeActive.tsx', 'components/labs/TrybeOffDiscover.tsx', 'components/labs/TrybeAdsGallery.tsx', 'components/labs/TrybeCompare.tsx', 'components/labs/metaAdsRead.ts', 'lib/trybe-compare.ts', 'lib/trybe-adsgallery.ts', 'lib/trybe-active.ts', 'lib/trybe-creators.ts']) {
  check(`no long dashes in ${f}`, !/[–—]/.test(read(f).replace(/^\/\/.*$/gm, '')))
}

// THE ADMIN'S TOP 100 READ AND WHAT THE TILES SAY (Seb, 2026-10-23: "??" at
// "Read the ads of 0 Top 100 brands" beside "6,119 TRYBE brands read on Meta"
// and "400 ads they are running").
{
  const g = { brands: { a: { name: 'A', at: '2026-10-20', count: 12 }, b: { name: 'B', at: '2026-10-22', count: 0 }, c: { name: 'C', at: '2026-10-21', count: null } } }
  check('brands with ads counts only a read that found some', brandsWithAds(g) === 1 && brandsWithAds(null) === 0)
  const top = [{ brandId: 'b' }, { brandId: 'new' }, { brandId: 'a' }, { brandId: 'c' }]
  check('never read first, then the longest ago', nextToRead(top, g, 3).map((x) => x.brandId).join() === 'new,a,c')
  check('a press reads at most what it is asked', nextToRead(top, g, 2).length === 2 && nextToRead([], g, 25).length === 0)
  const PANEL = read('components/labs/TrybeAdsGallery.tsx'), ROUTE = read('app/api/labs/trybe/route.ts')
  check('the panel falls back to the Top 100 MVP saved', /const pool = topBrands\.length \? topBrands : data\?\.top\?\.brands \|\| \[\]/.test(PANEL))
  check('the route sends the saved Top 100 to the team, with when each was read', /if \(tier === 'admin'\) \{[\s\S]{0,200}gt\('top100_hits', 0\)/.test(ROUTE) && /readAt: g\?\.brands\?\.\[r\.brand_id\]\?\.at \?\? null/.test(ROUTE))
  check('the button never offers 0 brands', !/Read the ads of \{Math\.min\(25, topBrands\.length\)\}/.test(PANEL) && /todo\.length \? `Read the ads of \$\{todo\.length\} Top 100 brands`/.test(PANEL))
  check('no "read the Top 100 above" when nothing above can', !/Read the Top 100 above first/.test(PANEL))
  check('the kept cards are never called the ads running', !/label="Ads they are running"/.test(PANEL) && /kept had run \$\{LONG_RUN_DAYS\} days or more when read/.test(PANEL) && /running ads/.test(PANEL))
}

if (failures.length) {
  console.error('❌ trybe board guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ trybe board guard passed')
