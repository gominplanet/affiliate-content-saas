// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE'S ANALYTICS, IN MVP (Seb, 2026-10-19, with TRYBE's Analytics screen).
// Its own tab, laid out as TRYBE's: All or one brand, Total submissions split
// into approved, pending, revision and rejected with TRYBE's approval rate,
// then the same tiles under TRYBE's names. One brand's ad numbers are only
// ever its own videos', and a brand that could not be read is said.

import { readFileSync } from 'node:fs'
import { analyticsStatus, countSubmissions, approvalRateOf, addCounts, brandAdTotals, sameBrand, NO_COUNTS } from '../lib/trybe-analytics'
import { NO_TOTALS, type AdVideo } from '../lib/trybe-ads'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

check('TRYBE’s status words land in its four rows, revision before pending',
  analyticsStatus('APPROVED') === 'approved' && analyticsStatus('APPROVED_PENDING_PAYOUT') === 'approved' && analyticsStatus('PENDING_APPROVAL') === 'pending'
    && analyticsStatus('in review') === 'pending' && analyticsStatus('REVISION_REQUESTED') === 'revision' && analyticsStatus('changes requested') === 'revision'
    && analyticsStatus('NOT_APPROVED') === 'rejected' && analyticsStatus('declined') === 'rejected' && analyticsStatus('zzz') === 'other')

const now = Date.UTC(2026, 9, 19, 12)
const day = 86_400_000
const subs = [
  { rawStatus: 'PENDING_APPROVAL', at: now - 2 * day },
  { rawStatus: 'APPROVED', at: now - 3 * day },
  { rawStatus: 'REVISION_REQUESTED', at: now - 6 * day },
  { rawStatus: 'REJECTED', at: now - 20 * day },
  { rawStatus: 'APPROVED', at: null },
]
const week = countSubmissions(subs, 7, now)
check('the last 7 days count what was submitted in them, and one with no date', week.total === 4 && week.approved === 2 && week.pending === 1 && week.revision === 1 && week.rejected === 0, JSON.stringify(week))
check('30 days takes the older rejection too', countSubmissions(subs, 30, now).rejected === 1)
check('the approval rate is TRYBE’s: approved out of all submitted, 0% for one still pending',
  approvalRateOf(countSubmissions([{ rawStatus: 'pending', at: now }], 7, now)) === 0 && approvalRateOf(week) === 0.5 && approvalRateOf({ ...NO_COUNTS }) === null)
check('brands add up', addCounts(week, week).total === 8)

const v = (id: string, brand: string, brandId: string | null, earned: number, impressions: number): AdVideo => ({ ...NO_TOTALS, id, title: null, brand, brandId, thumbnail: null, live: true, earned, impressions, clicks: 1, hookRate: 30, ctr: 1 })
const videos = [v('1', 'Chef Preserve', 'cp', 10, 100), v('2', 'NOBL', 'nobl', 5, 50), v('3', 'chef preserve', null, 2, 10)]
const cp = brandAdTotals(videos, { id: 'cp', name: 'Chef Preserve' })
check('one brand’s numbers are its own videos’, matched by id or by name', cp.videos.length === 2 && cp.totals.earned === 12 && cp.totals.impressions === 110 && cp.totals.liveAds === 2)
check('a brand with no ads has no numbers, never another brand’s', brandAdTotals(videos, { id: 'x', name: 'Other' }).videos.length === 0)
check('sameBrand does not match a different brand', !sameBrand({ brandId: 'nobl', brand: 'NOBL' }, { id: 'cp', name: 'Chef Preserve' }))

const UI = read('components/labs/TrybeAds.tsx')
check('it is headed Analytics, with TRYBE’s tile names', /Analytics<\/p>/.test(UI) && ['Total earnings', 'Avg watch time', 'Active ads', 'Hook rate', 'Impressions', 'Click through', 'Link clicks'].every((l) => UI.includes(`label: '${l}'`)))
check('All and one chip per brand with activity in the period', /name: 'All'/.test(UI) && /filter\(\(b\) => b\.n > 0\)/.test(UI))
check('Total submissions shows approved, pending, revision and rejected, and the approval rate', /Total submissions/.test(UI) && ["'approved'", "'pending'", "'revision'", "'rejected'"].every((k) => UI.includes(`key: ${k}`)) && /Approval rate/.test(UI))
check('a brand that could not be read is said, not counted as zero', /could not be read, so these counts may be low/.test(UI) && /'not read'/.test(UI))
check('one brand’s tiles say they are added up from its videos', /added up from your \$\{one\.videos\.length\}/.test(UI) && /ran as ads in the last/.test(UI))
const HOOK = read('components/labs/useTrybeSubmissions.ts')
check('submissions are read per brand from TRYBE’s own list, which SCOUT already allows', /\/backend\/api\/creator\/v2\/brands\/\$\{encodeURIComponent\(id\)\}\/submissions\?page=1&limit=100/.test(HOOK) && /creator\/v2\/brands\/stats/.test(HOOK))
const OUT = read('components/labs/TrybeOutreach.tsx')
check('Analytics is its own tab in Track, opened from the address too', /\{ id: 'analytics', label: 'Analytics'[^\n]*group: 'track'/.test(OUT) && /t === 'analytics'/.test(OUT) && /tab === 'analytics' && canMyBrands && <TrybeAds/.test(OUT))
check('without SCOUT on TRYBE the tab says what it needs, not a blank page', /tab === 'analytics' && !canMyBrands/.test(OUT))

if (failures.length) {
  console.error(`\n❌ trybe-analytics: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-analytics: TRYBE’s Analytics in MVP, all brands or one, submissions by status, the same tiles, nothing borrowed from another brand')
