// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CAP YOU CAN ONLY DISCOVER BY HITTING IT.
//
// 17 Sep 2026, from a Pro creator:
//
//   "Hi Seb I am on the pro plan is there a limit to how many renders I can do
//    now in clip factory? It says I hit my limit of 50."
//
// There is: 50 finished Shorts per billing period, claimed atomically so
// concurrent renders cannot slip past it. The cap worked and her red message was
// correct. Nothing here changes the number.
//
// What failed is that she had to ask. The count existed in exactly one place, a
// small pill beside the Clip Factory page title, and it had two faults that
// compounded:
//
//   1. It loaded once on mount and refreshed only when somebody clicked
//      "Use this clip", which is not the action that spends a slot. So it could
//      sit at 12 / 50 while she rendered her fiftieth.
//   2. It was in the page header, scrolled far above the Render Short buttons
//      in the moment list she was actually working in.
//
// And the Shorts Studio modal, which renders through the same capped route from
// /content, had no counter at all.
//
// A number that does not move is worse than no number: it reads as evidence
// there is plenty left. This pins the counter at the decision, moving.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHORTS_MONTHLY_CAP } from '../lib/usage-cap'
import { quotaTone } from '../components/vertical/ShortsQuotaBadge'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const BADGE = read('components/vertical/ShortsQuotaBadge.tsx')
const BADGE_LIVE = live(BADGE)
/** Every surface that can spend a Shorts render. */
const RENDER_SURFACES = [
  'components/vertical/ShortsCreatePanel.tsx',
  'components/content/ShortsStudioModal.tsx',
]
const USAGE_ROUTE = read('app/api/youtube/shorts/usage/route.ts')
const RENDER_ROUTE = live(read('app/api/youtube/shorts/render/route.ts'))

