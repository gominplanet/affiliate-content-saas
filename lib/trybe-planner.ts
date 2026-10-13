// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE WEEKLY PLANNER (Seb, 2026-10-13: "think of this as a weekly planner for
// busy content creators ... a downloadable pdf that is designed properly and
// cleanly", replacing the Excel export). What goes in it, worked out here and
// tested (scripts/test-trybe-planner.ts); lib/trybe-planner-pdf.ts draws it.
//
//   Cover: this week's three jobs, your month's pace, videos stuck in review.
//   Calendar: Monday to Sunday from the week plan, a box per job.
//   One page per product you have on hand (a sample ticked Received): photo,
//     price, what the brief asks, 5 video guidelines, and the brand's 5 best
//     videos on TRYBE, each a link and a QR code.
//   Samples still on the way, flagged after a week.
//   Money: earnings per brand and by month as charts, approval next to MVP
//     members', and earnings per video sent.
//   Before you film: the checklist (Lukas Pakter's rules).

import type { MyBrand, Submission } from '@/lib/trybe-mybrands'
import type { Pooled } from '@/lib/trybe-changes'
import type { VideoIdea } from '@/lib/trybe-playbook'
import { stuckOf } from '@/lib/trybe-mybrands'
import { planWeek, perDayNeeded, stageOf, CHASE_DAYS, type Sample, type Day, type Pace } from '@/lib/trybe-week'

const DAY = 86_400_000

export interface MonthMoney { month: string; amount: number }

/** Earnings by month from GET creator/v2/brands/{id}/earnings, whatever list
 *  shape TRYBE sends; null when none can be read. Pure. */
export function readMonthlyEarnings(json: unknown): MonthMoney[] | null {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const root = isObj(json) && (isObj(json.data) || Array.isArray(json.data)) ? json.data : json
  const list = Array.isArray(root) ? root : isObj(root) ? ([root.earnings, root.items, root.payouts, root.history, root.months, root.data].find(Array.isArray) as unknown[] | undefined) : undefined
  if (!list) return null
  const by = new Map<string, number>()
  for (const raw of list) {
    if (!isObj(raw)) continue
    const amt = Number(raw.amount ?? raw.earnings ?? raw.total ?? raw.value ?? raw.commission ?? raw.payout)
    const when = String(raw.month ?? raw.date ?? raw.createdAt ?? raw.created_at ?? raw.paidAt ?? raw.periodStart ?? raw.period ?? '')
    const m = when.match(/^(\d{4})-(\d{2})/) || (Number.isFinite(Date.parse(when)) ? new Date(Date.parse(when)).toISOString().match(/^(\d{4})-(\d{2})/) : null)
    if (!Number.isFinite(amt) || !m) continue
    by.set(`${m[1]}-${m[2]}`, (by.get(`${m[1]}-${m[2]}`) || 0) + amt)
  }
  if (!by.size) return null
  return Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 }))
}

export interface ViralVideo { url: string; thumb: string | null; caption: string | null }

export interface PlannerProduct {
  brand: string
  product: string
  price: string | null
  image: string | null
  productUrl: string | null
  brandPage: string | null
  wants: string[]
  avoid: string[]
  /** Where the brief stood: read, a document MVP could not read, none. */
  briefNote: string | null
  ideas: VideoIdea[]
  /** Why there are fewer than 5 ideas, when there are. */
  ideasNote: string | null
  viral: ViralVideo[]
  viralNote: string | null
}

export interface PlannerInput {
  now: number
  samples: Sample[]
  /** Brands with their submissions filled in (withSubmissions). */
  brands: MyBrand[]
  subs: Record<string, { subs: Submission[]; error: string | null }>
  verdicts: Record<string, string>
  pooled: Record<string, Pooled>
  months: Record<string, MonthMoney[] | null>
  focusIds: string[]
  target: number
  perDay: number
  products: PlannerProduct[]
}

