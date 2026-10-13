// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TRYBE SPREADSHEET (Seb, 2026-10-13: "an exportable spreadsheet ... keep
// track of the samples they receive, the videos they make ... and keep track
// of their business"). Six tabs: Samples, Videos, Shooting list, Brands,
// My month, Money. Totals are formulas, so they update as the creator edits.
// Anything TRYBE did not give is said in the sheet, never filled with a
// guess. Pure (scripts/test-trybe-export.ts).

import type { Sheet, Cell } from '@/lib/xlsx-lite'
import type { Submission, MyBrand } from '@/lib/trybe-mybrands'
import type { Pooled } from '@/lib/trybe-changes'
import { HOOK_STYLE_WORDS, type VideoPlan } from '@/lib/trybe-playbook'

export interface ExportSample { brand_name: string; product: string; videos_planned: number; requested_at: string; received_at: string | null; filmed_at: string | null; submitted_at: string | null }
export interface ExportPlan { brand: string; product: string | null; at: string | null; plan: VideoPlan | null }
export interface MonthMoney { month: string; amount: number }

export interface ExportInput {
  now: number
  samples: ExportSample[]
  brands: MyBrand[]
  /** Each brand's videos, as read from TRYBE; error when it could not be read. */
  subs: Record<string, { subs: Submission[]; error: string | null }>
  pooled: Record<string, Pooled>
  pay: Record<string, string>
  verdicts: Record<string, string>
  plans: ExportPlan[]
  month: Array<{ brand: string; sent: number; target: number }>
  /** Earnings by month per brand id; null for a brand TRYBE gave none for. */
  money: Record<string, MonthMoney[] | null>
}

const day = (iso: string | number | null | undefined) => {
  if (iso == null || iso === '') return ''
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''
}
const STATUS_WORDS: Record<string, string> = { approved: 'Approved', pending: 'In review', rejected: 'Rejected', other: 'Other' }

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

