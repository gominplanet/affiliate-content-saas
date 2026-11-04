// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NEW LOOK'S PAGE PICTURES, from Seb's PNGs to public/banners/<name>.webp
// (lib/banner-art lists which menu row shows which).
//
//   node scripts/clean-banner-art.cjs <folder of PNGs> [name,name]
//
// Every picture is trimmed to what is drawn on it and shrunk to fit 760 by
// 560. The fixes below are for the first set (2026-11-04), named per file:
//   - CHECKER: a grey stair-step shadow painted under the object instead of a
//     see-through one. Flooded away from the see-through side, stopping at
//     anything coloured or outlined. It was not clean enough on articles,
//     blog-design, blog-posts and ended-deals, so those were remade (the
//     second set, clean) instead. HOLD keeps a picture off until remade.
//   - HAZE: a pale see-through box behind the whole picture, lifted off.
//   - meta-hub, group-queue: a piece cut off at the box's edge.
//   - face-models, team, brand-voice, meta-hub: a stray sliver or dot.
// A remade picture with a clean see-through background needs none of them:
// take its name out of the lists before running it.
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const SRC = process.argv[2]
if (!SRC) { console.error('Usage: node scripts/clean-banner-art.cjs <folder of PNGs> [name,name]'); process.exit(1) }
const OUT = path.join(__dirname, '..', 'public', 'banners')
const HOLD = new Set()
const MAP = {
  'Instagram auto dm.png': 'instagram-auto-dm', 'Isometric Dashboard Orbit Illustration.png': 'dashboard',
  'ads.png': 'ads', 'amazon live.png': 'amazon-live', 'articles.png': 'articles', 'ask-mvp.png': 'ask-mvp',
  'blog design.png': 'blog-design', 'blog post.png': 'blog-posts', 'brand-campaigns.png': 'brand-campaigns',
  'brand-inbox.png': 'brand-inbox', 'brand-pitches.png': 'brand-pitches', 'brand-voice.png': 'brand-voice',
  'bulk amazon upload.png': 'bulk-amazon-upload', 'clipfactory.png': 'clip-factory', 'comparisons.png': 'comparisons',
  'connections.png': 'connections', 'deal-radar.png': 'deal-radar', 'deals-hub.png': 'deals-hub', 'drop.png': 'drop',
  'ended deals.png': 'ended-deals', 'face-models.png': 'face-models', 'group-queue.png': 'group-queue',
  'idea-lists.png': 'idea-lists', 'launch-kit.png': 'launch-kit', 'link-in-bio.png': 'link-in-bio',
  'meta-hub.png': 'meta-hub', 'partner-programs.png': 'partner-programs', 'passport.png': 'passport',
  'plan-usage.png': 'plan-usage', 'product-research.png': 'product-research', 'revieweditor.png': 'review-editor',
  'seo.png': 'seo', 'social-designs.png': 'social-designs', 'social-push.png': 'social-push', 'team.png': 'team',
  'thumbnails.png': 'thumbnails', 'trybe.png': 'trybe', 'tutorials.png': 'tutorials',
  'youtube comments.png': 'youtube-comments', 'youtube copilot.png': 'youtube-co-pilot',
  // The second set (2026-11-04): remakes of the four held back, and three new pages.
  'hashtags insight.png': 'hashtag-insights', 'newsletter.png': 'newsletter', 'scriptwriter.png': 'scriptwriter',
}
const CHECKER = new Set(['ads', 'comparisons', 'seo'])
const HAZE = new Set(['deals-hub', 'group-queue', 'launch-kit', 'link-in-bio', 'meta-hub', 'passport', 'social-designs', 'social-push'])
const SLIVER = new Set(['face-models', 'team'])
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null

const sat = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])
const mn = (d, i) => Math.min(d[i], d[i + 1], d[i + 2])

function bbox(d, W, H, t = 40) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return { x0, y0, x1, y1 }
}

