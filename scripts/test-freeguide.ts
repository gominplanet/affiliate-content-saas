// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The free Amazon Influencer guide is reachable, and is still one file.
//
// WHY A GUARD FOR ONE STATIC PAGE. Because a static page linked from the nav
// has four separate ways to become a 404, and three of them are invisible to
// whoever made the change:
//
//   1. THE FILE. It lives in public/ and is not imported by anything, so no
//      compiler, no type check and no other test notices it leaving. A nav link
//      to a page that is not in the repo is a 404 for every visitor and looks
//      fine in every diff.
//   2. THE REWRITE. public/freeguide/index.html is served at that exact path
//      and nowhere else. Without the rewrite, /freeguide is a 404 while the
//      file sits right there.
//   3. THE AUTH GATE. middleware.ts sends anything not on its whitelist to
//      /login. This is a lead magnet, so every person it is written for is
//      logged out: exactly the population the default setting turns away. The
//      same oversight sent paid ad clicks for /amazon-influencer to a login
//      screen and read as bad targeting.
//   4. ROBOTS. A disallow that grows to cover it would quietly delist the one
//      page here whose whole job is to be found.
//
// AND IT IS ONE FILE, DELIBERATELY. It carries its own inline CSS and JS, its
// own <title>, description, canonical and Open Graph tags, and the only thing
// it fetches is Google Fonts. Turning it into a React page would mean restyling
// it and would put the root layout's metadata on top of tags it already has, so
// this checks the tags are still its own.

