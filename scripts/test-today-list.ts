// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TODAY, THE PRO DASHBOARD LIST: ranked, and never silent about a failed read.
//
// An empty list must mean "every source was read and nothing needs you". A
// source that errors is named in `unread`, so the card can say what it could
// not check instead of looking like a clean bill of health.
import { readFileSync } from 'node:fs'
import { rankToday, gatherToday, type TodayItem } from '../lib/today-list'
import { weekWindow } from '../lib/week-window'
import { gatherWeek } from '../lib/week-recap'

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

  // THE WEEK RECAP: last full Monday to Monday, and a failed read is not a zero.
  const w = weekWindow(new Date(Date.UTC(2030, 0, 9, 15)))  // a Wednesday
  check('the recap covers the last full week, Monday to Monday',
    w.start.toISOString() === '2029-12-31T00:00:00.000Z' && w.end.toISOString() === '2030-01-07T00:00:00.000Z' && w.key === '2029-12-31')
  const m = weekWindow(new Date(Date.UTC(2030, 0, 7, 0, 5)))  // just after Monday midnight
  check('on Monday the new recap is the week that just ended', m.key === '2029-12-31')
  check('back=1 is the week before', weekWindow(new Date(Date.UTC(2030, 0, 9)), 1).key === '2029-12-24')
  const wr = await gatherWeek(brokenSb, 'u1', w, weekWindow(new Date(Date.UTC(2030, 0, 9)), 1))
  check('a recap source that fails is null and named, never 0',
    wr.videos === null && wr.amazonVideos === null && wr.clicks === null && wr.unread.includes('YouTube videos'))
  const page = r('app/(dashboard)/recap/page.tsx')
  check('the recap page shows a missing number as missing', /Could not be read/.test(page) && /value == null \? '\?'/.test(page))
  check('opening the recap stops the top bar flashing', /localStorage\.setItem\(RECAP_SEEN_KEY/.test(page))
  check('the top bar carries the recap button', /<RecapTopbarButton \/>/.test(r('components/layout/DashboardShellV2.tsx')))

  // THE CC UPLOAD REMINDER (Seb, 2026-10-10): Monday and Thursday, AST, until an upload.
  {
    const { ccUploadDue, uploadDayName } = await import('../lib/cc-upload-due')
    const sat = Date.parse('2026-10-10T16:00:00Z') // Saturday, noon AST
    check('a Friday upload covers the Thursday reminder', !ccUploadDue('2026-10-09T15:00:00Z', sat).due)
    const mon = Date.parse('2026-10-12T14:00:00Z') // Monday, 10am AST
    const m = ccUploadDue('2026-10-09T15:00:00Z', mon)
    check('on Monday it is due again, named as Monday', m.due && uploadDayName(m.since) === 'Monday')
    check('an upload on Monday clears it', !ccUploadDue('2026-10-12T13:00:00Z', mon).due)
    check('Sunday night AST is still before Monday', !ccUploadDue('2026-10-09T15:00:00Z', Date.parse('2026-10-12T03:30:00Z')).due)
    check('a missed Thursday stays due over the weekend', ccUploadDue('2026-10-05T15:00:00Z', sat).due)
    check('no upload on record reads as due', ccUploadDue(null, sat).due)
    const tl = r('lib/today-list.ts')
    check('the reminder is admin only and links to the CC import', /tier === 'admin' && read\('CC upload'/.test(tl) && /'\/admin\/cc-import', 'Upload ZIPs'/.test(tl))
    check('every staging upload records when it happened', /CC_LAST_UPLOAD_FLAG/.test(r('app/api/admin/import-cc-catalog/stage/route.ts')))
  }

  if (failures.length) {
    console.error(`\n❌ today-list: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ today-list: ranked, Pro only, and a failed read is named rather than hidden; the week recap covers the last full week and never shows a failed read as zero')
}
main()
