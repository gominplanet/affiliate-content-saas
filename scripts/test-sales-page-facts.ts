// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SALES PAGE QUOTES THE PRODUCT, NOT A MEMORY OF IT.
//
// Every number on the marketing site was typed in by hand, and the product
// moved underneath them. Found live on mvpaffiliate.io:
//
//   the Amazon price      $79 across five places, against a real 99. The page
//                         advertised a price Stripe does not charge.
//   the struck price      $129, against a real regularPrice of 179
//   the saving            "Save $50 for life", against a real 80
//   thumbnails            "200 / month", against 250
//   designs               "100 Reels · 40 FB", against 150 and 120. The same
//                         page said 120 Facebook in another section, so it
//                         contradicted itself.
//   brand deals           "40 / month", against 60
//   publishing            "60 posts / month", against 150
//   face models           "1 model · 6 headshots", against 2 and 12
//   the free trial        "5 full posts" and "No time limit", against a trial
//                         that contains NO posts at all (5 thumbnails, 5
//                         designs, 1 face, 2 headshots) and runs 30 days
//
// Every one of those understated the plan except the trial, which overstated
// it. The pricing page already imported TIERS and hardcoded the numbers
// anyway, which is the whole lesson: a number that CAN be typed will be, and
// it will be right on the day it is typed and wrong by the next release.
//
// So this file does not check the values. It checks that the marketing surfaces
// cannot state a number the product does not agree with.
import { readFileSync } from 'node:fs'
import { SELLABLE_TIERS, TIERS } from '../lib/tier'
import { trackCards } from '../lib/plan-compare'
import { FREE_TRIAL } from '../lib/free-trial'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const LANDING = readFileSync('app/page.tsx', 'utf8')
const PRICING = readFileSync('app/pricing/page.tsx', 'utf8')
const SPLIT = readFileSync('components/landing/AudienceSplit.tsx', 'utf8')
// Comment lines first, everywhere. Each fix below is explained in a comment
// that quotes the OLD wrong number, so a grep over the raw file would flag the
// explanation as the bug.
const strip = (s: string) => s
  // Whole comment BLOCKS first. A line filter only drops the line a block
  // STARTS on, so lines 2..n of every JSX comment survive, and each of those
  // blocks quotes the old wrong number it exists to explain. This guard
  // flagged its own comments as the bug on the first run.
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const landing = strip(LANDING)
const pricing = strip(PRICING)
const split = strip(SPLIT)

// ── no price is typed in ───────────────────────────────────────────────────
//
// The literal that was wrong in five places. Checked as a bare price token so
// a new hardcoded "$79" anywhere on these three surfaces fails, whatever
// sentence it is wrapped in.
{
  for (const [name, src] of [['landing', landing], ['pricing', pricing], ['audience split', split]] as const) {
    check(`${name} quotes no stale Amazon price`, !/\$79\b/.test(src),
      'the Amazon plan is $99; $79 is the price it was BEFORE the change and is not what Stripe charges')
    check(`${name} quotes no stale regular price`, !/\$129\b/.test(src),
      'the struck-through price is regularPrice, which is 179')
  }
  check('the pricing card reads the price', /\$\{TIERS\.amazon\.price\}/.test(pricing))
  check('and the struck price', /\$\{TIERS\.amazon\.regularPrice\}/.test(pricing))
  check('and COMPUTES the saving', /TIERS\.amazon\.regularPrice - TIERS\.amazon\.price/.test(pricing),
    '"Save $50" was typed next to a real saving of $80; a subtraction cannot be wrong')
  check('the landing page reads it too', /\$\{TIERS\.amazon\.price\}/.test(landing))
  check('and so does the audience split', /TIERS\.amazon\.price/.test(split) && /TIERS\.amazon\.regularPrice/.test(split))
}

