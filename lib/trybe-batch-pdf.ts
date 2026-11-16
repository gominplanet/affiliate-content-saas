// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SHOOTING PDF FOR A BATCH (lib/trybe-batch; the Story-Time Script
// Generator brief's layout): a cover, a "Read before you shoot" page built
// from the brief's rules and the filming reality, an index (# / title / angle
// / host / where, a star for real stories), one card per script that never
// splits across pages (a navy bar with the number and title, the angle, host
// and seconds on the right, a sand row with where, the on-screen text and the
// real-story warning, then Say / Show with the story shaded cream and a coral
// rule where the product enters), and a submission log at the end. jsPDF in
// the browser, on MVP's own PDF kit (lib/mvp-pdf). Also the CSV.

import { jsPDF } from 'jspdf'
import { brandKit, drawCover, drawHeader, drawFooters, BRAND, PAGE, type BrandAssets, type RGB, type Kit } from '@/lib/mvp-pdf'
import { storySeconds, type Campaign, type Script } from '@/lib/trybe-batch'

const SAND: RGB = [245, 236, 220]
const CREAM: RGB = [253, 248, 238]
const CORAL: RGB = [232, 96, 76]
const W = PAGE.W - PAGE.M * 2

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec % 60))).padStart(2, '0')}`

/** The height a script's card needs, so it is never split. Pure. */
function cardHeight(k: Kit, s: Script): number {
  const col = (W - 16) / 2 - 8
  let h = 30 + 24 // header bar + meta row
  for (const b of [...s.story, ...s.body]) {
    // Measured in the sizes they are drawn in, or the words overrun the column.
    k.font(8.6, 'normal'); const said = k.lines(b.say || ' ', col).length
    k.font(8.2, 'normal'); const shown = k.lines(b.show || ' ', col).length
    const n = Math.max(said, shown)
    h += n * k.lh(8.6) + 8
  }
  return h + 18 + (s.story.length ? 12 : 0)
}

function drawCard(k: Kit, s: Script, y: number): number {
  const { doc } = k
  const x = PAGE.M
  const col = (W - 16) / 2 - 8
  // Navy bar: number and title, angle, host and seconds on the right.
  k.fill(BRAND.navy); doc.roundedRect(x, y, W, 26, 6, 6, 'F'); doc.rect(x, y + 14, W, 12, 'F')
  k.color(BRAND.white); k.font(10.5, 'heavy')
  const right = `${s.angle}  |  ${s.host}  |  ~${s.estSeconds}s`
  k.font(8.2, 'bold'); const rw = doc.getTextWidth(k.safe(right))
  k.font(10.5, 'heavy')
  const titleLine = k.lines(`#${s.idx}  ${s.title}`, W - rw - 30)[0] || ''
  doc.text(titleLine, x + 10, y + 17)
  k.font(8.2, 'bold'); doc.text(k.safe(right), x + W - 10 - rw, y + 17)
  y += 26
  // Sand row: where, on-screen text, the real-story warning.
  k.fill(SAND); doc.rect(x, y, W, 22, 'F')
  k.color(BRAND.ink); k.font(7.8, 'bold')
  const meta = `Where: ${s.location}    On screen (0 to 2s): "${s.title}"`
  doc.text(k.lines(meta, s.realStory ? W - 150 : W - 20)[0] || '', x + 10, y + 14)
  if (s.realStory) { k.color(CORAL); k.font(7.8, 'heavy'); doc.text('* REAL STORY: shoot only if true', x + W - 10 - doc.getTextWidth('* REAL STORY: shoot only if true'), y + 14) }
  y += 22
  // Say / Show.
  k.color(BRAND.soft); k.font(7, 'bold')
  doc.text('SAY', x + 10, y + 11); doc.text('SHOW', x + 18 + col + 8, y + 11)
  y += 16
  const beats: Array<{ say: string; show: string; story: boolean }> = [...s.story.map((b) => ({ ...b, story: true })), ...s.body.map((b) => ({ say: b.say, show: b.show, story: false }))]
  beats.forEach((b, i) => {
    k.font(8.6, 'normal'); const sl = k.lines(b.say || ' ', col)
    k.font(8.2, 'normal'); const wl = k.lines(b.show || ' ', col)
    const h = Math.max(sl.length, wl.length) * k.lh(8.6) + 8
    if (b.story) { k.fill(CREAM); doc.rect(x, y, W, h, 'F') }
    k.color(BRAND.ink); k.font(8.6, 'normal'); doc.text(sl, x + 10, y + 10)
    k.color(BRAND.soft); k.font(8.2, 'normal'); doc.text(wl, x + 18 + col + 8, y + 10)
    y += h
    if (b.story && (!beats[i + 1] || !beats[i + 1].story)) {
      k.stroke(CORAL); doc.setLineWidth(1.2); doc.line(x + 6, y + 1, x + W - 6, y + 1)
      k.color(CORAL); k.font(7, 'heavy'); const lab = `product enters at ~${mmss(storySeconds(s.story))}`
      doc.text(lab, x + W - 10 - doc.getTextWidth(lab), y + 10)
      y += 12
    }
  })
  return y + 14
}

