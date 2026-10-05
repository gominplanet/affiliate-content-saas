/**
 * META HUB REELS ARE LONGER, COMPLETE MOMENTS.
 *
 * Clip Factory cut 15 to 30 second Shorts everywhere. A Facebook Reel that sends
 * people to buy needs a clip that makes sense on its own, so inside Meta Hub the
 * planner asks for complete segments sized to the source video, capped at
 * Facebook's 90 second limit for Page Reels published through the API.
 *
 * Run: npx tsx scripts/test-reel-length.ts
 */
import { readFileSync } from 'node:fs'
import { reelWindow, FACEBOOK_REEL_API_MAX_SEC } from '../lib/shorts-planner'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

check('a video over 3 minutes gets 45 to 90 second Reels', JSON.stringify(reelWindow(600)) === '{"minSec":45,"maxSec":90}' && JSON.stringify(reelWindow(180)) === '{"minSec":45,"maxSec":90}')
check('90 seconds to 3 minutes gets 30 to 60', JSON.stringify(reelWindow(150)) === '{"minSec":30,"maxSec":60}')
check('a short source keeps 15 to 30', JSON.stringify(reelWindow(70)) === '{"minSec":15,"maxSec":30}' && JSON.stringify(reelWindow(null)) === '{"minSec":15,"maxSec":30}')
check('never past Facebook\'s Page Reel limit', FACEBOOK_REEL_API_MAX_SEC === 90 && /Math\.min\(FACEBOOK_REEL_API_MAX_SEC, opts\.maxSec \?\? 30\)/.test(read('lib/shorts-planner.ts')))
const PL = read('lib/shorts-planner.ts')
check('Reels are asked for as complete segments, not teasers', /each clip must be a COMPLETE segment/.test(PL) && /never mid-sentence/.test(PL))
check('the plan route sizes Reels from the source video', /const lengths = reel \? reelWindow\(sourceSec\) : \{\}/.test(read('app/api/youtube/shorts/plan/route.ts')))
check('Meta Hub\'s Clip Factory asks for Reels', /reel=\{facebookOnly\}/.test(read('components/clip-factory/ClipFactory.tsx')) && /\.\.\.\(reel \? \{ format: 'reel' \} : \{\}\)/.test(read('components/vertical/ShortsCreatePanel.tsx')))
check('YouTube Shorts elsewhere stay 15 to 30', /opts\.minSec \?\? 15/.test(PL) && /opts\.maxSec \?\? 30/.test(PL))

if (failures.length) {
  console.error('❌ reel-length guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ reel-length guard passed: Meta Hub Reels are 45 to 90 second complete moments on longer videos')
