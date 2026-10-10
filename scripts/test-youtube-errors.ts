// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A USED-UP YOUTUBE QUOTA SAYS SO. Google's message puts a link between
// "exceeded your" and "quota", and the body was cut before the reason code,
// so the playlist picker told a creator to reconnect YouTube.
import { readFileSync } from 'node:fs'
import { youTubeErrorText } from '../services/youtube'
import { ingestFailureWords } from '../lib/youtube-ingest'
import { toGb, usedPct } from '../lib/proxy-usage'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const quotaBody = JSON.stringify({ error: { code: 403, message: 'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.', errors: [{ message: 'x', domain: 'youtube.quota', reason: 'quotaExceeded' }] } })
const q = youTubeErrorText(403, quotaBody)
check('a quota error is named as one', /quotaExceeded/.test(q) && /midnight Pacific/.test(q) && !/<a /.test(q))
const other = youTubeErrorText(403, JSON.stringify({ error: { message: 'Forbidden', errors: [{ reason: 'forbidden' }] } }))
check('another error keeps its reason', /forbidden\. Forbidden/.test(other) && !/quota/i.test(other))
check('a body that is not JSON still reads', /502: Bad gateway/.test(youTubeErrorText(502, 'Bad gateway')))
const YT = readFileSync('services/youtube/index.ts', 'utf8')
check('no YouTube API error is built from a cut body any more', !/YouTube API error \$\{res\.status\}: \$\{body/.test(YT))
const CP = readFileSync('app/(dashboard)/co-pilot/page.tsx', 'utf8')
check('the playlist picker does not send a quota error to reconnect', /Playlists cannot load right now: MVP.s daily YouTube allowance is used up/.test(CP))

// A FETCH THAT FAILED SAYS WHY (Alejandro, 2026-10-08: "not being able to
// fetch the MP4", with nothing about whether YouTube, the video or MVP).
check('a bot wall is named as YouTube refusing the downloader', /refusing MVP/.test(ingestFailureWords("HTTP 502: ERROR: [youtube] abc: Sign in to confirm you're not a bot")))
check('a private video is named as private', /private or members only/.test(ingestFailureWords('HTTP 502: ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access')))
check('a proxy out of credit is named as MVP\'s service, not the member\'s video', /out of credit/.test(ingestFailureWords("HTTP 502: ERROR: [youtube] I_TI-k4-GrA: Unable to download API page: ('Unable to connect to proxy', OSError('Tunnel connection failed: 402 Payment Required'))")))
check('the raw proxy error is not pasted on screen', !/Tunnel connection/.test(ingestFailureWords("HTTP 502: ERROR: Unable to connect to proxy, OSError('Tunnel connection failed: 402 Payment Required')")))
check('the downloader health check makes a real request through the proxy', /generate_204/.test(readFileSync('ingest-service/server.js', 'utf8')) && /proxyOk/.test(readFileSync('ingest-service/server.js', 'utf8')))
// THE PROXY'S DATA IS ON THE ADMIN PAGE (Seb, 2026-10-09: the plan ran out
// unnoticed and every fetch failed).
check('proxy bytes read as GB', toGb(3_200_000_000) === 3.2)
check('usage is a share of the plan, and an unlimited plan has none', usedPct(8, 10) === 80 && usedPct(5, null) === null)
check('the admin costs page shows the proxy gauge', /<ProxyUsage \/>/.test(readFileSync('app/(dashboard)/admin/costs/page.tsx', 'utf8')))
check('the proxy gauge is admin only', /tier !== 'admin'/.test(readFileSync('app/api/admin/proxy-usage/route.ts', 'utf8')))
check('a service that is down is named as down', /not answering/.test(ingestFailureWords('the service did not answer (fetch failed)')))
check('anything else shows the downloader\'s own words', /downloader said: Requested format is not available/.test(ingestFailureWords('HTTP 502: ERROR: Requested format is not available')))
{
  const R = readFileSync('app/api/youtube/shorts/ingest/route.ts', 'utf8')
  check('the Short fetch puts the reason on screen', /ingestFailureWords\(got\.why\)/.test(R) && /why: got\.why/.test(R))
}

if (failures.length) {
  console.error(`❌ youtube errors: ${failures.length} failed`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}
console.log('✅ youtube errors: a used-up quota is named, not sent to reconnect')
