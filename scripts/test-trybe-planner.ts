// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The TRYBE weekly planner PDF (Seb, 2026-10-13: "a downloadable pdf that is
// designed properly and cleanly", replacing the Excel export).

import { readFileSync, writeFileSync } from 'node:fs'
import QRCode from 'qrcode'
import { buildPlanner, pdfSafe, weekOf, readMonthlyEarnings, type PlannerProduct } from '../lib/trybe-planner'
import { renderPlannerPdf } from '../lib/trybe-planner-pdf'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const DAY = 86_400_000
const now = Date.parse('2026-10-13T12:00:00')
const iso = (d: number) => new Date(now - d * DAY).toISOString()

check('the week label has no year', weekOf(now) === 'Week of Oct 13')
check('text the PDF fonts cannot draw is made plain', pdfSafe('“You’re” — great ✨ Atom™ café') === '"You\'re" - great Atom(TM) café')
check('earnings by month are read from any list shape', JSON.stringify(readMonthlyEarnings({ data: [{ amount: 10, createdAt: '2026-09-03T00:00:00Z' }, { amount: '5.5', date: '2026-09-20' }]})) === JSON.stringify([{ month: '2026-09', amount: 15.5 }]) && readMonthlyEarnings({ data: {} }) === null)

const idea = (i: number) => ({ angle: `Cheap one versus Audien ${i}`, style: 'versus' as const, hook: 'If you think hearing aids cost $3,000, watch this.', shot: 'Slide both onto the counter, camera tilts down', beats: ['Show the tiny Atom next to the bulky one', 'Put it in, smile, turn the TV down', 'Show the $149 price card'], cta: 'Try it for 45 days, risk free.', forBrief: 'price' })
const product: PlannerProduct = {
  brand: 'Audien', product: 'Audien Atom ONE OTC Hearing Aid', price: '$98', image: null, productUrl: 'https://www.audienhearing.com/products/atom-one', brandPage: 'https://jointrybe.com/creator/brands/abc',
  wants: ['Show how small it is in the ear', 'Say the price: $149 versus $3,000'], avoid: ['No medical claims'], briefNote: null,
  ideas: [1, 2, 3, 4, 5].map(idea), ideasNote: null,
  viral: [1, 2, 3, 4, 5].map((i) => ({ url: `https://jointrybe.com/v/${i}`, thumb: null, caption: `Top video ${i}: this changed how I hear my grandkids` })), viralNote: 'The brand\'s best videos on TRYBE, not always for this exact product.',
}
const model = buildPlanner({
  now,
  samples: [
    { id: 's1', brand_id: 'b1', brand_name: 'Audien', product: 'Audien Atom ONE OTC Hearing Aid', videos_planned: 3, requested_at: iso(9), received_at: iso(2), filmed_at: null, submitted_at: null, has_ideas: true },
    { id: 's2', brand_id: 'b2', brand_name: 'NOBL', product: 'Travel bag', videos_planned: 3, requested_at: iso(10), received_at: null, filmed_at: null, submitted_at: null, has_ideas: false },
  ],
  brands: [
    { id: 'b1', name: 'Audien', logo: null, earnings: 240, submitted: 20, approved: 9, pending: 3, rejected: 8, enrolledAt: null, programs: [] },
    { id: 'b2', name: 'NOBL', logo: null, earnings: 0, submitted: 2, approved: 0, pending: 2, rejected: 0, enrolledAt: null, programs: [] },
  ],
  subs: { b1: { subs: [{ id: 'v1', status: 'pending', rawStatus: 'PENDING', at: now - 8 * DAY, product: 'Atom', thumbnail: null }, ...Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, status: 'approved' as const, rawStatus: 'APPROVED', at: now - (i % 10) * DAY, product: 'Atom', thumbnail: null }))], error: null }, b2: { subs: [], error: null } },
  verdicts: { b1: 'Focus', b2: 'Too early' },
  pooled: { b1: { members: 6, approvalRate: 0.62, payPerApproved: 18, why: null } },
  months: { b1: [{ month: '2026-08', amount: 60 }, { month: '2026-09', amount: 100 }, { month: '2026-10', amount: 80 }], b2: null },
  focusIds: ['b1'], target: 30, perDay: 1, products: [product],
})
check('the three jobs lead with the pace, the stuck video and the late sample', model.jobs.length === 3 && /Film \d+ videos? a day for Audien: 1[12] of 30/.test(model.jobs[0]) && /Nudge Audien: 1 video in review for 8 days/.test(model.jobs[1]) && /Ask NOBL when the Travel bag sample ships/.test(model.jobs[2]))
check('samples on the way are listed and flagged after a week', model.shipping.length === 1 && model.shipping[0].chase)
check('money: brands by earnings, approval next to members, months charted', model.money.brands[0].name === 'Audien' && Math.abs((model.money.brands[0].approval ?? 0) - 9 / 17) < 1e-9 && model.money.brands[0].members === 0.62 && model.money.months.map((m) => m.label).join(',') === 'Aug,Sep,Oct' && model.money.total === 240)
check('the calendar is the next 7 days', model.days.length === 7)

void (async () => {
  const qrs: Record<string, string> = {}
  for (const v of product.viral) qrs[v.url] = await QRCode.toDataURL(v.url, { margin: 0, width: 200 })
  const pdf = Buffer.from(renderPlannerPdf(model, { images: {}, qrs }))
  if (process.env.PLANNER_OUT) writeFileSync(process.env.PLANNER_OUT, pdf)
  const s = pdf.toString('latin1')
  const pages = (s.match(/\/Type \/Page\b/g) || []).length
  check('it is a PDF with a cover, calendar, product, shipping, money and checklist page', s.startsWith('%PDF-') && pages >= 6)
  check('the viral videos and the product page are clickable links', /\/URI \(https:\/\/jointrybe\.com\/v\/1\)/.test(s) && /\/URI \(https:\/\/www\.audienhearing\.com\/products\/atom-one\)/.test(s))
  // Wiring
  const wk = read('components/labs/TrybeWeek.tsx')
  check('This week downloads the planner, the Excel export is gone', /Download my weekly planner/.test(wk) && /renderPlannerPdf\(/.test(wk) && !/Export to spreadsheet/.test(wk) && !/buildXlsx/.test(wk))
  check('only products ticked Received get pages', /stageOf\(s\) === 'to_film' \|\| stageOf\(s\) === 'to_submit'/.test(wk))
  if (failures.length) { console.error('❌ trybe planner guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
  console.log(`✓ trybe planner guard passed (${pages} pages)`)
})()
