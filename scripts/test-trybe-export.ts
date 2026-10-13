// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The TRYBE spreadsheet (Seb, 2026-10-13) and ideas kept for every brand.

import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { buildXlsx, colName, sheetName } from '../lib/xlsx-lite'
import { trybeWorkbook, readMonthlyEarnings } from '../lib/trybe-export'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

check('column letters run A to Z, then AA', colName(0) === 'A' && colName(25) === 'Z' && colName(26) === 'AA' && colName(27) === 'AB')
const taken = new Set<string>()
check('sheet names are made legal and unique', sheetName('My: month/plan?', taken) === 'My month plan' && sheetName('My month plan', taken) === 'My month plan 2')

const now = Date.parse('2026-10-13T12:00:00Z')
const sheets = trybeWorkbook({
  now,
  samples: [{ brand_name: 'Audien', product: 'Atom Air <tiny>', videos_planned: 3, requested_at: '2026-10-01T00:00:00Z', received_at: '2026-10-05T00:00:00Z', filmed_at: null, submitted_at: null }],
  brands: [{ id: 'b1', name: 'Audien', logo: null, earnings: 120, submitted: 10, approved: 6, pending: 2, rejected: 2, enrolledAt: null, programs: [] }, { id: 'b2', name: 'NOBL', logo: null, earnings: 0, submitted: 0, approved: 0, pending: 0, rejected: 0, enrolledAt: null, programs: [] }],
  subs: { b1: { subs: [{ id: 's1', status: 'approved', rawStatus: 'APPROVED', at: Date.parse('2026-10-10T00:00:00Z'), product: 'Atom Air', thumbnail: null }], error: null }, b2: { subs: [], error: 'TRYBE answered 500' } },
  pooled: { b1: { members: 6, approvalRate: 0.62, payPerApproved: 18.5, why: null } },
  pay: { b1: '8% of GMV' },
  verdicts: { b1: 'Focus' },
  plans: [{ brand: 'Audien', product: 'Atom Air', at: null, plan: { product: 'Atom Air', body: 'b', hooks: [], ctas: [], funnel: { top: '', middle: '', bottom: '' }, videos: [{ angle: 'Cheap versus Audien', style: 'versus', hook: 'If you think hearing aids cost $3,000...', shot: 'slide both in', beats: ['show it', 'wear it'], cta: 'Try it for 45 days', forBrief: '' }] } }],
  month: [{ brand: 'Audien', sent: 11, target: 30 }],
  money: { b1: [{ month: '2026-09', amount: 40 }, { month: '2026-10', amount: 80 }], b2: null },
})
check('six tabs, in order', sheets.map((s) => s.name).join(',') === 'Samples,Videos,Shooting list,Brands,My month,Money')
const flat = JSON.stringify(sheets)
check('a brand TRYBE could not be read is said on the Videos tab', /Not read from TRYBE: NOBL: TRYBE answered 500/.test(flat))
check('the shooting list carries each idea with its beats', /Cheap versus Audien/.test(flat) && /1\) show it\\n2\) wear it/.test(flat))
check('totals and rates are formulas', /IF\(E2\+F2>0,E2\/\(E2\+F2\),\\"\\"\)/.test(flat) && /SUM\(C2:C3\)/.test(flat) && /MAX\(0,B2-C2\)/.test(flat))
check('earnings by month, with the total', /2026-09/.test(flat) && /SUM\(C2:C3\)/.test(JSON.stringify(sheets[5])))
check('samples have a retail value column for tax time', /Retail value \(\$\)/.test(flat) && /helps at tax time/.test(flat))
check('earnings by month are read from any list shape', JSON.stringify(readMonthlyEarnings({ data: [{ amount: 10, createdAt: '2026-09-03T00:00:00Z' }, { amount: '5.5', date: '2026-09-20' }, { amount: 20, month: '2026-10' }] })) === JSON.stringify([{ month: '2026-09', amount: 15.5 }, { month: '2026-10', amount: 20 }]) && readMonthlyEarnings({ data: { nothing: 1 } }) === null)

void (async () => {
  const files = buildXlsx(sheets)
  const zip = new JSZip()
  for (const [p, x] of Object.entries(files)) zip.file(p, x)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  if (process.env.TRYBE_XLSX_OUT) writeFileSync(process.env.TRYBE_XLSX_OUT, buf)
  const back = await JSZip.loadAsync(buf)
  const names = Object.keys(back.files)
  check('the file has every part Excel needs', ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet6.xml'].every((n) => names.includes(n)))
  const s1 = await back.file('xl/worksheets/sheet1.xml')!.async('string')
  check('text is escaped, and the header row is frozen and bold', /Atom Air &lt;tiny&gt;/.test(s1) && /state="frozen"/.test(s1) && /<c r="A1" s="1" t="inlineStr">/.test(s1))
  const wb = await back.file('xl/workbook.xml')!.async('string')
  check('the workbook lists the six sheets', (wb.match(/<sheet /g) || []).length === 6)

  // Wiring
  const route = read('app/api/labs/trybe/route.ts')
  check('ideas are kept for every brand, joined on TRYBE or not', /from\('trybe_ideas'\)\.insert\(/.test(route) && /action === 'ideas'/.test(route) && /onList: !!own \|\| ideasKept/.test(route))
  check('the export reads kept plans from every place they live', /action === 'export_data'/.test(route) && /from\('trybe_samples'\)\.select\('brand_id, brand_name, product, ideas, ideas_at'\)/.test(route))
  const vi = read('components/labs/TrybeVideoIdeas.tsx')
  check('a brand\'s saved ideas load when it opens, one per product', /api\(\{ action: 'ideas', brandId \}\)/.test(vi) && /Saved ideas/.test(vi))
  const wk = read('components/labs/TrybeWeek.tsx')
  check('This week exports the spreadsheet and says what it could not read', /Export to spreadsheet/.test(wk) && /could not be read from TRYBE; the Videos tab says which/.test(wk) && /buildXlsx\(sheets\)/.test(wk))
  const mig = read('supabase/migrations/429_trybe_ideas.sql')
  check('migration 429 is safe to run twice', /create table if not exists public\.trybe_ideas/.test(mig) && /create index if not exists/.test(mig))

  if (failures.length) {
    console.error('❌ trybe export guard failed:\n  - ' + failures.join('\n  - '))
    process.exit(1)
  }
  console.log('✓ trybe export guard passed')
})()
