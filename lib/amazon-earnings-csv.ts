// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Parse an Amazon Associates / Influencer earnings report CSV (the file behind
// the "Download Reports" button) into per-ASIN earnings rows MVP can store.
//
// Amazon's export headers drift by report type and over time, so header
// matching is FUZZY (lowercased, alnum-only, alias lists) — the same approach
// SCOUT uses for the CC-catalog CSVs. We surface every header we could NOT map
// so a format change is a visible diagnostic, not a silent wrong number.
//
// Two report shapes land here:
//   • Commissions / earnings  — per-product: ASIN, items shipped, revenue,
//     total earnings (or a commission rate we multiply by revenue).
//   • Creator Connections     — per-campaign; rows still carry the promoted
//     ASIN(s), so we map earnings onto the ASIN. Campaign-only rows with no
//     ASIN are counted as skipped (reported back, not silently dropped).

export interface ParsedEarning {
  asin: string
  title: string | null
  units: number | null
  revenue: number | null      // dollars
  earnings: number | null     // dollars
  clicks: number | null
}

export interface EarningsParseResult {
  rows: ParsedEarning[]
  matched: Record<string, string>       // field → the header we mapped it to
  unmatchedHeaders: string[]            // headers we ignored (for tuning)
  totalRows: number                     // data rows in the file
  skippedNoAsin: number                 // rows with earnings but no ASIN (e.g. CC campaign-level)
  totalEarnings: number                 // sum of mapped earnings (dollars)
}

// ── CSV (RFC-4180-ish): quoted fields, embedded commas/newlines, "" escapes ──
export function parseCsv(text: string): { headers: string[]; objects: Record<string, string>[] } {
  const rows: string[][] = []
  let field = '', row: string[] = [], inQ = false
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* \r\n handled by \n */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return { headers: [], objects: [] }
  const headers = rows[0].map(h => (h || '').trim())
  const objects: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue // blank line
    const o: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) o[headers[c]] = rows[r][c] ?? ''
    objects.push(o)
  }
  return { headers, objects }
}

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// field → alias list (normalized). Order of fields = mapping priority.
const ALIASES: Record<string, string[]> = {
  asin: ['asin', 'productasin', 'promotedasin'],
  title: ['name', 'productname', 'product', 'title', 'itemname', 'producttitle'],
  units: ['itemsshipped', 'unitsshipped', 'qtyshipped', 'shippeditems', 'unitsordered', 'itemsordered', 'quantity', 'qty', 'units'],
  revenue: ['totalrevenue', 'shippedrevenue', 'productrevenue', 'orderedrevenue', 'revenue', 'sales', 'shippeditemsrevenue'],
  earnings: ['totalearnings', 'earnings', 'adfees', 'commissionincome', 'commissionearnings', 'feeearnings', 'fees', 'commissionamount', 'bonusearnings', 'income'],
  commissionPct: ['commissionrate', 'commissionpercentage', 'rate', 'commissionpct'],
  clicks: ['clicks', 'totalclicks'],
}

function buildHeaderMap(headers: string[]): { map: Record<string, string>; unmatched: string[] } {
  const normd = headers.map(h => ({ h, n: norm(h) }))
  const map: Record<string, string> = {}
  const used = new Set<string>()
  for (const field of Object.keys(ALIASES)) {
    const aliases = ALIASES[field]
    // exact normalized match first, then "contains" (so "Total Earnings ($)" hits).
    let hit = normd.find(x => !used.has(x.h) && aliases.includes(x.n))
    if (!hit) hit = normd.find(x => !used.has(x.h) && aliases.some(a => x.n.includes(a)))
    if (hit) { map[field] = hit.h; used.add(hit.h) }
  }
  const unmatched = normd.filter(x => !used.has(x.h)).map(x => x.h).filter(Boolean)
  return { map, unmatched }
}

const ASIN_RE = /\b([A-Z0-9]{10})\b/
const toMoney = (v: string | undefined): number | null => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isFinite(n) ? n : null
}
const toInt = (v: string | undefined): number | null => {
  if (v == null) return null
  const n = parseInt(String(v).replace(/[^0-9\-]/g, ''), 10)
  return isFinite(n) ? n : null
}
const toPct = (v: string | undefined): number | null => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isFinite(n) ? n : null
}

/** Parse a report CSV into per-ASIN earnings rows + a mapping diagnostic. */
export function parseEarningsCsv(text: string): EarningsParseResult {
  const { headers, objects } = parseCsv(text)
  const { map, unmatched } = buildHeaderMap(headers)
  const get = (o: Record<string, string>, field: string) => (map[field] ? o[map[field]] : undefined)

  const rows: ParsedEarning[] = []
  let skippedNoAsin = 0
  let totalEarnings = 0

  for (const o of objects) {
    // ASIN can sit in its own column or be embedded in a product cell.
    let asin = ''
    const asinCell = get(o, 'asin')
    if (asinCell) { const m = String(asinCell).toUpperCase().match(ASIN_RE); if (m) asin = m[1] }
    if (!asin) {
      const titleCell = get(o, 'title')
      if (titleCell) { const m = String(titleCell).toUpperCase().match(ASIN_RE); if (m) asin = m[1] }
    }

    const revenue = toMoney(get(o, 'revenue'))
    let earnings = toMoney(get(o, 'earnings'))
    // No explicit earnings column but a commission rate + revenue → derive it.
    if (earnings == null) {
      const pct = toPct(get(o, 'commissionPct'))
      if (pct != null && revenue != null) earnings = Math.round(revenue * (pct / 100) * 100) / 100
    }
    const units = toInt(get(o, 'units'))
    const clicks = toInt(get(o, 'clicks'))

    const hasMetric = earnings != null || revenue != null || units != null
    if (!hasMetric) continue

    if (!ASIN_RE.test(asin)) { skippedNoAsin++; continue }

    const titleRaw = get(o, 'title')
    rows.push({
      asin,
      title: titleRaw ? String(titleRaw).replace(new RegExp(asin, 'i'), '').trim().slice(0, 300) || null : null,
      units,
      revenue,
      earnings,
      clicks,
    })
    if (earnings != null) totalEarnings += earnings
  }

  // Merge duplicate ASIN rows within the same file (Amazon can split a product
  // across marketplaces / device groups) so each ASIN lands once.
  const byAsin = new Map<string, ParsedEarning>()
  for (const r of rows) {
    const cur = byAsin.get(r.asin)
    if (!cur) { byAsin.set(r.asin, { ...r }); continue }
    cur.units = (cur.units ?? 0) + (r.units ?? 0)
    cur.revenue = (cur.revenue ?? 0) + (r.revenue ?? 0)
    cur.earnings = (cur.earnings ?? 0) + (r.earnings ?? 0)
    cur.clicks = (cur.clicks ?? 0) + (r.clicks ?? 0)
    if (!cur.title && r.title) cur.title = r.title
  }

  return {
    rows: [...byAsin.values()],
    matched: map,
    unmatchedHeaders: unmatched,
    totalRows: objects.length,
    skippedNoAsin,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
  }
}