// ── no cap is typed in ─────────────────────────────────────────────────────
//
// Each of these was a real number on the live page, lower than the truth. They
// are checked by SOURCE rather than by value: asserting the page says "250"
// would pass again the day the cap moves to 300 and the page does not.
{
  const reads = [
    ['thumbnailsPerMonth', 'thumbnails'],
    ['pinsPerMonth', 'pins'],
    ['igPostsPerMonth', 'Reels'],
    ['facebookPostsPerMonth', 'Facebook designs'],
    ['dealsPerMonth', 'posts published'],
    ['maxFaces', 'face models'],
    ['photoboothPerMonth', 'headshots'],
  ] as const
  // collabsPerMonth is deliberately NOT in that list any more. The Amazon card
  // it used to sit on is Creator Connections messaging, which is uncapped, so
  // requiring the page to print the number would be requiring it to state a
  // limit the product does not enforce. The number is still read on the Pro
  // Brand Deals bullet, which is the feature it actually belongs to.
  for (const [field, what] of reads) {
    check(`the ${what} cap is read, not typed`, new RegExp(`TIERS\\.amazon\\.${field}`).test(pricing),
      `it was hardcoded and wrong; TIERS.amazon.${field} is ${String((TIERS.amazon as Record<string, unknown>)[field])}`)
  }
  // The specific literals that were on the page. A guard on the source alone
  // would not notice one of them being typed back in beside the read.
  for (const stale of ['200 / month', '100 Reels', '40 FB', '40 brand deals', '60 posts / month', '1 model · 6 headshots']) {
    check(`the stale "${stale}" is gone`, !pricing.includes(stale),
      'it understated the plan, which is the expensive direction to be wrong in')
  }
}

// ── the free trial is described as what it is ──────────────────────────────
//
// TWO OFFERS, AND THE FIRST VERSION OF THIS CHECK GOT IT BACKWARDS. It read
// TIERS.trial.articlesPerMonth === 0 as "the trial has no posts" and asserted
// the page must not mention any. But lifetimeMax and basePosts are both 5, and
// lib/free-tier-gate says "the free plan includes 5 lifetime posts" outright,
// so "5 full posts" was true and acting on that check DELETED a real claim from
// the sales page. The clock is real as well, but only on the design surfaces:
// freeTrialExpiredBlock is enforced on face-models, photobooth and
// generate-thumbnail, and on nothing in the blog path.
{
  check('the post allowance is still five', TIERS.trial.lifetimeMax === 5 && TIERS.trial.basePosts === 5,
    'the copy states this number, so a change here has to reach the page')
  check('and the design clock is still real', FREE_TRIAL.trialDays > 0, `${FREE_TRIAL.trialDays} days`)
  const GATE = readFileSync('lib/free-tier-gate.ts', 'utf8')
  check('the gate still requires a WordPress site', /Connect a WordPress site/.test(GATE),
    'the copy now says "once you connect a WordPress site", which it never used to mention')

  check('the posts are stated, and READ', /TIERS\.trial\.lifetimeMax/.test(landing),
    'they are real; the page should say so, from the constant')
  // The literal is the regression. A presence check on the read passes while
  // one of its three uses is typed back in as a number.
  for (const [name, src] of [['landing', landing], ['pricing', pricing]] as const) {
    check(`${name} types no post count`, !/\b\d+ (full |free )?(posts|published reviews)\b/i.test(src),
      'the count is TIERS.trial.lifetimeMax; typed beside it, it goes stale the way every price on this page did')
  }
  check('the design allowance is read too',
    /FREE_TRIAL\.thumbnails/.test(landing) && /FREE_TRIAL\.socialDesigns/.test(landing))
  check('and the window', /FREE_TRIAL\.trialDays/.test(landing))
  // The one thing that was simply false. The designs stop after trialDays.
  for (const [name, src] of [['landing', landing], ['pricing', pricing]] as const) {
    check(`${name} does not claim there is no time limit`, !/no time limit/i.test(src),
      `freeTrialExpiredBlock cuts the design surfaces off after ${FREE_TRIAL.trialDays} days`)
  }
  const FAQ = strip(readFileSync('components/landing/islands.tsx', 'utf8'))
  check('nor does the FAQ', !/no time limit/i.test(FAQ),
    'it is the longest-form answer on the site and it said it outright')
}

