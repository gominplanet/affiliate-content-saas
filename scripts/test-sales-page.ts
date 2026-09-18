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
// The section renders only when TESTIMONIALS has entries, which is the right
// shape and is not self-enforcing: the temptation when a page looks thin is to
// write a plausible quote from a plausible creator. These are real people whose
// businesses we can name, so a fabricated one is not a white lie, it is a quote
// attributed to somebody who never said it.
{
  check('the testimonial wall is hidden rather than padded when empty',
    /if \(TESTIMONIALS\.length === 0\) return null/.test(PAGE_LIVE))
  check('and the rule is written down where the next person will edit',
    /real customer quotes only/i.test(PAGE),
    'the comment is the guard here; the array itself cannot know if a name is real')

  // Placeholder names that mean somebody was drafting rather than quoting.
  const drafting = /(Jane Doe|John Doe|Lorem|Acme|Example Creator|Creator Name|Your Name|TODO|FIXME|placeholder)/i
  const block = PAGE_LIVE.slice(PAGE_LIVE.indexOf('const TESTIMONIALS'), PAGE_LIVE.indexOf('/** Wrap a section'))
  check('no placeholder names are sitting in the testimonial list',
    !drafting.test(block), block.match(drafting)?.[0])

  // A photo path must point at a file that exists, or the card renders a broken
  // image on the page we are paying to send people to.
  for (const m of block.matchAll(/photo:\s*'([^']+)'/g)) {
    let ok = true
    try { readFileSync(join(root, 'public', m[1].replace(/^\//, ''))) } catch { ok = false }
    check(`the photo for a testimonial exists on disk (${m[1]})`, ok,
      'a missing file is a broken image in the middle of the proof section')
  }
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

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
