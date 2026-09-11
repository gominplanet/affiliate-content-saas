// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The free tier now has to sell the Amazon plan, and three things can quietly
// stop it.
//
// The loop is: an Amazon product → a finished design with their own face on it →
// downloaded, in their hands. Complete that once and the $79 explains itself.
//
//  1. THE BREAKER FIRES MID-TRIAL. The ceiling was $5. Five thumbnails, five
//     designs, a face model and six headshots do not fit under $5, so generation
//     would stop working partway through, on the most engaged users first, and a
//     generation that just stops does not read as a limit. It reads as broken.
//
//  2. THE POOL LEAKS. Five designs pooled across pins, Instagram and Facebook
//     is five. Three separate caps of five is fifteen, at roughly triple the
//     cost, and nothing would look wrong until the bill.
//
//  3. THE QUALIFIER GOES MISSING. Free AI without a bar feeds signup-and-farm
//     bots. The bar moved from a connected WordPress site to an Amazon
//     Associates tag: one field, known by heart by a real Amazon influencer,
//     owned by no bot farm. If that check stops running, free AI is open to
//     anyone with an email address.
import { TIERS } from '../lib/tier'
import {
  FREE_TRIAL, looksLikeAssociatesTag, freeTrialImageBlock, pooledDesignCap,
  freeTrialHighlights, freeTrialExclusions,
} from '../lib/free-trial'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the loop is actually affordable ─────────────────────────────────────────
{
  const trial = TIERS.trial
  check('the free tier can reach the loop it advertises',
    trial.monthlyAiSpendCeilingUsd === FREE_TRIAL.aiSpendCeilingUsd,
    `tier says ${trial.monthlyAiSpendCeilingUsd}, the trial spec says ${FREE_TRIAL.aiSpendCeilingUsd}`)
  check('and the ceiling is above the old $5',
    (trial.monthlyAiSpendCeilingUsd ?? 0) > 5,
    'at $5 the circuit breaker cut users off partway through the trial')

  // A rough floor for the advertised allowance, using the costs recorded in the
  // Amazon tier comment: ~$0.14 a thumbnail, ~$0.06 a design, and a face model
  // plus six headshots on top. If the ceiling ever drops back under this, the
  // breaker becomes the real cap again.
  const roughFloor = FREE_TRIAL.thumbnails * 0.14 + FREE_TRIAL.socialDesigns * 0.06 + 6 * 0.06 + 1.0
  check('the ceiling has headroom over the advertised allowance',
    (trial.monthlyAiSpendCeilingUsd ?? 0) > roughFloor * 1.5,
    `ceiling ${trial.monthlyAiSpendCeilingUsd}, rough cost of the full allowance ${roughFloor.toFixed(2)}`)
}

// ── the numbers the user is shown are the numbers the server enforces ───────
{
  const trial = TIERS.trial
  check('thumbnails match', trial.thumbnailsPerMonth === FREE_TRIAL.thumbnails)
  check('the design pool matches', trial.socialDesignsPerMonth === FREE_TRIAL.socialDesigns)
  check('the face model is included', trial.maxFaces === FREE_TRIAL.faces,
    '"your face on every design" is the trial\'s whole argument')
  check('the headshots are included', trial.photoboothPerMonth === FREE_TRIAL.photobooth)

  // The trial matches the Amazon tier on faces and headshots on purpose: it is a
  // one-time cost and the most memorable part of the product.
  check('the face allowance matches the plan it is selling', trial.maxFaces === TIERS.amazon.maxFaces)
  check('the headshot allowance matches too', trial.photoboothPerMonth === TIERS.amazon.photoboothPerMonth)
}