// The pale see-through box: estimate its alpha per 48px cell from the light,
// grey, half-see-through pixels, then lift it off every pixel.
function unhaze(d, W, H, rect) {
  const C = 48, gw = Math.ceil(W / C), gh = Math.ceil(H / C)
  const grid = new Float32Array(gw * gh).fill(NaN)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const vals = []
    for (let y = gy * C; y < Math.min(H, gy * C + C); y++) for (let x = gx * C; x < Math.min(W, gx * C + C); x++) {
      const i = (y * W + x) * 4
      if (d[i + 3] > 15 && d[i + 3] < 150 && sat(d, i) < 30 && mn(d, i) > 200) vals.push(d[i + 3])
    }
    if (vals.length > C * C * 0.15) { vals.sort((a, b) => a - b); grid[gy * gw + gx] = vals[Math.floor(vals.length / 2)] / 255 }
  }
  // Fill cells with no backdrop sample (covered by objects) from their neighbours.
  for (let pass = 0; pass < 40; pass++) {
    let missing = 0
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const k = gy * gw + gx; if (!isNaN(grid[k])) continue
      const cx = (gx + 0.5) * C, cy = (gy + 0.5) * C
      if (cx < rect.x0 || cx > rect.x1 || cy < rect.y0 || cy > rect.y1) continue
      let s = 0, n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = grid[(gy + dy) * gw + gx + dx]; if (gx + dx >= 0 && gx + dx < gw && gy + dy >= 0 && gy + dy < gh && !isNaN(v)) { s += v; n++ } }
      if (n) grid[k] = s / n; else missing++
    }
    if (!missing) break
  }
  const bAt = (x, y) => {
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(x / C))), gy = Math.min(gh - 1, Math.max(0, Math.floor(y / C)))
    const v = grid[gy * gw + gx]; return isNaN(v) ? 0.4 : v
  }
  const Wc = [250, 246, 240]
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, A = d[i + 3] / 255
    if (A === 0) continue
    const b = Math.min(0.6, bAt(x, y) * 1.06)
    const ao = (A - b) / (1 - b)
    if (ao <= 0.1) { d[i + 3] = 0; continue }
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] * A - Wc[c] * b * (1 - ao)) / ao)))
    d[i + 3] = Math.round(ao * 255)
  }
}

// The grey stair-step shadow under an object: flood it from the see-through
// side through grey pixels, stopping at anything coloured or outlined.
function unchecker(d, W, H, bb) {
  const top = bb.y1 - 70
  const seen = new Uint8Array(W * H), q = []
  const ok = (x, y) => { const i = (y * W + x) * 4; return d[i + 3] >= 10 && sat(d, i) <= 22 && mn(d, i) >= 140 }
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] < 10) { seen[y * W + x] = 1; q.push(x, y) }
  let removed = 0
  while (q.length) {
    const y = q.pop(), x = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= W || ny < top || ny >= H || seen[ny * W + nx]) continue
      seen[ny * W + nx] = 1
      if (!ok(nx, ny)) continue
      d[(ny * W + nx) * 4 + 3] = 0; removed++; q.push(nx, ny)
    }
  }
  return removed
}

// Pieces cut off at the pale box's edge, and stray white slivers.
function dropPieces(d, W, H, rect, mode) {
  const lab = new Int32Array(W * H).fill(-1), comps = []
  for (let s = 0; s < W * H; s++) {
    if (lab[s] !== -1 || d[s * 4 + 3] <= 60) continue
    const id = comps.length, st = [s]; lab[s] = id
    const c = { n: 0, x0: W, y0: H, x1: 0, y1: 0, light: 0, px: [] }
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0
      c.n++; c.px.push(p); if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y
      if (sat(d, p * 4) < 25 && mn(d, p * 4) > 190) c.light++
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
        const q = ny * W + nx; if (lab[q] === -1 && d[q * 4 + 3] > 60) { lab[q] = id; st.push(q) }
      }
    }
    comps.push(c)
  }
  const total = comps.reduce((s, c) => s + c.n, 0), out = []
  for (const c of comps) {
    let drop = false
    if (mode === 'haze') {
      const edge = c.x0 <= rect.x0 + 3 || c.x1 >= rect.x1 - 3 || c.y0 <= rect.y0 + 3 || c.y1 >= rect.y1 - 3
      drop = edge && c.n < total * 0.08
    } else {
      drop = c.n < total * 0.03 && c.light > c.n * 0.6 && c.y0 > rect.y1 - (rect.y1 - rect.y0) * 0.2
    }
    if (!drop) continue
    out.push({ n: c.n, at: [c.x0, c.y0, c.x1, c.y1] })
    for (const p of c.px) d[p * 4 + 3] = 0
    // Its faint glow and edge pixels too.
    for (let y = Math.max(0, c.y0 - 12); y <= Math.min(H - 1, c.y1 + 12); y++) for (let x = Math.max(0, c.x0 - 12); x <= Math.min(W - 1, c.x1 + 12); x++) {
      const i = (y * W + x) * 4; if (d[i + 3] <= 60) d[i + 3] = 0
    }
  }
  return out
}

