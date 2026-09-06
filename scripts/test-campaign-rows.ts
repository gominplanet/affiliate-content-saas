// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the campaigns table turn into one honest row per product?
//
// The Joined Campaigns page told a creator with 279 published posts that ONE of
// their 775 campaigns had content. The table is not one row per product and the
// page assumed it was.
//
// Two writers, and they do not agree. Accepting a campaign writes a row with the
// join markers, Amazon's internal campaign label as the title, and no post.
// Generating a blog post INSERTS its own row for the same product, with the real
// product title and the post attached, and no join marker at all. Reading only
// the rows that carry a join marker kept the empty half of every product and
// threw away the work.
//
// The other half of the failure was on screen: rows read
// "B0F327X17F +Room Numbers for Office Doors, Collaboration Invite 10%", which
// is an internal label, not a product.
import { mergeCampaignRows, displayTitle, isJoined, type CampaignRow } from '../lib/campaign-rows'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ASIN = 'B0F327X17F'

/** What the Amazon sync writes when a campaign is joined. */
const acceptRow: CampaignRow = {
  asin: ASIN, cc_campaign_id: 'camp-1', brand_name: 'EliteSign',
  product_title: 'B0F327X17F +Room Numbers for Office Doors, Collaboration Invite 10%',
  commission_pct: 10, ends_at: null, accepted_at: '2026-08-01T00:00:00Z',
  amazon_joined_at: '2026-08-01T00:00:00Z', details_url: 'https://amazon/x',
  status: 'pending', blog_post_id: null, wordpress_url: null,
}
/** What the blog generator inserts, on its own row, for the same product. */
const postRow: CampaignRow = {
  asin: ASIN, cc_campaign_id: null, brand_name: null,
  product_title: 'EliteSign Acrylic Room Number Signs, Pack of 4',
  commission_pct: null, ends_at: '2026-10-01', accepted_at: null, amazon_joined_at: null,
  status: 'published', blog_post_id: 'post-1', wordpress_url: 'https://gominreviews.com/room-numbers',
}

// ── the failure this file exists for ────────────────────────────────────────
{
  const merged = mergeCampaignRows([acceptRow, postRow])
  const r = merged.get(ASIN)
  check('the two rows become one product', merged.size === 1, `${merged.size}`)
  check('the post survives the merge', r?.blog_post_id === 'post-1', `${r?.blog_post_id}`)
  check('and so does its published URL', !!r?.wordpress_url, `${r?.wordpress_url}`)
  check('the join marker survives too', isJoined(r as CampaignRow) === true)
  check('so the product counts as joined AND made, not one or the other',
    isJoined(r as CampaignRow) && !!r?.blog_post_id)
  check('the brand from the accept row is kept', r?.brand_name === 'EliteSign', `${r?.brand_name}`)
  check('and the commission', r?.commission_pct === 10, `${r?.commission_pct}`)
  check('and the campaign id', r?.cc_campaign_id === 'camp-1', `${r?.cc_campaign_id}`)
}

// ── order must not decide the answer ────────────────────────────────────────
// Rows come back in whatever order the database feels like.
{
  const a = mergeCampaignRows([acceptRow, postRow]).get(ASIN)
  const b = mergeCampaignRows([postRow, acceptRow]).get(ASIN)
  for (const k of ['blog_post_id', 'wordpress_url', 'accepted_at', 'brand_name', 'commission_pct', 'cc_campaign_id', 'ends_at', 'product_title'] as const) {
    check(`"${k}" is the same whichever row came first`, a?.[k] === b?.[k], `${a?.[k]} vs ${b?.[k]}`)
  }
}

// ── the window is the one you can still publish into ────────────────────────
{
  const early: CampaignRow = { ...acceptRow, ends_at: '2026-09-10' }
  const late: CampaignRow = { ...postRow, ends_at: '2026-12-01' }
  check('the later end date wins', mergeCampaignRows([early, late]).get(ASIN)?.ends_at === '2026-12-01')
  check('and still wins in the other order', mergeCampaignRows([late, early]).get(ASIN)?.ends_at === '2026-12-01')
  check('a null end date never beats a real one',
    mergeCampaignRows([{ ...acceptRow, ends_at: null }, late]).get(ASIN)?.ends_at === '2026-12-01')
}

