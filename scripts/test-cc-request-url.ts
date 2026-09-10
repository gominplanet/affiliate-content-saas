// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The "On Amazon" link has to STAY on the campaign it opened.
//
// Every CC link was built with type=spcc&status=opportunity, copied from one
// live example. spcc is Sponsored Products for Creators, a different Amazon tab
// from Affiliate+. Opening a JOINED Affiliate+ campaign with those params loaded
// the campaign and then, about two seconds later, Amazon's SPA reconciled the
// mismatch and threw the creator onto the EPC list. The page they clicked for
// appeared, then took itself away.
//
// Amazon resolves the program and the status from the campaign id on its own, so
// a wrong value is worse than none. Both params are opt-in now, and only a
// caller that is certain names them.
import { ccRequestUrl, ccNormalizeRequestUrl } from '../lib/cc-urls'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const q = (url: string, k: string) => new URL(url).searchParams.get(k)

const ID = 'amzn1.campaign.2P7PKV0KCD08Y'

// ── the builder ─────────────────────────────────────────────────────────────
{
  const u = ccRequestUrl(ID)
  check('the campaign id goes in as both adId and campaignId',
    q(u, 'adId') === ID && q(u, 'campaignId') === ID,
    'that pairing is the shape Amazon actually resolves')
  check('no type is guessed', q(u, 'type') === null,
    'type=spcc on an Affiliate+ campaign is what caused the bounce')
  check('no status is guessed', q(u, 'status') === null)

  // Older callers pass a bare creatorId string. That must keep working.
  const withCreator = ccRequestUrl(ID, 'amzn1.creator.c74b9849')
  check('a bare creatorId string is still accepted',
    q(withCreator, 'creatorId') === 'amzn1.creator.c74b9849')

  // A caller that KNOWS can still say so.
  const known = ccRequestUrl(ID, { type: 'affiliate-plus', status: 'accepted' })
  check('a certain caller can name the program', q(known, 'type') === 'affiliate-plus')
  check('and the status', q(known, 'status') === 'accepted')
}

// ── repairing what is already stored ────────────────────────────────────────
// Fixing the builder alone leaves every campaign already in a creator's library
// bouncing, because their details_url was written with the old tail.
{
  const stored = `https://affiliate-program.amazon.com/p/connect/request?adId=${ID}&campaignId=${ID}&recc=0&early-acc=1&type=spcc&status=opportunity`
  const fixed = ccNormalizeRequestUrl(stored)!
  check('the stored type is stripped', q(fixed, 'type') === null)
  check('the stored status is stripped', q(fixed, 'status') === null)
  check('and everything else survives',
    q(fixed, 'adId') === ID && q(fixed, 'campaignId') === ID && q(fixed, 'recc') === '0' && q(fixed, 'early-acc') === '1',
    'this repairs a URL rather than rebuilding one whose other params we may not know')

  const retyped = ccNormalizeRequestUrl(stored, { status: 'accepted' })!
  check('a caller can set the status while stripping the type',
    q(retyped, 'status') === 'accepted' && q(retyped, 'type') === null)

  // Anything that is not a CC request URL is returned untouched, so this can sit
  // on a column that holds other things without mangling them.
  check('a non-CC URL is left alone',
    ccNormalizeRequestUrl('https://www.amazon.com/dp/B0DPKGY6LJ') === 'https://www.amazon.com/dp/B0DPKGY6LJ')
  check('a product URL on the CC host is left alone',
    ccNormalizeRequestUrl('https://affiliate-program.amazon.com/p/connect/requests?type=spcc')
      === 'https://affiliate-program.amazon.com/p/connect/requests?type=spcc',
    'only /p/connect/request, singular, is the campaign page')
  check('empty in, null out', ccNormalizeRequestUrl('') === null)
  check('garbage is returned as-is rather than throwing',
    ccNormalizeRequestUrl('not a url') === 'not a url')
}

// ── the library repairs its rows on the way out ─────────────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const root = new URL('..', import.meta.url).pathname
  const LIB = readFileSync(join(root, 'app/api/campaigns/library/route.ts'), 'utf8')
  check('the library normalizes details_url',
    /detailsUrl: ccNormalizeRequestUrl\(r\.details_url\)/.test(LIB),
    'without this, only newly joined campaigns are fixed and an existing library keeps bouncing')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
