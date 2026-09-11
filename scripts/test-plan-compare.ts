// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A comparison table is the worst place for a stale number.
//
// It is read by somebody deciding what to pay for, and every line of it is a
// promise. The Amazon sales page advertised 300 pins against a 150 cap, 50
// pitches against 40 and 100 posts against 60, because the plan was trimmed and
// the marketing copy stayed where it was. Nobody noticed, because a marketing
// number and the number the server enforces live in different files and only
// meet in a support ticket.
//
// So every figure in this comparison is read from lib/tier.ts, and this file
// checks that it still is, by comparing what the rows SAY against what the plan
// config holds. A row that stops matching is a row that has been hand-edited.
//
// The second thing it protects is the claim underneath the whole page: that
// these are two different products rather than four rungs of one ladder. The
// prices make that easy to miss ($49, $79, $99, $199 reads as a range), so the
// rows that carry the distinction are marked, and they have to stay marked.
import { TIERS } from '../lib/tier'
import { planCompareRows, trackCards } from '../lib/plan-compare'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const rows = planCompareRows()
const row = (label: string) => rows.find(r => r.label === label)

// ── every number in the table is the plan's own ─────────────────────────────
{
  const A = TIERS.amazon

  const thumbs = row('Thumbnails')
  check('the thumbnail row exists', !!thumbs)
  check('and states the Amazon cap from the plan',
    thumbs!.amazon.includes(String(A.thumbnailsPerMonth)),
    `${thumbs!.amazon} vs plan ${A.thumbnailsPerMonth}`)

  const designs = row('Ready-to-post designs')
  check('the designs row states all three Amazon caps',
    designs!.amazon.includes(String(A.pinsPerMonth))
    && designs!.amazon.includes(String(A.igPostsPerMonth))
    && designs!.amazon.includes(String(A.facebookPostsPerMonth)),
    `${designs!.amazon} vs plan ${A.pinsPerMonth}/${A.igPostsPerMonth}/${A.facebookPostsPerMonth}`)

  // The numbers that were oversold on the sales page. If any of them reappears
  // in this table, somebody has typed one in again.
  for (const stale of ['300 pins', '150 Reels', '45 Facebook', '50 pitches', '100 posts']) {
    check(`no row repeats the old "${stale}" claim`,
      !rows.some(r => r.amazon.includes(stale)),
      'that is the exact shape of the numbers that went stale')
  }

  const deals = row('Brand deals (Creator Connections)')
  check('the brand-deal row matches the plan',
    deals!.amazon.includes(String(A.collabsPerMonth)),
    `${deals!.amazon} vs plan ${A.collabsPerMonth}`)

  const face = row('Your face on the designs')
  check('the face row matches the plan',
    face!.amazon.includes(String(A.maxFaces)) && face!.amazon.includes(String(A.photoboothPerMonth)),
    `${face!.amazon} vs plan ${A.maxFaces}/${A.photoboothPerMonth}`)

  const price = row('Price')
  check('every price comes from the plan config',
    [TIERS.amazon.price, TIERS.creator.price, TIERS.studio.price, TIERS.pro.price]
      .every(p => `${price!.amazon} ${price!.ladder}`.includes(`$${p}`)),
    `${price!.amazon} | ${price!.ladder}`)

  const posts = row('Blog posts')
  check('the ladder\'s post counts come from the plan config',
    [TIERS.creator.postsPerMonth, TIERS.studio.postsPerMonth, TIERS.pro.postsPerMonth]
      .every(v => posts!.ladder.includes(String(v))),
    posts!.ladder)
}

