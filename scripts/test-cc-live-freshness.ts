// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CC open spots stay current (Seb, 2026-10-10: "too many campaigns are showing
// not full but actually are"). Spot counts came from the weekly upload and an
// occasional live check, and a five-day-old count read as today's.

import { readFileSync } from 'node:fs'
import { spotFreshness, spotAgeWords, isStale, brandsToRecheck, latestListWords, latestListReady, LIVE_STALE_MS, BROWSER_RECHECK_MS } from '../lib/cc-spot-freshness'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const now = Date.parse('2026-10-10T12:00:00Z')

const live = spotFreshness('2026-10-10T10:00:00Z', '2026-10-05T09:00:00Z')
const upload = spotFreshness(null, '2026-10-05T09:00:00Z')
check('a live check newer than the upload is the age shown', live.spotsLive && live.spotsCheckedAt === '2026-10-10T10:00:00.000Z')
check('without a live check the upload is the age shown', !upload.spotsLive && upload.spotsCheckedAt === '2026-10-05T09:00:00.000Z')
check('the card says live versus upload, and how old', spotAgeWords(live, now) === 'Checked live on Amazon 2 h ago' && spotAgeWords(upload, now) === 'From the weekly upload, 5 days ago', `${spotAgeWords(live, now)} / ${spotAgeWords(upload, now)}`)
check('no date means no line rather than a made-up one', spotAgeWords({ spotsCheckedAt: null }, now) === null)
check('an upload-only count is always worth a live check', isStale(upload, now))
check('a fresh live count is not re-checked', !isStale(live, now))
check('a live count past the window is re-checked', isStale(spotFreshness(new Date(now - LIVE_STALE_MS - 1000).toISOString(), null), now))

const cards = [
  { brand: 'Anker', ...upload }, { brand: 'anker', ...upload }, { brand: 'Eufy', ...live },
  { brand: 'Ninja', ...upload }, { brand: 'Dreame', ...upload }, { brand: 'Shark', ...upload },
]
const picked = brandsToRecheck(cards, { ninja: now - 1000 }, now)
check('re-checks distinct stale brands, at most three, skipping fresh and just-checked ones', JSON.stringify(picked) === JSON.stringify(['Anker', 'Dreame', 'Shark']), JSON.stringify(picked))
check('a brand this browser checked long ago is checked again', brandsToRecheck([{ brand: 'Ninja', ...upload }], { ninja: now - BROWSER_RECHECK_MS - 1 }, now).length === 1)

const page = readFileSync('app/(dashboard)/cc-campaigns/page.tsx', 'utf8')
check('the campaigns page checks the brands on screen live, by itself', /brandsToRecheck\(campaigns\.slice\(0, 24\)/.test(page) && /refreshLiveSpots\(terms\)/.test(page))
check('one automatic check per search, so a reload never chains another', /liveRanFor\.current === searchKey/.test(page))
check('a failed live check says so rather than looking like nothing changed', /Could not check spots live/.test(page))
check('each card says how old its count is', /spotAgeWords\(/.test(page))
// IN AMAZON'S LATEST LIST (Seb, 2026-11-18: "if they're matching with the latest upload")
const synced = '2026-11-16T15:00:00Z'
check('a card in the last upload says so, with the day', latestListWords({ inLatest: true, latestAt: synced })?.text === 'In Amazon\u2019s latest list (Nov 16)' && latestListWords({ inLatest: true, latestAt: synced })?.tone === 'ok')
check('a card the last upload left out is a warning', latestListWords({ inLatest: false, latestAt: synced })?.tone === 'warn' && /may have ended or filled/.test(latestListWords({ inLatest: false, latestAt: synced })?.text || ''))
check('a live check newer than the upload says more, so nothing is added', latestListWords({ inLatest: false, latestAt: synced, spotsLive: true, spotsCheckedAt: '2026-11-17T09:00:00Z' }) === null)
check('when MVP cannot tell, nothing is said', latestListWords({ inLatest: null, latestAt: synced }) === null && latestListWords({ inLatest: true, latestAt: null }) === null)
check('the latest list counts only once its merge finished, and not while the next upload fills staging', latestListReady({ phase: 'done', finishedAt: synced }, '2026-11-16T14:00:00Z') && !latestListReady({ phase: 'done', finishedAt: synced }, '2026-11-18T08:00:00Z') && !latestListReady({ phase: 'hide', finishedAt: synced }, null) && !latestListReady(null, null))
const route = readFileSync('app/api/cc/campaigns/route.ts', 'utf8')
check('the route looks each card up in the last upload, by id, only when it is ready', /latestListReady\(drain, flagOf\(CC_LAST_UPLOAD_FLAG\)\?\.at \?\? null\)/.test(route) && /from\('cc_campaign_catalog_import'\)\.select\('campaign_id'\)\.in\('campaign_id', ids\)/.test(route) && /latestUpload: latestAt/.test(route))

// THE LIST LOADS ONCE AND STAYS (Seb, 2026-11-18: "it's loading weird")
check('the list stays on screen while it reloads; only a first load shows the spinner', /\{loading && !campaigns\.length \? \(/.test(page) && /'Updating the list…'/.test(page))
check('a live check reloads only when a campaign filled or new ones came, and never drops loaded pages', /if \(\(r\.nowFull > 0 \|\| r\.added > 0\) && pagesLoaded\.current === 1\) void fetchPage\(1, false\)/.test(page) && !/if \(r\.saved > 0 \|\| r\.added > 0\)/.test(page))
check('Load more never shows a card twice', /const have = new Set\(prev\.map\(\(c\) => c\.campaignId\)\)/.test(page) && /filter\(\(c\) => !have\.has\(c\.campaignId\)\)/.test(page))
check('a late Joined only answer never replaces the list', /const fetchJoinedLive[\s\S]{0,200}const seq = \+\+fetchSeq\.current[\s\S]{0,200}if \(seq !== fetchSeq\.current\) return/.test(page))
const shell = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
check('the menu calls it CC campaigns (Seb, 2026-11-18)', /label: 'CC campaigns', gate: canBrowseDealRadar/.test(shell) && /label: 'All CC campaigns'/.test(shell) && !/label: 'Brand campaigns'/.test(shell) && /title="CC campaigns"/.test(page) && !/Formerly CC Campaigns/.test(page))
const api = readFileSync('app/api/cc/campaigns/route.ts', 'utf8')
check('the list carries each card\'s age, read apart from the main query', /select\('campaign_id,last_live_at,imported_at'\)/.test(api))
const full = readFileSync('app/api/cc/campaign-full/route.ts', 'utf8')
check('a campaign found full on Accept is stamped as a live check', /last_live_at: new Date\(\)\.toISOString\(\)/.test(full))

const bg = readFileSync('extension/background.js', 'utf8')
check('SCOUT accept-and-message reports a full campaign instead of swallowing it', /if \(r && r\.full\) \{ fullSeen = /.test(bg) && /const full = fullSeen \? \{ full: true/.test(bg))
const frame = readFileSync('lib/extension-frame.ts', 'utf8')
check('a full campaign from accept-and-message is marked full for everyone', /if \(resp\.full\) \{[\s\S]{0,400}\/api\/cc\/campaign-full/.test(frame.slice(frame.indexOf('export async function requestAcceptAndSendBrand'))))

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
