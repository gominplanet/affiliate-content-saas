// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// An Amazon influencer has to be able to get in.
//
// There is one onboarding funnel and its first step is "Connect YouTube",
// marked required, with every later step locked until it is done. For a creator
// with a channel that is the right first move. For an Amazon influencer it is
// the end of the road: no channel, never going to have one, and the product
// they were sold does not use one. They click an ad about turning a product
// link into a design and the first thing the app asks for is the one thing they
// cannot give it.
//
// Three separate things had to be true before that worked, and none of them
// were:
//
//  1. THE PAID BUTTON HAD TO REACH CHECKOUT. A logged-out visitor clicking "Get
//     Amazon Influencer" arrived at /signup?tier=amazon. The signup form's list
//     of paid tiers was ['creator','studio','pro'], so 'amazon' failed the check
//     and the visitor was quietly given the FREE flow: confirm an email, land in
//     onboarding, never see a checkout. The API had always accepted the tier.
//     Only this one list did not.
//
//  2. THE CHOICE HAD TO SURVIVE THE INBOX. They type an address, close the tab,
//     and come back through a confirmation link twenty minutes later. Nothing
//     client-side survives that, so the path has to ride in the URL the whole
//     way and be written to the account when the onboarding first renders.
//
//  3. THERE HAD TO BE A SECOND DOOR, SIGNPOSTED. Someone already inside the
//     funnel, or arriving from the homepage rather than the ad, needs to see the
//     way out before they hit the locked step, not after.
import {
  parseOnboardingPath, resolveOnboardingPath, onboardingDestination,
  signupHrefFor, confirmationLandingFor, amazonOnboardingSteps, amazonOnboardingReady,
} from '../lib/onboarding-path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── reading the choice ──────────────────────────────────────────────────────
{
  check('amazon parses', parseOnboardingPath('amazon') === 'amazon')
  check('creator parses', parseOnboardingPath('creator') === 'creator')
  check('the words people actually type parse too',
    parseOnboardingPath('youtube') === 'creator' && parseOnboardingPath('blog') === 'creator')
  check('case and padding do not matter', parseOnboardingPath('  AMAZON ') === 'amazon')

  // Null, not a default. "No answer" has to stay distinguishable from "creator"
  // right up to the one function whose job is to pick.
  check('nonsense is null, not creator', parseOnboardingPath('pro') === null)
  check('empty is null', parseOnboardingPath('') === null)
  check('undefined is null', parseOnboardingPath(undefined) === null)
}

// ── picking the path ────────────────────────────────────────────────────────
{
  // The URL is the newest thing they did: the ad they just clicked, or the fork
  // they just picked. It outranks everything.
  check('the url wins over the stored path',
    resolveOnboardingPath({ param: 'amazon', stored: 'creator' }).path === 'amazon')
  check('and over what is connected',
    resolveOnboardingPath({ param: 'amazon', hasYouTube: true, hasWordPress: true }).path === 'amazon')
  check('in both directions',
    resolveOnboardingPath({ param: 'creator', stored: 'amazon' }).path === 'creator',
    'someone who took the Amazon door by mistake has to be able to leave it')

  check('the stored path is used when the url says nothing',
    resolveOnboardingPath({ stored: 'amazon' }).path === 'amazon')

  // Accounts that predate this: an Associates tag, no channel, no blog. Sending
  // them back into the YouTube funnel repeats the original mistake.
  check('an existing Amazon-shaped account is guessed correctly',
    resolveOnboardingPath({ hasAmazonTag: true }).path === 'amazon')
  check('but a tag alone never outweighs a real channel',
    resolveOnboardingPath({ hasAmazonTag: true, hasYouTube: true }).path === 'creator',
    'plenty of YouTube creators have an Associates tag; that is not a signal')
  check('nor a blog', resolveOnboardingPath({ hasAmazonTag: true, hasWordPress: true }).path === 'creator')
  check('a blank account gets the main funnel', resolveOnboardingPath({}).path === 'creator')

  // Only a STATED choice is written down. A guess must never be, or a creator
  // who connects a channel tomorrow is locked into the wrong funnel today.
  check('a stated choice is persisted', resolveOnboardingPath({ param: 'amazon' }).persist === true)
  check('a guess is never persisted', resolveOnboardingPath({ hasAmazonTag: true }).persist === false)
  check('and neither is a re-statement of what is already stored',
    resolveOnboardingPath({ param: 'amazon', stored: 'amazon' }).persist === false,
    'a write per page view for no change')
  check('the source is reported', resolveOnboardingPath({ param: 'amazon' }).from === 'param')
}

