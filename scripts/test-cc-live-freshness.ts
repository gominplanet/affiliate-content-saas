// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CC open spots stay current (Seb, 2026-10-10: "too many campaigns are showing
// not full but actually are"). Spot counts came from the weekly upload and an
// occasional live check, and a five-day-old count read as today's.

import { readFileSync } from 'node:fs'
import { spotFreshness, spotAgeWords, isStale, brandsToRecheck, LIVE_STALE_MS, BROWSER_RECHECK_MS } from '../lib/cc-spot-freshness'

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
const api = readFileSync('app/api/cc/campaigns/route.ts', 'utf8')
check('the list carries each card\'s age, read apart from the main query', /select\('campaign_id,last_live_at,imported_at'\)/.test(api))
const full = readFileSync('app/api/cc/campaign-full/route.ts', 'utf8')
check('a campaign found full on Accept is stamped as a live check', /last_live_at: new Date\(\)\.toISOString\(\)/.test(full))

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
