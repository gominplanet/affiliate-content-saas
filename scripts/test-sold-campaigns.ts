// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Creator Connections campaigns for products already selling: found from the
// creator's own earnings, never offered twice, and recorded only after Amazon
// took the accept.
import { readFileSync } from 'node:fs'
import { soldCampaignMatches } from '../lib/sold-campaigns'
import { keepaFamilyOf } from '../services/keepa'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const LIB = readFileSync('lib/sold-campaigns.ts', 'utf8')
const ROUTE = readFileSync('app/api/campaigns/sold-matches/route.ts', 'utf8')
const UI = readFileSync('components/earnings/SoldCampaigns.tsx', 'utf8')
const ACCEPT = readFileSync('lib/sold-accept.ts', 'utf8')
const DAILY = readFileSync('components/earnings/SoldCampaignsDaily.tsx', 'utf8')

check('sold means orders in the creator\'s own earnings', /from\('amazon_earnings_products'\)/.test(LIB) && /\.gt\('orders', 0\)/.test(LIB))
check('only open campaigns naming a sold product', /\.overlaps\('asins', keys\.slice\(i, i \+ 150\)\)/.test(LIB) && /\.gte\('ends_at', today\)/.test(LIB))
check('a full campaign is left out', /c\.available_slot != null && c\.available_slot <= 0/.test(LIB))
check('already accepted is read from both places MVP records it',
  /from\('cc_accepted_campaigns'\)/.test(LIB) && /from\('campaigns'\)\.select\('cc_campaign_id'\)/.test(LIB) && /if \(accepted\.has\(c\.campaign_id\)\) continue/.test(LIB))