// ── where each path goes ────────────────────────────────────────────────────
{
  check('the Amazon path lands on the generator', onboardingDestination('amazon') === '/amazon/thumbnails',
    'the ad promised one thing; a dashboard they then have to read is not it')
  check('the creator path lands on the dashboard', onboardingDestination('creator') === '/dashboard')

  check('the Amazon signup url carries the intent', signupHrefFor('amazon') === '/signup?for=amazon')
  check('the creator signup url is plain', signupHrefFor('creator') === '/signup')

  check('the confirmation link comes back to the Amazon setup',
    confirmationLandingFor('amazon') === '/onboarding?for=amazon',
    'this is the half that has to survive the inbox')
  check('and to the main funnel otherwise', confirmationLandingFor('creator') === '/onboarding')
}

// ── the Amazon setup is short, and only one thing is required ───────────────
{
  const steps = amazonOnboardingSteps()
  check('there are three steps', steps.length === 3, String(steps.length))
  check('exactly one is required', steps.filter(s => s.required).length === 1,
    'every question before they have seen a design come out is a chance to lose them')
  check('and it is the Associates tag', steps.find(s => s.required)?.key === 'tag',
    'it is what qualifies free AI, and it is one field they know by heart')
  check('neither optional step mentions YouTube or WordPress',
    !steps.some(s => /youtube|wordpress/i.test(`${s.title} ${s.blurb}`)),
    'asking for either is what made the main funnel a dead end for this person')

  check('the tag is what opens the door', amazonOnboardingReady({ hasAmazonTag: true }))
  check('and nothing else does', !amazonOnboardingReady({}))
}

