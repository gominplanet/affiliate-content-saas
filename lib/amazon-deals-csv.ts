// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Amazon Creator Connections deals-CSV parser.
//
// Amazon emails creators a CSV of upcoming promotional deals (Lightning,
// Best Deal, Prime exclusive, etc.). Each row is one ASIN + one deal
// window. The exact schema (as of 2026-06):
//
//   asin, asin_name, parent_asin, is_creator_favorite, asin_url,
//   star_rating, deal_start_datetime, deal_end_datetime,
//   category_description, subcategory_description, promo_gl_product_group,
//   deal_id, deal_title, is_prime_only, promotion_type, brand,
//   deal_price_band, deal_price, vrp, lowest_price_ytd, lowest_t30d_price,
//   discount_pct
//
// We parse this into a typed shape the Deals Hub UI can render in a
// sortable table, then per-row the user generates + schedules a deal post
// against the existing /api/deals pipeline.

/** Canonical parsed shape. Every Amazon column is preserved in case the
 *  UI wants to filter / display it; the most useful fields surface as
 *  top-level typed properties. */
export interface AmazonDealRow {
  /** 10-char ASIN — required. Rows without an ASIN are dropped. */
  asin: string
  asinName: string | null
  parentAsin: string | null
  isCreatorFavorite: boolean
  asinUrl: string | null
  starRating: number | null

  /** ISO 8601 — deal scheduled to START. Used as the WP publish date when
   *  the user schedules the post. */
  dealStartDatetime: string | null
  /** ISO 8601 — deal scheduled to END. Used for the countdown banner. */
  dealEndDatetime: string | null

  categoryDescription: string | null
  subcategoryDescription: string | null
  promoGlProductGroup: string | null

  /** Amazon's own deal_id. We keep it so we can warn about duplicates if
   *  the user uploads the same CSV twice. */
  dealId: string | null
  dealTitle: string | null

  isPrimeOnly: boolean
  /** e.g. 'BEST_DEAL', 'LIGHTNING_DEAL', 'PRIME_DAY', 'COUPON'. We map
   *  this to our DealOccasionSlug at write-time. */
  promotionType: string | null
  brand: string | null

  /** Tier label Amazon assigns: under_25, 25_to_50, etc. Just a string. */
  dealPriceBand: string | null
  /** SALE price during the deal window. Number (USD). */
  dealPrice: number | null
  /** Variable Reference Price = the strike-through "was" / MSRP. */
  vrp: number | null
  /** Lowest price this product has hit so far this year. Trigger for
   *  auto-selecting the 'lowest_price_ytd' occasion when dealPrice <=
   *  lowestPriceYtd. */
  lowestPriceYtd: number | null
  /** Lowest price in the trailing 30 days. */
  lowestT30dPrice: number | null
  /** Percent off — number 0-100. Used for sorting + the savings line. */
  discountPct: number | null

  /** Position in the original CSV (1-indexed). Useful for "row 47 failed"
   *  error messages. */
  rowNumber: number
}

export interface ParseResult {
  rows: AmazonDealRow[]
  /** Soft warnings — surface to user but don't block. */
  warnings: string[]
  /** Hard errors — bad CSV shape, missing headers, etc. */
  errors: string[]
  /** Original column header order, for any debug display. */
  headers: string[]
  /** Count of raw rows before filtering (helps user spot row-loss). */
  totalRows: number
}

// ─── CSV tokeniser ────────────────────────────────────────────────────────
//
// Implementation note: Amazon's CSVs use commas + occasional quoted fields
// (e.g. titles containing commas). We hand-roll a minimal RFC 4180 parser
// rather than pull in papaparse to keep the bundle small and edge-runnable.
// The implementation handles:
//   - Quoted fields with embedded commas
//   - Escaped quotes ("" inside a quoted field)
//   - Both CRLF and LF line endings
//   - Trailing newlines

function tokenizeCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        row.push(field)
        field = ''
      } else if (c === '\r') {
        // wait for the \n
      } else if (c === '\n') {
        row.push(field)
        out.push(row)
        row = []
        field = ''
      } else {
        field += c
      }
    }
  }
  // Capture the last field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    out.push(row)
  }
  // Drop trailing fully-empty rows.
  while (out.length > 0 && out[out.length - 1].every((c) => c === '')) {
    out.pop()
  }
  return out
}

// ─── Field coercion helpers ───────────────────────────────────────────────