// ── publishing stays paid ───────────────────────────────────────────────────
//
// The download is free and the publish is the upgrade, so the wall lands while
// the creator is holding a finished design rather than before they have seen
// one. If any of these opens up, the trial stops being a trial.
{
  const trial = TIERS.trial
  check('no social publishing on the free tier', trial.socials.length === 0,
    'publishing is the upgrade moment; giving it away removes the moment')
  check('no brand pitches', trial.collabsPerMonth === 0,
    'seeing a campaign they cannot claim is the strongest upgrade trigger there is')
  check('no deal posts', trial.dealsPerMonth === 0)
  check('no publish-all', trial.publishAll === false)
}

// ── the design pool ─────────────────────────────────────────────────────────
{
  check('the free tier pools its designs', pooledDesignCap(TIERS.trial) === 5)

  // Every paid tier must NOT pool: a pin cap and an Instagram cap are separate
  // promises there, and pooling them would silently cut what was sold.
  for (const t of ['creator', 'amazon', 'studio', 'pro', 'admin'] as const) {
    check(`${t} keeps its per-format caps`, pooledDesignCap(TIERS[t]) === null,
      'pooling a paid tier would quietly deliver less than was advertised')
  }

  // The pool is the ONLY thing standing between five designs and fifteen. The
  // per-format numbers on the trial are left at 0 so that a tier which somehow
  // lost its pool falls closed instead of open.
  check('the trial\'s per-format caps fall closed',
    TIERS.trial.pinsPerMonth === 0 && TIERS.trial.igPostsPerMonth === 0 && TIERS.trial.facebookPostsPerMonth === 0,
    'if they were 5 each, losing the pool would hand out 15 designs at triple the cost')
}

// ── the qualifier ───────────────────────────────────────────────────────────
{
  check('a normal tag passes', looksLikeAssociatesTag('alejandrogime-20'))
  check('a short tag passes', looksLikeAssociatesTag('seb-20'))
  check('a three-digit store id passes', looksLikeAssociatesTag('gominreviews-201'))
  check('a UK tag passes', looksLikeAssociatesTag('mvpaffiliate-21'))

  check('an empty tag fails', !looksLikeAssociatesTag(''))
  check('whitespace fails', !looksLikeAssociatesTag('   '))
  check('null fails', !looksLikeAssociatesTag(null))
  check('an email is not a tag', !looksLikeAssociatesTag('me@example.com'))
  check('a bare word is not a tag', !looksLikeAssociatesTag('amazon'),
    'the store-id suffix is the part a bot farm does not have')

  // Deliberately loose. This qualifies an audience, it does not prove ownership,
  // and turning away a real creator with an unusual tag costs far more than
  // letting a malformed one through.
  check('an odd but plausible tag is allowed', looksLikeAssociatesTag('my-store-name-20'))
}

// ── the gate ────────────────────────────────────────────────────────────────
{
  check('a free user with a tag can generate',
    freeTrialImageBlock({ tier: 'trial', amazonTag: 'alejandrogime-20' }) === null)

  const noTag = freeTrialImageBlock({ tier: 'trial', amazonTag: null })
  check('a free user with no tag is blocked', noTag !== null)
  check('and is told exactly what to do', /Associates tag/.test(noTag ?? '') && /Setup/.test(noTag ?? ''), String(noTag))
  check('and is told it is not a connection', /no site or account to connect/.test(noTag ?? ''), String(noTag),
    )

  // A typo'd tag and a missing one need different sentences: one is "go and
  // find yours", the other is "look again at the one you typed".
  const badTag = freeTrialImageBlock({ tier: 'trial', amazonTag: 'alejandrogime' })
  check('a malformed tag is blocked', badTag !== null)
  check('and says so specifically', badTag !== noTag, String(badTag))
  check('and shows the shape expected', /-20/.test(badTag ?? ''), String(badTag))

  // No paid tier is ever gated here. An Amazon subscriber without a tag on file
  // must never be stopped from generating what they are paying for.
  for (const t of ['creator', 'amazon', 'studio', 'pro', 'admin'] as const) {
    check(`${t} is never gated on the tag`,
      freeTrialImageBlock({ tier: t, amazonTag: null }) === null,
      'this gate is a free-tier qualifier, not a product requirement')
  }
}

