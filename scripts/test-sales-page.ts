// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PAGE WE ARE ABOUT TO SPEND AD MONEY ON.
//
// Rebuilt for cold traffic from paid ads, aimed at Amazon Influencers, against
// two competitors who are already winning that click. What changed and why:
//
//   The headline named the product. "Everything an Amazon affiliate needs. Zero
//   compromise." is a boast to somebody who has never heard of us, and cold
//   traffic has heard of nobody. It now names the reader, and the one promise
//   the storefront tools structurally cannot make: their entire product
//   optimises a shopfront Amazon owns and the creator rents.
//
//   There was no Old Way / New Way. The page had a feature grid against named
//   competitors, which converts somebody already choosing between tools, and
//   nothing that let a stranger recognise their own week before the features
//   started.
//
//   The guarantee was 14 days against a competitor's 30.
//
// This file guards the things that would quietly rot: a claim nobody can
// support, a testimonial somebody invented to fill a gap, a promise here that
// the product does not keep. A sales page is the one surface where being wrong
// is not a bug report, it is a refund and a chargeback.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const live = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const PAGE = read('app/page.tsx')
const PAGE_LIVE = live(PAGE)
const FEATURES = read('app/features/page.tsx')
const AD = read('app/own-your-blog/page.tsx')
const AD_LIVE = live(AD)
const TESTIMONIALS_SRC = read('lib/testimonials.ts')

// ── the offer says one thing everywhere ─────────────────────────────────────
//
// Two surfaces state the guarantee and they drifted once already: the homepage
// said one number while /features said another. A visitor who reads both and
// finds two answers has learned something about us, and it is not good.
{
  const homepage = PAGE_LIVE.match(/const GUARANTEE: string \| null = '([^']+)'/)?.[1] ?? ''
  check('the homepage states a guarantee', homepage.length > 0)
  check('and it is the 30 days we settled on',
    /\b30-day\b/.test(homepage), homepage)
  check('/features states the same one',
    FEATURES.includes(homepage),
    `homepage says "${homepage}"`)
  check('no 14-day guarantee survives anywhere on the marketing pages',
    !/14-day money-back/.test(PAGE) && !/14-day money-back/.test(FEATURES),
    'the old number, which is now smaller than the competitor we are bidding against')
}

// ── nothing on the page is invented ─────────────────────────────────────────
//
// The wall renders only when TESTIMONIALS has entries, rather than being padded
// out when it looks thin.
//
// The placeholder-name and missing-photo checks used to live here and scanned
// app/page.tsx for the list. The list moved to lib/testimonials when the ad page
// started sharing it, `indexOf` began returning -1, and both clauses went on
// passing against a slice of the wrong file. They are now in the shared-proof
// section below, pointed at the module that actually holds the quotes.
{
  check('the testimonial wall is hidden rather than padded when empty',
    /if \(TESTIMONIALS\.length === 0\) return null/.test(PAGE_LIVE))
}

// ── the hero sells the reader, not us ───────────────────────────────────────
{
  const hero = PAGE_LIVE.slice(PAGE_LIVE.indexOf('function Hero()'), PAGE_LIVE.indexOf('function PlatformBar'))
  check('the hero names who it is for',
    /For Amazon Influencers/.test(hero),
    'the ads target one audience, so the first screen must repeat that audience back')
  check('the headline leads with the asset they do not own',
    /storefront[\s\S]{0,80}rented/i.test(hero),
    'this is the one claim the storefront tools cannot answer')
  check('and promises the one they would own',
    /Build the one you own/.test(hero))
  check('the old product-first headline is gone',
    !/Everything an Amazon<br \/>affiliate needs/.test(PAGE),
    'it was a claim about us, addressed to people who have never heard of us')
  check('the hero still says the trial needs no card',
    /No card to start/.test(hero),
    'the single biggest objection on a cold click')
}

// ── the transformation section exists and is honest ─────────────────────────
{
  check('there is an Old Way / New Way section',
    /function OldWayNewWay/.test(PAGE_LIVE))
  check('and it is placed before the feature grid',
    PAGE_LIVE.indexOf('<OldWayNewWay />') < PAGE_LIVE.indexOf('<FeaturesGridCondensed />'),
    'features mean nothing to somebody who has not recognised the problem yet')
  check('it is rendered, not merely defined',
    /<OldWayNewWay \/>/.test(PAGE_LIVE))

  // Every right-hand claim must be something the product does. Spot-checked
  // against features that exist in this repository, because the failure mode of
  // a comparison table is a column of things we wish were true.
  const rows = PAGE_LIVE.slice(PAGE_LIVE.indexOf('function OldWayNewWay'), PAGE_LIVE.indexOf('function TestimonialsSection'))
  check('the Passport claim matches what Passport actually is',
    /unlimited/i.test(rows) && /no cost per click/i.test(rows),
    'free unlimited geo-routing is the real differentiator and the one worth stating exactly')
  check('the link-repair claim matches the census we built',
    /counted link by link/.test(rows),
    'that wording is load-bearing: it is what the repair tool now genuinely reports')
  check('the voice claim stays inside what the writer does',
    /from your own transcript/.test(rows),
    'grounded in the video, which is the claim we can defend')
}

