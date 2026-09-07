// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The one rule Pinterest enforces and MVP was breaking in one of two places.
//
// A Deal Radar push came back with "Sorry! We blocked this link because it may
// lead to spam" on Pinterest alone, while every other platform in the same run
// posted fine. The pin pointed at an mvpl.ink Passport link.
//
// MVP already had the rule written down, in the OTHER Pinterest path:
// "NEVER an affiliate redirect — Pinterest + Amazon ToS; every option here is
// the creator's own page". Two paths, opposite behaviour, and only the wrong
// one reached Pinterest.
//
// So the test is not "does it pick a URL". It is: can an affiliate redirect
// EVER come out of this, by any route, including the fallbacks.
import { pinDestination, isBlockedPinLink } from '../lib/pinterest-destination'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const APP = 'https://www.mvpaffiliate.io'

// ── the Deal Radar case: no blog post will ever exist ───────────────────────
{
  const d = pinDestination({ shopHandle: 'lisa', appOrigin: APP })
  check('a deal push points at the shop page', d.url === 'https://www.mvpaffiliate.io/shop/lisa', d.url ?? 'null')
  check('and is labelled as such', d.kind === 'shop')
  check('and the creator is told why, not left guessing',
    /does not allow affiliate redirect links/.test(d.note || ''), d.note || 'null')
  check('and told the product is actually on that page',
    /product is on that page/.test(d.note || ''), d.note || 'null')

  check('a leading @ on the handle is not doubled up',
    pinDestination({ shopHandle: '@lisa', appOrigin: APP }).url === 'https://www.mvpaffiliate.io/shop/lisa')
  check('a trailing slash on the origin does not double up',
    pinDestination({ shopHandle: 'lisa', appOrigin: 'https://x.io/' }).url === 'https://x.io/shop/lisa')
  check('a handle with regrettable characters is encoded',
    pinDestination({ shopHandle: 'a b', appOrigin: APP }).url === 'https://www.mvpaffiliate.io/shop/a%20b')
}

// ── a post about this exact product beats a grid containing it ─────────────
{
  const d = pinDestination({ blogPostUrl: 'https://mine.com/review', shopHandle: 'lisa', appOrigin: APP })
  check('the blog post wins when there is one', d.url === 'https://mine.com/review' && d.kind === 'blog_post')
  check('and needs no explanation', d.note === null, 'this is what a creator already expects a pin to do')
}

// ── the fallbacks, which are where an affiliate link would sneak back in ───
{
  const home = pinDestination({ homepageUrl: 'https://mine.com', appOrigin: APP })
  check('no shop page falls back to their own site', home.url === 'https://mine.com' && home.kind === 'homepage')
  check('and says how to do better', /Set up your Link in Bio/.test(home.note || ''), home.note || 'null')

  const none = pinDestination({ appOrigin: APP })
  check('nothing to point at means NO pin, not an affiliate link',
    none.url === null && none.kind === 'none',
    'publishing a pin we know will be rejected, then showing the creator Pinterest\'s spam wording, blames them for our gap')
  check('and it explains what to set up', /Link in Bio/.test(none.note || ''), none.note || 'null')

  // ── the fix is offered, not just described ────────────────────────────────
  // A sentence telling someone to go and make a page, with no way to get there,
  // is a dead end dressed up as help.
  check('the no-page case is flagged so the UI can offer a button',
    none.needsLinkPage === true && none.setupPath === '/link-in-bio',
    JSON.stringify({ needsLinkPage: none.needsLinkPage, setupPath: none.setupPath }))
  check('and so is the homepage fallback, where a page would be an upgrade',
    home.needsLinkPage === true && home.setupPath === '/link-in-bio')
  check('but a working shop page prompts nothing',
    pinDestination({ shopHandle: 'lisa', appOrigin: APP }).needsLinkPage !== true)
  check('and neither does a blog post',
    pinDestination({ blogPostUrl: 'https://mine.com/p', appOrigin: APP }).needsLinkPage !== true)
}

// ── junk in the inputs must not become a destination ────────────────────────
{
  for (const bad of ['', '   ', 'not a url', 'javascript:alert(1)', 'ftp://x.com/a']) {
    const d = pinDestination({ blogPostUrl: bad, homepageUrl: bad, appOrigin: APP })
    check(`a malformed URL is not used: ${JSON.stringify(bad)}`, d.url === null, d.url ?? 'null')
  }
}

// ── the guard: an affiliate redirect must never reach Pinterest ────────────
// Whatever route assembles the pin, this is the last thing that looks at it.
{
  for (const blocked of [
    'https://www.mvpl.ink/ab3xy9k',
    'https://mvpl.ink/ab3xy9k',
    'https://geni.us/cXNSl',
    'https://bit.ly/3xyz',
    'https://amzn.to/3abc',
    'https://a.co/d/xyz',
    'https://tinyurl.com/abc',
    'https://www.mvpaffiliate.io/go/ab3xy9k',
  ]) {
    check(`blocked: ${blocked}`, isBlockedPinLink(blocked), 'this is what Pinterest rejected')
  }
  for (const allowed of [
    'https://www.mvpaffiliate.io/shop/lisa',
    'https://mine.com/review',
    'https://mine.com',
    'https://www.amazon.com/dp/B0H298X69Z?tag=x-20',
    '',
    null,
  ]) {
    check(`allowed: ${allowed ?? '(null)'}`, !isBlockedPinLink(allowed), 'a real page must still be pinnable')
  }
  // The shop page lives on the same domain as the /go/ redirect. If the guard
  // matched the domain rather than the path, it would block the very page this
  // whole change exists to point at.
  check('the shop page is not confused with the redirect on the same domain',
    !isBlockedPinLink('https://www.mvpaffiliate.io/shop/lisa')
    && isBlockedPinLink('https://www.mvpaffiliate.io/go/abc123'))
}

// ── no route through this function returns something Pinterest blocks ──────
// Stated as an invariant rather than case by case, because the failure mode is
// a future edit adding a fallback that reaches for the affiliate link again.
{
  const inputs = [
    { shopHandle: 'lisa' },
    { blogPostUrl: 'https://mine.com/p' },
    { homepageUrl: 'https://mine.com' },
    { shopHandle: 'lisa', blogPostUrl: 'https://mine.com/p', homepageUrl: 'https://mine.com' },
    {},
    { shopHandle: '', blogPostUrl: '', homepageUrl: '' },
  ]
  for (const i of inputs) {
    const d = pinDestination({ ...i, appOrigin: APP })
    check(`never returns a blocked link: ${JSON.stringify(i)}`,
      !isBlockedPinLink(d.url), d.url ?? 'null')
    check(`and always explains itself when it is not the obvious answer: ${JSON.stringify(i)}`,
      d.kind === 'blog_post' ? d.note === null : d.note !== null)
  }
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
