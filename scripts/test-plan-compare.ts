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
import { SELLABLE_TIERS, TIERS } from '../lib/tier'
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

  // NO NUMBER IN THIS TABLE THAT THE PLAN DOES NOT GRANT.
  //
  // This used to ban five literal strings that had been oversold on the sales
  // page ('300 pins', '150 Reels', ...). That worked until a banned number
  // became a TRUE one: Amazon's Instagram cap is 150 as of 2026-09-15, so the
  // table correctly rendered "150 Reels" and the guard failed the build for
  // telling the truth. A blocklist of yesterday's wrong answers goes stale in
  // both directions.
  //
  // The rule underneath it is the durable one: every figure quoted in the
  // Amazon column has to be a number this plan actually grants. That catches a
  // typed-in stale figure the same way, and cannot object to a live one.
  {
    const granted = new Set(
      Object.values(A).filter((v): v is number => typeof v === 'number').map(String),
    )
    for (const r of rows) {
      // Years, prices and formatted sizes ("1280x720") are not allowances.
      const quoted = (r.amazon.match(/\b\d{2,}\b/g) ?? [])
        .filter(n => !/^(19|20)\d{2}$/.test(n) && !['720', '1280', '1024', '1536'].includes(n))
      for (const n of quoted) {
        check(`"${r.amazon}" quotes ${n}, which the Amazon plan grants`,
          granted.has(n),
          'a number on the comparison table that is not in TIERS.amazon is one somebody typed')
      }
    }
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

  // A SELLABLE price, not just any configured one. This used to assert the
  // ladder card quoted TIERS.creator.price, so it held the page to advertising
  // "From $49" long after Creator froze and checkout stopped selling it. The
  // guard was enforcing the bug.
  const sellable = SELLABLE_TIERS.map(t => TIERS[t].price)
  check('prices come from the plan config',
    amz.price.includes(String(TIERS.amazon.price))
    && sellable.some(p => lad.price.includes(String(p))),
    `${amz.price} | ${lad.price} — sellable: ${sellable.map(p => '$' + p).join(', ')}`)
  // No second check for "does not quote a FROZEN tier". Studio is $99 and so is
  // Amazon, so a price alone cannot tell a live plan from a retired one, and a
  // check that cannot distinguish them would fail on correct copy. The sellable
  // test above is the one that holds: $49 is on no sellable plan, which is what
  // made the old claim wrong.
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