export async function renderBatchPdf(c: Campaign, scripts: Script[], assets: BrandAssets = {}): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const k = brandKit(doc, assets)
  const cast = c.reality.cast.map((p) => p.name).join(' and ')
  drawCover(k, { eyebrow: 'Batch scripts', title: c.product.name || c.name, subtitle: c.name, meta: `${cast ? `${cast}  |  ` : ''}${scripts.length} scripts  |  version ${new Date().toISOString().slice(0, 10)}` })

  // ── Read before you shoot ───────────────────────────────────────────────
  doc.addPage()
  drawHeader(k, 'Read before you shoot', c.product.name)
  let y = 92
  const section = (title: string, lines: string[]) => {
    if (!lines.length) return
    if (y > PAGE.BOTTOM - 60) { doc.addPage(); drawHeader(k, 'Read before you shoot', c.product.name); y = 92 }
    k.color(BRAND.navy); k.font(11, 'heavy'); doc.text(k.safe(title), PAGE.M, y); y += 14
    k.color(BRAND.ink); k.font(9, 'normal')
    for (const l of lines) {
      const wrapped = k.lines(`-  ${l}`, W)
      if (y + wrapped.length * k.lh(9) > PAGE.BOTTOM) { doc.addPage(); drawHeader(k, 'Read before you shoot', c.product.name); y = 92 }
      doc.text(wrapped, PAGE.M, y); y += wrapped.length * k.lh(9) + 2
    }
    y += 10
  }
  const R = c.rules, X = c.reality
  section('The product', [`Always "${c.product.name}", spelled exactly so.`, ...(c.product.neverSay.length ? [`Never say: ${c.product.neverSay.join(', ')}.`] : []),
    ...(R.productDelaySec > 0 ? [`Story first: nothing about the product, its brand or "${c.product.categoryWords[0] || 'its category'}" in the first ${R.productDelaySec} seconds, said or seen.`] : [])])
  section('Claims you may make (and only these)', R.approvedClaims.map((x) => x.text))
  section('Never', [...(R.bannedTerms.length ? [`Say or show: ${R.bannedTerms.join(', ')}.`] : []), ...(R.noPrices ? ['Prices or money amounts.'] : []), ...(R.noPercentOff ? ['Percentages.'] : [])])
  section('Sale language', [R.saleLanguageRule || 'Generic words only, in the last beat only.'])
  section('Length and framing', [`${R.targetLengthSec[0]} to ${R.targetLengthSec[1]} seconds.`, ...(R.safeZoneNotes ? [R.safeZoneNotes] : [])])
  section('Where you film', X.locations.map((l) => `${l.name}${l.accessNotes ? `: ${l.accessNotes}` : ''}${l.deny.length ? `. Not here: ${l.deny.join(', ')}` : ''}.`))
  section('On camera', [X.isTraveling ? 'You may be travelling in these.' : 'You are NOT travelling: never say you are flying, checking in, boarding or landing today. You are dropping someone off, watching, remembering a past trip, or getting ready for one.',
    ...(X.onePersonPerVideo ? ['One person on camera per video.'] : []), ...(X.appFootageReuse ? ['App demo shots may be a screen recording from a past trip; label them so.'] : [])])
  // THE CONTEXT (the Walter scripts' "How these work"): what every story is
  // about, what the product never does with it, and what is said with care.
  if (c.context) {
    const P = c.contextPlan && c.contextPlan.from === c.context ? c.contextPlan : null
    section('The context', [c.context, ...(P?.keepApart.length ? P.keepApart.map((x) => `Kept apart: ${x}.`) : []), ...(P?.careful.length ? P.careful.map((x) => `Said with care: ${x}.`) : [])])
  }
  section('Real stories', ['Scripts marked with a star tell a specific event, name a real person, or use a detail of your context that may not be true. Shoot them only if they are true.'])

  // ── Index ───────────────────────────────────────────────────────────────
  doc.addPage(); drawHeader(k, 'Index', `${scripts.length} scripts`)
  y = 92
  const cols = [{ l: '#', w: 34 }, { l: 'Title', w: 236 }, { l: 'Angle', w: 92 }, { l: 'Host', w: 60 }, { l: 'Where', w: W - 422 }]
  const head = () => { k.fill(BRAND.navy); doc.rect(PAGE.M, y, W, 18, 'F'); k.color(BRAND.white); k.font(8, 'bold'); let cx = PAGE.M + 6; for (const c2 of cols) { doc.text(c2.l, cx, y + 12); cx += c2.w } y += 18 }
  head()
  scripts.forEach((s, i) => {
    if (y > PAGE.BOTTOM - 16) { doc.addPage(); drawHeader(k, 'Index', `${scripts.length} scripts`); y = 92; head() }
    if (i % 2) { k.fill(BRAND.panel); doc.rect(PAGE.M, y, W, 15, 'F') }
    k.color(BRAND.ink); k.font(7.8, 'normal')
    const cells = [`${s.idx}${s.realStory ? ' *' : ''}`, s.title, s.angle, s.host, s.location]
    let cx = PAGE.M + 6
    cells.forEach((t, j) => { doc.text(k.lines(t, cols[j].w - 8)[0] || '', cx, y + 10.5); cx += cols[j].w })
    y += 15
  })

  // ── One card per script, never split ────────────────────────────────────
  doc.addPage(); drawHeader(k, 'Scripts', c.product.name)
  y = 88
  for (const s of scripts) {
    const h = cardHeight(k, s)
    if (y + h > PAGE.BOTTOM && y > 100) { doc.addPage(); drawHeader(k, 'Scripts', c.product.name); y = 88 }
    y = drawCard(k, s, y)
  }

  // ── Submission log ──────────────────────────────────────────────────────
  doc.addPage(); drawHeader(k, 'Submission log', c.name)
  y = 92
  const lc = [{ l: 'Script #', w: 52 }, { l: 'Date shot', w: 72 }, { l: 'Footage files', w: 130 }, { l: 'Link', w: 170 }, { l: 'Status', w: W - 424 }]
  const lhead = () => { k.fill(BRAND.navy); doc.rect(PAGE.M, y, W, 18, 'F'); k.color(BRAND.white); k.font(8, 'bold'); let cx = PAGE.M + 6; for (const c2 of lc) { doc.text(c2.l, cx, y + 12); cx += c2.w } y += 18 }
  lhead()
  for (const s of scripts) {
    if (y > PAGE.BOTTOM - 20) { doc.addPage(); drawHeader(k, 'Submission log', c.name); y = 92; lhead() }
    k.stroke(BRAND.line); doc.setLineWidth(0.5); doc.line(PAGE.M, y + 19, PAGE.M + W, y + 19)
    k.color(BRAND.ink); k.font(7.8, 'normal')
    doc.text(String(s.idx), PAGE.M + 6, y + 13)
    if (s.link) doc.text(k.lines(s.link, lc[3].w - 8)[0] || '', PAGE.M + 6 + 52 + 72 + 130, y + 13)
    if (s.status !== 'draft') doc.text(s.status, PAGE.M + 6 + 52 + 72 + 130 + 170, y + 13)
    y += 20
  }
  drawFooters(k)
  return doc.output('blob')
}

/** The batch as CSV, one row per script. Pure. */
export function batchCsv(scripts: Script[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['#', 'Title', 'Angle', 'Host', 'Where', 'Real story', 'Seconds', 'Status', 'Link', 'Check', 'Reasons', 'Story (say)', 'Story (show)', 'Body (say)', 'Body (show)', 'Claims']
  const rows = scripts.map((s) => [s.idx, s.title, s.angle, s.host, s.location, s.realStory ? 'yes' : 'no', s.estSeconds, s.status, s.link || '', s.checks.state, [...s.checks.reasons, ...s.checks.warnings].join(' '),
    s.story.map((b) => b.say).join(' | '), s.story.map((b) => b.show).join(' | '), s.body.map((b) => b.say).join(' | '), s.body.map((b) => b.show).join(' | '), Array.from(new Set(s.body.flatMap((b) => b.claimIds))).join(' ')])
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\n')
}
