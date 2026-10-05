/**
 * A LOWERED CAP LANDS ON THE NEXT BILLING WINDOW, NEVER MID-CYCLE.
 *
 * The 2026-10-05 limit changes cut a Pro member from 100 generations to 60
 * while he was 54 into his month. The rule (lib/tier effectiveCap): a window
 * that began before the change keeps the old cap; the next window gets the
 * new one; new signups get the new one at once. Every place that enforces or
 * shows a lowered cap goes through it.
 *
 * Run: npx tsx scripts/test-cap-stepdown.ts
 */
import { readFileSync } from 'node:fs'
import { effectiveCap, effectivePostCap, CAP_STEPDOWN_ISO, TIERS, LEGACY_PRO_COHORT } from '../lib/tier'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

const before = '2026-09-20T00:00:00.000Z'
const after = '2026-10-20T00:00:00.000Z'
check('the step-down is dated after the change shipped', CAP_STEPDOWN_ISO >= '2026-10-05T13:36:05.000Z')
check('Pro is 100 generations for everyone (back up from 60 the same day)', TIERS.pro.postsPerMonth === 100 && effectivePostCap('pro', after) === 100)
check('a Pro member from before keeps the old thumbnail cap for good, in any window',
  effectiveCap('pro', 'thumbnailsPerMonth', TIERS.pro.thumbnailsPerMonth, after, LEGACY_PRO_COHORT) === 300)
check('a new Pro member gets the new thumbnail cap', effectiveCap('pro', 'thumbnailsPerMonth', TIERS.pro.thumbnailsPerMonth, after, null) === TIERS.pro.thumbnailsPerMonth)
check('the Pro mark does nothing on another plan', effectiveCap('amazon', 'collabsPerMonth', TIERS.amazon.collabsPerMonth, after, LEGACY_PRO_COHORT) === TIERS.amazon.collabsPerMonth)
check('Pro thumbnails, pins, X keep their old caps for that window',
  effectiveCap('pro', 'thumbnailsPerMonth', TIERS.pro.thumbnailsPerMonth, before) === 300 &&
  effectiveCap('pro', 'pinsPerMonth', TIERS.pro.pinsPerMonth, before) === 200 &&
  effectiveCap('pro', 'xPostsPerMonth', 75, before) === 100)
check('Amazon assistant and collabs keep theirs for that window',
  effectiveCap('amazon', 'assistantMessagesPerMonth', TIERS.amazon.assistantMessagesPerMonth, before) === 600 &&
  effectiveCap('amazon', 'collabsPerMonth', TIERS.amazon.collabsPerMonth, before) === 60)
check('a cap is never LOWERED by the old value', effectiveCap('pro', 'thumbnailsPerMonth', 500, before) === 500)
check('unlimited stays unlimited', effectiveCap('pro', 'thumbnailsPerMonth', null, before) === null)
check('an unknown window start gets the current cap', effectiveCap('pro', 'thumbnailsPerMonth', 200, null) === 200)

const SITES: Array<[string, RegExp]> = [
  ['app/api/youtube/generate-thumbnail/route.ts', /effectiveCap\(tier, 'thumbnailsPerMonth', T\.thumbnailsPerMonth, winStart, cohort\)/],
  ['app/api/assistant/chat/route.ts', /effectiveCap\(tier, 'assistantMessagesPerMonth'[\s\S]{0,260}limits_cohort/],
  ['app/api/collaborations/generate/route.ts', /effectiveCap\(tier, 'collabsPerMonth', TIERS\[tier\]\.collabsPerMonth, startISO, /],
  ['lib/x-cap.ts', /effectiveCap\(tier, 'xPostsPerMonth', X_MONTHLY_CAP, startISO, \(data as/],
  ['lib/tier.ts', /const limit = effectivePostCap\(tier, startISO, \(ig as \{ limits_cohort/],
  ['app/api/usage/summary/route.ts', /ec\('xPostsPerMonth', X_MONTHLY_CAP\)/],
  ['app/api/usage/generations/route.ts', /effectivePostCap\(tier, startISO, /],
]
for (const [f, re] of SITES) check(`${f}: uses the cap in force for the window`, re.test(read(f)))

if (failures.length) {
  console.error('❌ cap-stepdown guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ cap-stepdown guard passed (lowered caps start on the next billing window, everywhere they are enforced or shown)')
