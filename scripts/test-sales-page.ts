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
import { TIERS } from '../lib/tier'

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
const AD2 = read('app/run-your-storefront/page.tsx')
const AD2_LIVE = live(AD2)
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
  for (const [label, src] of [['/own-your-blog', AD_LIVE], ['/run-your-storefront', AD2_LIVE]] as const) {
    check(`${label} carries no invented countdown either`,
      !/prices end|offer ends|ends (?:soon|tonight|today)|only \d+ (?:spots|seats|left)/i.test(src),
      'the page we spend ad money on is the worst place to put a deadline we do not mean')
  }
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
  check('and so does the second ad page',
    /from '@\/lib\/testimonials'/.test(AD2_LIVE))
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

// ── both ad pages behave like ad pages ──────────────────────────────────────
//
// Every rule here is a way of not paying for a click and then handing it an
// exit. They are cheap to violate by accident, which is why they are pinned.
//
// There are two of these pages now, one per tier, so the ads can be bought
// against one promise each. The shared rules run over both in a loop rather
// than being copied: a second copy of a checklist is a checklist that only gets
// half-updated, and the half that rots is the one on the newer page.
const AD_PAGES = [
  { label: '/own-your-blog', src: AD_LIVE, raw: AD },
  { label: '/run-your-storefront', src: AD2_LIVE, raw: AD2 },
] as const

for (const { label, src } of AD_PAGES) {
  check(`${label} has exactly one call to action, spelled once`,
    /const CTA_HREF =/.test(src) && /const CTA_LABEL =/.test(src),
    'four hand-written CTAs drift into four different offers')
  // `<Cta[\s/>]`, not `<Cta`. The loose version also counted every
  // <CtaSubtext>, the small grey line UNDER each button, which roughly doubled
  // the tally: deleting two of the four real buttons still left seven matches
  // and the clause went on passing. Break-tested by removing them.
  check(`${label} uses it more than once down the page`,
    (src.match(/<Cta[\s/>]/g) || []).length >= 4,
    'a visitor who scrolls past the hero needs the button where they stopped')
  check(`${label} has no navigation links away from the page`,
    !/<nav|<Nav\b/.test(src),
    'every link that is not the CTA is an exit from a page we paid for')
  check(`${label} does not make the logo a link home`,
    !/href="\/"/.test(src),
    'the logo is the most-clicked escape route on a landing page')
  check(`${label} is kept out of search results`,
    /robots: \{ index: false/.test(src),
    'a thin ad page competing with the homepage dilutes the one meant to rank')
  // Against the LIVE source, not the raw file. The first version tested the raw
  // file and passed on a phrase appearing in that page's own header comment,
  // which describes an objection rather than answering it for a reader.
  check(`${label} states the guarantee in the copy, not only in a comment`,
    /30-day money-back/.test(src),
    'two different guarantees across two pages is the drift that already happened once')
  check(`${label} carries the Amazon disclaimer`,
    /not affiliated with, endorsed by, or sponsored by Amazon/.test(src))
  check(`${label} answers the AI objection out loud`,
    /AI slop/i.test(src) || /look like AI made them/i.test(src),
    'it is the first thing this buyer thinks and the page has to say it out loud')
}

// ── the headings are visible to a dark-theme visitor ───────────────────────
//
// BOTH AD PAGES LOST THEIR HEADINGS AND NOBODY BUILDING THEM COULD SEE IT.
// app/globals.css has a base rule:
//
//   h1, h2, h3, h4, h5, h6 { color: var(--text); }
//
// The ad pages are deliberately light-only and hardcode `bg-[#FAFAF8]
// text-[#1D1D1F]` on their wrapper. A Tailwind text class on an ancestor does
// not beat a base-layer rule targeting the heading element, so every heading
// took var(--text). For a visitor whose app theme is dark that is #FAFAFA:
// near-white headings on a near-white page.
//
// /run-your-storefront lost the whole first line of its H1, "Other tools help
// you decide.", leaving only the gradient half. The page still looked designed,
// just missing its argument, on a page we buy clicks for. Anyone checking in
// light mode saw nothing wrong.
//
// Two rules, because fixing only the first moves the bug rather than removing
// it: the wrapper restates the light palette as VARIABLES, and every heading
// states its own colour, since these pages mix light sections with dark bands
// and a single inherited value cannot be right for both.
for (const { label, src } of AD_PAGES) {
  check(`${label} restates the light palette as variables`,
    /style=\{AD_PAGE_LIGHT\}/.test(src),
    'a Tailwind text class on the wrapper does not beat `h1..h6 { color: var(--text) }`')

  const heads = [...src.matchAll(/<h[123](\s[^>]*)?>/g)].map((m) => m[0])
  check(`${label} has headings to check`, heads.length >= 4, String(heads.length))
  const bare = heads.filter((h) => !/color:/.test(h))
  check(`${label}: every heading states its own colour`,
    bare.length === 0,
    `${bare.length} heading(s) inherit the theme variable: ${bare.map((h) => h.slice(0, 60)).join(' | ')}`)

  // A gradient headline painted with background-clip vanishes completely if the
  // clip does not take. A plain `color` underneath costs nothing and degrades
  // to a readable word instead of a gap.
  for (const m of src.matchAll(/style=\{\{([^}]*WebkitTextFillColor[^}]*)\}\}/g)) {
    check(`${label}: gradient text has a colour fallback`,
      /color:\s*'#/.test(m[1]),
      'without it, a failed background-clip renders nothing at all')
  }
}