function toNum(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const cleaned = v.replace(/[$,%\s]/g, '')
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : null
}

function toBool(v: string | undefined): boolean {
  if (v == null) return false
  const s = v.trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y'
}

/** Normalise Amazon's datetime strings to ISO 8601. Their export usually
 *  emits "2026-07-15 14:30:00" (space separator, no timezone) — we treat
 *  those as UTC since that's what Creator Connections appears to use. If
 *  the string already parses cleanly, we trust it. */
function toIsoDatetime(v: string | undefined): string | null {
  if (v == null || v === '') return null
  const raw = v.trim()
  // Try direct Date.parse first (handles ISO 8601 + many other shapes).
  const direct = Date.parse(raw)
  if (!isNaN(direct)) return new Date(direct).toISOString()
  // Try the "YYYY-MM-DD HH:MM:SS" pattern Amazon often uses.
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2}(?::\d{2})?)/)
  if (m) {
    const isoish = `${m[1]}T${m[2]}${m[2].length === 5 ? ':00' : ''}Z`
    const parsed = Date.parse(isoish)
    if (!isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

function toStr(v: string | undefined): string | null {
  if (v == null) return null
  const s = v.trim()
  return s === '' ? null : s
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Required canonical headers. Order matches the known schema from Creator
 *  Connections as of 2026-06. Tolerant of case + whitespace + a few common
 *  variants in case Amazon tweaks the export. */
const HEADER_ALIASES: Record<string, string[]> = {
  asin: ['asin', 'product_asin', 'product_id'],
  asin_name: ['asin_name', 'product_title', 'product_name', 'title'],
  parent_asin: ['parent_asin'],
  is_creator_favorite: ['is_creator_favorite', 'creator_favorite'],
  asin_url: ['asin_url', 'product_url', 'url'],
  star_rating: ['star_rating', 'rating'],
  deal_start_datetime: ['deal_start_datetime', 'deal_start', 'start_datetime', 'start_date', 'start_time'],
  deal_end_datetime: ['deal_end_datetime', 'deal_end', 'end_datetime', 'end_date', 'end_time'],
  category_description: ['category_description', 'category'],
  subcategory_description: ['subcategory_description', 'subcategory'],
  promo_gl_product_group: ['promo_gl_product_group', 'product_group'],
  deal_id: ['deal_id', 'promotion_id'],
  deal_title: ['deal_title', 'promotion_title', 'promotion_name'],
  is_prime_only: ['is_prime_only', 'prime_only', 'prime_exclusive'],
  promotion_type: ['promotion_type', 'deal_type', 'promo_type'],
  brand: ['brand', 'brand_name', 'manufacturer'],
  deal_price_band: ['deal_price_band', 'price_band'],
  deal_price: ['deal_price', 'sale_price', 'promo_price'],
  vrp: ['vrp', 'list_price', 'msrp', 'reference_price'],
  lowest_price_ytd: ['lowest_price_ytd', 'lowest_ytd'],
  lowest_t30d_price: ['lowest_t30d_price', 'lowest_30d', 'lowest_30_day_price'],
  discount_pct: ['discount_pct', 'discount_percent', 'percent_off', 'savings_pct'],
}

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

/** Build a header → column-index map from a CSV's header row. Tolerant of
 *  ordering + whitespace + a handful of aliases per canonical key. */
function buildHeaderMap(headers: string[]): { map: Record<string, number>; missing: string[]; warnings: string[] } {
  const normalised = headers.map(normaliseHeader)
  const map: Record<string, number> = {}
  const missing: string[] = []
  const warnings: string[] = []
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    let foundAt = -1
    for (const alias of aliases) {
      const idx = normalised.indexOf(alias)
      if (idx !== -1) { foundAt = idx; break }
    }
    if (foundAt !== -1) {
      map[canonical] = foundAt
    } else if (canonical === 'asin') {
      missing.push(canonical)
    } else {
      warnings.push(`Column "${canonical}" not found — row data for this field will be empty.`)
    }
  }
  return { map, missing, warnings }
}

/** Parse a CSV file (string) into AmazonDealRow rows. */
export function parseDealsCsv(csvText: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const out: ParseResult = { rows: [], warnings, errors, headers: [], totalRows: 0 }

  if (!csvText || !csvText.trim()) {
    errors.push('CSV file is empty.')
    return out
  }

  const tokens = tokenizeCsv(csvText)
  if (tokens.length < 2) {
    errors.push('CSV needs at least a header row + one data row.')
    return out
  }

  const headers = tokens[0].map((h) => h.trim())
  out.headers = headers
  const dataRows = tokens.slice(1)
  out.totalRows = dataRows.length

  const { map, missing, warnings: headerWarnings } = buildHeaderMap(headers)
  warnings.push(...headerWarnings)
  if (missing.length > 0) {
    errors.push(`Required column missing: ${missing.join(', ')}. Make sure your CSV has an "asin" column.`)
    return out
  }

  // Map every row through the header → field translator. Filter out rows
  // with no ASIN (Amazon sometimes leaves blank summary rows at the end).
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]
    const get = (key: string): string | undefined => {
      const idx = map[key]
      return idx != null ? cells[idx] : undefined
    }
    const asinRaw = toStr(get('asin'))
    if (!asinRaw) continue
    const asin = asinRaw.toUpperCase()
    // Loose ASIN check — Amazon CSVs sometimes ship 13-char codes for
    // edge cases (Kindle, B2B). Don't reject; just warn.
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      warnings.push(`Row ${i + 2}: ASIN "${asin}" doesn't look standard — generation may fail.`)
    }

    out.rows.push({
      asin,
      asinName: toStr(get('asin_name')),
      parentAsin: toStr(get('parent_asin')),
      isCreatorFavorite: toBool(get('is_creator_favorite')),
      asinUrl: toStr(get('asin_url')),
      starRating: toNum(get('star_rating')),
      dealStartDatetime: toIsoDatetime(get('deal_start_datetime')),
      dealEndDatetime: toIsoDatetime(get('deal_end_datetime')),
      categoryDescription: toStr(get('category_description')),
      subcategoryDescription: toStr(get('subcategory_description')),
      promoGlProductGroup: toStr(get('promo_gl_product_group')),
      dealId: toStr(get('deal_id')),
      dealTitle: toStr(get('deal_title')),
      isPrimeOnly: toBool(get('is_prime_only')),
      promotionType: toStr(get('promotion_type')),
      brand: toStr(get('brand')),
      dealPriceBand: toStr(get('deal_price_band')),
      dealPrice: toNum(get('deal_price')),
      vrp: toNum(get('vrp')),
      lowestPriceYtd: toNum(get('lowest_price_ytd')),
      lowestT30dPrice: toNum(get('lowest_t30d_price')),
      discountPct: toNum(get('discount_pct')),
      rowNumber: i + 2, // 1-indexed + skip the header row
    })
  }

  return out
}