check('the best earner comes first', /y\.earningsCents - x\.earningsCents/.test(LIB))
check('it is Labs', /canUsePreview\('sold_campaigns'/.test(ROUTE) && /sold_campaigns: 'admin'/.test(readFileSync('lib/labs-preview.ts', 'utf8')))
check('recorded only after Amazon took it',
  ACCEPT.indexOf("if (!res.ok) return { state: 'failed'") > 0 && ACCEPT.indexOf("if (!res.ok) return { state: 'failed'") < ACCEPT.indexOf("fetch('/api/campaigns/sold-matches', { method: 'POST'")
  && /acceptSoldMatch\(m\)/.test(UI) && /acceptSoldMatch\(m, 'sold-match-daily'\)/.test(DAILY))
check('another colour or size is recorded on the version the campaign pays on', /const asin = m\.campaignAsin \|\| m\.asin/.test(ACCEPT))
check('the row says when it is another colour or size', /m\.matchKind === 'variant'/.test(UI) && /Link that version to earn the campaign rate/.test(UI))

// ── THE DAILY RUN ───────────────────────────────────────────────────────────
check('it runs from every page, once a day', /<SoldCampaignsDaily \/>/.test(readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')) && /localStorage\.getItem\(DAY_KEY\) === day/.test(DAILY))
check('it respects the switch and the 20 hour gap across browsers', /if \(!j\.auto\) \{ mark\(\); return \}/.test(DAILY) && /20 \* 3600_000/.test(DAILY))
check('it is capped, and stops at a failure that fails them all', /slice\(0, DAILY_MAX\)/.test(DAILY) && /if \(stopsTheRun\(o\.note\)\) \{ result\.stopped = o\.note; break \}/.test(DAILY))
check('it says what it did, failures apart from successes', /toast\.warning\(msg/.test(DAILY) && /toast\.error\(`Today's Creator Connections campaigns were not accepted/.test(DAILY))
check('the card shows the last daily result and the switch', /Daily run on \{daily\.day\}/.test(UI) && /Accept new matches every day\./.test(UI))
check('a family that could not be looked up or saved is said, not taken for none',
  /error: keepaError/.test(readFileSync('lib/asin-family.ts', 'utf8')) && /could not save families/.test(readFileSync('lib/asin-family.ts', 'utf8'))
  && /Keepa answered \$\{res\.status\}/.test(readFileSync('services/keepa/index.ts', 'utf8')) && /Colour and size matching: known for/.test(UI))
check('families are filled in the background, best sellers first, above a Keepa floor',
  /"\/api\/cron\/asin-families"/.test(readFileSync('vercel.json', 'utf8')) && /MIN_TOKENS/.test(readFileSync('app/api/cron/asin-families/route.ts', 'utf8')))
check('off only when switched off: null is on', /sold_campaigns_auto !== false/.test(ROUTE))
check('one at a time, and it can be stopped', /for \(const m of list\)/.test(UI) && /if \(stop\.current\) break/.test(UI))
check('a failed accept says why on its own row', /o\?\.state === 'failed' && <div/.test(UI))

// ── MATCHING, RUN ON A FAKE DATABASE ────────────────────────────────────────
type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(t: string) {
      let rows = [...(tables[t] ?? [])]
      const q = {
        select: () => q, limit: () => q, range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return q },
        eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q },
        gt: (k: string, v: number) => { rows = rows.filter((r) => Number(r[k]) > v); return q },
        gte: (k: string, v: string) => { rows = rows.filter((r) => String(r[k]) >= v); return q },
        not: (k: string) => { rows = rows.filter((r) => r[k] != null); return q },
        in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return q },
        overlaps: (k: string, v: string[]) => { rows = rows.filter((r) => ((r[k] as string[]) ?? []).some((x) => v.includes(x))); return q },
        upsert: async () => ({ error: null }),
        then: (res: (x: { data: Row[]; error: null; count: number }) => unknown) => res({ data: rows, error: null, count: rows.length }),
      }
      return q
    },
  }
}
async function matching() {
  const far = '2999-01-01'
  const db = fakeDb({
    amazon_earnings_products: [
      { user_id: 'u', asin: 'BLACKFAN01', product_title: 'Tower Fan', orders: 14, earnings_cents: 3800, period_start: '2999-01-01' },
      { user_id: 'u', asin: 'KETTLE0001', product_title: 'Kettle', orders: 3, earnings_cents: 900, period_start: '2999-01-01' },
      { user_id: 'u', asin: 'LAMP000001', product_title: 'Lamp', orders: 2, earnings_cents: 500, period_start: '2999-01-01' },
    ],
    cc_accepted_campaigns: [], campaigns: [],
    asin_families: [
      { asin: 'BLACKFAN01', parent_asin: 'FANPARENT1', siblings: ['WHITEFAN01'], attrs: 'Black', checked_at: new Date().toISOString() },
      { asin: 'LAMP000001', parent_asin: 'LAMPPARENT', siblings: [], attrs: null, checked_at: new Date().toISOString() },
    ],
    cc_campaign_catalog: [
      { campaign_id: 'c-white', campaign_name: 'Fan', brand_name: 'LEVOIT', asins: ['WHITEFAN01'], commission_pct: 10, ends_at: far, available_slot: 5, parent_asin: 'FANPARENT1' },
      { campaign_id: 'c-kettle', campaign_name: 'Kettle', brand_name: 'K', asins: ['KETTLE0001'], commission_pct: 8, ends_at: far, available_slot: null, parent_asin: null },
      { campaign_id: 'c-lamp', campaign_name: 'Lamp', brand_name: 'L', asins: ['LAMPOTHER1'], commission_pct: 12, ends_at: far, available_slot: 3, parent_asin: 'LAMPPARENT' },
      { campaign_id: 'c-full', campaign_name: 'Full', brand_name: 'F', asins: ['KETTLE0001'], commission_pct: 20, ends_at: far, available_slot: 0, parent_asin: null },
      { campaign_id: 'c-other', campaign_name: 'Other', brand_name: 'O', asins: ['UNRELATED1'], commission_pct: 30, ends_at: far, available_slot: 9, parent_asin: 'SOMEPARENT' },
    ],
  })
  const r = await soldCampaignMatches(db, 'u', { days: 90 })
  const by = new Map(r.matches.map((m) => [m.campaignId, m]))
  check('an exact match is exact', by.get('c-kettle')?.matchKind === 'exact' && by.get('c-kettle')?.campaignAsin === null)
  check('another colour (a sibling the campaign names) matches, as a variant naming the version paid on',
    by.get('c-white')?.matchKind === 'variant' && by.get('c-white')?.asin === 'BLACKFAN01' && by.get('c-white')?.campaignAsin === 'WHITEFAN01' && by.get('c-white')?.soldAttrs === 'Black')
  check('a campaign product sharing the parent matches', by.get('c-lamp')?.matchKind === 'variant' && by.get('c-lamp')?.campaignAsin === 'LAMPOTHER1')
  check('a full campaign and an unrelated one do not', !by.has('c-full') && !by.has('c-other'))
  check('still best earner first', r.matches[0]?.campaignId === 'c-white')

  const f = keepaFamilyOf({ asin: 'blackfan01', parentAsin: 'FANPARENT1', variations: [
    { asin: 'BLACKFAN01', attributes: [{ dimension: 'Color', value: 'Black' }, { dimension: 'Size', value: 'Large' }] },
    { asin: 'WHITEFAN01', attributes: [{ dimension: 'Color', value: 'White' }] },
  ], variationCSV: 'WHITEFAN01,GREYFAN001' })
  check('Keepa family: parent, siblings from both fields, own colour and size',
    f?.parentAsin === 'FANPARENT1' && JSON.stringify(f?.siblings.sort()) === JSON.stringify(['GREYFAN001', 'WHITEFAN01']) && f?.attrs === 'Black, Large')
  check('a product that is its own parent has no parent', keepaFamilyOf({ asin: 'SOLO000001', parentAsin: 'SOLO000001' })?.parentAsin === null)
}

void matching().then(() => {
if (failures.length) {
  console.error(`\n❌ sold-campaigns: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ sold-campaigns: campaigns for products already selling, accepted one at a time, recorded only when Amazon took them')
})