// ── the visitor who is ready to buy has somewhere to go ────────────────────
//
// Both pages sold the free trial and never said what the plan costs. Somebody
// convinced on the first visit had one button, "start free", and had to leave
// to find a price. Most of them do not come back.
for (const { label, src } of AD_PAGES) {
  check(`${label} shows the plans and their prices`,
    /<AdPricingTable/.test(src),
    'a landing page that cannot be bought from is one that banks on a second visit')
  check(`${label} highlights its own tier`,
    /focus="(amazon|pro)"/.test(src))
  check(`${label} keeps the free path beside it`,
    /freeHref=\{CTA_HREF\}/.test(src),
    'the ad promised no card; removing that door would be a bait and switch')
}

// ── the pricing table quotes the product ───────────────────────────────────
{
  const CARD = live(read('components/landing/AdPricingTable.tsx'))
  check('the table reads its prices from the tier',
    /\$\{t\.price\}/.test(CARD) && !/\$\d{2,4}\b/.test(CARD.replace(/\$\{[^}]*\}/g, ' ')),
    'a typed price on a page we pay for is a refund waiting')
  check('and COMPUTES the annual saving',
    /t\.price \* 12 - annual/.test(CARD),
    '"Save $50" sat next to a real saving of $80 because somebody typed it')
  check('and COMPUTES the headline percentage too',
    /1 - a \/ \(priceOf\(k\) \* 12\)/.test(CARD),
    'the toggle advertises a saving; a typed percentage is the same bug one step along')
  check('a cap of zero is dropped rather than printed',
    /filter\(\(\[, v\]\) => v !== 0\)/.test(CARD),
    '"0 a month" reads as a broken number, not as a feature the plan lacks')
  check('null is rendered as unlimited',
    /'Unlimited' : v\.toLocaleString/.test(CARD),
    'null means no cap; printing "null a month" or nothing at all both mislead')

  // MONTHLY FIRST. Yearly is the better deal, but a yearly figure shown first
  // reads as the price, and the annual number next to a competitor's monthly
  // one loses the reader before they find the comparable figure.
  // THE BUTTONS, not the variable. The first version tested /Yearly/, which
  // matches `setYearly` and passed with the whole toggle relabelled away.
  // aria-pressed is the thing that only a real two-state control has.
  const toggles = [...CARD.matchAll(/aria-pressed=\{!?yearly\}/g)].length
  check('there is a real two-state toggle',
    toggles === 2,
    `found ${toggles} aria-pressed buttons; a toggle needs both states`)
  check('and it starts on monthly',
    /const \[yearly, setYearly\] = useState\(false\)/.test(CARD),
    'monthly is the default the pricing page already settled on')
  check('both options are labelled for a reader',
    /onClick=\{\(\) => setYearly\(false\)\}[\s\S]{0,300}?Monthly/.test(CARD)
      && /onClick=\{\(\) => setYearly\(true\)\}[\s\S]{0,300}?Yearly/.test(CARD),
    'the label has to sit inside the button it switches to')
  check('the billing choice reaches signup',
    /billing=\$\{showYear \? 'annual' : 'monthly'\}/.test(CARD),
    'a toggle that does not change where the button goes is decoration')
  check('both paid plans are shown, not only the page\'s own',
    /\['amazon', 'pro'\] as PaidTier\[\]\)\.map/.test(CARD),
    'a reader who landed on the wrong page should find the right plan rather than bounce')
  check('the free column is there too',
    /name="Free"/.test(CARD),
    'it is what the ad promised, and it is the lowest-risk way in')
  check('the toggle hides itself when nothing is sold yearly',
    /bestPct > 0 && \(/.test(CARD),
    'a toggle that flips to an option that does not exist is worse than no toggle')
}

