// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PLAN THIS VIDEO: admin only while tested, dates worked back from the
// campaign end, no prices in a plan, and "made" only when a video exists.
import { readFileSync } from 'node:fs'
import { planDates, parsePlan } from '../lib/video-plan'
import { canUsePreview } from '../lib/labs-preview'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')
const now = new Date(Date.UTC(2030, 0, 1, 12))

const d = planDates('2030-01-31', now)
check('post a week before the end, film four days before posting', d.postBy === '2030-01-24' && d.shootBy === '2030-01-20' && d.daysLeft === 30 && d.note === null)
const tight = planDates('2030-01-03', now)
check('a short window moves the dates to today and says so', tight.postBy === '2030-01-01' && tight.shootBy === '2030-01-01' && /2 days left/.test(tight.note || ''))
check('an ended campaign has no dates and says so', planDates('2029-12-20', now).postBy === null && /ended/.test(planDates('2029-12-20', now).note || ''))
check('no end date is said, not guessed', planDates(null, now).postBy === null && /no end date/.test(planDates(null, now).note || ''))

const raw = JSON.stringify({
  angle: 'Is it worth it for a small kitchen?',
  titles: ['I used this air fryer for a month', 'Now 30% off: grab it', 'Best air fryer 2031 for small kitchens'],
  hook: 'This fits under my cabinet, and that is the whole story.',
  outline: [{ section: 'Unboxing', points: ['Show the size next to a toaster', 'It is only $59 today'] }],
  shots: ['Basket sliding out'], short: { moment: 'The fries test', why: 'Crunch sound' }, thumbnail: { text: 'TOO SMALL?', idea: 'Fryer under a cabinet' },
  questions: ['How loud is it?'],
})
const plan = parsePlan(raw, d)
check('a line with a price or a discount is dropped', !!plan && plan.titles.length === 2 && !plan.titles.some((t) => /30%/.test(t)) && plan.outline[0].points.length === 1)
check('no year in a title', !!plan && !plan.titles.some((t) => /\b20\d\d\b/.test(t)))
check('an unusable answer is null, not an empty plan', parsePlan('nope', d) === null && parsePlan('{"titles":[],"outline":[]}', d) === null)

check('admin only while tested', canUsePreview('video_plan', 'admin') && !canUsePreview('video_plan', 'pro'))
check('the Labs item is admin gated', /href: '\/plan-video'[^\n]*gate: isAdmin/.test(r('components/layout/DashboardShellV2.tsx')))
const route = r('app/api/video-plan/route.ts')
check('the route checks the Labs gate', /canUsePreview\('video_plan'/.test(route))
check('only a campaign this account has can be planned', /from\('campaigns'\)[\s\S]{0,200}\.eq\('asin', asin\)/.test(route) && /not one of your campaigns/.test(route))
check('"made" is read from the videos on the channel', /from\('youtube_videos'\)\.select\('asin,title,youtube_video_id,published_at'\)/.test(route))
check('a plan that could not be saved is still returned and says so', /saved: false/.test(route))

if (failures.length) {
  console.error(`\n❌ video-plan: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ video-plan: admin only, dates from the campaign end, no prices or years, made only when the video exists')
