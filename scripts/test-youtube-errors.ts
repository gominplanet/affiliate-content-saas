// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A USED-UP YOUTUBE QUOTA SAYS SO. Google's message puts a link between
// "exceeded your" and "quota", and the body was cut before the reason code,
// so the playlist picker told a creator to reconnect YouTube.
import { readFileSync } from 'node:fs'
import { youTubeErrorText } from '../services/youtube'
import { ingestFailureWords } from '../lib/youtube-ingest'

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