// ── the collab cap is on the DRAFTING, not on the outreach ─────────────────
//
// collabsPerMonth gates ONE route: /api/collaborations/generate, the Claude
// call that writes a pitch from the creator's brand profile. Messaging a brand
// is not capped anywhere — campaigns/message-link and campaigns/mark-messaged
// have no tier check and no counter, because the message is sent on Amazon, in
// Amazon's own box. A creator past the cap can still pitch every brand they
// like; they just write it themselves.
//
// The pricing page said "60 brand deals / month" next to a card about browsing
// the catalogue, which puts a monthly ceiling on the two things that have none:
// how many campaigns you can see and how many brands you can approach. It
// understated the plan in the most expensive place to be wrong.
{
  const AMZ_PAGE = readFileSync('app/amazon-influencer/page.tsx', 'utf8')
  const surfaces = [
    ['landing', LANDING], ['pricing', PRICING], ['amazon page', AMZ_PAGE],
  ] as const

  for (const [name, raw] of surfaces) {
    const src = strip(raw)
    check(`${name} does not cap brand DEALS`, !/brand deals\s*\/\s*month/i.test(src),
      'nothing limits how many deals a creator lands; the cap is on pitches MVP writes')
    check(`${name} does not cap outreach`, !/pitch emails\s*\/\s*month/i.test(src),
      '"emails / month" reads as a send limit, and sending is uncapped and happens on Amazon')
    // Wherever the number IS stated, it has to say what it counts.
    if (/collabsPerMonth/.test(src)) {
      check(`${name} says the pitches are DRAFTED`, /draft(ed|s)?\b/i.test(src),
        'the word is what separates "we write 60 for you" from "you may send 60"')
      // TWO FEATURES, TWO WRITERS, ONE CAP. collabsPerMonth belongs to
      // /api/collaborations/generate, the long-form Brand Deals EMAIL tool.
      // Creator Connections messages come from /api/campaigns/outreach, which
      // has no cap at all, so putting this number on a Creator Connections card
      // invents a limit the product does not enforce. It was on one.
      check(`${name} names Brand Deals where it states the figure`,
        /Brand Deals/.test(src),
        'unlabelled, the number reads as a limit on Creator Connections messaging, which is uncapped')
    }
  }

  // Creator Connections drafting is uncapped and the pages have to be able to
  // say so. The bulk modal drafts ONE message and fills each brand's product
  // into it; a saved template re-sends with no drafting at all.
  {
    // strip() first. The route's header now explains WHY it has no cap, and
    // names collabsPerMonth to do it, so a raw grep finds the explanation and
    // calls it the bug. Third time this exact trap has fired today.
    const OUTREACH = strip(readFileSync('app/api/campaigns/outreach/route.ts', 'utf8'))
    check('the Creator Connections drafter is still uncapped',
      !/collabsPerMonth/.test(OUTREACH),
      'adding a cap here would make the "Unlimited" on three pages false')
    const BULK = readFileSync('components/campaigns/BulkMessageBrandModal.tsx', 'utf8')
    check('and the bulk modal still drafts once and reuses it',
      /\/api\/campaigns\/outreach/.test(BULK) && /template/i.test(BULK),
      'if bulk started drafting per brand, "unlimited" would depend on the spend ceiling instead')
  }

  // The claim that was simply false. There is no inbox: campaigns/message-link
  // caches Amazon's own detailsUrl and sends the creator there.
  for (const [name, raw] of surfaces) {
    check(`${name} does not claim conversations live in MVP`,
      !/keep every conversation in one place|negotiate with brands inside MVP/i.test(raw),
      'MVP hands over a link to Amazon\'s message box and stores no thread')
  }
}

