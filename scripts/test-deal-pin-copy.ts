// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The headline on a deals pin must be about the deals.
//
// A Deal Radar roundup of four home products produced a pin reading
// "COOL YOUR SPACE / RANKED & READY TO BUY". The image itself was right by then
// (four real product photos in tiles), so what the pin SHOWED and what the pin
// SAID disagreed: a single-product benefit line over a four-product board, and
// a ranking over a set of simultaneous price drops that nothing had ordered.
//
// One prompt was doing two jobs. The copy brief was written for a buying guide
// and a deals roundup went through it unchanged, so the copy described the post
// the prompt expected rather than the post it was handed.
//
// The checks below run the real judgement, not a grep for a sentence, because
// this text is baked into a JPEG and posted. There is no editing it afterwards.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { badDealCopy, dealFallbackHeadline, DEAL_FALLBACK_SUBHEAD } from '../lib/deal-pin-copy'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the headline that shipped ───────────────────────────────────────────────
{
  check('the subhead that shipped is now rejected', badDealCopy('RANKED & READY TO BUY'),
    'this exact line went out on a four-deal roundup')
}

// ── ranking language ────────────────────────────────────────────────────────
// Same reasoning as dropping the numbered badges: nothing ranked these, they
// all dropped in price at once.
{
  for (const line of [
    'RANKED & READY TO BUY', 'TOP 5 KITCHEN PICKS', 'BEST HOME DEALS',
    'OUR PICKS THIS WEEK', 'RATED AND REVIEWED', '#1 DEAL TODAY',
    'NO. 1 PICK', 'THE COUNTDOWN', 'DYSON VS SHARK',
  ]) {
    check(`"${line}" is rejected on a deals pin`, badDealCopy(line))
  }
}

// ── invented figures ────────────────────────────────────────────────────────
// The copy step is given product titles and nothing else. Every discount number
// it writes is one it made up, printed as a price claim under the creator's
// name, on a platform that does not let them correct it later.
{
  for (const line of [
    '40% OFF TODAY', 'UP TO 60 % OFF', 'SAVE $29 NOW', 'FROM £12 EACH', 'ONLY €19',
  ]) {
    check(`"${line}" is rejected as an invented price`, badDealCopy(line),
      'nothing in the brief knows what any of these cost')
  }
}

// ── and good deals copy still passes ────────────────────────────────────────
// A rule that rejects everything is not a rule, it is an outage. These are the
// headlines the deals brief is actually asked for.
{
  for (const line of [
    '4 KITCHEN PRICE DROPS', '6 HOME DEALS RIGHT NOW', '5 DESK DEALS TODAY',
    'PRICES DROPPED NOW', 'ALL AT THEIR LOWEST', 'LIVE RIGHT NOW', '',
  ]) {
    check(`"${line}" is allowed`, !badDealCopy(line))
  }
  check('the fallback subhead passes its own rule', !badDealCopy(DEAL_FALLBACK_SUBHEAD),
    'shipping a fallback the checker rejects would be its own bug')
}

// ── the fallback headline ───────────────────────────────────────────────────
// This is what prints when the AI call fails, and the old one was
// "TOP 4 <CATEGORY> / COMPARED & RANKED", which made the same false claim in
// our own words rather than the model's.
{
  check('the count leads', dealFallbackHeadline(4, 'Kitchen').startsWith('4 '))
  check('it says deals', /DEALS|PRICE DROPS/.test(dealFallbackHeadline(4, 'Kitchen')))
  check('it keeps a short category', dealFallbackHeadline(4, 'Kitchen') === '4 KITCHEN DEALS')
  check('it drops a category that would not fit', dealFallbackHeadline(4, 'Home Furniture And Appliances') === '4 PRICE DROPS',
    'better a shorter true headline than one truncated mid-word inside the image')
  check('an empty category still gives a headline', dealFallbackHeadline(3, '') === '3 PRICE DROPS')
  check('the fallback passes its own rule', !badDealCopy(dealFallbackHeadline(4, 'Kitchen')))
  check('and never runs past the headline band', dealFallbackHeadline(4, 'X'.repeat(200)).length <= 24)
}

// ── the two prompts stay two prompts ────────────────────────────────────────
// The whole bug was one brief serving both post types. If they merge back, the
// deals pin quietly starts describing a buying guide again.
{
  const ART = readFileSync(join(new URL('..', import.meta.url).pathname, 'lib/art-director-pin.ts'), 'utf8')
  check('a deals roundup has its own copy brief', /COLLAGE_SYSTEM_DEAL/.test(ART))
  check('and the brief is told which kind it is', /kind: 'deal' \| 'guide' = 'guide'/.test(ART))
  check('the caller passes it', /isDeal \? 'deal' : 'guide'/.test(ART))
  check('the deals brief asks for the count', /Lead with the count/.test(ART))
  check('and forbids ranking framing', /NOT a ranking and NOT a review/.test(ART))
  check('the deals fallbacks are the deals ones',
    /isDeal \? dealFallbackHeadline/.test(ART) && /isDeal \? DEAL_FALLBACK_SUBHEAD/.test(ART),
    'the fallback prints on the pin exactly like the AI copy does')
  check('the image is told not to draw a discount starburst',
    /NO INVENTED NUMBERS/.test(ART),
    'an image model adds "50% OFF" on its own the moment it hears the word deals')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
