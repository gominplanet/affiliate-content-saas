// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Draws the weekly planner (lib/trybe-planner.ts) as a Letter PDF with jsPDF:
// MVP purple, one idea per line of sight, one product per page so a creator
// can print just the one they are filming, links that click in the PDF and
// QR codes that scan on paper. Charts are drawn as shapes, never pictures, so
// they stay sharp printed. Runs in the browser and in node (the guard renders
// one and checks it).

import { jsPDF } from 'jspdf'
import { pdfSafe, type PlannerModel, type PlannerProduct } from '@/lib/trybe-planner'
import { HOOK_STYLE_WORDS } from '@/lib/trybe-playbook'

type RGB = [number, number, number]
const PURPLE: RGB = [124, 58, 237]
const TINT: RGB = [245, 241, 255]
const INK: RGB = [24, 24, 27]
const SOFT: RGB = [107, 107, 118]
const LINE: RGB = [226, 226, 234]
const GREEN: RGB = [22, 163, 74]
const AMBER: RGB = [180, 83, 9]
const RED: RGB = [220, 38, 38]

const W = 612
const H = 792
const M = 44
const BOTTOM = H - 48

export interface PlannerAssets {
  /** Product photos as data URLs (JPEG or PNG), by the product's image URL. */
  images: Record<string, string>
  /** QR codes as PNG data URLs, by the link they open. */
  qrs: Record<string, string>
}

