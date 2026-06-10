// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Associates EARNINGS-report CSV parser (revenue loop, epic #249).
//
// Distinct from lib/amazon-deals-csv.ts (the Creator Connections *deals* feed).
// This parses the Associates "Earnings"/"Fee-Orders" report a creator exports
// from affiliate-program.amazon.com → Reports. Amazon has tweaked these columns
// over the years and localises the headers, so we detect columns by tolerant
// header-aliasing rather than fixed positions. The columns we care about:
//
//   ASIN            — the product (key we aggregate + later match to posts)
//   Name / Product  — product title (display)
//   Ad Fees / Earnings / Commission — the COMMISSION (what the creator earned)
//   Items Shipped / Qty             — units (volume signal)
//   Revenue / Price                 — gross sales (optional, display)
//
// Output is aggregated PER ASIN (a report has one row per order/shipment, so
// the same ASIN appears many times — we sum). Tolerant + non-throwing: bad rows
// are skipped with warnings, never an exception.

export interface AmazonEarningRow {
  asin: string
  title: string | null
  /** Commission earned, USD (summed across the report's rows for this ASIN). */
  earnings: number
  /** Units shipped (summed). */
  items: number
  /** Gross sales revenue, USD (summed) — optional, for display only. */
  revenue: number
}

export interface EarningsParseResult {
  products: AmazonEarningRow[]
  totalEarnings: number
  totalItems: number
  totalRevenue: number
  warnings: string[]
  errors: string[]
  headers: string[]
  /** Raw data rows seen (pre-aggregation) — helps the user spot row-loss. */
  totalRows: number
}

// ─── Minimal RFC-4180 tokenizer (mirrors lib/amazon-deals-csv) ──────────────
function tokenizeCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else { field += c }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* wait for \n */ }
      else if (c === '\n') { row.push(field); out.push(row); row = []; field = '' }
      else field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); out.push(row) }
  while (out.length > 0 && out[out.length - 1].every(c => c === '')) out.pop()
  return out
}

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

/** Money/number coercion — strips $, commas, %, currency words, whitespace. */
function toNum(v: string | undefined): number {
  if (v == null || v === '') return 0
  const cleaned = v.replace(/[$,%\s]/g, '').replace(/[a-z]/gi, '')
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : 0
}

function toStr(v: string | undefined): string | null {
  if (v == null) return null
  const s = v.trim()
  return s === '' ? null : s
}

// Column aliases. Amazon's earnings report headers vary by locale + report
// flavour; cover the common ones. `earnings` is the only REQUIRED metric.
const HEADER_ALIASES: Record<string, string[]> = {
  asin: ['asin', 'product_asin', 'product_id'],
  title: ['name', 'product_name', 'title', 'product_title', 'product'],
  earnings: ['ad_fees', 'ad_fees_', 'earnings', 'fees', 'commission', 'commission_income', 'referral_fees', 'ad_fees_usd', 'fee_amount'],
  items: ['items_shipped', 'qty', 'quantity', 'units_shipped', 'items', 'shipped_items'],
  revenue: ['revenue', 'price', 'product_sales', 'ordered_revenue', 'sales'],
}

function findCol(normalised: string[], aliases: string[]): number {
  for (const a of aliases) {
    const idx = normalised.indexOf(a)
    if (idx !== -1) return idx
  }
  // Soft fallback: a header that *contains* the alias (e.g. "ad_fees_usd").
  for (const a of aliases) {
    const idx = normalised.findIndex(h => h.includes(a))
    if (idx !== -1) return idx
  }
  return -1
}

/** Parse an Amazon Associates earnings CSV → per-ASIN aggregated commissions. */
export function parseEarningsCsv(csvText: string): EarningsParseResult {
  const result: EarningsParseResult = {
    products: [], totalEarnings: 0, totalItems: 0, totalRevenue: 0,
    warnings: [], errors: [], headers: [], totalRows: 0,
  }
  if (!csvText || !csvText.trim()) {
    result.errors.push('CSV file is empty.')
    return result
  }

  // Amazon prepends a couple of metadata/summary lines before the real header
  // on some report flavours. Find the row that actually contains an ASIN header.
  const tokens = tokenizeCsv(csvText)
  let headerIdx = tokens.findIndex(r => r.map(normaliseHeader).some(h => h === 'asin' || h.includes('asin')))
  if (headerIdx === -1) headerIdx = 0
  const headerRow = tokens[headerIdx] ?? []
  const dataRows = tokens.slice(headerIdx + 1)
  result.headers = headerRow.map(h => h.trim())
  result.totalRows = dataRows.length

  if (dataRows.length === 0) {
    result.errors.push('No data rows found below the header.')
    return result
  }

  const normalised = headerRow.map(normaliseHeader)
  const cAsin = findCol(normalised, HEADER_ALIASES.asin)
  const cTitle = findCol(normalised, HEADER_ALIASES.title)
  const cEarn = findCol(normalised, HEADER_ALIASES.earnings)
  const cItems = findCol(normalised, HEADER_ALIASES.items)
  const cRev = findCol(normalised, HEADER_ALIASES.revenue)

  if (cAsin === -1) {
    result.errors.push('Could not find an "ASIN" column. Use the Associates → Reports → Earnings export.')
    return result
  }
  if (cEarn === -1) {
    result.errors.push('Could not find an earnings column (e.g. "Ad Fees", "Earnings", or "Commission").')
    return result
  }

  // Aggregate per ASIN.
  const byAsin = new Map<string, AmazonEarningRow>()
  for (const cells of dataRows) {
    const asin = toStr(cells[cAsin])?.toUpperCase()
    if (!asin) continue
    const earnings = toNum(cells[cEarn])
    const items = cItems !== -1 ? toNum(cells[cItems]) : 0
    const revenue = cRev !== -1 ? toNum(cells[cRev]) : 0
    const title = cTitle !== -1 ? toStr(cells[cTitle]) : null
    const existing = byAsin.get(asin)
    if (existing) {
      existing.earnings += earnings
      existing.items += items
      existing.revenue += revenue
      if (!existing.title && title) existing.title = title
    } else {
      byAsin.set(asin, { asin, title, earnings, items, revenue })
    }
  }

  const products = Array.from(byAsin.values()).sort((a, b) => b.earnings - a.earnings)
  result.products = products
  result.totalEarnings = Math.round(products.reduce((s, p) => s + p.earnings, 0) * 100) / 100
  result.totalItems = products.reduce((s, p) => s + p.items, 0)
  result.totalRevenue = Math.round(products.reduce((s, p) => s + p.revenue, 0) * 100) / 100

  if (products.length === 0) result.warnings.push('No rows with an ASIN + earnings were found.')
  return result
}
