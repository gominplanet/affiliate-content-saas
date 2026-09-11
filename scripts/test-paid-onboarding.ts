// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A paying customer must never be held at a step the product does not enforce.
//
// WHAT HAPPENED. On 2026-09-11 a Studio customer signed up at 19:23:34, paid
// $79.20 two minutes later, signed in once more at 19:26:27 and never came
// back. Her account had no YouTube channel, no WordPress site and no Associates
// tag, so resolveOnboardingPath fell through to 'creator' and she got the main
// funnel. Step 1 of that funnel is "Connect YouTube", required: Save & next
// refused, Finish refused, "Skip for now" was hidden because the step was
// required, and the header's "Skip to dashboard" only rendered once YouTube or
// WordPress was already connected. The one visible exit on her screen was a
// panel offering free research tools.
//
// WHY IT WAS A BUG AND NOT A CHOICE. The funnel was stricter than the thing it
// was gating. lib/free-tier-gate.ts opens with `if (tier !== 'trial') return
// null`, so a channel is demanded of trial accounts and of nobody else. Her
// tier already granted 90 thumbnails, 90 pins, 70 Instagram posts, 45 Facebook
// posts, photobooth and research, none of which touch YouTube. The funnel was
// the only thing standing between her and all of it.
//
// The rule this file defends: the funnel may hold someone at YouTube only when
// lib/free-tier-gate.ts would also stop them. One tier, 'trial', and no other.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { youtubeRequiredForTier } from '../lib/onboarding-path'
import { TIERS } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ── who the gate applies to ─────────────────────────────────────────────────
{
  check('the free trial is still gated', youtubeRequiredForTier('trial') === true,
    'trial genuinely needs a channel before it spends one of its 5 posts')

  for (const tier of Object.keys(TIERS).filter((t) => t !== 'trial')) {
    check(`${tier} is not gated`, youtubeRequiredForTier(tier) === false,
      'a paying account walks past free-tier-gate untouched, so the funnel must not stop it either')
  }

  // Every paid tier in the table, named or not, so a tier added later cannot
  // quietly inherit the wall.
  check('studio, the tier that was actually lost, is not gated',
    youtubeRequiredForTier('studio') === false)
  check('amazon is not gated', youtubeRequiredForTier('amazon') === false)

  // An unreadable tier must fail CLOSED, to the strict behaviour, never open.
  check('a missing tier falls back to gated', youtubeRequiredForTier(null) === true)
  check('an unknown tier falls back to gated', youtubeRequiredForTier('enterprise') === true)
  check('the legacy name maps before it is judged', youtubeRequiredForTier('starter') === false,
    "normalizeTier turns 'starter' into 'creator', which is paid")
}

// ── the gate matches what free-tier-gate actually enforces ──────────────────
{
  const GATE = read('lib/free-tier-gate.ts')
  check('free-tier-gate still exempts every paid tier',
    /tier\s*!==\s*'trial'\s*\)\s*return null/.test(GATE),
    'if this ever changes, youtubeRequiredForTier has to change with it')
}

// ── the funnel honours the flag everywhere it could trap someone ────────────
{
  const F = read('components/onboarding/OnboardingFunnel.tsx')

  check('the page hands the funnel a real tier',
    /youtubeRequired=\{youtubeRequiredForTier\(intRow\?\.tier\)\}/.test(read('app/onboarding/page.tsx')),
    'and reads the column: a hardcoded true would restore the wall')
  check('the tier column is actually selected',
    /\.select\('[^']*\btier\b[^']*'\)/.test(read('app/onboarding/page.tsx')),
    'naming it without selecting it means undefined, which fails closed and walls everyone')

  check('Save & next checks the flag',
    /youtubeRequired && current\.required && !current\.done\(status\)/.test(F))
  check('Finish checks the flag',
    /youtubeRequired && !status\.ytConnected/.test(F))
  check('the rail unlocks without a channel',
    /function stepUnlocked\(n: number, s: Status, youtubeRequired: boolean\)/.test(F)
    && /if \(!youtubeRequired\) return true/.test(F))
  check('"Skip for now" is offered on step 1 when it is not required',
    /\(!current\.required \|\| !youtubeRequired\) && step < STEPS\.length/.test(F))
  check('"Skip to dashboard" is offered to an account with nothing connected',
    /status\.ytConnected \|\| status\.wpConnected \|\| !youtubeRequired/.test(F),
    'it was hidden from exactly the people who had no way forward')

  // The failure this repo keeps producing is a screen that states the plan
  // rather than the outcome. This footnote promised a skip the footer refused
  // to render.
  check('the step no longer promises a skip it will not give',
    !/Not ready\? You can skip this and connect later from Set up\./.test(F),
    'that line was shown to users the funnel then refused to let past')
  check('the trial still gets told where its other door is',
    /required \?/.test(F) && /onboarding\?for=amazon/.test(F))
}

if (failures.length) {
  console.error(`\n❌ paid-onboarding: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ paid-onboarding: only the free trial can be held at "Connect YouTube"; every paying account can walk through')
