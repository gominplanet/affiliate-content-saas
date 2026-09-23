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

  // ── THE MODULE LIST HAS TO BE REACHABLE ───────────────────────────────────
  //
  // The sidebar is `position: sticky`, and the list of modules is taller than a
  // laptop viewport. Sticky pins it, so scrolling the page moves the article
  // and leaves the sidebar exactly where it is: everything past module 8 sat
  // below the fold of an element that never moves, and there was no gesture
  // that could reach it. The last four modules, including the closing call to
  // action, were simply unavailable from the navigation.
  check('the pinned module list can scroll on its own',
    /\.toc details\{position:sticky[^}]*max-height:calc\(100vh/.test(HTML)
    && /\.toc details\{position:sticky[^}]*overflow-y:auto/.test(HTML),
    'a sticky element taller than the viewport hides its own bottom with no way to reach it')
  check('and a scroll that hits the end does not drag the page with it',
    /overscroll-behavior:contain/.test(HTML),
    'without it the page lurches the moment the list runs out')
  check('the cap comes off when the sidebar stops being pinned',
    /\.toc details\{position:static;max-height:none;overflow:visible/.test(HTML),
    'below 900px it is an ordinary box, and a height cap there would stunt the list on a phone')

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
    /function markStarted\(/.test(HTML) && /started=true/.test(HTML),
    'firing it on load would build a retargeting audience of people who left')

  // AND THE BAR IS REACHABLE. The first version put ViewContent at 25% scroll
  // on a page about 65,000px tall, which is roughly eighteen phone screens.
  // 3.6% of 1,375 paid visitors cleared it. Because the ad set optimizes on
  // ViewContent, Meta was learning from almost nothing and bought the cheapest
  // inventory on the platform: a $0.55 CPM where this account otherwise pays
  // $56 to $97. A percentage of a page this long does not mean what it sounds
  // like, so the shallow bar is measured in SCREENS and SECONDS, never in
  // percent of the document.
  check('the optimization bar is measured in screens, not in percent of the page',
    /y>=h\.clientHeight\*2/.test(HTML) && /scroll-2-screens/.test(HTML),
    'a percentage bar on a 65,000px page is a bar almost nobody clears')
  check('and dwelling counts too, but only on a visible tab that scrolled',
    /dwell-20s/.test(HTML) && /!document\.hidden && scrollY\(\)>0/.test(HTML),
    'a bare timer would count a backgrounded tab as a reader')

  // THE DEEP BAR KEEPS ITS OWN NAME. ads_get_dataset_stats filters by event
  // name and cannot filter by custom parameter, so folding "read a quarter"
  // into ViewContent with a depth param would make the difference between a
  // reader and a bouncer unreadable in the only report that checks.
  check('reading deeply is its own named event, not a parameter',
    /trackCustom','GuideRead'/.test(HTML) && /scroll-25/.test(HTML),
    'a depth hidden in a parameter cannot be queried, so it would never be reported')
  check('and the deep bar is NOT what delivery optimizes on',
    !/fbq\('track','ViewContent'[^)]*scroll-25/.test(HTML),
    'optimizing on the strictest signal on the page is what bought the $0.55 CPM')

  check('module completions are reported too',
    /trackCustom','GuideModuleDone'/.test(HTML),
    'so a section nobody finishes is a number rather than a hunch')
  check('and ticking a module satisfies both bars',
    /markStarted\('module-done'\); markRead\('module-done'\)/.test(HTML),
    'it is the strongest engagement on the page however little was scrolled to reach it')

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

// ── the signup is an offer, never a toll ───────────────────────────────────
//
// THE PROMISE IS ALREADY IN MARKET. The ad creatives for this page say "FREE.
// NO EMAIL. NO SIGNUP." in as many words, and until this card existed the page
// never said it anywhere, so an arrival from the ad had no confirmation. The
// capture only works if the page keeps that promise out loud beside it: a
// field with "free to read, no email needed" above it reads as an offer, and
// the same field without that line reads as a gate on a page that promised
// there wasn't one.
{
  // This block sits outside the `if (present)` scope above, so it reads the
  // file again rather than borrowing a const it cannot see.
  const HTML = present ? read(FILE) : ''
  const ROUTE = read('app/api/freeguide/subscribe/route.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')
  const MW2 = read('middleware.ts')

  check('the page says what the ad promised',
    /Free to read\. No email needed\./.test(HTML),
    'the one sentence that turns a form into an offer instead of a toll')
  // A GATE WOULD LOOK LIKE THIS: an overlay that covers the page until the
  // form is answered. The guide is a static file so the words are always in
  // the source; what would make it a toll is something painted over them.
  check('the form never covers the page',
    !/\.upd[^{]*\{[^}]*position:\s*fixed/.test(HTML)
    && !/\.upd[^{]*\{[^}]*(?:z-index:\s*9|inset:\s*0)/.test(HTML),
    'an overlay on a page whose ads promise no signup would break that promise on arrival')
  check('and the modules are readable without answering it',
    /<section class="mod" id="start">/.test(HTML) && /<section class="mod" id="mvp">/.test(HTML),
    'the content has to be in the page for a reader who never touches the field')

  check('the form posts to the guide’s own endpoint',
    /fetch\('\/api\/freeguide\/subscribe'/.test(HTML),
    'the newsletter route is for a creator’s blog and carries rules written for it')
  // THE ENTRY, NOT THE NOTE ABOVE IT. The comment explaining why this path
  // needs its own line quotes the path, so a check on the raw block passed
  // with the entry deleted and only the explanation left.
  const mwList = MW2.slice(MW2.indexOf('const publicPaths'), MW2.indexOf('\n]', MW2.indexOf('const publicPaths')))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  check('and a logged-out reader can actually reach that endpoint',
    /'\/api\/freeguide\/subscribe'/.test(mwList),
    'isPublic matches on segment boundaries, so the /freeguide entry does NOT cover it and every signup would 307 to /login')

  check('there is a honeypot',
    /name="hp"/.test(HTML) && /body\.hp \|\| ''/.test(ROUTE),
    'the cheapest filter there is, and it only works while it looks like success')

  // THE ORDER IS THE POINT. This page is about to take an ad campaign's worth
  // of traffic, and an address lost to an unverified sending domain is an
  // address nobody ever knows existed.
  check('the address is stored before the email is attempted',
    ROUTE.indexOf(".insert({") > -1
    && ROUTE.indexOf(".insert({") < ROUTE.indexOf('await sendEmail('),
    'sending first means a send failure costs the lead, and it looks exactly like nobody signing up')
  check('and a failed send says so rather than pointing at an empty inbox',
    /did not go out, so we will pick this up ourselves/.test(ROUTE),
    '"check your inbox" about an email that never sent is the plan reported as the result')

  // THE CONFIRMATION HAS TO LOOK LIKE IT CAME FROM THE PAGE THEY WERE ON.
  // Deriving the sender from this account's newsletter_settings, the way the
  // blog shortcode does, would have sent it as "Gomin Reviews
  // <newsletter@mail.gominreviews.com>" to somebody who had just been reading
  // mvpaffiliate.io. On a double opt-in an unrecognised sender is not a
  // cosmetic problem: it does not get opened, the link never gets clicked, and
  // the row stays pending forever.
  check('the confirmation sends as MVP, not as the blog',
    !/deriveFromAddress/.test(ROUTE) && !/newsletter_settings/.test(ROUTE),
    'that settings row belongs to another product, and its enabled flag is false today')

  check('an unset owner refuses loudly instead of guessing',
    /FREEGUIDE_OWNER_USER_ID/.test(ROUTE) && /Signups are not switched on yet/.test(ROUTE),
    'writing rows onto whichever account sorted first is worse than collecting nothing')

  check('the page prints the server’s sentence, not a fixed cheerful one',
    /j\.message \|\| /.test(HTML) && /j\.error \|\| /.test(HTML),
    'the route knows which of four things happened and the reader needs the right one')

  // THE REASON TO COME BACK, and it is a promise about what we will do rather
  // than a list of what we have done. An invented changelog was written here
  // first and removed: the page was two days old and every date would have
  // been fiction.
  check('the page says it keeps changing',
    /This guide keeps changing, because the program does\./.test(HTML)
    && /Worth coming back to/.test(HTML),
    'nothing else on the page gives a reader a reason to return')
}

// ── the guide is part of the site, and says so ─────────────────────────────
//
// It is a static file, so it never passes through app/layout.tsx and never
// inherited the top bar. A reader arriving from an ad had no way back to the
// product they had just been told about.
//
// THE LINKS ARE CHECKED AGAINST THE REAL NAV, because this bar is a second
// copy of a list that lives in app/page.tsx, and a second copy drifts. When a
// link is added, renamed or repointed there, this fails until it is matched
// here.
{
  const HTML2 = present ? read(FILE) : ''
  const HOME = read('app/page.tsx')
  const navSrc = HOME.slice(HOME.indexOf('const NAV_ANCHORS'), HOME.indexOf(']', HOME.indexOf('const NAV_ANCHORS')))
  const anchors = [...navSrc.matchAll(/\{\s*label:\s*'([^']+)',\s*href:\s*'([^']+)'\s*\}/g)]
    .map((m) => ({ label: m[1], href: m[2] }))

  check('the nav list was parsed',
    anchors.length >= 5, `${anchors.length} found`)

  const bar = HTML2.slice(HTML2.indexOf('<div class="sitebar">'), HTML2.indexOf('</div>', HTML2.indexOf('</nav>')))
  for (const a of anchors) {
    // AN ANCHOR ON THE HOMEPAGE NEEDS THE SLASH. Copied verbatim, '#roles'
    // points at nothing on this page and clicking it does nothing at all.
    const want = a.href.startsWith('#') ? `/${a.href}` : a.href
    check(`the bar carries ${a.label}`,
      new RegExp(`href="${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(bar),
      `expected href="${want}" in the guide's bar`)
  }

  check('the page it is on is stated rather than linked to itself',
    /href="\/freeguide" aria-current="page"/.test(HTML2),
    'a live link to the page you are already reading is a dead end that looks like a way out')
  // THE CHANNEL, FROM THE PAGE THAT SENDS PEOPLE TO IT. The guide spends
  // eleven modules on making videos; the one place to see them being made was
  // nowhere on it.
  check('the YouTube channel is linked from the top',
    /href="https:\/\/www\.youtube\.com\/@MVPaffiliate"/.test(HTML2),
    'a guide about video with no link to the channel is a missing door')
  check('and it opens away without handing over the tab',
    /class="yt"[^>]*target="_blank"[^>]*rel="noopener"/.test(HTML2.replace(/\n\s*/g, ' ')),
    'rel=noopener, or the new tab can reach back into this one')
  check('the mark is drawn rather than typed',
    /<svg viewBox="0 0 24 17"[\s\S]{0,120}?<path d="M23\.5/.test(HTML2)
    && /aria-hidden="true"/.test(HTML2),
    'an emoji or a unicode glyph standing in for an icon is the tell this page has avoided everywhere else')
  check('and it still has a readable name',
    /<span>YouTube<\/span>/.test(HTML2),
    'an icon with no text is a guess for anyone who does not recognise the shape')

  check('and the two account actions are there',
    /class="signin" href="\/login"/.test(HTML2) && /class="cta" href="\/signup"/.test(HTML2),
    'the bar exists so somebody who likes the guide can act on it')
  check('the bar is not pinned',
    !/\.sitebar\{[^}]*position:\s*(?:sticky|fixed)/.test(HTML2),
    'the module list is already pinned, and two fixed bars spend the same screen twice')
  check('and it is not printed',
    /@media print\{\.sitebar\{display:none/.test(HTML2),
    'navigation on paper is ink spent on something nobody can click')
}

// ── the offer panel says what the server actually enforces ─────────────────
//
// This panel is an offer, on a page an ad campaign is about to point at, and
// every number in it is a promise somebody can hold us to. It is also a hand
// copy of numbers that live in lib/tier.ts and lib/free-trial.ts, which is the
// exact shape that drifts: three public pages once advertised "unlimited
// Amazon product research" against a route that enforced fifty a day.
//
// So the numbers are read out of the source of truth rather than typed here.
// Change a cap and this fails until the guide is changed with it.
{
  const HTML3 = present ? read(FILE) : ''
  const panel = HTML3.slice(HTML3.indexOf('<div class="cta">'), HTML3.indexOf('</div></div></section>'))
  const TIER = read('lib/tier.ts')
  const TRIAL = read('lib/free-trial.ts')
  const num = (src: string, key: string) => {
    const m = new RegExp(`(?:^|[^A-Za-z])${key}:\\s*(\\d+)`).exec(src)
    return m ? m[1] : '«unreadable»'
  }
  // The keys in TIERS are padded to line up (`trial:   {`), so slice on the
  // key itself rather than on a literal with a guessed number of spaces. A
  // slice that silently returns '' turns every check below into a pass.
  const tierBlock = (from: string, to: string) => {
    const a = new RegExp(`^  ${from}:\\s*\\{`, 'm').exec(TIER)?.index ?? -1
    const b = new RegExp(`^  ${to}:\\s*\\{`, 'm').exec(TIER)?.index ?? -1
    return a >= 0 && b > a ? TIER.slice(a, b) : ''
  }
  const trialBlock = tierBlock('trial', 'creator')
  const amazonBlock = tierBlock('amazon', 'studio')
  const proBlock = tierBlock('pro', 'admin')
  check('the three tier blocks were found in lib/tier.ts',
    !!trialBlock && !!amazonBlock && !!proBlock,
    'an empty slice makes every number below read «unreadable» and every check below meaningless')

  check('the panel was found',
    panel.includes('Try it free'), 'everything below is checking an empty string otherwise')

  check(`it offers the ${num(TRIAL, 'thumbnails')} thumbnails the tier grants`,
    panel.includes(`${num(TRIAL, 'thumbnails')} Art Director thumbnails`), '')
  check(`and the ${num(TRIAL, 'socialDesigns')} designs`,
    panel.includes(`${num(TRIAL, 'socialDesigns')} designs`), '')
  check(`over the ${num(TRIAL, 'trialDays')} days the window actually runs`,
    panel.includes(`first ${num(TRIAL, 'trialDays')} days`), '')
  check(`the ${num(trialBlock, 'lifetimeMax')} posts match lifetimeMax`,
    panel.includes(`${num(trialBlock, 'lifetimeMax')} full posts`), '')
  check(`Amazon is the $${num(amazonBlock, 'price')} we charge`,
    panel.includes(`$${num(amazonBlock, 'price')}/month`), '')
  check(`and Pro the $${num(proBlock, 'price')}`,
    panel.includes(`$${num(proBlock, 'price')}/month`), '')
  check(`the discount is off the real $${num(amazonBlock, 'regularPrice')} and $${num(proBlock, 'regularPrice')}`,
    panel.includes(`normally $${num(amazonBlock, 'regularPrice')}`)
    && panel.includes(`normally $${num(proBlock, 'regularPrice')}`),
    'a saving measured against a number we never charged is the one claim here that could cost us')

  // THE FIVE POSTS ARE NOT PART OF THE MONTH, and grouping them under it was
  // the mistake this section was written for. try_consume_post_quota is handed
  // limits.lifetimeMax and never the trial window, so those five survive day
  // 31. The panel listed them as a bullet under "Free for your first 30 days",
  // which tells a reader they expire, and a reader who believes that has no
  // reason to come back and use them.
  const monthList = panel.slice(panel.indexOf('first 30 days'), panel.indexOf('</ul>'))
  check('the lifetime posts are not listed inside the 30-day list',
    !monthList.includes('full posts'),
    'a lifetime allowance sold as a monthly one is an offer that expires in the reader\'s head and not in the database')
  check('and the panel says so in words',
    /don't run out with the 30 days/.test(panel),
    'the correction only works if the reader is told, not merely if the bullet moved')

  // A LINK THE SAME COLOUR AS THE PANEL IT SITS ON. The Facebook group
  // sentence rendered as a blank gap: `a{color:var(--accent)}` and
  // `.cta{background:var(--accent)}` are the same token.
  check('a link in the panel is not painted in the panel background',
    /\.cta a:not\(\.btn\)\{color:var\(--accent-ink\)/.test(HTML3),
    'blue on blue: the sentence read "Our      is where Amazon Influencers compare notes"')
  check('and it is underlined, since colour alone no longer separates it',
    /\.cta a:not\(\.btn\)\{[^}]*text-decoration:underline/.test(HTML3), '')
  check('the group link is still there to be seen',
    /facebook\.com\/groups\/mvpaffiliate/.test(panel), '')
}

if (failures.length) {
  console.error(`\n❌ freeguide: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ freeguide: one file, its own tags, a clean URL, no login in the way, and two ways to reach it')