// ── the plan grid has as many columns as there are plans ───────────────────
//
// It was a fixed lg:grid-cols-4, written when four plans were sold. Creator and
// Studio froze, two cards were left, and they rendered into a four-column row:
// each squeezed to a quarter width, packed to the left, the right half of the
// section empty and the copy wrapping every three words. On the one page whose
// job is to sell. Nothing caught it because it is a layout fact, not a number.
{
  const grid = PRICING.match(/const PLAN_GRID: Record<number, string> = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  check('the plan grid is a lookup by count', grid.length > 0,
    'a fixed column count is what broke this; the layout has to follow plans.length')
  const entries = [...grid.matchAll(/(\d+):\s*'([^']+)'/g)]
  check('it covers one through four plans', entries.length >= 4, `${entries.length} entries`)
  for (const [, key, classes] of entries) {
    const cols = [...classes.matchAll(/grid-cols-(\d+)/g)].map(m => Number(m[1]))
    check(`${key} plan(s) lay out in ${key} column(s)`, Math.max(...cols) === Number(key),
      `widest breakpoint is grid-cols-${Math.max(...cols)}`)
  }
  check('and the grid is keyed on the real count', /PLAN_GRID\[plans\.length\]/.test(pricing),
    'hardcoding the key here would leave the lookup correct and unused')
}

// ── the two-door chooser quotes a price you can actually buy ───────────────
//
// The ladder card said "From $49 a month", which is Creator: a frozen tier that
// existing subscribers keep and nobody new can purchase. The front page of the
// pricing site was quoting a price checkout will not sell, and it had been
// since the lineup changed.
//
// It also said "I have a blog or a YouTube channel", which turned the door away
// from everyone who has not started one, on a product whose Hostinger flow
// installs WordPress for them.
{
  const cards = trackCards()
  // Widened to number: TIERS prices are a literal union, so .includes() on the
  // narrowed array rejects an arbitrary parsed number.
  const sellablePrices: number[] = SELLABLE_TIERS.map(t => TIERS[t].price as number)
  for (const c of cards) {
    const stated = Number(c.price.match(/\$(\d+)/)?.[1] ?? NaN)
    check(`the ${c.key} card quotes a sellable price`, sellablePrices.includes(stated),
      `it says $${stated}; the plans anyone can buy are ${sellablePrices.map(p => '$' + p).join(', ')}`)
  }
  const ladder = cards.find(c => c.key === 'ladder')!
  check('the ladder door does not require an existing site',
    !/I have a blog|publish to a website of your own/i.test(`${ladder.title} ${ladder.tell}`),
    'MVP installs WordPress for a creator with no site; this door excluded them')
  check('and says so', /build|set (one )?up/i.test(`${ladder.blurb} ${ladder.tell}`),
    'the fact that MVP makes the site is the reason the door is open to them')
}

// ── the claims that are NOT numbers ────────────────────────────────────────
{
  // 9 is exactly the length of the Social union. If a platform is added or
  // dropped, the page has to be told rather than quietly becoming wrong.
  const TIER_SRC = readFileSync('lib/tier.ts', 'utf8')
  const socials = (TIER_SRC.match(/export type Social =([^\n]+)/)?.[1].match(/'/g)?.length ?? 0) / 2
  check('the Social union still has 9 platforms', socials === 9, `${socials}`)
  check('so "9 places" is true', /9 places|9 channels|9 outputs/.test(LANDING),
    'if the union changes, this check fails and the copy needs updating with it')

  // NO STALE COUNTDOWN. Two ways to satisfy that, and both are fine: have no
  // countdown at all, or have one that hides itself once its date passes.
  //
  // This used to require the self-expiry code specifically, which failed the
  // build the day the countdown was removed on request. A guard that fails
  // because the thing it guards no longer exists is a guard that teaches people
  // to delete it. The property it actually protects is that the page never
  // shows a deadline that has already gone, and an absent countdown protects
  // that perfectly.
  const hasCountdown = /FOUNDING_DEADLINE/.test(LANDING)
  check('the founding deadline self-expires',
    !hasCountdown || /end\.getTime\(\) <= Date\.now\(\) \) return null|end\.getTime\(\) <= Date\.now\(\)\) return null/.test(LANDING),
    'a countdown that keeps counting after the date is the most obvious kind of stale')
}

if (failures.length) {
  console.error(`\n❌ sales-page-facts: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ sales-page-facts: every price and cap on the marketing pages is read from the product, not typed beside it')
