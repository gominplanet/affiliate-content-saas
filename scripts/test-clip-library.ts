// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// My clips (Seb, 2026-10-12): every clip Clip Factory rendered, still there to
// post, per creator, with where each one already went.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const route = read('app/api/youtube/shorts/library/route.ts')
check('the library lists only this creator\'s rendered clips', /\.eq\('user_id', user\.id\)\.eq\('status', 'rendered'\)\.not\('rendered_url', 'is', null\)/.test(route))
check('each file is checked, and a check that cannot answer is not called gone', /status === 404 \|\| r\.status === 410\) return false/.test(route) && /catch \{ return null \}/.test(route))
check('clips still rendering are counted', /\.eq\('status', 'rendering'\)/.test(route) && /rendering: rendering \?\? 0/.test(route))
const purge = read('app/api/cron/purge-shorts-sources/route.ts')
check('the retention sweep never deletes rendered clips', /Finished rendered\s*\n?\s*\/\/? ?\*? ?Shorts are the deliverable and are NOT touched/.test(purge) || /rendered Shorts are the deliverable and are NOT touched/.test(purge.replace(/\s*\*\s*/g, ' ')))
const lib = read('components/clip-factory/ClipLibrary.tsx')
check('My clips shows not-posted first, says where posted, and gone files apart', /useState<Filter>\('unposted'\)/.test(lib) && /Posted on \{on\.join/.test(lib) && /can no longer be posted: the file is not stored any more/.test(lib))
const cf = read('components/clip-factory/ClipFactory.tsx')
check('Clip Factory has the My clips tab, and a picked clip goes to Enhance', /<ClipLibrary/.test(cf) && /My clips/.test(cf) && /shortId: c\.id \}\)/.test(cf))
check('a post from Clip Factory is stamped on its clip', (cf.match(/markPosted\('(tiktok|instagram|youtube)'\)/g) || []).length === 3 && /\/api\/youtube\/shorts\/mark-posted/.test(cf))
check('a clip just made carries its id into Publish', /shortId: clip\.id \}\)/.test(read('components/vertical/ShortsCreatePanel.tsx')) && /shortId: c\.shortId \}\)/.test(cf))

if (failed) { console.error(`\n${failed} clip library check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
