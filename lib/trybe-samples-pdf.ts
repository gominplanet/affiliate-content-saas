// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR SAMPLES, AS A PDF (Alejandro, via Seb, 2026-10-14: "a this week export
// so we can have a file with the samples ourselves"; Seb: "i rather PDF ..
// it looks better"). Every sample on This week, grouped by brand with the
// brand's logo, in MVP's PDF template (lib/mvp-pdf.ts): where each one
// stands, the dates, days waiting, and the Amazon video you already have of
// it. The model is worked out here (pure, tested); the drawing follows it.

import { jsPDF } from 'jspdf'
import { stageOf, STAGE_WORDS, CHASE_DAYS, type Sample, type Stage } from '@/lib/trybe-week'
import { brandKit, drawCover, drawHeader, drawFooters, sectionTitle, table, tile, brandBadge, chip, BRAND, PAGE, type BrandAssets, type Cell, type Tone } from '@/lib/mvp-pdf'

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 12", never the year (no year in generated copy). Pure. */
export function shortDate(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export interface SampleLine {
  product: string
  stage: Stage
  asked: string
  here: string
  filmed: string
  submitted: string
  /** Days since it was asked for, while it is on the way. */
  waiting: number | null
  chase: boolean
  videos: number
  amazonVideo: string | null
}
export interface BrandGroup { brand: string; brandPage: string | null; logo: string | null; lines: SampleLine[]; open: number }
export interface SamplesReport {
  asOf: string
  counts: Record<Stage, number>
  chase: Array<{ brand: string; product: string; days: number }>
  groups: BrandGroup[]
}

/** Everything the PDF shows, worked out. Brands with samples still open come
 *  first; inside a brand, the ones furthest from done first. Pure. */
export function buildSamplesReport(samples: Array<Omit<Sample, 'has_ideas'>>, o: { now: number; logos?: Record<string, string | null>; amazon?: Record<string, string | null>; brandPage?: (id: string) => string }): SamplesReport {
  const counts: Record<Stage, number> = { on_the_way: 0, to_film: 0, to_submit: 0, done: 0 }
  const order: Record<Stage, number> = { on_the_way: 0, to_film: 1, to_submit: 2, done: 3 }
  const by = new Map<string, BrandGroup>()
  const chase: SamplesReport['chase'] = []
  for (const s of samples) {
    const stage = stageOf(s)
    counts[stage]++
    const waiting = stage === 'on_the_way' ? Math.max(0, Math.floor((o.now - Date.parse(s.requested_at)) / DAY)) : null
    const late = waiting != null && waiting >= CHASE_DAYS
    if (late) chase.push({ brand: s.brand_name, product: s.product, days: waiting as number })
    const key = s.brand_name.trim().toLowerCase()
    const g = by.get(key) || { brand: s.brand_name, brandPage: s.brand_id && o.brandPage ? o.brandPage(s.brand_id) : null, logo: o.logos?.[s.brand_name] ?? null, lines: [], open: 0 }
    if (!g.brandPage && s.brand_id && o.brandPage) g.brandPage = o.brandPage(s.brand_id)
    g.lines.push({
      product: s.product, stage,
      asked: shortDate(s.requested_at), here: shortDate(s.received_at), filmed: shortDate(s.filmed_at), submitted: shortDate(s.submitted_at),
      waiting, chase: late, videos: s.videos_planned,
      amazonVideo: o.amazon?.[`${s.brand_name}|${s.product}`] ?? null,
    })
    if (stage !== 'done') g.open++
    by.set(key, g)
  }
  const groups = Array.from(by.values())
  for (const g of groups) g.lines.sort((a, b) => order[a.stage] - order[b.stage] || (b.waiting ?? 0) - (a.waiting ?? 0))
  groups.sort((a, b) => b.open - a.open || a.brand.localeCompare(b.brand))
  return { asOf: shortDate(new Date(o.now).toISOString()), counts, chase: chase.sort((a, b) => b.days - a.days), groups }
}

const STAGE_TONE: Record<Stage, Tone> = { on_the_way: 'amber', to_film: 'indigo', to_submit: 'navy', done: 'green' }

/** Draws the report in MVP's template. */
export function renderSamplesPdf(r: SamplesReport, assets: BrandAssets = {}): ArrayBuffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const k = brandKit(doc, assets)
  const { W, M } = PAGE
  const total = r.counts.on_the_way + r.counts.to_film + r.counts.to_submit + r.counts.done

  // ── Cover ──────────────────────────────────────────────────────────────
  let y = drawCover(k, { eyebrow: 'TRYBE  |  Samples', title: 'Your samples', subtitle: `Every sample you asked TRYBE brands for, where each one stands, and what to do next. ${total} sample${total === 1 ? '' : 's'} with ${r.groups.length} brand${r.groups.length === 1 ? '' : 's'}.`, meta: `As of ${r.asOf}` })
  const tw = (W - 2 * M - 36) / 4
  const tiles: Array<[number, string, typeof BRAND.amber]> = [
    [r.counts.on_the_way, 'on the way', BRAND.amber],
    [r.counts.to_film, 'here, to film', BRAND.indigo],
    [r.counts.to_submit, 'filmed, to submit', BRAND.navy],
    [r.counts.done, 'submitted', BRAND.green],
  ]
  tiles.forEach(([n, label, c], i) => tile(k, M + i * (tw + 12), y, tw, String(n), label, c))
  y += 98

  // ── One section per brand, from the cover on ──────────────────────────
  const newPage = () => { doc.addPage(); drawHeader(k, 'Your TRYBE samples', `As of ${r.asOf}`); return 60 }

  // CHASE THESE, two lines each (Seb, 2026-10-14: "all messed up"): the
  // brand and product in bold across the full width, wrapped when long, and
  // the note under it. The note used to take only the width the name left,
  // so a long product name pushed it into a column one letter wide.
  // One line per brand: you chase a brand once, in its chat, not each product.
  const byBrand = new Map<string, { brand: string; products: string[]; most: number; least: number }>()
  for (const c of r.chase) {
    const g = byBrand.get(c.brand) || { brand: c.brand, products: [], most: c.days, least: c.days }
    g.products.push(c.product); g.most = Math.max(g.most, c.days); g.least = Math.min(g.least, c.days)
    byBrand.set(c.brand, g)
  }
  const groups = Array.from(byBrand.values()).sort((a, b) => b.most - a.most || b.products.length - a.products.length)
  k.font(9.5, 'heavy'); k.color(r.chase.length ? BRAND.amber : BRAND.soft)
  doc.text(r.chase.length ? `CHASE THESE (${r.chase.length} SAMPLE${r.chase.length === 1 ? '' : 'S'}, ${groups.length} BRAND${groups.length === 1 ? '' : 'S'})` : 'NOTHING TO CHASE', M, y, { charSpace: 1 })
  y += 16
  const textW = W - 2 * M - 14
  if (!r.chase.length) {
    k.font(10.5); k.color(BRAND.soft); doc.text(k.safe(`No sample has been on the way more than ${CHASE_DAYS} days.`), M, y + 4)
    y += 14
  } else {
    for (const g of groups) {
      const n = g.products.length
      const head = n === 1 ? `${g.brand}: ${g.products[0]}` : `${g.brand}: ${n} samples`
      const days = g.least === g.most ? `${g.most}` : `${g.least} to ${g.most}`
      const what = n === 1 ? '' : `${g.products.slice(0, 2).join('; ')}${n > 2 ? `; and ${n - 2} more` : ''}. `
      const note = `${what}Asked ${days} days ago. Ask in their TRYBE chat when ${n === 1 ? 'it ships' : 'they ship'}.`
      k.font(9.5); const noteLines = k.lines(note, textW).slice(0, 3)
      k.font(10.5, 'bold'); const headLines = k.lines(head, textW).slice(0, 2)
      if (y + 13 * headLines.length + 12 * noteLines.length + 10 > PAGE.BOTTOM) { y = newPage(); k.font(10.5, 'bold') }
      k.fill(BRAND.amber); doc.circle(M + 4, y + 1, 2.4, 'F')
      k.color(BRAND.ink)
      headLines.forEach((l, i) => doc.text(l, M + 14, y + 4 + i * 13))
      y += headLines.length * 13
      k.font(9.5); k.color(BRAND.soft)
      noteLines.forEach((l, i) => doc.text(l, M + 14, y + 3 + i * 12))
      y += noteLines.length * 12 + 6
    }
  }
  y += 26
  if (y + 150 > PAGE.BOTTOM) y = newPage()
  y = sectionTitle(k, y, 'By brand', 'Brands with samples still open come first.')
  const cols = [
    { label: 'Product', width: 160 },
    { label: 'Stage', width: 128 },
    { label: 'Asked', width: 52 },
    { label: 'Here', width: 52 },
    { label: 'Filmed', width: 56 },
    { label: 'Submitted', width: 76 },
  ]
  for (const g of r.groups) {
    if (y + 92 > PAGE.BOTTOM) y = newPage()
    brandBadge(k, M, y, 34, g.brand, g.logo)
    k.font(14, 'heavy'); k.color(BRAND.navy); doc.text(k.safe(g.brand), M + 46, y + 15)
    k.font(9); k.color(BRAND.soft)
    doc.text(k.safe(`${g.lines.length} sample${g.lines.length === 1 ? '' : 's'}${g.open ? `, ${g.open} still open` : ', all submitted'}`), M + 46, y + 29)
    if (g.brandPage) { k.font(9, 'bold'); k.color(BRAND.indigo); doc.textWithLink('Brand page on TRYBE', W - M, y + 15, { url: g.brandPage, align: 'right' }) }
    y += 44
    const rows: Cell[][] = g.lines.map((l) => [
      // How many videos the creator planned for it, worked out and now shown.
      { text: l.videos && l.stage !== 'done' ? `${l.product} (${l.videos} video${l.videos === 1 ? '' : 's'} planned)` : l.product, bold: true },
      { text: l.chase ? `Late: ${l.waiting} days` : l.waiting != null ? `On the way: ${l.waiting} day${l.waiting === 1 ? '' : 's'}` : STAGE_WORDS[l.stage], tone: l.chase ? 'red' : STAGE_TONE[l.stage] },
      { text: l.asked },
      { text: l.here || '-' },
      { text: l.filmed || '-' },
      { text: l.submitted || '-' },
    ])
    y = table(k, y, M, cols, rows, newPage)
    const withAmazon = g.lines.filter((l) => l.amazonVideo)
    if (withAmazon.length) {
      if (y + 20 > PAGE.BOTTOM) y = newPage()
      const w = chip(k, 'On Amazon', M, y, 'green')
      k.font(9); k.color(BRAND.soft)
      const note = k.lines(`You already filmed ${withAmazon.map((l) => l.product).join(', ')} on Amazon. Submit ${withAmazon.length === 1 ? 'that video' : 'those videos'} on TRYBE too, if ${withAmazon.length === 1 ? 'it fits' : 'they fit'} the brief.`, W - 2 * M - w - 90)
      note.forEach((l, i) => doc.text(l, M + w + 8, y + 9 + i * 12))
      // The video itself, one click away.
      k.font(9, 'bold'); k.color(BRAND.indigo); doc.textWithLink(withAmazon.length === 1 ? 'Watch it on Amazon' : 'Watch the first on Amazon', W - M, y + 9, { url: withAmazon[0].amazonVideo as string, align: 'right' })
      y += Math.max(24, note.length * 12 + 12)
    }
    y += 14
  }

  drawFooters(k)
  return doc.output('arraybuffer')
}