export function renderPlannerPdf(model: PlannerModel, assets: PlannerAssets): ArrayBuffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  let y = M

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2])
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2])
  const font = (size: number, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size) }
  const lines = (t: string, width: number): string[] => doc.splitTextToSize(pdfSafe(t), width) as string[]
  const lh = (size: number) => size * 1.32

  const header = () => {
    font(8.5, true); color(PURPLE); doc.text('MVP  |  TRYBE WEEKLY PLANNER', M, 28)
    font(8.5); color(SOFT); doc.text(pdfSafe(model.weekLabel), W - M, 28, { align: 'right' })
    stroke(LINE); doc.setLineWidth(0.6); doc.line(M, 34, W - M, 34)
  }
  const newPage = () => { doc.addPage(); header(); y = 56 }
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage() }

  /** Wrapped text at x, moving y. */
  const para = (t: string, x: number, width: number, size = 10.5, c: RGB = INK, bold = false) => {
    font(size, bold); color(c)
    for (const l of lines(t, width)) { ensure(lh(size)); doc.text(l, x, y + size); y += lh(size) }
  }
  const title = (t: string, sub?: string) => {
    ensure(60)
    font(20, true); color(INK); doc.text(pdfSafe(t), M, y + 20); y += 30
    if (sub) { para(sub, M, W - 2 * M, 10.5, SOFT); y += 4 }
    y += 6
  }
  const label = (t: string, c: RGB = SOFT) => { ensure(22); font(8.5, true); color(c); doc.text(pdfSafe(t).toUpperCase(), M, y + 9); y += 16 }
  const box = (x: number, yy: number, s = 9) => { stroke(SOFT); doc.setLineWidth(0.8); doc.rect(x, yy, s, s) }
  const link = (t: string, x: number, yy: number, url: string, size = 10) => {
    font(size, true); color(PURPLE); doc.textWithLink(pdfSafe(t), x, yy, { url })
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  header()
  y = 70
  font(32, true); color(INK); doc.text('Your TRYBE week', M, y + 30); y += 44
  font(13); color(SOFT); doc.text(pdfSafe(model.weekLabel), M, y + 12); y += 34

  // Three tiles: on hand, on the way, earned.
  const tiles: Array<[string, string, RGB]> = [
    [String(model.products.length), 'products on hand to film', PURPLE],
    [String(model.shipping.length), 'samples on the way', AMBER],
    [`$${Math.round(model.money.total).toLocaleString('en-US')}`, 'earned on TRYBE', GREEN],
  ]
  const tw = (W - 2 * M - 24) / 3
  tiles.forEach(([big, small, c], i) => {
    const x = M + i * (tw + 12)
    fill([250, 250, 252]); stroke(LINE); doc.setLineWidth(0.8); doc.roundedRect(x, y, tw, 70, 10, 10, 'FD')
    fill(c); doc.rect(x + 10, y, tw - 20, 3, 'F')
    font(24, true); color(c); doc.text(pdfSafe(big), x + 14, y + 36)
    font(9.5); color(SOFT); doc.text(pdfSafe(small), x + 14, y + 54)
  })
  y += 96

  label("This week's three jobs", PURPLE)
  model.jobs.forEach((j, i) => {
    ensure(40)
    fill(PURPLE); doc.circle(M + 10, y + 9, 10, 'F')
    font(11, true); doc.setTextColor(255, 255, 255); doc.text(String(i + 1), M + 10, y + 13, { align: 'center' })
    const ls = lines(j, W - 2 * M - 34)
    font(12); color(INK)
    ls.forEach((l, k) => doc.text(l, M + 30, y + 13 + k * lh(12)))
    y += Math.max(26, ls.length * lh(12) + 10)
  })
  y += 10

  if (model.pace.length) {
    label('Your month')
    for (const p of model.pace) {
      ensure(30)
      font(10.5, true); color(INK); doc.text(pdfSafe(p.brand), M, y + 10)
      font(10); color(SOFT); doc.text(`${p.sent} of ${p.target} videos sent`, W - M, y + 10, { align: 'right' })
      const bw = W - 2 * M
      fill([238, 238, 243]); doc.roundedRect(M, y + 16, bw, 7, 3.5, 3.5, 'F')
      const done = Math.min(1, p.target ? p.sent / p.target : 0)
      fill(done >= 1 ? GREEN : PURPLE); if (done > 0) doc.roundedRect(M, y + 16, Math.max(7, bw * done), 7, 3.5, 3.5, 'F')
      y += 34
    }
    font(9); color(SOFT); doc.text('About 1 ad in 25 becomes a winner, so around 30 videos a month per brand gives you a fair shot at one.', M, y + 6); y += 22
  }

  label('Stuck in review', model.stuck.length ? AMBER : SOFT)
  if (!model.stuck.length) para('Nothing stuck: no video has waited more than 5 days.', M, W - 2 * M, 10.5, SOFT)
  for (const s of model.stuck) {
    ensure(18); box(M, y + 2)
    font(10.5); color(INK); doc.text(pdfSafe(`Nudge ${s.brand}: ${s.count} video${s.count === 1 ? '' : 's'} waiting, the oldest ${s.oldestDays} days. Send a short note in their TRYBE chat.`), M + 16, y + 10)
    y += 18
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  newPage()
  title('Your next 7 days', 'Tick each box as you go. Planned from your samples and your monthly pace.')
  const cw = (W - 2 * M - 14) / 2
  let col = 0
  let rowTop = y
  let rowH = 0
  for (const d of model.days) {
    const tasks = d.tasks.slice(0, 7)
    const bodyH = tasks.length ? tasks.reduce((n, t) => n + lines(t.text, cw - 34).length * lh(9.5) + 4, 0) : lh(9.5)
    const hgt = Math.max(70, 34 + bodyH + 10)
    if (col === 0 && rowTop + hgt > BOTTOM) { newPage(); rowTop = y }
    const x = M + col * (cw + 14)
    fill([250, 250, 252]); stroke(LINE); doc.setLineWidth(0.8); doc.roundedRect(x, rowTop, cw, hgt, 10, 10, 'FD')
    font(11, true); color(PURPLE); doc.text(pdfSafe(d.label), x + 12, rowTop + 20)
    font(9); color(SOFT); doc.text(pdfSafe(d.date), x + cw - 12, rowTop + 20, { align: 'right' })
    let ty = rowTop + 32
    if (!tasks.length) { font(9.5); color(SOFT); doc.text('Free: film ahead, or rest.', x + 12, ty + 8) }
    for (const t of tasks) {
      box(x + 12, ty)
      font(9.5); color(t.late ? AMBER : INK)
      const ls = lines(t.text, cw - 34)
      ls.forEach((l, k) => doc.text(l, x + 26, ty + 8 + k * lh(9.5)))
      ty += ls.length * lh(9.5) + 4
    }
    rowH = Math.max(rowH, hgt)
    if (col === 1) { rowTop += rowH + 12; rowH = 0; col = 0 } else col = 1
  }
  y = rowTop + rowH + 12

  // ── One page per product on hand ───────────────────────────────────────────
  for (const p of model.products) productPage(p)

  function productPage(p: PlannerProduct) {
    newPage()
    const img = p.image ? assets.images[p.image] : null
    const ph = 104
    fill([250, 250, 252]); stroke(LINE); doc.setLineWidth(0.8); doc.roundedRect(M, y, ph, ph, 10, 10, 'FD')
    if (img) { try { doc.addImage(img, img.startsWith('data:image/png') ? 'PNG' : 'JPEG', M + 6, y + 6, ph - 12, ph - 12, undefined, 'FAST') } catch { /* the box stays empty */ } }
    const tx = M + ph + 16
    const tWidth = W - M - tx
    let ty = y + 4
    font(9, true); color(PURPLE); doc.text(pdfSafe(p.brand).toUpperCase(), tx, ty + 9); ty += 16
    font(19, true); color(INK)
    for (const l of lines(p.product, tWidth).slice(0, 2)) { doc.text(l, tx, ty + 18); ty += 22 }
    if (p.price) { font(11); color(SOFT); doc.text(pdfSafe(p.price), tx, ty + 12); ty += 18 }
    let lx = tx
    if (p.productUrl) { link('Product page', lx, ty + 12, p.productUrl); lx += doc.getTextWidth('Product page') + 16 }
    if (p.brandPage) link('Brand on TRYBE', lx, ty + 12, p.brandPage)
    y += ph + 18

    // What the brief asks.
    if (p.wants.length || p.avoid.length) {
      label('What the brief asks for', PURPLE)
      for (const w of p.wants.slice(0, 6)) { ensure(16); fill(PURPLE); doc.circle(M + 3, y + 6, 1.8, 'F'); para(w, M + 12, W - 2 * M - 12, 10) }
      if (p.avoid.length) {
        y += 2; label('It rules out', AMBER)
        for (const w of p.avoid.slice(0, 4)) { ensure(16); fill(AMBER); doc.circle(M + 3, y + 6, 1.8, 'F'); para(w, M + 12, W - 2 * M - 12, 10) }
      }
      y += 6
    } else if (p.briefNote) { para(p.briefNote, M, W - 2 * M, 9.5, SOFT); y += 6 }

    // Five videos.
    label(`${p.ideas.length} video${p.ideas.length === 1 ? '' : 's'} to film`, PURPLE)
    if (!p.ideas.length) para(p.ideasNote || 'No ideas yet: plan them in Make videos.', M, W - 2 * M, 10.5, SOFT)
    p.ideas.forEach((v, i) => {
      const inner = W - 2 * M - 40
      const beats = v.beats.slice(0, 4)
      const est = 26 + lines(`Hook: ${v.hook}`, inner).length * lh(10) + (v.shot ? lines(`First 2 seconds: ${v.shot}`, inner).length * lh(9.5) : 0)
        + beats.reduce((n, b) => n + lines(b, inner - 14).length * lh(9.5), 0) + (v.cta ? lines(`Close: ${v.cta}`, inner).length * lh(9.5) : 0) + 24
      ensure(est)
      const top = y
      fill(TINT); doc.roundedRect(M, top, W - 2 * M, est - 8, 10, 10, 'F')
      fill(PURPLE); doc.circle(M + 16, top + 16, 9, 'F')
      font(10, true); doc.setTextColor(255, 255, 255); doc.text(String(i + 1), M + 16, top + 19.5, { align: 'center' })
      const x = M + 32
      y = top + 6
      font(11.5, true); color(INK); doc.text(pdfSafe(v.angle || HOOK_STYLE_WORDS[v.style]), x, y + 12)
      font(8.5, true); color(PURPLE); doc.text(pdfSafe(HOOK_STYLE_WORDS[v.style] || '').toUpperCase(), W - M - 12, y + 12, { align: 'right' })
      y += 20
      para(`Hook: ${v.hook}`, x, inner, 10, INK, true)
      if (v.shot) para(`First 2 seconds: ${v.shot}`, x, inner, 9.5, SOFT)
      beats.forEach((b, j) => { font(9.5, true); color(PURPLE); doc.text(`${j + 1}`, x, y + 9.5); para(b, x + 14, inner - 14, 9.5) })
      if (v.cta) para(`Close: ${v.cta}`, x, inner, 9.5, INK)
      // Filmed, edited, submitted.
      let bx = x
      for (const t of ['Filmed', 'Edited', 'Submitted']) { box(bx, y + 3, 8); font(8.5); color(SOFT); doc.text(t, bx + 12, y + 10); bx += doc.getTextWidth(t) + 26 }
      y = top + est
    })

    // The brand's best videos on TRYBE.
    y += 2
    ensure(150)
    label(`Their best videos on TRYBE`, PURPLE)
    if (!p.viral.length) para(p.viralNote || 'TRYBE showed no top videos for this brand.', M, W - 2 * M, 10, SOFT)
    else {
      const n = Math.min(5, p.viral.length)
      const cell = (W - 2 * M) / 5
      p.viral.slice(0, n).forEach((v, i) => {
        const x = M + i * cell
        const qr = assets.qrs[v.url]
        if (qr) { try { doc.addImage(qr, 'PNG', x + 4, y, 70, 70) } catch { /* the link still works */ } }
        link(`Watch #${i + 1}`, x + 4, y + 84, v.url, 9.5)
        if (v.caption) { font(8); color(SOFT); lines(v.caption, cell - 10).slice(0, 3).forEach((l, k) => doc.text(l, x + 4, y + 96 + k * 10)) }
      })
      y += 132
      if (p.viralNote) para(p.viralNote, M, W - 2 * M, 8.5, SOFT)
    }
  }

  // ── Samples on the way ─────────────────────────────────────────────────────
  newPage()
  title('Samples on the way', 'Brands still shipping to you. After a week, ask when it ships.')
  if (!model.shipping.length) para('Nothing on the way. Every sample you logged has arrived.', M, W - 2 * M, 10.5, SOFT)
  else {
    const cols: Array<[string, number]> = [['Brand', M], ['Product', M + 150], ['Waiting', M + 380], ['', M + 450]]
    font(8.5, true); color(SOFT); cols.forEach(([t, x]) => doc.text(t.toUpperCase(), x, y + 9)); y += 16
    stroke(LINE); doc.line(M, y, W - M, y); y += 6
    for (const s of model.shipping) {
      ensure(22)
      font(10.5, true); color(INK); doc.text(lines(s.brand, 140)[0] || '', M, y + 11)
      font(10.5); doc.text(lines(s.product, 220)[0] || '', M + 150, y + 11)
      color(s.chase ? AMBER : INK); doc.text(`${s.daysWaiting} day${s.daysWaiting === 1 ? '' : 's'}`, M + 380, y + 11)
      if (s.chase) { box(M + 450, y + 3); font(9.5, true); color(AMBER); doc.text('Ask when it ships', M + 464, y + 11) }
      y += 20; stroke(LINE); doc.line(M, y, W - M, y); y += 4
    }
  }

  // ── Money ──────────────────────────────────────────────────────────────────
  newPage()
  title('Your money', 'What is working and what is not, at a glance.')
  font(30, true); color(GREEN); doc.text(`$${Math.round(model.money.total).toLocaleString('en-US')}`, M, y + 28)
  font(10); color(SOFT); doc.text('earned on TRYBE, all brands', M, y + 44); y += 62

  const top = model.money.brands.filter((b) => b.earned > 0 || (b.sent ?? 0) > 0).slice(0, 10)
  label('Earned per brand')
  if (!top.length) para('No earnings yet. Your first approved videos show here.', M, W - 2 * M, 10.5, SOFT)
  const max = Math.max(1, ...top.map((b) => b.earned))
  const nameW = 130
  const barW = W - 2 * M - nameW - 70
  for (const b of top) {
    ensure(22)
    font(10, true); color(INK); doc.text(lines(b.name, nameW - 8)[0] || '', M, y + 11)
    const c: RGB = b.verdict === 'Focus' ? GREEN : b.verdict === 'Drop' ? RED : PURPLE
    fill([238, 238, 243]); doc.roundedRect(M + nameW, y + 3, barW, 10, 4, 4, 'F')
    if (b.earned > 0) { fill(c); doc.roundedRect(M + nameW, y + 3, Math.max(8, barW * (b.earned / max)), 10, 4, 4, 'F') }
    font(10, true); color(INK); doc.text(`$${Math.round(b.earned).toLocaleString('en-US')}`, W - M, y + 12, { align: 'right' })
    y += 22
  }
  if (top.length) {
    font(8.5); let kx = M
    for (const [t, c] of [['Focus', GREEN], ['Keep or too early', PURPLE], ['Drop', RED]] as Array<[string, RGB]>) { fill(c); doc.rect(kx, y + 3, 8, 8, 'F'); color(SOFT); doc.text(t, kx + 12, y + 10); kx += doc.getTextWidth(t) + 30 }
    y += 24
  }

  if (model.money.months.length) {
    ensure(170)
    label('By month')
    const ch = 110
    const mmax = Math.max(1, ...model.money.months.map((m) => m.amount))
    const slot = (W - 2 * M) / model.money.months.length
    stroke(LINE); doc.line(M, y + ch, W - M, y + ch)
    model.money.months.forEach((m, i) => {
      const bh = Math.max(2, (m.amount / mmax) * (ch - 16))
      const bx = M + i * slot + slot * 0.25
      fill(i === model.money.months.length - 1 ? PURPLE : [196, 181, 253]); doc.roundedRect(bx, y + ch - bh, slot * 0.5, bh, 3, 3, 'F')
      font(9, true); color(INK); doc.text(`$${Math.round(m.amount).toLocaleString('en-US')}`, bx + slot * 0.25, y + ch - bh - 4, { align: 'center' })
      font(9); color(SOFT); doc.text(m.label, bx + slot * 0.25, y + ch + 12, { align: 'center' })
    })
    y += ch + 26
  } else if (model.money.monthsNote) { para(model.money.monthsNote, M, W - 2 * M, 9.5, SOFT); y += 6 }

  const rows = model.money.brands.filter((b) => (b.sent ?? 0) > 0)
  if (rows.length) {
    ensure(60)
    label('Approval and pay per video')
    const cx = [M, M + 170, M + 270, M + 390]
    font(8.5, true); color(SOFT); ['Brand', 'You approve', 'MVP members', '$ per video sent'].forEach((t, i) => doc.text(t.toUpperCase(), cx[i], y + 9)); y += 16
    for (const b of rows.slice(0, 14)) {
      ensure(18)
      font(10, true); color(INK); doc.text(lines(b.name, 160)[0] || '', cx[0], y + 10)
      font(10)
      const pct = (v: number | null) => (v == null ? 'not read' : `${Math.round(v * 100)}%`)
      color(b.approval != null && b.members != null && b.approval < b.members ? AMBER : INK); doc.text(pct(b.approval), cx[1], y + 10)
      color(SOFT); doc.text(b.members == null ? 'not enough yet' : pct(b.members), cx[2], y + 10)
      color(INK); doc.text(b.perVideo == null ? '-' : `$${b.perVideo.toFixed(2)}`, cx[3], y + 10)
      y += 18
    }
  }

  // ── Before you film ────────────────────────────────────────────────────────
  newPage()
  title('Before you film', 'From TRYBE\'s co-founder and its top creators. Run through it before every video.')
  const checks = [
    'Talk to the viewer: "you" and "your", not "I" and "my".',
    'No logo and no product held up in the first 2 seconds. It must not look like an ad.',
    'Open on the problem, the result or the moment, then show the product.',
    'Hook in under 12 words. No "hey guys", no "so today".',
    'A background that suits the buyer and pops: a gym, outdoors, a styled kitchen. Never a plain wall.',
    'Good sound and light: a clip-on mic and a ring light pay for themselves.',
    'Follow the brief: show what it asks, never what it rules out.',
    'Never invent a claim, a price or a result.',
    'Film several hooks for the same middle: the hook decides if the ad gets watched.',
    'Send it, then the next one. Volume is what finds the winner.',
  ]
  for (const c of checks) {
    ensure(26)
    box(M, y + 2, 12)
    const ls = lines(c, W - 2 * M - 24)
    font(11.5); color(INK); ls.forEach((l, k) => doc.text(l, M + 22, y + 12 + k * lh(11.5)))
    y += ls.length * lh(11.5) + 12
  }

  // Page numbers.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { doc.setPage(i); font(8.5); color(SOFT); doc.text(`${i} of ${pages}`, W / 2, H - 22, { align: 'center' }) }
  return doc.output('arraybuffer')
}