// ── the title comes off the product page, not the campaign label ────────────
{
  const r = mergeCampaignRows([acceptRow, postRow]).get(ASIN)
  check('the row carrying the post supplies the title',
    r?.product_title === 'EliteSign Acrylic Room Number Signs, Pack of 4', `${r?.product_title}`)

  // With no post anywhere, the label is all there is, and it still gets cleaned.
  const labelOnly = mergeCampaignRows([acceptRow]).get(ASIN)
  check('with no post, the label is kept as the only title',
    labelOnly?.product_title === acceptRow.product_title)
}

// ── a product joined but never written about ────────────────────────────────
{
  const merged = mergeCampaignRows([acceptRow])
  check('stays joined', isJoined(merged.get(ASIN) as CampaignRow) === true)
  check('and has no content', !merged.get(ASIN)?.blog_post_id)
}

// ── a product written about but never joined ────────────────────────────────
// It has to survive the merge and then be filtered out by the caller, not
// silently vanish here.
{
  const merged = mergeCampaignRows([postRow])
  check('is merged like any other', merged.size === 1)
  check('but is not joined', isJoined(merged.get(ASIN) as CampaignRow) === false)
}

// ── junk rows ───────────────────────────────────────────────────────────────
{
  const merged = mergeCampaignRows([
    { asin: '' }, { asin: 'nope' }, { asin: 'B0F327X17' }, acceptRow,
  ])
  check('a malformed product id is skipped rather than shown', merged.size === 1, `${merged.size}`)
  check('lowercase ids are normalised',
    mergeCampaignRows([{ ...acceptRow, asin: 'b0f327x17f' }]).has(ASIN))
}

// ── the titles a person actually reads ──────────────────────────────────────
{
  // Amazon's campaign names are marketing strings for its own browser: pipe
  // separated promo segments, the commission stapled on, wrapped in quotes,
  // decorated with stars, suffixed with internal codes. The product name is one
  // segment among several and every other segment is advertising.
  check('the promo segment and the commission come off, leaving the product',
    displayTitle('1 New Release | 4K Large Projector Screen for World Cup.Earn 20% Commission!') === '4K Large Projector Screen for World Cup',
    `${displayTitle('1 New Release | 4K Large Projector Screen for World Cup.Earn 20% Commission!')}`)
  check('quotes, a star, a sold count and an internal code all come off too',
    displayTitle('"⭐3K+ Sold | Bear Baby Food Maker | Homemade Baby Food | 15% Commission" (FW)') === 'Bear Baby Food Maker',
    `${displayTitle('"⭐3K+ Sold | Bear Baby Food Maker | Homemade Baby Food | 15% Commission" (FW)')}`)
  check('a product whose own name contains a promo word survives',
    displayTitle('Deal Cutter Pro | 12% Commission') === 'Deal Cutter Pro',
    `${displayTitle('Deal Cutter Pro | 12% Commission')}`)
  check('a name with no pipes is left alone',
    displayTitle('Anker 737 Power Bank, 24000mAh') === 'Anker 737 Power Bank, 24000mAh')

  check('the ASIN and the commission come off Amazon’s label',
    displayTitle('B0F327X17F +Room Numbers for Office Doors, Collaboration Invite 10%') === 'Room Numbers for Office Doors',
    `${displayTitle('B0F327X17F +Room Numbers for Office Doors, Collaboration Invite 10%')}`)
  check('a leading hash and a trailing "Campaign" come off',
    displayTitle('# ArtisaEura Dinosaur Canvas Wall Banners Campaign') === 'ArtisaEura Dinosaur Canvas Wall Banners',
    `${displayTitle('# ArtisaEura Dinosaur Canvas Wall Banners Campaign')}`)
  check('a real product name is left alone',
    displayTitle('FORGEBODY Beef Organ Complex') === 'FORGEBODY Beef Organ Complex')

  // A title inherited from an old post is still MVP showing it, so the house
  // rules apply: no banned word, no en-dash.
  const old = displayTitle('"Is This The Most Beautiful Tablecloth On Amazon?" – Honest Review')
  check('the banned word is scrubbed from an inherited title', !/honest/i.test(old || ''), `${old}`)
  check('and so is the dash', !/[—–]/.test(old || ''), `${old}`)

  check('nothing becomes null rather than an empty row', displayTitle('') === null && displayTitle(null) === null && displayTitle('   ') === null)
  check('a title that is only an ASIN becomes null, not a bare id',
    displayTitle('B0F327X17F') === null, `${displayTitle('B0F327X17F')}`)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