// ── the cap is a billing decision, made in one place ────────────────────────
//
// This used to pin the literal 50, on the reasoning that an edit to the display
// must not quietly become an edit to the allowance. Right instinct, wrong
// mechanism: it froze the VALUE, so it failed the moment the cap was
// deliberately raised, and a guard that fails on the intended change is a guard
// somebody edits without reading.
//
// What actually protects the allowance is that there is ONE number and every
// surface reads it. So: a sane band (a typo'd 1500 or a 0 still fails), and
// nothing anywhere types the figure next to a read of it.
{
  check('the Pro cap is a deliberate number, not a typo',
    Number.isInteger(SHORTS_MONTHLY_CAP) && SHORTS_MONTHLY_CAP >= 25 && SHORTS_MONTHLY_CAP <= 500,
    `${SHORTS_MONTHLY_CAP}: outside the band a Clip Factory allowance should ever be. Widen this deliberately or fix the constant`)
  {
    // Every user-facing surface must READ it. A literal beside the read is the
    // drift that put "50 finished shorts a month" in the tool guide and in the
    // assistant's prompt while the constant said something else.
    const TYPED: string[] = []
    for (const rel of [
      'components/guide/tool-guides.tsx',
      'components/vertical/ShortsQuotaBadge.tsx',
      'app/api/youtube/shorts/render/route.ts',
      'app/api/youtube/shorts/usage/route.ts',
      'app/api/usage/summary/route.ts',
    ]) {
      const src = live(read(rel))
      if (new RegExp(`\\b${SHORTS_MONTHLY_CAP}\\b`).test(src)) TYPED.push(rel)
    }
    check('no surface types the cap beside reading it', TYPED.length === 0, TYPED.join(', '))

    // The typed check above only catches a literal equal to the CURRENT cap. A
    // stale literal (the guide saying 50 while the constant says 150) is the
    // more likely drift and slips straight past it, so the surfaces that state
    // the number to a creator must be shown to READ it.
    for (const rel of ['components/guide/tool-guides.tsx']) {
      const src = live(read(rel))
      check(`${rel} reads the cap rather than stating one`,
        /\{SHORTS_MONTHLY_CAP\}/.test(src) && /from '@\/lib\/usage-cap'/.test(src),
        'this line is what a creator is shown when they ask what their limit is')
    }
  }
  check('and the render route still enforces it atomically',
    /claim_shorts_render/.test(RENDER_ROUTE),
    'the RPC locks per user so concurrent renders cannot both take the last slot')
  check('a refused render still names the number and the reset date',
    /You've rendered all \$\{capLimit\} Shorts for this billing period\. Resets \$\{resetLabel\}/.test(RENDER_ROUTE))
}

// ── the counter is where the button is ──────────────────────────────────────
{
  for (const rel of RENDER_SURFACES) {
    const src = live(read(rel))
    check(`${rel} shows the remaining count`,
      /<ShortsQuotaBadge \/>/.test(src),
      'a creator deciding whether to render should not have to scroll to find out how many are left')
  }
  check('the Clip Factory header uses the same badge, not its own copy',
    /<ShortsQuotaBadge \/>/.test(live(read('app/(dashboard)/clip-factory/page.tsx'))),
    'the second implementation is the one that goes stale')
  check('and no longer keeps a private usage fetch beside it',
    !/fetch\('\/api\/youtube\/shorts\/usage'\)/.test(live(read('app/(dashboard)/clip-factory/page.tsx'))),
    'two readers of one number is how they disagree')
}

// ── and it moves when a slot is spent ───────────────────────────────────────
//
// The fault that actually cost her the warning. Refreshing on mount is not
// refreshing: the number only matters after a render.
{
  for (const rel of RENDER_SURFACES) {
    const src = live(read(rel))
    check(`${rel} refreshes the count after a successful render`,
      /notifyShortsUsageChanged\(\)/.test(src))
    // Placement matters as much as presence. Announcing before the response is
    // checked would count renders that failed, which hands back the opposite
    // lie: a creator told she has spent slots she still has.
    const idx = src.indexOf('notifyShortsUsageChanged()')
    const throwIdx = src.indexOf("throw new Error(data.error || 'Render failed')")
    check(`${rel} refreshes only AFTER the render is known to have succeeded`,
      idx > throwIdx && throwIdx !== -1,
      'a failed render is refunded, so counting it would overstate what she has spent')
  }
  check('the badge listens for that signal rather than polling',
    /window\.addEventListener\(EVENT/.test(BADGE_LIVE) && /removeEventListener\(EVENT/.test(BADGE_LIVE),
    'and cleans up, or every remount adds another listener')
  check('the signal reaches surfaces that are not children of the counter',
    /window\.dispatchEvent/.test(BADGE_LIVE),
    'a prop chain is exactly how the Shorts Studio modal ended up with no counter')
}

// ── it warns before the wall, and says nothing it cannot support ────────────
{
  // Tested as behaviour, not as a constant's name. The first version of this
  // clause grepped for LOW_WATER, and renaming the constant to
  // LOW_WATER_MARK_REMOVED while disabling the comparison left it passing.
  check('a creator with room to work is not warned',
    quotaTone(50) === 'ok' && quotaTone(6) === 'ok', `${quotaTone(6)}`)
  check('the warning arrives with slots still in hand, not at zero',
    quotaTone(5) === 'low' && quotaTone(1) === 'low',
    'the first warning arriving at zero is the problem, not the fix')
  check('and zero is its own state',
    quotaTone(0) === 'spent')
  check('a count that somehow went negative still reads as spent, never as room',
    quotaTone(-3) === 'spent',
    'a stale reservation row could do this, and "-3 Shorts left" must not read as plenty')
  check('the pill counts down rather than up',
    /Shorts left/.test(BADGE) && !/Shorts this month/.test(BADGE),
    '"38 / 50" needs arithmetic before it is a decision; "12 left" already is one')
  check('the reset date rides along once it matters',
    /resets \$\{usage\.resetLabel\}/.test(BADGE),
    'the other half of "when do I get more"')
  check('nothing is claimed before the first answer arrives',
    /if \(!usage \|\| usage\.limit === null\) return null/.test(BADGE_LIVE),
    'a placeholder number is a claim')
  check('admin, who has no cap, is shown no number',
    /usage\.limit === null/.test(BADGE_LIVE))
  check('a failed read keeps the last known number instead of inventing one',
    !/setUsage\(null\)/.test(BADGE_LIVE) && !/setUsage\(\{/.test(BADGE_LIVE),
    'falling back to a zero would read as a full allowance')
  check('the endpoint already returned remaining, so nothing new is computed',
    /remaining: limit === null \? null : Math\.max\(0, limit - used\)/.test(USAGE_ROUTE),
    'a second arithmetic path is a second chance to disagree')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
