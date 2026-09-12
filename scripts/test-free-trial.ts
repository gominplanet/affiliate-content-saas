// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The free tier now has to sell the Amazon plan, and three things can quietly
// stop it.
//
// The loop is: an Amazon product → a finished design with their own face on it →
// downloaded, in their hands. Complete that once and the $79 explains itself.
//
//  1. THE BREAKER FIRES MID-TRIAL. The ceiling was $5. Five thumbnails, five
//     designs, a face model and its headshots do not fit under $5, so generation
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
import { TIERS, nextTierFor } from '../lib/tier'
import {
  FREE_TRIAL, looksLikeAssociatesTag, freeTrialImageBlock, pooledDesignCap,
  freeTrialHighlights, freeTrialExclusions, freeTrialWindow, freeTrialExpiredBlock,
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
  // plus its headshots on top. Reads the headshot count rather than hardcoding
  // it, so changing the allowance re-checks the ceiling instead of quietly
  // invalidating this sum. If the ceiling drops back under it, the breaker
  // becomes the real cap again.
  const roughFloor = FREE_TRIAL.thumbnails * 0.14 + FREE_TRIAL.socialDesigns * 0.06 + FREE_TRIAL.photobooth * 0.06 + 1.0
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

  // The trial gets ONE face on purpose: putting your own face on a design is the
  // whole argument, and a trial that cannot do it once has no argument.
  check('the face allowance matches the plan it is selling', trial.maxFaces === TIERS.amazon.maxFaces)

  // The headshots must NOT match. They used to, at 6 apiece, which meant a $79
  // subscriber had exactly the allowance of somebody paying nothing. Two is
  // enough to watch your own face come out of the machine, which is all this
  // number has to do.
  check('the trial gets fewer headshots than the plan it is selling',
    (trial.photoboothPerMonth ?? 0) < (TIERS.amazon.photoboothPerMonth ?? 0),
    `trial ${trial.photoboothPerMonth} vs amazon ${TIERS.amazon.photoboothPerMonth}`)
  check('but still enough to see its own face once',
    (trial.photoboothPerMonth ?? 0) >= 1,
    'zero headshots removes the reason the trial converts')

  // And no PAID plan may sit at or below the free one on headshots. Amazon was
  // the only one that did; this catches the next one.
  for (const t of ['creator', 'amazon', 'studio', 'pro'] as const) {
    check(`${t} gets more headshots than the free plan`,
      (TIERS[t].photoboothPerMonth ?? 0) > (trial.photoboothPerMonth ?? 0),
      `${t} ${TIERS[t].photoboothPerMonth} vs trial ${trial.photoboothPerMonth}`)
  }
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

// ── the free month, and the fact that it ends ───────────────────────────────
//
// Free allowances were monthly and the counter reset on the 1st, so a free
// account got five thumbnails, five designs and its headshots again every month
// for as long as it existed. That is not a trial. It also meant somebody who
// signed up on the 28th spent five designs and had five more three days later.
{
  const at = (iso: string) => new Date(iso)
  const SIGNUP = '2026-09-01T12:00:00.000Z'

  const day1 = freeTrialWindow(SIGNUP, at('2026-09-01T12:00:01.000Z'))
  check('the window starts at signup, not the 1st of the month',
    day1.startISO === new Date(SIGNUP).toISOString(), day1.startISO)
  check('and it is not over on day one', !day1.expired)
  check('with the whole month left', day1.daysLeft === FREE_TRIAL.trialDays - 1,
    String(day1.daysLeft))

  // The case the calendar window got wrong.
  const lateSignup = freeTrialWindow('2026-09-28T00:00:00.000Z', at('2026-10-02T00:00:00.000Z'))
  check('a late-in-the-month signup still has its month four days later',
    !lateSignup.expired,
    'under the calendar window their allowance came back on 1 October instead')
  check('and the counter still starts at their signup',
    lateSignup.startISO.startsWith('2026-09-28'), lateSignup.startISO)

  const justOver = freeTrialWindow(SIGNUP, at('2026-10-01T12:00:01.000Z'))
  check('the month ends after exactly the advertised days', justOver.expired,
    `${FREE_TRIAL.trialDays} days from ${SIGNUP}`)
  check('and nothing is left', justOver.daysLeft === 0, String(justOver.daysLeft))

  const justUnder = freeTrialWindow(SIGNUP, at('2026-10-01T11:59:00.000Z'))
  check('and not one minute early', !justUnder.expired)

  // A date we cannot read must never be why an account stops working.
  for (const bad of [null, undefined, '', 'not a date']) {
    const w = freeTrialWindow(bad as string | null | undefined, at('2027-01-01T00:00:00.000Z'))
    check(`an unreadable signup date (${JSON.stringify(bad)}) does not expire anybody`, !w.expired)
  }

  // The block itself.
  check('a paid plan is never told its trial is over',
    (['creator', 'amazon', 'studio', 'pro', 'admin'] as const).every(t =>
      freeTrialExpiredBlock({ tier: t, signupISO: '2020-01-01T00:00:00.000Z' }) === null))
  const over = freeTrialExpiredBlock({ tier: 'trial', signupISO: '2020-01-01T00:00:00.000Z' })
  check('an expired trial gets a sentence', typeof over === 'string' && over.length > 40)
  check('and it says what they keep, not only what stopped',
    /still yours to download/i.test(over ?? '') && /research/i.test(over ?? ''),
    'an account that refuses to generate and explains nothing reads as broken, not finished')
  check('a trial inside its month is not blocked',
    freeTrialExpiredBlock({ tier: 'trial', signupISO: new Date().toISOString() }) === null)

  // Wiring: every route that spends free AI has to honour both halves.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  for (const f of [
    'app/api/youtube/generate-thumbnail/route.ts',
    'app/api/photobooth/route.ts',
    'app/api/face-models/route.ts',
  ]) {
    const src = readFileSync(f, 'utf8')
    check(`${f} refuses an expired trial`, /freeTrialExpiredBlock\(/.test(src),
      'without it the free month never actually ends')
  }
  for (const f of ['app/api/youtube/generate-thumbnail/route.ts', 'app/api/photobooth/route.ts']) {
    const src = readFileSync(f, 'utf8')
    check(`${f} counts inside the free month rather than the calendar month`,
      /freeTrialWindow\(/.test(src) && /tw \? tw\.startISO/.test(src),
      'a calendar window hands the allowance back on the 1st')
  }
  // The signup lookup must not live in the pure module: it is imported by three
  // public pages that render in the browser.
  const PURE = readFileSync('lib/free-trial.ts', 'utf8')
  check('the pure module stays free of server imports',
    !/supabase/i.test(PURE),
    'the pricing page imports this file; a service-role client has no business in it')
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

  // "Unlimited" is a word the server has to be able to back.
  //
  // The highlights read "Unlimited Amazon product research and Deal Radar" on
  // three public pages, one of them a paid-ad landing, while
  // /api/amazon-research counted to fifty a day and 429'd. Fifty is a fine cap
  // and plenty for a person; the cap was never the problem. Printing a number
  // the server does not honour, in an ad, is.
  const unlimited = h.filter(x => /unlimited/i.test(x))
  check('nothing in the highlights claims to be unlimited',
    unlimited.length === 0,
    `${unlimited.join(' | ')} — if a cap really is removed, say so here and delete this check`)
  check('the research allowance is stated as a number',
    h.some(x => x.includes(String(FREE_TRIAL.researchSearchesPerDay))),
    'the count a creator reads has to be the count the route enforces')

  const RESEARCH = (require('node:fs') as typeof import('node:fs'))
    .readFileSync('app/api/amazon-research/route.ts', 'utf8')
  check('and the route reads that same number rather than its own copy',
    /FREE_TRIAL\.researchSearchesPerDay/.test(RESEARCH),
    'two copies of a number that appears in an ad is how the ad goes stale')
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

  // Nor the face. "1 face model and 6 photobooth headshots" is on the free
  // plan's own advertised list, and /photobooth was on the content list, so the
  // Amazon thumbnails page said "No face yet. Upload your selfies" and that link
  // bounced a trial account into the YouTube funnel. Photobooth needs no
  // connection — it is selfies — and /api/photobooth already qualifies free AI
  // with the Associates tag, which is the right bar.
  check('photobooth needs no connection either',
    !/'\/photobooth'/.test(contentRoutes),
    'the trial advertises the face model; the route gate demanded YouTube or WordPress for it')
  check('the content-route list was actually found', /'\/content'/.test(contentRoutes),
    'if the slice missed, both checks above pass by finding nothing')

  // And the whole bounce is off for the Amazon plan. That funnel asks for a
  // channel and a blog; an Amazon Influencer has neither by design, so it is a
  // wall in front of /link-in-bio and /storefront, which ARE their features.
  check('the content bounce never fires for the Amazon plan',
    /!onboarded && normalizeTier\(tier\) !== 'amazon'/.test(LAYOUT),
    'a paying customer sent to connect two things their plan does not include')

  // ── the page the ads actually land on ─────────────────────────────────────
  //
  // /amazon-influencer is the ad destination. A free tier the sales page never
  // mentions does not exist as far as the traffic is concerned.
  const SALES = readFileSync('app/amazon-influencer/page.tsx', 'utf8')
  check('the Amazon sales page offers the free trial',
    /tier="trial"/.test(SALES),
    'the ad destination sent everyone straight to a $79 checkout with no way to try it')
  // The signup has to KNOW they came for the Amazon product, or it drops them
  // in the main funnel whose first required step is "Connect YouTube". This was
  // a nextPath prop at first, which put ?next= on the signup URL that the signup
  // form never read. scripts/test-signup-intent.ts owns the full journey.
  check('the free signup carries the Amazon intent',
    /intent="amazon"/.test(SALES),
    'without it they land in the YouTube funnel, which is where this traffic dies')
  check('the sales page lists the same free plan',
    /freeTrialHighlights\(\)/.test(SALES) && /freeTrialExclusions\(\)/.test(SALES))
  check('a paused paid checkout does not close free signup',
    /tier="trial"[^>]*salesPaused=\{false\}/.test(SALES),
    'SALES_PAUSED stops selling, not signing up')

  // The allowances on that page must be READ from the plan, never typed. Typed,
  // they went stale and oversold it: 300 pins advertised against a 150 cap, 50
  // pitches against 40, 100 posts against 60. Someone paying $79 for 300 pins
  // and stopping at 150 is a refund conversation.
  check('the sales page reads its numbers from the plan',
    /const AMZ = TIERS\.amazon/.test(SALES))

  // Scoped to the FEATURES array, which is what renders. The note above it
  // quotes the old numbers to explain why they are gone, and a whole-file search
  // would match that and fail forever.
  const featureCards = SALES.slice(SALES.indexOf('const FEATURES'), SALES.indexOf('const OTHER_TIERS'))
  check('the feature cards were found', featureCards.length > 500, `${featureCards.length} chars`)
  // An ALLOWANCE is a number next to a plan unit. "Up to Top 20" on the idea-list
  // card is a description of the output, not a monthly cap, so it is not one.
  const literalTags = (featureCards.match(/tag: '[^']*'/g) ?? [])
    .filter(t => /\d/.test(t) && /(pins|reels|fb|facebook|pitches|posts|month|model|headshots)/i.test(t))
  check('no feature card states an allowance as a typed literal',
    literalTags.length === 0,
    literalTags.join(' | '))
  // The filter has to be able to find one, or this passes by matching nothing.
  check('the literal detector works',
    /\d/.test("tag: '300 pins · 150 Reels'") && /(pins)/i.test("tag: '300 pins · 150 Reels'"))
  // And the plan really does define every number the cards interpolate. A card
  // reading an undefined field renders "undefined pins" and still passes a
  // no-literals check.
  for (const [field, v] of Object.entries({
    thumbnailsPerMonth: TIERS.amazon.thumbnailsPerMonth,
    pinsPerMonth: TIERS.amazon.pinsPerMonth,
    igPostsPerMonth: TIERS.amazon.igPostsPerMonth,
    facebookPostsPerMonth: TIERS.amazon.facebookPostsPerMonth,
    collabsPerMonth: TIERS.amazon.collabsPerMonth,
    dealsPerMonth: TIERS.amazon.dealsPerMonth,
    maxFaces: TIERS.amazon.maxFaces,
    photoboothPerMonth: TIERS.amazon.photoboothPerMonth,
  })) {
    check(`the plan defines ${field}`, typeof v === 'number', String(v))
    check(`the sales page interpolates ${field}`, featureCards.includes(`AMZ.${field}`),
      'a card that stopped reading the plan is a card that can go stale again')
  }
}

// ── the upgrade offered when the trial runs out ─────────────────────────────
//
// A free user makes their five designs, tries a sixth, and is told which plan
// to buy. nextTierFor walks the BLOG ladder (trial, creator, studio, pro) and
// 'amazon' is not on it, because it is not a rung: it is the other product.
//
// So the answer to "you are out of ready-to-post designs" was "upgrade to
// Creator" — the one paid plan with pinsPerMonth: 0, which cannot make a single
// design. We were selling the exact product that does not do the thing they
// just ran out of, at the moment of highest intent in the whole trial.
{
  const design = nextTierFor('trial', 'thumbnailsPerMonth', { preferTier: 'amazon' })
  check('a free user out of designs is offered the Amazon plan',
    design?.tier === 'amazon', JSON.stringify(design))
  check('and the number quoted is the Amazon allowance',
    design?.limit === TIERS.amazon.thumbnailsPerMonth, JSON.stringify(design))

  // Creator genuinely cannot do it, which is what made the old answer wrong
  // rather than merely suboptimal.
  check('Creator really cannot make ready-to-post designs',
    TIERS.creator.pinsPerMonth === 0 && TIERS.creator.igPostsPerMonth === 0,
    'if this ever changes, the reasoning above needs revisiting')

  // Untouched without the hint: the same cap, asked without a preference, still
  // walks the blog ladder to Creator.
  check('the blog ladder is unchanged when no preference is given',
    nextTierFor('trial', 'thumbnailsPerMonth')?.tier === 'creator',
    JSON.stringify(nextTierFor('trial', 'thumbnailsPerMonth')))
  check('and a paid blog tier is never diverted to Amazon',
    nextTierFor('creator', 'postsPerMonth')?.tier === 'studio',
    JSON.stringify(nextTierFor('creator', 'postsPerMonth')))

  // The hint only wins when the preferred plan actually offers MORE. Otherwise
  // it would answer a cap with a plan that caps lower.
  check('a preference that offers less is ignored',
    nextTierFor('trial', 'postsPerMonth', { preferTier: 'amazon' })?.tier !== 'amazon',
    'the Amazon plan has no blog posts; offering it here would be the same bug mirrored')

  const { readFileSync: rf } = require('node:fs') as typeof import('node:fs')
  const THUMB2 = rf('app/api/youtube/generate-thumbnail/route.ts', 'utf8')
  check('the design route passes the preference',
    /isSocialDesign \? \{ preferTier: 'amazon' \} : undefined/.test(THUMB2),
    'and only for the design formats, so a YouTube thumbnail cap still walks the blog ladder')
}

if (failures.length) {
  console.error(`\n❌ free-trial: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ free-trial: the Amazon loop fits under the ceiling, the pool holds, and free AI still needs a real Associates tag')