export interface PlannerModel {
  weekLabel: string
  jobs: string[]
  pace: Pace[]
  stuck: Array<{ brand: string; count: number; oldestDays: number }>
  days: Day[]
  products: PlannerProduct[]
  shipping: Array<{ brand: string; product: string; daysWaiting: number; chase: boolean }>
  money: {
    brands: Array<{ name: string; earned: number; verdict: string; approval: number | null; members: number | null; perVideo: number | null; sent: number | null }>
    months: Array<{ label: string; amount: number }>
    monthsNote: string | null
    total: number
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Week label without the year (no year in generated copy). Pure. */
export function weekOf(now: number): string {
  const d = new Date(now)
  return `Week of ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** Text the PDF's built-in fonts can draw: curly quotes and dashes made
 *  plain, anything outside Latin-1 (emoji, symbols) dropped. Pure. */
export function pdfSafe(t: string | null | undefined): string {
  return String(t ?? '')
    .replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/™/g, '(TM)').replace(/[•·]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, '')
    .replace(/[ \t]+/g, ' ').trim()
}

/** Everything the PDF shows, worked out. Pure. */
export function buildPlanner(x: PlannerInput): PlannerModel {
  const start = new Date(new Date(x.now).getFullYear(), new Date(x.now).getMonth(), 1).getTime()
  const pace: Pace[] = x.focusIds.map((id) => {
    const b = x.brands.find((y) => y.id === id)
    const s = x.subs[id]
    return b && s && !s.error ? { brand: b.name, sent: s.subs.filter((v) => (v.at ?? 0) >= start).length, target: x.target } : null
  }).filter((p): p is Pace => !!p)

  const stuck = x.brands.map((b) => {
    const list = stuckOf(x.subs[b.id]?.subs || [], x.now)
    return list.length ? { brand: b.name, count: list.length, oldestDays: Math.floor((x.now - (list[0].at ?? x.now)) / DAY) } : null
  }).filter((s): s is { brand: string; count: number; oldestDays: number } => !!s)

  const shipping = x.samples.filter((s) => stageOf(s) === 'on_the_way').map((s) => {
    const d = Math.max(0, Math.floor((x.now - Date.parse(s.requested_at)) / DAY))
    return { brand: s.brand_name, product: s.product, daysWaiting: d, chase: d >= CHASE_DAYS }
  }).sort((a, b) => b.daysWaiting - a.daysWaiting)

  const days = planWeek(x.samples, { perDay: x.perDay, now: x.now, pace })

  // THE THREE JOBS: the biggest gap to the month's pace, the oldest stuck
  // videos, the sample overdue, then what is on hand to film.
  const jobs: string[] = []
  const behind = pace.map((p) => ({ p, n: perDayNeeded(p, x.now) })).filter((v) => v.n > 0).sort((a, b) => (b.p.target - b.p.sent) - (a.p.target - a.p.sent))
  if (behind[0]) jobs.push(`Film ${behind[0].n} video${behind[0].n === 1 ? '' : 's'} a day for ${behind[0].p.brand}: ${behind[0].p.sent} of ${behind[0].p.target} sent this month.`)
  if (stuck[0]) jobs.push(`Nudge ${stuck[0].brand}: ${stuck[0].count} video${stuck[0].count === 1 ? '' : 's'} in review for ${stuck[0].oldestDays} days.`)
  const late = shipping.find((s) => s.chase)
  if (late) jobs.push(`Ask ${late.brand} when the ${late.product} sample ships (asked ${late.daysWaiting} days ago).`)
  for (const p of x.products) { if (jobs.length >= 3) break; jobs.push(`Film your ${p.product} videos for ${p.brand}: the scripts are on its page.`) }
  if (behind[1] && jobs.length < 3) jobs.push(`Film ${behind[1].n} a day for ${behind[1].p.brand}: ${behind[1].p.sent} of ${behind[1].p.target} this month.`)
  if (!jobs.length) jobs.push('Pick a brand and a product in Make videos, and tick your samples as they arrive.')

  // MONEY
  const brands = x.brands.map((b) => {
    const pool = x.pooled[b.id]
    const decided = (b.approved ?? 0) + (b.rejected ?? 0)
    return {
      name: b.name, earned: b.earnings ?? 0, verdict: x.verdicts[b.id] || '',
      approval: b.approved != null && b.rejected != null && decided > 0 ? (b.approved as number) / decided : null,
      members: pool?.approvalRate ?? null,
      perVideo: b.submitted && b.earnings != null ? b.earnings / b.submitted : null,
      sent: b.submitted,
    }
  }).sort((a, b) => b.earned - a.earned)
  const byMonth = new Map<string, number>()
  let anyMonths = false
  for (const b of x.brands) for (const m of x.months[b.id] || []) { anyMonths = true; byMonth.set(m.month, (byMonth.get(m.month) || 0) + m.amount) }
  const months = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-6)
    .map(([k, amount]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1] || k, amount: Math.round(amount * 100) / 100 }))
  const total = brands.reduce((n, b) => n + b.earned, 0)

  return {
    weekLabel: weekOf(x.now), jobs: jobs.slice(0, 3), pace, stuck, days, products: x.products, shipping,
    money: { brands, months, monthsNote: anyMonths ? null : 'TRYBE did not give your earnings by month, so only the totals per brand show.', total },
  }
}
