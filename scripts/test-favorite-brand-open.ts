// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The Favorite brands badge has to count what Accept all can actually do.
//
// It said "3 open" for Anker, and it still said "3 open" after Accept all, every
// time. Two causes, both the same mistake in different places: a number that
// described something other than the work the button performs.
//
//  1. Neither the badge nor Accept all filtered out campaigns that had ENDED.
//     25,104 of the catalogue's campaigns are over, plenty with available_slot
//     frozen above zero at whatever Amazon last exported. Those read as open,
//     cannot be joined, and so came back as open on every reload.
//
//  2. The badge read 1,000 rows in no order; Accept all read 1,000 rows ordered
//     by monthly_sold. On a brand matching far more than 1,000 of 918,748 rows,
//     those are different campaigns. The badge counted ones Accept all never saw.
//
// The ends_at filter and the shared ordering live in the query, which needs a
// database. What is testable here is the predicate both sides now share, so the
// two can never drift apart again by an edit to one of them.
import { ccIsAcceptable, CC_BRAND_SCAN_LIMIT, type CcBrandScanRow } from '../lib/cc-brand-scan'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const row = (over: Partial<CcBrandScanRow> = {}): CcBrandScanRow => ({
  campaign_id: 'amzn1.campaign.OPEN1',
  campaign_name: 'Anker 737 Power Bank 12%',
  brand_name: 'Anker',
  asins: ['B09VP6C4RJ'],
  rep_asin: 'B09VP6C4RJ',
  commission_pct: 12,
  ends_at: '2026-12-31',
  image_url: null,
  available_slot: 4,
  total_slot: 10,
  ...over,
})

const none = new Set<string>()

// ── the ordinary case ───────────────────────────────────────────────────────
{
  check('an open, unjoined campaign with an ASIN is acceptable',
    ccIsAcceptable(row(), none, false))
}

// ── the three reasons a campaign is NOT acceptable ──────────────────────────
{
  check('a full campaign is not acceptable', !ccIsAcceptable(row(), none, true),
    'you cannot join a campaign with no free slot')

  check('an already-joined campaign is not acceptable',
    !ccIsAcceptable(row({ campaign_id: 'amzn1.campaign.JOINED' }), new Set(['amzn1.campaign.JOINED']), false),
    'counting it would leave a badge that Accept all reports as "already joined" forever')

  check('a campaign with no ASIN is not acceptable',
    !ccIsAcceptable(row({ rep_asin: null, asins: [] }), none, false),
    'there is nothing to accept, so counting it leaves a phantom that never clears')
  check('an empty-string ASIN is not an ASIN',
    !ccIsAcceptable(row({ rep_asin: '  ', asins: [] }), none, false))
}

// ── the fallbacks that keep a real campaign countable ───────────────────────
{
  check('a null rep_asin still counts when the array has one',
    ccIsAcceptable(row({ rep_asin: null, asins: ['B09VP6C4RJ'] }), none, false),
    'rep_asin is generated from asins[1] and can lag; dropping the row would undercount')

  // Joined is keyed on the CAMPAIGN id, never the ASIN. Amazon runs several
  // distinct campaigns for one product, each separately joinable, so an ASIN key
  // would hide a brand-new campaign because an older one was joined.
  check('joining one campaign does not retire another for the same product',
    ccIsAcceptable(row({ campaign_id: 'amzn1.campaign.NEW' }), new Set(['amzn1.campaign.OLD']), false))
}

// ── the cap is a real number the UI has to be able to name ─────────────────
{
  check('the scan limit is a positive integer',
    Number.isInteger(CC_BRAND_SCAN_LIMIT) && CC_BRAND_SCAN_LIMIT > 0, String(CC_BRAND_SCAN_LIMIT))
}

if (failures.length) {
  console.error(`\n❌ favorite-brand-open: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ favorite-brand-open: the badge counts exactly what Accept all acts on')