// ─── Promotion-type → DealOccasionSlug mapper ────────────────────────────
//
// Amazon's `promotion_type` is an enum-ish string. We map it to our own
// DealOccasionSlug (from lib/deal-occasion.ts) so the generated deal post
// uses the right badge colour + hype phrase.

export type DealOccasionGuess =
  | 'lightning_deal'
  | 'prime_day'
  | 'prime_big_deal_days'
  | 'black_friday'
  | 'cyber_monday'
  | 'holiday'
  | 'lowest_price_ytd'
  | 'none'

export function mapPromotionType(
  promotionType: string | null,
  opts?: { dealPrice?: number | null; lowestPriceYtd?: number | null; dealStartDatetime?: string | null },
): DealOccasionGuess {
  const t = (promotionType ?? '').toUpperCase()
  if (t.includes('LIGHTNING')) return 'lightning_deal'
  if (t.includes('PRIME_DAY') || t.includes('PRIME DAY')) return 'prime_day'
  if (t.includes('PRIME_BIG_DEAL') || t.includes('BIG_DEAL_DAYS')) return 'prime_big_deal_days'
  if (t.includes('BLACK_FRIDAY') || t.includes('BLACK FRIDAY')) return 'black_friday'
  if (t.includes('CYBER_MONDAY') || t.includes('CYBER MONDAY')) return 'cyber_monday'
  if (t.includes('HOLIDAY')) return 'holiday'

  // Best-deal-on-record detection: if Amazon flags the deal price as <=
  // the YTD low, that's the "Lowest of the year" occasion. Cleaner signal
  // than the user manually picking it from a dropdown.
  if (
    opts?.dealPrice != null &&
    opts?.lowestPriceYtd != null &&
    opts.dealPrice <= opts.lowestPriceYtd + 0.01 /* float-safe equals */
  ) {
    return 'lowest_price_ytd'
  }

  return 'none'
}