// ── each ad page makes its OWN promise ──────────────────────────────────────
//
// The point of two pages is two ads. The failure that would waste the money is
// not a broken page, it is two pages saying the same thing, at which point the
// second one is a duplicate with a different URL and the targeting behind it is
// pointless. So each is pinned to the promise its own ad is bought against, and
// to NOT carrying the other one's.
//
// Scoped to the H1, not to the whole page. The first version scanned the whole
// file for the storefront promise and passed after the headline was replaced
// outright, because "help you decide" also appears in an FAQ answer forty lines
// down. A phrase that exists somewhere on the page is not a phrase the visitor
// reads first, and the first screen is the only one a bounce sees.
{
  const h1 = (src: string) => src.slice(src.indexOf('<h1'), src.indexOf('</h1>'))
  check('the blog page echoes the blog ad in its headline',
    /storefront is rented/i.test(h1(AD_LIVE)) && /Build the one you own/.test(h1(AD_LIVE)),
    'a landing page that does not echo its ad is a bounce we paid for')
  check('the storefront page echoes the storefront ad in its headline',
    /help you decide/i.test(h1(AD2_LIVE)) && /does the work/i.test(h1(AD2_LIVE)),
    'the Amazon-tier ad sells a different category, not a cheaper version of the blog pitch')
  check('the storefront page does not reuse the blog promise',
    !/Build the one you own/.test(AD2_LIVE),
    'two pages with one promise is one page with two URLs')
  check('the storefront page sends signups to the Amazon tier',
    /const CTA_HREF = '\/signup\?tier=amazon'/.test(AD2_LIVE),
    'the whole point is that the ad and the plan it lands on agree')
  check('the blog page sends signups to Pro',
    /const CTA_HREF = '\/signup\?tier=pro'/.test(AD_LIVE))
  check('the storefront page says no blog is needed',
    /No blog needed|no WordPress|without a blog/i.test(AD2_LIVE),
    'the Amazon buyer is not looking to start a website and will assume this is one')

  // OUR OWN prices and caps are READ from TIERS, never typed. The marketing
  // site has been wrong about its own numbers in nine places at once, every one
  // of them understating the plan, and a typed figure on a page we are paying
  // to put in front of strangers is a refund waiting.
  //
  // A competitor's price IS allowed to be a literal: "others are $29" is a fact
  // about somebody else's pricing page and there is no constant to read it
  // from. So this does not ban dollar literals, it bans OUR numbers appearing
  // as literals, which is the thing that actually goes stale.
  const ours = [TIERS.amazon.price, TIERS.amazon.regularPrice, TIERS.amazon.thumbnailsPerMonth]
  for (const n of ours) {
    check(`the storefront page does not type ${n} as a literal`,
      !new RegExp(`(?<!\\}|\\w)${n}\\b`).test(AD2_LIVE.replace(/\$\{[^}]*\}/g, ' ')),
      'it is correct today and wrong on the day the tier moves; read it from TIERS')
  }
  check('the storefront page reads its caps from the tier',
    /TIERS\.amazon\.thumbnailsPerMonth/.test(AD2_LIVE) && /TIERS\.amazon\.price/.test(AD2_LIVE))
}

// ── the homepage offers the same two doors ──────────────────────────────────
//
// The whole point of two landing pages is two ads. A visitor who arrives on the
// homepage instead should get the same choice rather than one generic pitch, so
// the fork is rendered, not merely defined. It sat in the tree DEFINED AND
// UNRENDERED for months and rotted there: it advertised Pro at $49 against a
// real $199, and its CTA pointed at an anchor that no longer existed. Nobody
// saw either, because nothing rendered it.
{
  const SPLIT = live(read('components/landing/AudienceSplit.tsx'))
  check('the audience fork is actually rendered on the homepage',
    /<AudienceSplit \/>/.test(PAGE_LIVE) && /import AudienceSplit from/.test(PAGE_LIVE),
    'an unrendered component is a component whose copy nobody is checking')
  check('and it is above the feature grid',
    PAGE_LIVE.indexOf('<AudienceSplit />') < PAGE_LIVE.indexOf('<FeaturesGridCondensed />'),
    'the choice has to come before the pitch it chooses between')
  check('each door goes to that tier own landing page',
    /href: '\/run-your-storefront'/.test(SPLIT) && /href: '\/own-your-blog'/.test(SPLIT),
    'otherwise the homepage and the ads argue for the same plan in two different ways')
  check('both panel prices are read, not typed',
    /\$\{TIERS\.amazon\.price\}/.test(SPLIT) && /\$\{TIERS\.pro\.price\}/.test(SPLIT),
    'the Pro panel said $49 against a real $199 for exactly as long as nothing rendered it')
  check('no dead in-page anchor survives in the fork',
    !/href: '#/.test(SPLIT),
    '#free-research was a link to nowhere; a fork with a broken door is worse than no fork')
  check('the slim Amazon strip is not rendered beside it',
    !/<AmazonRouter variant="strip" \/>/.test(PAGE_LIVE),
    'the same question asked twice, and the quiet version wins the click')
}

// ── house style on the pages we buy clicks for ──────────────────────────────
//
// The homepage copy is checked above. These two are the pages a stranger judges
// us by after we paid for them to arrive, so the same rules apply and it is
// worth the separate pass.
for (const { label, src } of AD_PAGES) {
  const copy = [...src.matchAll(/(?:old|mvp|q|a|title|body|t|b):\s*'([^']{16,})'/g)].map(m => m[1])
  check(`${label} has copy to check`, copy.length >= 6, String(copy.length))
  for (const line of copy) {
    check(`${label}: no dash punctuation in "${line.slice(0, 44)}"`, !/[—–]|\s-\s/.test(line))
    check(`${label}: no year stamped into "${line.slice(0, 44)}"`, !/\b20\d{2}\b/.test(line))
  }
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
