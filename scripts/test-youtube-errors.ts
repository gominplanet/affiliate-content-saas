// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A USED-UP YOUTUBE QUOTA SAYS SO. Google's message puts a link between
// "exceeded your" and "quota", and the body was cut before the reason code,
// so the playlist picker told a creator to reconnect YouTube.
import { readFileSync } from 'node:fs'
import { youTubeErrorText } from '../services/youtube'

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

if (failures.length) {
  console.error(`❌ youtube errors: ${failures.length} failed`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}
console.log('✅ youtube errors: a used-up quota is named, not sent to reconnect')