// ── house style ─────────────────────────────────────────────────────────────
//
// Applies to sales copy as much as to a support reply, and this is the page a
// stranger judges us by.
{
  const copy = [
    ...PAGE_LIVE.matchAll(/(?:old|mvp|quote|result|title):\s*'([^']{12,})'/g),
  ].map((m) => m[1])
  check('there is copy to check', copy.length >= 6, String(copy.length))
  for (const line of copy) {
    check(`no dash punctuation in "${line.slice(0, 46)}"`, !/[—–]|\s-\s/.test(line))
    check(`no year stamped into "${line.slice(0, 46)}"`, !/\b20\d{2}\b/.test(line))
  }
}


// ── no invented urgency ─────────────────────────────────────────────────────
//
// There was a founding-prices countdown set three months out. A deadline that
// far away does not create urgency, it reads as a deadline nobody means, and it
// sat on a page whose entire argument is that we tell creators the truth about
// their own numbers. Removed on request. If a genuine dated offer ever exists
// the countdown comes back with it, driven by a real date.
{
  check('the countdown is gone from the sales page',
    !/FOUNDING_DEADLINE/.test(PAGE_LIVE),
    'a constant nobody sets is a constant somebody sets to a date they made up')
  check('and no hardcoded end-date copy replaced it',
    !/prices end|offer ends|ends (?:soon|tonight|today|in \d)/i.test(PAGE_LIVE),
    'urgency on this page has to be traceable to a real date')
  check('the ad page carries no invented countdown either',
    !/prices end|offer ends|ends (?:soon|tonight|today)|only \d+ (?:spots|seats|left)/i.test(AD_LIVE),
    'the page we spend ad money on is the worst place to put a deadline we do not mean')
}

// ── one list of proof, shared ───────────────────────────────────────────────
{
  check('testimonials live in one module',
    /export const TESTIMONIALS/.test(TESTIMONIALS_SRC))
  check('the homepage reads it rather than keeping its own copy',
    /from '@\/lib\/testimonials'/.test(PAGE_LIVE) && !/const TESTIMONIALS[\s\S]{0,40}=\s*\[/.test(PAGE_LIVE),
    'two lists is two to remember, and the forgotten one is the one nobody is looking at')
  check('the ad page reads the same list',
    /from '@\/lib\/testimonials'/.test(AD_LIVE))
  check('the never-fabricate rule travelled with it',
    /never fabricated/i.test(TESTIMONIALS_SRC))
  const drafting = /(Jane Doe|John Doe|Lorem|Acme|Example Creator|Creator Name|Your Name|TODO|FIXME|placeholder)/i
  check('no placeholder names in the shared list',
    !drafting.test(TESTIMONIALS_SRC), TESTIMONIALS_SRC.match(drafting)?.[0])
  for (const m of TESTIMONIALS_SRC.matchAll(/photo:\s*'([^']+)'/g)) {
    let ok = true
    try { readFileSync(join(root, 'public', m[1].replace(/^\//, ''))) } catch { ok = false }
    check(`the photo ${m[1]} exists on disk`, ok)
  }
}

// ── the ad page behaves like an ad page ─────────────────────────────────────
//
// Every rule here is a way of not paying for a click and then handing it an
// exit. They are cheap to violate by accident, which is why they are pinned.
{
  check('there is exactly one call to action, spelled once',
    /const CTA_HREF =/.test(AD_LIVE) && /const CTA_LABEL =/.test(AD_LIVE),
    'four hand-written CTAs drift into four different offers')
  check('and it is used more than once down the page',
    (AD_LIVE.match(/<Cta/g) || []).length >= 4,
    'a visitor who scrolls past the hero needs the button where they stopped')
  check('no navigation links away from the page',
    !/<nav|<Nav\b/.test(AD_LIVE),
    'every link that is not the CTA is an exit from a page we paid for')
  check('the logo is not a link home',
    !/href="\/"/.test(AD_LIVE),
    'the logo is the most-clicked escape route on a landing page')
  check('it is kept out of search results',
    /robots: \{ index: false/.test(AD_LIVE),
    'a thin ad page competing with the homepage dilutes the one meant to rank')
  check('the hero repeats the promise the ad makes',
    /storefront is rented/i.test(AD_LIVE) && /Build the one you own/.test(AD_LIVE),
    'a landing page that does not echo its ad is a bounce we paid for')
  check('the guarantee matches the rest of the site',
    /30-day money-back/.test(AD_LIVE),
    'two different guarantees across two pages is the drift that already happened once')
  // Against the LIVE source, not the raw file. The first version tested the raw
  // file and passed on the phrase appearing in this page's own header comment,
  // which describes the objection rather than answering it for a reader.
  check('objections are answered, including the AI one',
    /AI slop/i.test(AD_LIVE),
    'it is the first thing this buyer thinks and the page has to say it out loud')
  check('and the Amazon disclaimer is present',
    /not affiliated with, endorsed by, or sponsored by Amazon/.test(AD_LIVE))
  check('the guarantee is stated in the copy, not only in a comment',
    /30-day money-back/.test(AD_LIVE))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