// ── one description of the free plan, not three ─────────────────────────────
{
  const h = freeTrialHighlights()
  check('the highlights name the thumbnail count', h.some(x => x.includes(String(FREE_TRIAL.thumbnails))))
  check('the highlights name the design count', h.some(x => x.includes(String(FREE_TRIAL.socialDesigns))))
  check('the highlights name the headshot count', h.some(x => x.includes(String(FREE_TRIAL.photobooth))))
  check('the highlights promise the download', h.some(x => /[Dd]ownload/.test(x)),
    'the free half of the loop ends at the download; saying so is what makes the paywall land right')
  check('the exclusions name publishing', freeTrialExclusions().some(x => /Publishing/.test(x)),
    'a trial that hides its walls until you hit one produces a support ticket, not an upgrade')
}

// ── the wiring ──────────────────────────────────────────────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const THUMB = readFileSync('app/api/youtube/generate-thumbnail/route.ts', 'utf8')
  const BOOTH = readFileSync('app/api/photobooth/route.ts', 'utf8')
  const FACES = readFileSync('app/api/face-models/route.ts', 'utf8')
  const PRICING = readFileSync('app/pricing/page.tsx', 'utf8')

  for (const [name, src] of [['thumbnails', THUMB], ['photobooth', BOOTH], ['face models', FACES]] as const) {
    check(`${name} check the qualifier`, /freeTrialImageBlock\(/.test(src),
      'a route that skips it hands free AI to anyone with an email address')
  }
  // Compare the CALL SITES, not the imports: the two import lines sit next to
  // each other at the top and would compare in whatever order they were typed,
  // proving nothing about when either one runs.
  check('the qualifier runs before the spend on thumbnails',
    THUMB.indexOf('freeTrialImageBlock({') < THUMB.indexOf('await spendGate('),
    'a gate after the generation has already cost the money it exists to protect')
  check('both call sites are actually present',
    THUMB.includes('freeTrialImageBlock({') && THUMB.includes('await spendGate('),
    'an indexOf of -1 compares as "earlier" and would pass this by finding nothing')
  check('the pooled cap is honoured', /pooledDesignCap\(T\)/.test(THUMB))
  check('and it covers all three formats',
    /capFeatures = \['amazon_pin', 'amazon_ig', 'amazon_fb'\]/.test(THUMB),
    'one counter across the three is what makes five designs mean five')
  check('the pricing page reads the same list', /freeTrialHighlights\(\)/.test(PRICING),
    'three surfaces describing three different free plans is how a refund request starts')

  // The loop has to be REACHABLE. The caps and the qualifier are meaningless if
  // the free user cannot see the Amazon hub in the first place, which was the
  // state before this change: the whole thing the ads sell was hidden from
  // everyone who had not already paid for it.
  const SHELL = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
  check('a free user can reach the Amazon hub',
    /canAmazonHub = \(\['trial',/.test(SHELL),
    'the trial cannot complete a loop it cannot navigate to')

  // And it must need no connection to get there. The dashboard layout bounces an
  // un-onboarded user to /onboarding for CONTENT routes only; /amazon must stay
  // out of that list or the first win needs a YouTube channel again.
  const LAYOUT = readFileSync('app/(dashboard)/layout.tsx', 'utf8')
  const contentRoutes = LAYOUT.slice(LAYOUT.indexOf('const CONTENT_ROUTES'), LAYOUT.indexOf('function isContentRoute'))
  check('the Amazon hub needs no connection to open',
    !/'\/amazon'/.test(contentRoutes),
    'adding /amazon to CONTENT_ROUTES puts the YouTube connection back in front of the first win')
}

if (failures.length) {
  console.error(`\n❌ free-trial: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ free-trial: the Amazon loop fits under the ceiling, the pool holds, and free AI still needs a real Associates tag')
