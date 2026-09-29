// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Facebook Reels from Clip Factory: the three Meta steps in order, the answer
// read back rather than assumed, and the whole thing behind Labs.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }

const LIB = readFileSync('lib/facebook-reels.ts', 'utf8')
const ROUTE = readFileSync('app/api/clip-factory/facebook-reel/route.ts', 'utf8')
const PAGE = readFileSync('app/(dashboard)/clip-factory/page.tsx', 'utf8')
const LABS = readFileSync('lib/labs-preview.ts', 'utf8')

check('start, upload by URL, then finish as published, in that order',
  LIB.indexOf("upload_phase: 'start'") < LIB.indexOf('rupload.facebook.com') && LIB.indexOf('rupload.facebook.com') < LIB.indexOf("upload_phase: 'finish'")
  && /file_url: opts\.videoUrl/.test(LIB) && /video_state: 'PUBLISHED'/.test(LIB))
check('the status is read back, and "still processing" is never called live',
  /fields=status/.test(LIB) && /state: 'processing'/.test(LIB) && /step: 'processing'/.test(LIB))
check('the route is Labs and Meta-gated', /canUsePreview\('facebook_reels', tier\)/.test(ROUTE) && /metaEnabledForUser/.test(ROUTE))
check('a refused permission tells the creator to reconnect', /Reconnect Facebook under Social Accounts/.test(ROUTE))
check('the button shows only to who may use it', /canUsePreview\('facebook_reels', tier\) && \(/.test(PAGE))
check('the toast says live or processing from what Facebook reported', /data\.state === 'published'/.test(PAGE))
check('it starts admin-only', /facebook_reels: 'admin'/.test(LABS))

if (failures.length) {
  console.error(`\n❌ facebook-reels: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ facebook-reels: a clip goes to the Page in Meta\'s three steps, and the screen says whether it is live')