// A lone dot well below everything else.
function dropSpecks(d, W, H) {
  const bb = bbox(d, W, H, 60), lab = new Uint8Array(W * H), out = []
  const comps = []
  for (let s0 = 0; s0 < W * H; s0++) {
    if (lab[s0] || d[s0 * 4 + 3] <= 60) continue
    const st = [s0], px = []; lab[s0] = 1; let y0 = H, y1 = 0, x0 = W, x1 = 0
    while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0; px.push(p); y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; const q = ny * W + nx; if (!lab[q] && d[q * 4 + 3] > 60) { lab[q] = 1; st.push(q) } } }
    comps.push({ px, y0, y1, x0, x1 })
  }
  const total = comps.reduce((a, c) => a + c.px.length, 0)
  for (const c of comps) {
    if (c.px.length > total * 0.003 || c.y0 < bb.y0 + (bb.y1 - bb.y0) * 0.8) continue
    out.push([c.x0, c.y0, c.px.length])
    for (let y = Math.max(0, c.y0 - 14); y <= Math.min(H - 1, c.y1 + 14); y++) for (let x = Math.max(0, c.x0 - 14); x <= Math.min(W - 1, c.x1 + 14); x++) d[(y * W + x) * 4 + 3] = 0
  }
  return out
}

// The piece cut off at the right edge: everything right of the last empty gap.
function dropRightPiece(d, W, H, rect) {
  const used = (x) => { for (let y = rect.y0; y <= rect.y1; y++) if (d[(y * W + x) * 4 + 3] > 60) return true; return false }
  let x = rect.x1; while (x > rect.x0 && !used(x)) x--
  while (x > rect.x0 && used(x)) x--
  const cut = x
  for (let y = 0; y < H; y++) for (let xx = cut; xx < W; xx++) d[(y * W + xx) * 4 + 3] = 0
  return cut
}
// A straight cut at the left edge, softened so it reads as coming in from the side.
function fadeLeft(d, W, H, bb, frac) {
  const span = (bb.x1 - bb.x0) * frac
  for (let y = 0; y < H; y++) for (let x = bb.x0; x < bb.x0 + span; x++) {
    const t = (x - bb.x0) / span, k = t * t * (3 - 2 * t), i = (y * W + x) * 4
    d[i + 3] = Math.round(d[i + 3] * k)
  }
}

;(async () => {
  for (const [file, slug] of Object.entries(MAP)) {
    if (only && !only.has(slug)) continue
    if (HOLD.has(slug)) { console.log(slug.padEnd(20), 'held back (see HOLD)'); continue }
    if (!fs.existsSync(path.join(SRC, file))) { console.log(slug.padEnd(20), 'no file ' + file); continue }
    const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const W = info.width, H = info.height, d = data
    const rect = bbox(d, W, H, 10)
    const notes = []
    if (HAZE.has(slug)) { unhaze(d, W, H, rect); notes.push('pale box lifted') }
    if (CHECKER.has(slug)) notes.push('grey shadow removed ' + unchecker(d, W, H, bbox(d, W, H)) + 'px')
    if (slug === 'group-queue') { const p = dropPieces(d, W, H, rect, 'haze'); if (p.length) notes.push('cut-off pieces removed ' + JSON.stringify(p)) }
    if (slug === 'meta-hub') notes.push('right-edge piece removed from x=' + dropRightPiece(d, W, H, rect))
    if (slug === 'group-queue') { fadeLeft(d, W, H, bbox(d, W, H, 60), 0.16); notes.push('left edge faded') }
    if (SLIVER.has(slug)) { const p = dropPieces(d, W, H, bbox(d, W, H), 'sliver'); notes.push('slivers removed ' + JSON.stringify(p)) }
    if (slug === 'brand-voice' || slug === 'meta-hub') { const p = dropSpecks(d, W, H); notes.push('stray dots removed ' + JSON.stringify(p)) }
    const bb = bbox(d, W, H, 24)
    const m = Math.round(Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.04)
    const left = Math.max(0, bb.x0 - m), top = Math.max(0, bb.y0 - m)
    const width = Math.min(W, bb.x1 + m + 1) - left, height = Math.min(H, bb.y1 + m + 1) - top
    const buf = await sharp(Buffer.from(d), { raw: { width: W, height: H, channels: 4 } })
      .extract({ left, top, width, height })
      .resize({ width: 760, height: 560, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 90, effort: 6 }).toBuffer()
    fs.writeFileSync(path.join(OUT, slug + '.webp'), buf)
    const meta = await sharp(buf).metadata()
    console.log(slug.padEnd(20), meta.width + 'x' + meta.height, (buf.length / 1024).toFixed(0) + 'KB', notes.join('; '))
  }
})()
