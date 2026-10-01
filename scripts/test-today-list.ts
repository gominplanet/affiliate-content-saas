// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TODAY, THE PRO DASHBOARD LIST: ranked, and never silent about a failed read.
//
// An empty list must mean "every source was read and nothing needs you". A
// source that errors is named in `unread`, so the card can say what it could
// not check instead of looking like a clean bill of health.
import { readFileSync } from 'node:fs'
import { rankToday, gatherToday, type TodayItem } from '../lib/today-list'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')

const it = (kind: TodayItem['kind'], rank: number, count: number): TodayItem => ({ kind, rank, count, title: kind, detail: '', href: '/', cta: 'Go', tone: 'upkeep' })
const ranked = rankToday([it('refresh_due', 30, 9), it('reconnect', 100, 3), it('encore', 70, 0), it('price_alerts', 50, 2), it('cc_matches', 50, 5)])
check('broken things first, then by count, and empty rows dropped',
  ranked.map((x) => x.kind).join(',') === 'reconnect,cc_matches,price_alerts,refresh_due')

// A database where every read fails.
const brokenSb = {
  from: () => {
    const q: Record<string, unknown> = {}
    const chain = () => q
    for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'not', 'order', 'limit', 'is']) q[m] = chain
    q.maybeSingle = async () => ({ data: null, error: { message: 'boom' } })
    q.then = (res: (v: unknown) => void) => res({ data: null, error: { message: 'boom' } })
    return q
  },
}

async function main() {
  const rep = await gatherToday(brokenSb, 'u1', 'pro')
  check('a failed read is reported, not shown as nothing to do', rep.items.length === 0 && rep.unread.length >= 4)
  check('Liftoff and scheduled posts are among the named failures', rep.unread.includes('Liftoff') && rep.unread.includes('scheduled posts'))

  const route = r('app/api/today/route.ts')
  check('the route is Pro only', /canSeeNav\('labs', tier\)/.test(route) && /status: 403/.test(route))
  const card = r('components/dashboard/TodayList.tsx')
  check('the card says what it could not check', /Could not check:/.test(card))
  check('"nothing needs you" only when every source was read', /items\.length === 0 && !unread\.length/.test(card))
  const dash = r('app/(dashboard)/dashboard/page.tsx')
  check('the dashboard shows Today to Pro', /\{isPro && <TodayList \/>\}/.test(dash))
  check('the panels Today links to keep their anchors', /id="price-alerts"/.test(dash) && /id="cc-digest"/.test(dash))

  if (failures.length) {
    console.error(`\n❌ today-list: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ today-list: ranked, Pro only, and a failed read is named rather than hidden')
}
main()
