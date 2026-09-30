// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Creator Connections campaigns for products already selling: found from the
// creator's own earnings, never offered twice, and recorded only after Amazon
// took the accept.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const LIB = readFileSync('lib/sold-campaigns.ts', 'utf8')
const ROUTE = readFileSync('app/api/campaigns/sold-matches/route.ts', 'utf8')
const UI = readFileSync('components/earnings/SoldCampaigns.tsx', 'utf8')

check('sold means orders in the creator\'s own earnings', /from\('amazon_earnings_products'\)/.test(LIB) && /\.gt\('orders', 0\)/.test(LIB))
check('only open campaigns naming a sold product', /\.overlaps\('asins', part\)/.test(LIB) && /\.gte\('ends_at', today\)/.test(LIB))
check('a full campaign is left out', /c\.available_slot != null && c\.available_slot <= 0/.test(LIB))
check('already accepted is read from both places MVP records it',
  /from\('cc_accepted_campaigns'\)/.test(LIB) && /from\('campaigns'\)\.select\('cc_campaign_id'\)/.test(LIB) && /if \(accepted\.has\(c\.campaign_id\)\) continue/.test(LIB))
check('the best earner comes first', /y\.earningsCents - x\.earningsCents/.test(LIB))
check('it is Labs', /canUsePreview\('sold_campaigns'/.test(ROUTE) && /sold_campaigns: 'labs'/.test(readFileSync('lib/labs-preview.ts', 'utf8')))
check('recorded only after Amazon took it',
  UI.indexOf("if (!res.ok) return { state: 'failed'") < UI.indexOf("fetch('/api/campaigns/sold-matches', { method: 'POST'"))
check('one at a time, and it can be stopped', /for \(const m of list\)/.test(UI) && /if \(stop\.current\) break/.test(UI))
check('a failed accept says why on its own row', /o\?\.state === 'failed' && <div/.test(UI))

if (failures.length) {
  console.error(`\n❌ sold-campaigns: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ sold-campaigns: campaigns for products already selling, accepted one at a time, recorded only when Amazon took them')