// ── the wiring, which is where all three failures actually lived ────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const FORM = readFileSync('components/auth/SignupForm.tsx', 'utf8')
  const API = readFileSync('app/api/auth/signup-paid/route.ts', 'utf8')
  const BTN = readFileSync('app/pricing/CheckoutButton.tsx', 'utf8')
  const SALES = readFileSync('app/amazon-influencer/page.tsx', 'utf8')
  const PAGE = readFileSync('app/onboarding/page.tsx', 'utf8')
  const FUNNEL = readFileSync('components/onboarding/OnboardingFunnel.tsx', 'utf8')

  // 1. The two lists of paid tiers must agree. They did not, and a whole
  //    campaign's worth of buyers would have been handed a free account.
  const formTiers = FORM.match(/PAID_SIGNUP_TIERS = \[([^\]]*)\]/)?.[1] ?? ''
  const apiTiers = API.match(/PAID_TIERS: Tier\[\] = \[([^\]]*)\]/)?.[1] ?? ''
  const norm = (s: string) => s.split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean).sort().join(',')
  check('both paid-tier lists were found', !!formTiers && !!apiTiers, `${formTiers} | ${apiTiers}`)
  check('the signup form and the checkout API agree on the paid tiers',
    norm(formTiers) === norm(apiTiers),
    `form [${norm(formTiers)}] vs api [${norm(apiTiers)}]`)
  check('and amazon is in them', /amazon/.test(formTiers) && /amazon/.test(apiTiers),
    'without it "Get Amazon Influencer" silently becomes a free signup')

  // 1b. A plan with no price env is a fault on our side, and has to be reported
  //     as one. This branch answered "Invalid tier" and paged nobody, while the
  //     malformed-price branch right below it alerted ops — so the likelier
  //     fault on a newly added plan (env never set in Vercel) was the silent
  //     one, and it would have taken the checkout the ads are paying for while
  //     telling the customer they picked an invalid plan.
  const CHECKOUT = readFileSync('app/api/stripe/checkout/route.ts', 'utf8')
  const missing = CHECKOUT.slice(CHECKOUT.indexOf('if (!priceId)'), CHECKOUT.indexOf('isValidPriceId(priceId)'))
  check('the missing-price branch was found', missing.length > 50, `${missing.length} chars`)
  check('a plan we sell with no price set pages ops', /alertOps\(/.test(missing),
    'a blank STRIPE_PRICE_AMAZON would have failed every Amazon checkout in silence')
  check('and does not tell the customer they chose an invalid plan',
    /status: 503/.test(missing),
    'Invalid tier reads as their mistake; it is ours')
  check('while a genuinely unknown tier is still a 400',
    /status: 400/.test(missing),
    'a malformed request is not a config fault and must not page anyone')
  check('the two are told apart by the plan list itself',
    /tier in PRICE_IDS/.test(missing),
    'anything else drifts the moment a plan is added')

  // 2. The path has to reach the confirmation link.
  check('the signup form reads the intent', /parseOnboardingPath\(sp\.get\('for'\)\)/.test(FORM))
  check('and a paid amazon click implies it too', /t === 'amazon' \? 'amazon' : null/.test(FORM),
    'someone buying the plan outright should still land in the right setup')
  check('the confirmation link carries it', /confirmationLandingFor\(path \?\? 'creator'\)/.test(FORM),
    'a hard-coded /onboarding here is what dropped the choice at the inbox')
  check('the signup pitch changes with the door', /path === 'amazon'/.test(FORM),
    'promising a branded review site to an Amazon influencer describes a product they cannot use')

  // 3. Both doors are signposted.
  check('the sales page buttons carry the intent', /intent="amazon"/.test(SALES))
  check('the button spells signup URLs in one place', /signupHrefFor\(intent \?\? 'creator'\)/.test(BTN))
  // Scoped to the props, not the file: the note explaining why nextPath is gone
  // names it, and a whole-file search would match that and fail forever.
  const props = BTN.slice(BTN.indexOf('export function CheckoutButton('), BTN.indexOf('}) {'))
  check('the dead nextPath prop is gone', !/nextPath\??:/.test(props),
    'it put ?next= on the signup URL and the form never read it')
  check('and intent took its place', /intent\?: OnboardingPath/.test(props), props.slice(-200))
  check('the main funnel offers the way out', /onboarding\?for=amazon/.test(FUNNEL),
    'the fork has to be visible BEFORE the locked step, not after it')

  // 4. The onboarding page forks, and reads the stored path without being able
  //    to take the rest of the page down with it.
  check('the onboarding page forks on the path', /chosen\.path === 'amazon'/.test(PAGE))
  check('and reads onboarding_path in its own guarded query',
    /try \{[\s\S]{0,200}?select\('onboarding_path'\)/.test(PAGE),
    'naming a column that migration 328 has not added yet fails the whole read it is part of')
  check('the main select does not name onboarding_path',
    !/select\('wordpress_url[^']*onboarding_path/.test(PAGE),
    'that is exactly the read it would break')
}

// ── the funnel has to be measurable ─────────────────────────────────────────
//
// Ads point at /amazon-influencer, and that page fired nothing. Meta saw the
// click land and then nothing until CompleteRegistration two pages later, so an
// ad that brought the right person and an ad that brought a bouncer looked the
// same, and there was no mid-funnel event to optimise on.
//
// The gap between "typed their address" and "confirmed the email" was invisible
// too, which is where a broken confirmation email hides.
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const SALES2 = readFileSync('app/amazon-influencer/page.tsx', 'utf8')
  const FORM2 = readFileSync('components/auth/SignupForm.tsx', 'utf8')
  const ONB = readFileSync('app/onboarding/page.tsx', 'utf8')

  check('the ad landing page reports a view', /<MetaTrack event="ViewContent"/.test(SALES2),
    'the page the ads point at reported nothing at all')
  check('and names itself distinctly', /content_name: 'Amazon Influencer'/.test(SALES2),
    'sharing a content_name with /pricing makes the two indistinguishable in reporting')

  check('a submitted signup reports a lead', /trackMeta\('Lead'/.test(FORM2),
    'everyone who typed an address and never confirmed was invisible')
  check('and the lead says which door they came through', /content_category: path/.test(FORM2))

  // The ad landing is its own step, and its own audience.
  const JOIN = readFileSync('app/join/amazon/page.tsx', 'utf8')
  const JOINFORM = readFileSync('components/landing/AmazonJoinForm.tsx', 'utf8')
  check('the ad landing reports a view', /<MetaTrack event="ViewContent"/.test(JOIN))
  check('under its own name', /content_name: 'Amazon ad landing'/.test(JOIN),
    'three pages sharing one content_name is three audiences merged into one number')
  check('starting the form is its own event, not a second Lead',
    /trackMeta\('InitiateCheckout'/.test(JOINFORM) && !/trackMeta\('Lead'/.test(JOINFORM),
    'a Lead here would double-count against the one the signup form fires')
  check('the landing carries the Amazon intent into signup',
    /\/signup\?for=amazon/.test(JOINFORM),
    'dropping it here puts them back in the YouTube funnel')
  check('and carries the address they already typed',
    /email=\$\{encodeURIComponent\(v\)\}/.test(JOINFORM),
    'asking for the same email twice on consecutive screens is a drop-off for nothing')
  check('the signup form reads that prefill', /sp\.get\('email'\)/.test(FORM2))
  check('and shape-checks it rather than trusting it',
    /\[\^\\s@\]\+@/.test(FORM2), 'it lands in a controlled input, but it arrives from a URL')
  check('the landing states the free allowance from the plan',
    /FREE_TRIAL\.thumbnails/.test(JOIN) && /TIERS\.amazon\.price/.test(JOIN),
    'a second hand-typed copy of the offer is a second thing that goes stale')

  check('the registration still fires where it always did',
    /event="CompleteRegistration"/.test(ONB) && /eventName: 'CompleteRegistration'/.test(ONB),
    'both halves, browser and server, sharing one event id')
}

if (failures.length) {
  console.error(`\n❌ signup-intent: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ signup-intent: an Amazon influencer can buy the plan, sign up free, and reach a setup that never asks for a channel')
