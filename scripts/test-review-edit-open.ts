// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A TAKE THAT WILL NOT OPEN SAYS WHY (Seb, 2026-11-04: a DJI take stopped on
// "MVP could not open your review take: That file could not be read as a
// video.." with nothing to act on).
//
// Pinned here: the video server tries a file twice and then says what was
// wrong in plain words; the card never ends on two full stops; and an upload
// that did not arrive in full is caught when it is added, by name.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { oneStop } from '../lib/review-edit-server'

const require = createRequire(import.meta.url)
const { plainProbeError } = require('../ingest-service/join-takes.js') as { plainProbeError: (t: string) => string }

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

check('a missing file says so', /cannot find the file \(404\)/.test(plainProbeError('https://x/a.mp4: Server returned 404 Not Found')))
check('a file MVP may not open says so', /not allowed to open it \(403\)/.test(plainProbeError('HTTP error 403 Forbidden')))
check('a file cut short says it is not complete', /not complete/.test(plainProbeError('[mov,mp4 @ 0x1] moov atom not found\nhttps://x: Invalid data found when processing input')))
check('a file that is not a video says so', /not a video file/.test(plainProbeError('https://x: Invalid data found when processing input')))
check('a dropped connection says so', /connection to it dropped/.test(plainProbeError('Connection timed out')))
check('anything else is passed on as ffprobe said it', /^ffprobe said: weird$/.test(plainProbeError('weird')) && /no reason/.test(plainProbeError('')))
check('one full stop at the end of a reason, never two', oneStop('That file could not be read as a video.') === 'That file could not be read as a video' && oneStop('fine') === 'fine' && oneStop(null) === '')

const S = read('lib/review-edit-server.ts')
check('every server reason inside a sentence of ours has its stop dropped', /\$\{oneStop\(probe\.error\)\}\./.test(S) && /\$\{oneStop\(audio\.error\)\}\./.test(S) && /\$\{oneStop\(sent\.error\)\}\./.test(S) && !/\$\{probe\.error\}\./.test(S))
const V = read('ingest-service/server.js')
check('the video server tries a file twice before giving up', /if \(!infos\[i\] \|\| !infos\[i\]\.w\) infos\[i\] = await ffprobeInfo\(parts\[i\]\.url, parts\[i\]\.auth\)/.test(V))
check('and then says why', /could not be read as a video: \$\{why\}/.test(V) && /await probeWhy\(parts\[bad\]\.url, parts\[bad\]\.auth\)/.test(V))
const R = read('app/api/review-edit/route.ts')
check('an upload is checked in storage before it is queued', /const got = await storedBytes\(String\(o\.url\)\)/.test(R))
check('missing or short, it is said by name with what arrived', /did not finish uploading: MVP cannot find it\. Upload it again\./.test(R) && /did not finish uploading: MVP has \$\{mbOf\(got\)\} of \$\{mbOf\(sent\)\}\. Upload it again\./.test(R))
check('a check that cannot run holds nothing up', /if \(!r\.ok\) return null/.test(R) && /catch \{ return null \}/.test(R))

if (fails.length) {
  console.error(`\n❌ review-edit-open: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ review-edit-open: a take that will not open is tried twice and says why, and an upload that did not arrive in full is caught when it is added')