// ── the boundary between the two products ───────────────────────────────────
{
  const posts = row('Blog posts')
  // Stated as an absence rather than a zero. "0 a month" reads like a limit you
  // could hit; "no blog" is the product boundary, which is the whole point.
  check('the Amazon plan really has no blog', TIERS.amazon.postsPerMonth === 0,
    'if this ever changes, the row below is a lie')
  check('and the row says so in words, not as a zero',
    /no blog/i.test(posts!.amazon) && !/^0/.test(posts!.amazon),
    posts!.amazon)

  const needs = row('What you need to start')
  check('the Amazon plan asks for no site', TIERS.amazon.sites === 0)
  check('and no channel', TIERS.amazon.youtubeChannels === 0)
  check('and the row says nothing to connect',
    /nothing to connect/i.test(needs!.amazon), needs!.amazon)
  check('while the ladder row names both',
    /wordpress/i.test(needs!.ladder) && /youtube/i.test(needs!.ladder), needs!.ladder)
  check('the ladder really does need a site', TIERS.creator.sites > 0 && TIERS.creator.youtubeChannels > 0)

  const publishes = row('Publishes to')
  check('the Amazon plan publishes to exactly three networks', TIERS.amazon.socials.length === 3,
    String(TIERS.amazon.socials.length))
  for (const s of TIERS.amazon.socials) {
    check(`and the row names ${s}`, new RegExp(s, 'i').test(publishes!.amazon), publishes!.amazon)
  }
  check('the row never promises a network the plan does not have',
    !/twitter|linkedin|bluesky|telegram|threads/i.test(publishes!.amazon), publishes!.amazon)
}

// ── the rows that decide it are marked ──────────────────────────────────────
{
  const decisive = rows.filter(r => r.decisive).map(r => r.label)
  for (const must of ['Who it is for', 'What you need to start', 'Blog posts', 'Publishes to']) {
    check(`"${must}" is marked as decisive`, decisive.includes(must),
      'these four are the difference between the two products; the rest are degree')
  }
  check('but not everything is marked', decisive.length < rows.length,
    'if every row is emphasised, none of them is')
}

// ── the two doors ───────────────────────────────────────────────────────────
{
  const cards = trackCards()
  check('there are exactly two', cards.length === 2, String(cards.length))
  const amz = cards.find(c => c.key === 'amazon')!
  const lad = cards.find(c => c.key === 'ladder')!

  check('the Amazon door says no website up front', /no website/i.test(amz.eyebrow), amz.eyebrow)
  check('and is described from the reader\'s side', /^I /.test(amz.title), amz.title)
  check('the ladder door too', /^I /.test(lad.title), lad.title)

  // The tie-breaker line is the point of the card: someone still unsure after
  // the blurb is unsure because nobody gave them the rule.
  check('both doors carry a tie-breaker', !!amz.tell && !!lad.tell)
  check('and the Amazon one names the blog test', /blog/i.test(amz.tell), amz.tell)

  check('prices come from the plan config',
    amz.price.includes(String(TIERS.amazon.price)) && lad.price.includes(String(TIERS.creator.price)),
    `${amz.price} | ${lad.price}`)
  check('the Amazon door points at its own page', amz.href === '/amazon-influencer')
}

// ── both pages actually render it ───────────────────────────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const PRICING = readFileSync('app/pricing/page.tsx', 'utf8')
  const SALES = readFileSync('app/amazon-influencer/page.tsx', 'utf8')

  check('the pricing page asks the question first', /<TrackPicker \/>/.test(PRICING))
  check('and the chooser sits above the plan grid',
    PRICING.indexOf('<TrackPicker />') < PRICING.indexOf('id="plans"'),
    'asking after they have already read four cards is asking too late')
  check('the ladder has an anchor to jump to', /id="plans"/.test(PRICING))
  check('the pricing page shows the comparison', /<TrackCompare/.test(PRICING))
  check('and so does the ad landing page', /<TrackCompare/.test(SALES),
    'that page is where the traffic is; it is the one that has to make the difference obvious')
}

if (failures.length) {
  console.error(`\n❌ plan-compare: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ plan-compare: the table reads its numbers from the plans, and the two products stay two products')
