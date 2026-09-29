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
check('the button shows only to who may use it', /\{canUsePreview\('facebook_reels', tier\) && [^\n]*<PostPill label="Facebook Reel"/.test(PAGE) || /canUsePreview\('facebook_reels', tier\) && !\(clip\?\.durationSec/.test(PAGE))
check('the toast says live or processing from what Facebook reported', /data\.state === 'published'/.test(PAGE))
check('it starts admin-only', /facebook_reels: 'admin'/.test(LABS))

// THE WHOLE VIDEO as one clip (Labs whole_video).
const PLAN = readFileSync('app/api/youtube/shorts/plan/route.ts', 'utf8')
const PANEL = readFileSync('components/vertical/ShortsCreatePanel.tsx', 'utf8')
check('whole mode makes one clip from the first second to the last, with no AI picking',
  /if \(body\.whole === true\)/.test(PLAN) && /start_sec: 0, end_sec: total/.test(PLAN)
  && PLAN.indexOf('if (body.whole === true)') < PLAN.indexOf('await planShorts('))
check('whole mode is Labs, on the server and on the button',
  /canUsePreview\('whole_video', tier\)/.test(PLAN) && /allowWhole=\{canUsePreview\('whole_video', tier\)\}/.test(PAGE) && /whole_video: 'admin'/.test(LABS))
check('a clip too long for Facebook Reels does not offer Facebook', /!\(clip\?\.durationSec && clip\.durationSec > 90\)/.test(PAGE))
check('the platform limits are said before posting', /Facebook Reels take up to 90 seconds/.test(PAGE) && /over 3 minutes as a regular video/.test(PAGE))
check('the whole clip joins the list instead of wiping rendered clips', /prev\.filter\(c => c\.status !== 'suggested'\)/.test(PANEL))

// When YouTube refuses the download, the way out is on the page.
const RENDER = readFileSync('app/api/youtube/shorts/render/route.ts', 'utf8')
check('a refused download shows the upload box, even for a video from YouTube',
  /setNeedsUpload\(true\)/.test(PANEL) && /!hasSource && \(!youtubeVideoId \|\| needsUpload\)/.test(PANEL))
check('no message names a button that is not on the page', !/Upload or pick a short/.test(PANEL + RENDER))
check('the whole video is labelled, not scored 0/100', /'Whole video'/.test(PANEL) && /clip\.score > 0 \?/.test(PANEL))

if (failures.length) {
  console.error(`\n❌ facebook-reels: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ facebook-reels: a clip goes to the Page in Meta\'s three steps, the screen says whether it is live, and a whole video posts as one clip')