import { readFileSync, existsSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')

const FILE = 'public/freeguide/index.html'

// ── 1. the page exists ──────────────────────────────────────────────────────
//
// FIRST, AND EVERYTHING ELSE DEPENDS ON IT. A rewrite, a sitemap entry and two
// nav links pointing at a file that is not in the repo are four confident
// statements about a 404.
const present = existsSync(FILE)
check('the guide itself is in the repo',
  present,
  `${FILE} is missing, so /freeguide is a 404 and the nav links point at it`)

if (present) {
  const HTML = read(FILE)

  check('it is still a whole HTML document',
    /<html[\s>]/i.test(HTML) && /<\/html>/i.test(HTML),
    'a fragment served at a URL is not a page')

  // ITS OWN HEAD, NOT OURS. These are the tags the brief said not to duplicate
  // or override, and the reason this is served as a file rather than rebuilt.
  check('it carries its own title',
    /<title>[^<]{3,}<\/title>/i.test(HTML),
    'without one the tab reads as the URL')
  check('and its own description',
    /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(HTML),
    'the snippet under the search result comes from this')
  check('and its own canonical, pointing at this page',
    /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/freeguide/i.test(HTML),
    'a canonical pointing anywhere else hands the ranking to another URL')
  check('and its own Open Graph tags',
    /<meta[^>]+property=["']og:title["']/i.test(HTML),
    'a shared link with no card is a shared link nobody opens')

  // ── THE SOCIAL CARD ───────────────────────────────────────────────────────
  //
  // THIS WAS BROKEN AND NOTHING SAID SO. The page declared
  // twitter:card=summary_large_image and then shipped no og:image at all, so
  // every share of it, on X, in Messages, in Slack, in a Facebook post, drew a
  // blank card. For a lead magnet whose distribution IS people passing the link
  // around, that is the most expensive missing image on the page, and it is
  // invisible from the page itself: you only ever see it in somebody else's
  // feed. A guard is the only thing that looks.
  const og = HTML.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ''
  check('the page has a social card image',
    !!og,
    'it promises summary_large_image and gave nothing, so every share drew a blank card')
  check('and twitter is given the same one',
    new RegExp(`name=["']twitter:image["'][^>]+content=["']${og.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(HTML),
    'some scrapers read only the twitter tag')
  if (og) {
    // THE FILE, NOT THE PROMISE. A tag pointing at a path nobody shipped is a
    // blank card that now also looks correct in the markup.
    const local = og.replace(/^https?:\/\/[^/]+/, '')
    check('the card image is actually in the repo',
      existsSync(`public${local}`),
      `${og} resolves to public${local}, which is not there`)
    // Facebook and X both reject or crop badly outside 1.91:1. The declared
    // size is what a scraper lays out before it has the bytes.
    check('and it declares the size scrapers lay out from',
      /property=["']og:image:width["'][^>]+content=["']1200["']/i.test(HTML)
      && /property=["']og:image:height["'][^>]+content=["']630["']/i.test(HTML),
      '1200x630 is the one shape every network renders whole')
  }

  // ── THE PEOPLE ────────────────────────────────────────────────────────────
  //
  // The page's whole claim is "how WE built this". Everything else on the
  // screen is type asserting it.
  const hero = HTML.match(/<img[^>]+src=["']([^"']*hero[^"']*)["']/i)?.[1] ?? ''
  check('the hero photo is in the page',
    !!hero && existsSync(`public${hero}`),
    hero ? `${hero} is referenced and not shipped` : 'no hero image in the markup')
  check('and it has alt text and its own dimensions',
    /<img[^>]+src=["'][^"']*hero[^"']*["'][^>]*>/i.test(HTML)
    && /<img[^>]+alt=["'][^"']{10,}["']/i.test(HTML)
    && /<img[^>]+width=["']\d+["'][^>]+height=["']\d+["']/i.test(HTML),
    'width and height on the tag are what stop the page jumping while it loads')

  // SELF-CONTAINED. Google Fonts is the one exception and it is named here so
  // a second exception has to be argued for rather than absorbed.
  const externals = [...HTML.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/gi)]
    .map((m) => m[1])
    // Google Fonts, and the Meta pixel. The pixel is the second exception and
    // it is argued for: this page is an ad destination, and without it the
    // guide is invisible to Meta. See the pixel block's own comment.
    .filter((u) => !/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|connect\.facebook\.net)\//i.test(u))
    // Links out of the page are the point of it; only things the BROWSER must
    // fetch to render count against self-contained.
    .filter((u) => /\.(css|js|woff2?|ttf)(\?|$)/i.test(u))
  check('nothing but Google Fonts is fetched to render it',
    externals.length === 0,
    `would also fetch: ${externals.slice(0, 3).join(', ')}`)

  // THE ONE LINK THAT HAS TO WORK. Everything above this is plumbing; this is
  // what the page is for.
  check('the call to action goes to /pricing',
    /href=["'](?:https:\/\/(?:www\.)?mvpaffiliate\.io)?\/pricing["']/i.test(HTML),
    'a lead magnet whose button goes nowhere is a page that costs and never pays')

  // ── THE PIXEL ─────────────────────────────────────────────────────────────
  //
  // THIS WAS MISSING AND NOTHING SAID SO, which is the same shape as the
  // social card above. The file lives in public/ and is served through a
  // rewrite, so it never passes through app/layout.tsx and does not inherit
  // the pixel mounted there. The page looked completely normal and was
  // invisible to Meta: no landing page views, no ViewContent, and no audience
  // to retarget. An ad pointed here would have spent into nothing, which is
  // precisely the failure that cost $115 and ten days on the last campaign.
  check('the guide carries the Meta pixel itself',
    /fbq\('init','301488807119194'\)/.test(HTML),
    'public/ never passes through app/layout.tsx, so the pixel has to be in this file')
  check('and reports the arrival',
    /fbq\('track','PageView'\)/.test(HTML),
    'without PageView, Meta cannot count a landing page view for any ad sent here')
  check('and is production-only, matched on hostname',
    /location\.hostname/.test(HTML) && /mvpaffiliate\.io/.test(HTML),
    'a static file has no NODE_ENV, so preview traffic would otherwise pollute the audiences')

  // ENGAGEMENT, NOT ARRIVAL. A ViewContent that fires on load is a second
  // PageView wearing a different name. The campaign plan is to retarget
  // READERS, so this event has to mean reader or the audience is bouncers.
  check('ViewContent is tied to engagement, not to load',
    /function engage\(/.test(HTML) && /engaged=true/.test(HTML),
    'firing it on load would build a retargeting audience of people who left')
  check('and there are two ways to earn it',
    /scroll-25/.test(HTML) && /module-done/.test(HTML),
    'scrolling a quarter of the page, or ticking a first module')
  check('module completions are reported too',
    /trackCustom','GuideModuleDone'/.test(HTML),
    'so a section nobody finishes is a number rather than a hunch')

  // ── THE GROUP ─────────────────────────────────────────────────────────────
  check('the guide offers the Facebook group',
    /facebook\.com\/groups\/mvpaffiliate/.test(HTML),
    'every organic reader is a possible member and it costs nothing to ask')
}

// ── 2. the clean URL is rewritten onto it ───────────────────────────────────
const CONFIG = read('next.config.ts')
check('/freeguide is rewritten onto the file',
  /\{ source: '\/freeguide', destination: '\/freeguide\/index\.html' \}/.test(CONFIG),
  'the file is served at /freeguide/index.html and nowhere else without this')
check('and it is a rewrite, not a redirect',
  !/source: '\/freeguide'[^}]*permanent:/.test(CONFIG),
  'a redirect would put /freeguide/index.html in the address bar, disagreeing with the canonical')

// ── 3. a logged-out visitor is let through ──────────────────────────────────
const MW = read('middleware.ts')
const listStart = MW.indexOf('const publicPaths = [')
const listSrc = MW.slice(listStart, MW.indexOf('\n]', listStart))
const publicPaths = listSrc
  .split('\n').map((l) => l.trim())
  .filter((l) => !l.startsWith('//') && !l.startsWith('const'))
  .flatMap((l) => [...l.matchAll(/'([^']+)'/g)].map((m) => m[1]))
check('the auth gate lets /freeguide through',
  publicPaths.includes('/freeguide'),
  'every person this page is written for is logged out, which is the case the default turns away')

// ── 4. it can be found ──────────────────────────────────────────────────────
const ROBOTS = read('app/robots.ts')
const disallowed = [...ROBOTS.matchAll(/disallow:\s*\[([^\]]*)\]/gi)]
  .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((d) => d[1]))
check('robots does not disallow it',
  !disallowed.some((d) => '/freeguide'.startsWith(d.replace(/\/$/, '')) && d !== '/'),
  `disallowed: ${disallowed.join(', ')}`)

const SITEMAP = read('app/sitemap.ts')
check('the sitemap lists it',
  /\/freeguide`/.test(SITEMAP),
  'a page no sitemap mentions is a page found late or never')

// ── 5. somebody on the site can get to it ───────────────────────────────────
const HOME = read('app/page.tsx')
check('the top nav links to it',
  /\{ label: 'Free Guide', href: '\/freeguide' \}/.test(HOME.slice(HOME.indexOf('const NAV_ANCHORS'), HOME.indexOf('const NAV_ANCHORS') + 900)),
  'a page reachable only by typing the URL is a page nobody reads')
check('and so does the footer',
  (HOME.match(/\{ label: 'Free Guide', href: '\/freeguide' \}/g) ?? []).length >= 2,
  'the nav link alone means it disappears the moment somebody scrolls')

if (failures.length) {
  console.error(`\n❌ freeguide: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ freeguide: one file, its own tags, a clean URL, no login in the way, and two ways to reach it')
