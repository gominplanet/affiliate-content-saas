// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SHARED YOUTUBE QUOTA IS COUNTED, AND HELD WHEN IT IS GONE.
//
// One day the quota ran out with no record of who spent it (a day of blog
// caption downloads), and playlists and uploads failed for everybody
// (lib/youtube-quota, migration 397).
import { readFileSync } from 'node:fs'
import { ytCallOf, holdOf, quotaDay, msToReset, PROBE_AFTER_MS } from '../lib/youtube-quota'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const G = 'https://www.googleapis.com'

check('a video upload costs 1,600', ytCallOf(`${G}/upload/youtube/v3/videos?uploadType=resumable&part=snippet`, 'POST')?.units === 1600)
check('upload pieces cost nothing', ytCallOf(`${G}/upload/youtube/v3/videos?uploadType=resumable&upload_id=x`, 'PUT') === null)
check('a caption download costs 200 and is optional', (() => { const c = ytCallOf(`${G}/youtube/v3/captions/abc?tfmt=srt`); return c?.units === 200 && c.optional })())
check('a caption list costs 50 and is optional', (() => { const c = ytCallOf(`${G}/youtube/v3/captions?videoId=x&part=snippet`); return c?.units === 50 && c.optional })())
check('a search costs 100 and is optional', (() => { const c = ytCallOf(`${G}/youtube/v3/search?part=id`); return c?.units === 100 && c.optional })())
check('a read costs 1', ytCallOf(`${G}/youtube/v3/videos?part=snippet&id=x`)?.units === 1)
check('a video update costs 50 and is not optional', (() => { const c = ytCallOf(`${G}/youtube/v3/videos?part=snippet`, 'PUT'); return c?.units === 50 && !c.optional })())
check('a comment costs 50', ytCallOf(`${G}/youtube/v3/commentThreads?part=snippet`, 'POST')?.units === 50)
check('a thumbnail costs 50', ytCallOf(`${G}/upload/youtube/v3/thumbnails/set?videoId=x`, 'POST')?.units === 50)
check('sign-in and token refresh are not quota calls', ytCallOf('https://oauth2.googleapis.com/token', 'POST') === null)
check('the public watch page is not a quota call', ytCallOf('https://www.youtube.com/shorts/x') === null)

const now = Date.now()
const upload = ytCallOf(`${G}/upload/youtube/v3/videos?uploadType=resumable`, 'POST')!
const caption = ytCallOf(`${G}/youtube/v3/captions/abc`)!
check('after a refusal, everything is held', holdOf({ spent: 0, refusedAt: now - 60_000 }, upload, now).hold === true)
check('a probe goes through after the wait', holdOf({ spent: 0, refusedAt: now - PROBE_AFTER_MS - 1000 }, upload, now).hold === false)
check('past the reserve line, caption downloads are held', holdOf({ spent: 6000, refusedAt: null }, caption, now, 10_000).hold === true)
check('past the reserve line, uploads still go', holdOf({ spent: 6000, refusedAt: null }, upload, now, 10_000).hold === false)
check('before the line, caption downloads go', holdOf({ spent: 1000, refusedAt: null }, caption, now, 10_000).hold === false)
check('the quota day is the Pacific date', quotaDay(new Date('2026-10-03T06:30:00Z')) === '2026-10-02' && quotaDay(new Date('2026-10-03T08:30:00Z')) === '2026-10-03')
check('time to reset is under a day', msToReset(new Date('2026-10-03T06:30:00Z')) === 30 * 60_000)

const YT = readFileSync('services/youtube/index.ts', 'utf8')
check('the YouTube service makes every call through the counter', /import \{ ytFetch as fetchWithTimeout, noteTokenOwner \} from '@\/lib\/youtube-quota'/.test(YT) && !/await fetch\(/.test(YT))
check('tokens are put down to their account', /noteTokenOwner\(accessToken, owner\)/.test(YT) && /noteTokenOwner\(token, userId\)/.test(readFileSync('lib/youtube-channels.ts', 'utf8')))
for (const f of ['app/api/blog/attach-video/route.ts', 'app/api/youtube/channel-stats/route.ts', 'lib/covered-sales.ts', 'lib/shorts-detect.ts']) {
  const src = readFileSync(f, 'utf8')
  check(`${f} calls YouTube through the counter`, /ytFetch\(/.test(src) && !/(?:await fetch|fetchWithTimeout)\([^)]*googleapis\.com\/youtube/.test(src))
}
check('a held call says MVP held it', /MVP is keeping the rest of today/.test(readFileSync('lib/youtube-quota.ts', 'utf8')) && /quotaExceeded \(held by MVP\)/.test(YT))

if (failures.length) {
  console.error(`❌ youtube quota: ${failures.length} failed`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}
console.log('✅ youtube quota: every call counted, held once YouTube refuses, uploads kept room')