/** The six tabs. Pure. */
export function trybeWorkbook(x: ExportInput): Sheet[] {
  const DAY = 86_400_000
  const nameOf = (id: string) => x.brands.find((b) => b.id === id)?.name || id

  // 1. Samples
  const samples: Cell[][] = [['Brand', 'Product', 'Videos planned', 'Asked', 'Received', 'Filmed', 'Submitted', 'Days waiting', 'Retail value ($)', 'Notes']]
  for (const s of x.samples) {
    const waitFrom = s.submitted_at ? null : s.filmed_at || s.received_at || s.requested_at
    samples.push([s.brand_name, s.product, s.videos_planned, day(s.requested_at), day(s.received_at), day(s.filmed_at), day(s.submitted_at),
      waitFrom ? Math.max(0, Math.floor((x.now - Date.parse(waitFrom)) / DAY)) : '', { v: null, s: 'money' }, ''])
  }
  if (x.samples.length) samples.push(['Total', '', { f: `SUM(C2:C${x.samples.length + 1})`, s: 'bold' }, '', { f: `COUNTA(E2:E${x.samples.length + 1})`, s: 'bold' }, { f: `COUNTA(F2:F${x.samples.length + 1})`, s: 'bold' }, { f: `COUNTA(G2:G${x.samples.length + 1})`, s: 'bold' }, '', { f: `SUM(I2:I${x.samples.length + 1})`, s: 'money' }, 'Retail value: fill in what each sample is worth. Free products can count as income, so this column helps at tax time.'])
  else samples.push(['No samples logged in MVP yet. Add them on the This week tab.'])

  // 2. Videos
  const videos: Cell[][] = [['Brand', 'Product', 'Sent on', 'Status', 'Hook used', 'Angle', 'Views', 'Notes']]
  const notRead: string[] = []
  for (const b of x.brands) {
    const r = x.subs[b.id]
    if (!r) continue
    if (r.error) { notRead.push(`${b.name}: ${r.error}`); continue }
    for (const s of [...r.subs].sort((p, q) => (q.at ?? 0) - (p.at ?? 0))) videos.push([b.name, s.product || '', day(s.at), STATUS_WORDS[s.status] || s.rawStatus || '', '', '', '', ''])
  }
  if (videos.length === 1) videos.push(['No videos read from TRYBE.'])
  for (const n of notRead) videos.push([`Not read from TRYBE: ${n}`])

  // 3. Shooting list
  const shoot: Cell[][] = [['Brand', 'Product', '#', 'Angle', 'Kind', 'Hook', 'First 2 seconds', 'Beats', 'Close', 'Filmed?']]
  for (const p of x.plans) {
    const plan = p.plan
    if (!plan) continue
    const product = p.product || plan.product || ''
    if (plan.videos?.length) {
      plan.videos.forEach((v, i) => shoot.push([p.brand, product, i + 1, v.angle, HOOK_STYLE_WORDS[v.style] || v.style, v.hook, v.shot, { v: v.beats.map((b, j) => `${j + 1}) ${b}`).join('\n'), s: 'wrap' }, v.cta, '']))
    } else {
      plan.hooks.forEach((h, i) => shoot.push([p.brand, product, i + 1, '', HOOK_STYLE_WORDS[h.style] || h.style, h.line, h.shot, { v: plan.body, s: 'wrap' }, plan.ctas[0]?.line || '', '']))
    }
  }
  if (shoot.length === 1) shoot.push(['No video ideas saved yet. Press Plan videos on a brand.'])

  // 4. Brands
  const brands: Cell[][] = [['Brand', 'Pays', 'Earned ($)', 'Sent', 'Approved', 'Rejected', 'Your approval', 'MVP members approve', 'Members: $ per approved video', 'Verdict']]
  x.brands.forEach((b, i) => {
    const r = i + 2
    const pool = x.pooled[b.id]
    brands.push([b.name, x.pay[b.id] || '', { v: b.earnings ?? null, s: 'money' }, b.submitted ?? '', b.approved ?? '', b.rejected ?? '',
      b.approved != null && b.rejected != null ? { f: `IF(E${r}+F${r}>0,E${r}/(E${r}+F${r}),"")`, s: 'pct' } : 'not read',
      pool?.approvalRate != null ? { v: Math.round(pool.approvalRate * 1000) / 1000, s: 'pct' } : (pool?.why ? 'not enough members yet' : ''),
      pool?.payPerApproved != null ? { v: Math.round(pool.payPerApproved * 100) / 100, s: 'money' } : '',
      x.verdicts[b.id] || ''])
  })
  if (x.brands.length) brands.push(['Total', '', { f: `SUM(C2:C${x.brands.length + 1})`, s: 'money' }, { f: `SUM(D2:D${x.brands.length + 1})`, s: 'bold' }, { f: `SUM(E2:E${x.brands.length + 1})`, s: 'bold' }, { f: `SUM(F2:F${x.brands.length + 1})`, s: 'bold' }])
  else brands.push(['No brands read from TRYBE.'])

  // 5. My month
  const month: Cell[][] = [['Focus brand', 'Videos target', 'Sent this month', 'Still to film', 'A day to get there']]
  const d = new Date(x.now)
  const daysLeft = Math.max(1, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1)
  x.month.forEach((m, i) => { const r = i + 2; month.push([m.brand, m.target, m.sent, { f: `MAX(0,B${r}-C${r})` }, { f: `ROUNDUP(D${r}/${daysLeft},0)` }]) })
  if (!x.month.length) month.push(['No focus brand picked. Pick 1 or 2 on the This week tab.'])
  month.push([''], ['About 1 ad in 25 becomes a winner, so around 30 videos a month per brand gives you a fair shot at one.'])

  // 6. Money
  const money: Cell[][] = [['Brand', 'Month', 'Earned ($)']]
  const noMonths: string[] = []
  for (const b of x.brands) {
    const m = x.money[b.id]
    if (m && m.length) m.forEach((e) => money.push([b.name, e.month, { v: e.amount, s: 'money' }]))
    else if ((b.earnings ?? 0) > 0) { money.push([b.name, 'all time', { v: b.earnings, s: 'money' }]); noMonths.push(nameOf(b.id)) }
  }
  if (money.length > 1) money.push(['Total', '', { f: `SUM(C2:C${money.length})`, s: 'money' }])
  else money.push(['No earnings on TRYBE yet.'])
  if (noMonths.length) money.push([''], [`TRYBE did not give earnings by month for ${noMonths.join(', ')}, so those show the all-time total.`])

  return [
    { name: 'Samples', widths: [22, 30, 9, 12, 12, 12, 12, 9, 14, 40], rows: samples },
    { name: 'Videos', widths: [22, 30, 12, 12, 34, 22, 10, 30], rows: videos },
    { name: 'Shooting list', widths: [18, 24, 4, 28, 16, 40, 40, 60, 34, 9], rows: shoot },
    { name: 'Brands', widths: [22, 24, 12, 8, 10, 10, 13, 16, 18, 12], rows: brands },
    { name: 'My month', widths: [24, 13, 15, 13, 17], rows: month },
    { name: 'Money', widths: [24, 12, 14], rows: money },
  ]
}
