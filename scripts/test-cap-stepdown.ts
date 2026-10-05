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
import { effectiveCap, effectivePostCap, CAP_STEPDOWN_ISO, TIERS } from '../lib/tier'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

const before = '2026-09-20T00:00:00.000Z'
const after = '2026-10-20T00:00:00.000Z'
check('the step-down is dated after the change shipped', CAP_STEPDOWN_ISO >= '2026-10-05T13:36:05.000Z')
check('a Pro window that began before keeps 100 generations', effectivePostCap('pro', before) === 100)
check('the next Pro window gets 60', effectivePostCap('pro', after) === TIERS.pro.postsPerMonth)
check('Pro thumbnails, pins, X keep their old caps for that window',
  effectiveCap('pro', 'thumbnailsPerMonth', TIERS.pro.thumbnailsPerMonth, before) === 300 &&
  effectiveCap('pro', 'pinsPerMonth', TIERS.pro.pinsPerMonth, before) === 200 &&
  effectiveCap('pro', 'xPostsPerMonth', 75, before) === 100)
check('Amazon assistant and collabs keep theirs for that window',
  effectiveCap('amazon', 'assistantMessagesPerMonth', TIERS.amazon.assistantMessagesPerMonth, before) === 600 &&
  effectiveCap('amazon', 'collabsPerMonth', TIERS.amazon.collabsPerMonth, before) === 60)
check('a cap is never LOWERED by the old value', effectiveCap('pro', 'postsPerMonth', 500, before) === 500)
check('unlimited stays unlimited', effectiveCap('pro', 'postsPerMonth', null, before) === null)
check('an unknown window start gets the current cap', effectiveCap('pro', 'postsPerMonth', 60, null) === 60)

const SITES: Array<[string, RegExp]> = [
  ['app/api/youtube/generate-thumbnail/route.ts', /effectiveCap\(tier, 'thumbnailsPerMonth'/],
  ['app/api/assistant/chat/route.ts', /effectiveCap\(tier, 'assistantMessagesPerMonth'/],
  ['app/api/collaborations/generate/route.ts', /effectiveCap\(tier, 'collabsPerMonth'/],
  ['lib/x-cap.ts', /effectiveCap\(tier, 'xPostsPerMonth', X_MONTHLY_CAP, startISO\)/],
  ['lib/tier.ts', /const limit = effectivePostCap\(tier, startISO\)/],
  ['app/api/usage/summary/route.ts', /ec\('xPostsPerMonth', X_MONTHLY_CAP\)/],
]
for (const [f, re] of SITES) check(`${f}: uses the cap in force for the window`, re.test(read(f)))

if (failures.length) {
  console.error('❌ cap-stepdown guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ cap-stepdown guard passed (lowered caps start on the next billing window, everywhere they are enforced or shown)')
