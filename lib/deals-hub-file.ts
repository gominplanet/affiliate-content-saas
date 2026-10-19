// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DEALS HUB FILE, READ IN THE MEMBER'S OWN BROWSER (Seb, 2026-10-19:
// "building an importer would be really, really valuable ... are we able to
// allocate enough resource for members to import 500 megabytes worth of a
// CSV?").
//
// Each member downloads the deals list from the Deals Hub in their OWN Amazon
// Associates account and opens it here. The file is never uploaded: the
// browser reads it a piece at a time (CsvStream), keeps only the best deals in
// each category (DealPool), and only the deals the member picks reach MVP, one
// deal post at a time. So a 500 MB file costs the server nothing, and nothing
// of one member's list is ever shown to another. The June importer sent every
// row to the database and drained its disk budget; this one cannot.
//
// Amazon's column names were not seen for this export, so each field is found
// by the names it is likely to have (mapColumns), and a file MVP cannot read
// says which columns it has instead of importing nothing as if it were empty.
//
// Pure: no DOM, no network. scripts/test-deals-hub-file.ts holds it.

import { asinFromAmazonUrl } from '@/lib/asin'

export type HubField =
  | 'asin' | 'title' | 'url' | 'image' | 'category' | 'subcategory' | 'brand'
  | 'dealPrice' | 'listPrice' | 'discountPct' | 'commissionPct' | 'startsAt' | 'endsAt'
  | 'lowestYtd' | 'dealType' | 'rating' | 'reviews' | 'primeOnly' | 'status'

/** Header names each field may go by, compared with case, spaces and
 *  punctuation taken out. In priority order: the first that matches wins. The
 *  Creator Connections deals file (June) used the snake_case ones. */
const ALIASES: Record<HubField, string[]> = {
  asin: ['asin', 'productasin', 'childasin', 'asinid'],
  title: ['asinname', 'productname', 'producttitle', 'itemname', 'title', 'dealtitle', 'name', 'product', 'dealinformation'],
  url: ['asinurl', 'producturl', 'detailpageurl', 'productlink', 'dealurl', 'url', 'link'],
  image: ['imageurl', 'mainimageurl', 'productimage', 'imagelink', 'image'],
  category: ['categorydescription', 'category', 'productcategory', 'productgroup', 'promoglproductgroup'],
  subcategory: ['subcategorydescription', 'subcategory', 'subcat'],
  brand: ['brand', 'brandname'],
  dealPrice: ['dealprice', 'saleprice', 'promotionprice', 'promoprice', 'dealpriceusd', 'price'],
  listPrice: ['vrp', 'listprice', 'wasprice', 'referenceprice', 'originalprice', 'strikethroughprice', 'msrp'],
  discountPct: ['discountpct', 'discountpercent', 'discountpercentage', 'percentoff', 'savingspercent', 'pctoff', 'discount'],
  commissionPct: ['commissionrate', 'commissionpct', 'commissionpercent', 'commission', 'earnrate', 'earningsrate', 'feerate', 'earn'],
  startsAt: ['dealstartdatetime', 'dealstarttime', 'dealstartdate', 'starttime', 'startdatetime', 'startdate', 'promotionstartdate', 'dealstart', 'start', 'starts'],
  endsAt: ['dealenddatetime', 'dealendtime', 'dealenddate', 'endtime', 'enddatetime', 'enddate', 'promotionenddate', 'dealend', 'end', 'ends'],
  lowestYtd: ['lowestpriceytd', 'lowestytdprice', 'ytdlowestprice', 'lowestprice'],
  dealType: ['promotiontype', 'dealtype', 'dealbadge', 'badge', 'type'],
  rating: ['starrating', 'averagerating', 'customerrating', 'rating', 'stars'],
  reviews: ['reviewcount', 'numberofreviews', 'totalreviews', 'ratingscount', 'ratingcount', 'numreviews', 'reviews'],
  primeOnly: ['isprimeonly', 'primeonly', 'primeexclusive'],
  status: ['dealstatus', 'status'],
}

/** Without these a row cannot become a deal post at the right time. */
export const REQUIRED: HubField[] = ['asin', 'startsAt']

export const FIELD_WORDS: Record<HubField, string> = {
  asin: 'ASIN', title: 'product name', url: 'product link', image: 'image', category: 'category',
  subcategory: 'subcategory', brand: 'brand', dealPrice: 'deal price', listPrice: 'list price',
  discountPct: 'discount', commissionPct: 'commission rate', startsAt: 'start time', endsAt: 'end time',
  lowestYtd: 'lowest price this year', dealType: 'deal type', rating: 'rating', reviews: 'reviews',
  primeOnly: 'Prime only', status: 'status',
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface ColumnMap {
  at: Partial<Record<HubField, number>>
  missing: HubField[]
  /** A time zone named in a time column's header, like "Start Time (PST)". */
  tzHint: string | null
}

/** Which column holds each field. An exact name first, then a header that
 *  contains a long alias ("Deal Start Time (PST)"). One column, one field. */
export function mapColumns(headers: string[]): ColumnMap {
  const names = headers.map(norm)
  const used = new Set<number>()
  const at: Partial<Record<HubField, number>> = {}
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of Object.keys(ALIASES) as HubField[]) {
      if (at[f] !== undefined) continue
      for (const a of ALIASES[f]) {
        if (pass === 'contains' && a.length < 7) continue
        const i = names.findIndex((n, k) => !used.has(k) && (pass === 'exact' ? n === a : n.includes(a)))
        if (i >= 0) { at[f] = i; used.add(i); break }
      }
    }
  }
  // An ASIN can come from the product link when there is no ASIN column.
  const missing = REQUIRED.filter((f) => at[f] === undefined && !(f === 'asin' && at.url !== undefined))
  const timeHeaders = [at.startsAt, at.endsAt].filter((i): i is number => i !== undefined).map((i) => headers[i])
  const tz = timeHeaders.join(' ').match(/\b(UTC|GMT|PST|PDT|PT|MST|MDT|CST|CDT|EST|EDT|AST|ADT|HST|AKST|AKDT)\b/i)
  return { at, missing, tzHint: tz ? tz[1].toUpperCase() : null }
}

// ── CSV, a piece at a time ──────────────────────────────────────────────────

const QUOTE = 34, NL = 10, CR = 13

/** A CSV reader fed in pieces. Each push returns the rows it completed; a
 *  row cut off at the end of a piece waits for the next. Quoted fields may
 *  hold commas, newlines and doubled quotes. A quote that never closes stops
 *  it with an error rather than holding the whole file in one field. */
export class CsvStream {
  private carry = ''
  private delim: number | null
  private first = true
  constructor(delimiter?: string) { this.delim = delimiter ? delimiter.charCodeAt(0) : null }

  push(chunk: string): string[][] {
    let text = this.carry + chunk
    if (this.first) {
      this.first = false
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      if (this.delim === null) {
        const line = text.slice(0, Math.max(0, text.indexOf('\n')) || 2000)
        const tabs = line.split('\t').length, commas = line.split(',').length, semis = line.split(';').length
        this.delim = tabs > commas && tabs > semis ? 9 : semis > commas ? 59 : 44
      }
    }
    const { rows, rest } = parseRows(text, this.delim as number)
    if (rest.length > 5_000_000) throw new Error('A quote in the file never closes, so MVP cannot tell where one deal ends.')
    this.carry = rest
    return rows
  }

  end(): string[][] {
    if (!this.carry) return []
    const { rows, rest } = parseRows(this.carry + '\n', this.delim ?? 44)
    this.carry = ''
    if (rest.trim()) throw new Error('The file ends inside a quoted field, so its last deal is cut off.')
    return rows
  }
}

function parseRows(text: string, d: number): { rows: string[][]; rest: string } {
  const rows: string[][] = []
  const n = text.length
  let i = 0, rowStart = 0
  let row: string[] = []
  while (i < n) {
    let field: string
    if (text.charCodeAt(i) === QUOTE) {
      let j = i + 1, seg = j, out = ''
      for (;;) {
        const q = text.indexOf('"', j)
        if (q === -1 || q + 1 >= n) return { rows, rest: text.slice(rowStart) }
        if (text.charCodeAt(q + 1) === QUOTE) { out += text.slice(seg, q + 1); j = q + 2; seg = j; continue }
        out += text.slice(seg, q); i = q + 1; break
      }
      // Anything between the closing quote and the next comma is dropped.
      while (i < n && text.charCodeAt(i) !== d && text.charCodeAt(i) !== NL) i++
      if (i >= n) return { rows, rest: text.slice(rowStart) }
      field = out
    } else {
      let k = i
      while (k < n) { const c = text.charCodeAt(k); if (c === d || c === NL) break; k++ }
      if (k >= n) return { rows, rest: text.slice(rowStart) }
      field = text.slice(i, k)
      if (field.charCodeAt(field.length - 1) === CR) field = field.slice(0, -1)
      i = k
    }
    row.push(field)
    if (text.charCodeAt(i) === d) { i++; if (i >= n) return { rows, rest: text.slice(rowStart) }; continue }
    i++ // the newline
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    rowStart = i
  }
  return { rows, rest: text.slice(rowStart) }
}

// ── one row, one deal ──────────────────────────────────────────────────────

export interface HubDeal {
  asin: string
  title: string
  url: string | null
  image: string | null
  category: string
  subcategory: string | null
  brand: string | null
  dealPrice: number | null
  listPrice: number | null
  discountPct: number | null
  commissionPct: number | null
  /** Epoch ms, or null when the file's time could not be read. */
  startsAt: number | null
  endsAt: number | null
  lowestYtd: number | null
  dealType: string | null
  rating: number | null
  reviews: number | null
  primeOnly: boolean
  /** The deal price is at or under the lowest price this year. */
  belowYtd: boolean
}

export function toNum(v: string | undefined): number | null {
  if (v == null) return null
  const s = v.replace(/[$,\s]/g, '').replace(/^USD/i, '')
  if (!s) return null
  const n = parseFloat(s.replace(/%$/, ''))
  return Number.isFinite(n) ? n : null
}

/** A percentage, whether written 15, 15%, or 0.15. */
export function toPct(v: string | undefined): number | null {
  const n = toNum(v)
  if (n == null) return null
  const p = !/%/.test(v || '') && n > 0 && n < 1 ? n * 100 : n
  return p >= 0 && p <= 100 ? Math.round(p * 100) / 100 : null
}

const TZ_OFFSET: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0, PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4,
  AST: -4, ADT: -3, HST: -10, AKST: -9, AKDT: -8,
}

/** US Pacific's offset on a given UTC day: daylight time from the second
 *  Sunday of March to the first Sunday of November. */
function pacificOffset(y: number, m: number, d: number): number {
  const nthSunday = (month: number, nth: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay()
    return 1 + ((7 - first) % 7) + (nth - 1) * 7
  }
  const start = Date.UTC(y, 2, nthSunday(2, 2)), end = Date.UTC(y, 10, nthSunday(10, 1))
  const t = Date.UTC(y, m, d)
  return t >= start && t < end ? -7 : -8
}

/** A deal time as epoch ms. Takes ISO times, "2026-11-20 04:00:00",
 *  "11/20/2026 4:00 AM AST" and the like. A time with no zone is read in
 *  `tzHint`, else in US Pacific time, which is how Amazon dates its deals. */
export function parseDealTime(raw: string | undefined, tzHint: string | null = null): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) { const t = Date.parse(s); return Number.isFinite(t) ? t : null }
  if (/^\d{12,13}$/.test(s)) return Number(s)
  let y: number, mo: number, d: number, rest: string
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T]?(.*)$/)
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; rest = m[4] }
  else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ ,]*(.*)$/)
    if (!m) return null
    mo = +m[1]; d = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; rest = m[4]
  }
  let hh = 0, mm = 0, ss = 0
  const tm = rest.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?\s*(.*)$/i)
  let zone = rest.trim()
  if (tm) {
    hh = +tm[1]; mm = +tm[2]; ss = tm[3] ? +tm[3] : 0
    const ap = (tm[4] || '').toUpperCase()
    if (ap === 'PM' && hh < 12) hh += 12
    if (ap === 'AM' && hh === 12) hh = 0
    zone = tm[5].trim()
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null
  const z = (zone || tzHint || '').toUpperCase().replace(/[()]/g, '')
  let offset: number
  const off = z.match(/^(?:UTC|GMT)?\s*([+-])(\d{1,2}):?(\d{2})?$/)
  if (off) offset = (off[1] === '-' ? -1 : 1) * (+off[2] + (off[3] ? +off[3] / 60 : 0))
  else if (z in TZ_OFFSET) offset = TZ_OFFSET[z]
  else if (!z || z === 'PT' || z === 'PACIFIC') offset = pacificOffset(y, mo - 1, d)
  else return null
  return Date.UTC(y, mo - 1, d, hh, mm, ss) - offset * 3_600_000
}

const ASIN_RE = /^[A-Z0-9]{10}$/
/** The ASIN from its own column, else from the product link (lib/asin, the
 *  one place Amazon's product paths are spelled). */
export function asinFrom(asinCell: string | undefined, url: string | undefined): string | null {
  const a = String(asinCell ?? '').trim().toUpperCase()
  if (ASIN_RE.test(a)) return a
  const fromUrl = url ? asinFromAmazonUrl(url) : null
  return fromUrl ? fromUrl.toUpperCase() : null
}

/** One row as a deal, or why not. */
export function readDeal(cells: string[], map: ColumnMap): { deal: HubDeal } | { skip: 'no-asin' | 'no-start' } {
  const get = (f: HubField) => { const i = map.at[f]; return i === undefined ? undefined : (cells[i] ?? '').trim() }
  const asin = asinFrom(get('asin'), get('url'))
  if (!asin) return { skip: 'no-asin' }
  const startsAt = parseDealTime(get('startsAt'), map.tzHint)
  if (startsAt == null) return { skip: 'no-start' }
  const dealPrice = toNum(get('dealPrice')), listPrice = toNum(get('listPrice')), lowestYtd = toNum(get('lowestYtd'))
  let discountPct = toPct(get('discountPct'))
  if (discountPct == null && dealPrice && listPrice && listPrice > dealPrice) discountPct = Math.round((1 - dealPrice / listPrice) * 100)
  const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test(String(v ?? '').trim())
  return {
    deal: {
      asin,
      title: get('title') || asin,
      url: get('url') || null,
      image: get('image') || null,
      category: get('category') || 'Other',
      subcategory: get('subcategory') || null,
      brand: get('brand') || null,
      dealPrice, listPrice, discountPct,
      commissionPct: toPct(get('commissionPct')),
      startsAt,
      endsAt: parseDealTime(get('endsAt'), map.tzHint),
      lowestYtd,
      dealType: get('dealType') || null,
      rating: toNum(get('rating')),
      reviews: toNum(get('reviews')),
      primeOnly: yes(get('primeOnly')),
      belowYtd: dealPrice != null && lowestYtd != null && dealPrice <= lowestYtd,
    },
  }
}

/** How good a deal is to write about: the discount, a price under the year's
 *  lowest, how proven the product is, and what it earns. */
export function dealScore(d: HubDeal): number {
  return (d.discountPct ?? 0)
    + (d.belowYtd ? 15 : 0)
    + Math.min(d.reviews ?? 0, 20_000) / 1_000
    + (d.rating != null ? (d.rating - 4) * 10 : 0)
    + (d.commissionPct ?? 0) * 2
}

/** The best deals in each category, kept small whatever the file's size:
 *  each category holds its top `perCategory` by dealScore. */
export class DealPool {
  private by = new Map<string, HubDeal[]>()
  readonly counts = new Map<string, number>()
  constructor(readonly perCategory = 250) {}
  add(d: HubDeal) {
    this.counts.set(d.category, (this.counts.get(d.category) ?? 0) + 1)
    let list = this.by.get(d.category)
    if (!list) { list = []; this.by.set(d.category, list) }
    list.push(d)
    if (list.length > this.perCategory * 2) this.trim(list)
  }
  private trim(list: HubDeal[]) {
    list.sort((a, b) => dealScore(b) - dealScore(a))
    // The same ASIN twice in a category keeps its best deal only.
    const seen = new Set<string>()
    const keep = list.filter((x) => (seen.has(x.asin) ? false : (seen.add(x.asin), true))).slice(0, this.perCategory)
    list.length = 0
    list.push(...keep)
  }
  deals(): HubDeal[] {
    const out: HubDeal[] = []
    for (const list of this.by.values()) { this.trim(list); out.push(...list) }
    return out
  }
}

export interface HubFilter {
  category?: string | null
  minDiscount?: number
  minCommission?: number
  belowYtdOnly?: boolean
  when?: 'any' | 'live' | 'upcoming'
  search?: string
}

export type HubSort = 'best' | 'discount' | 'commission' | 'reviews' | 'soonest'

/** The deals shown for these filters, ended deals left out. */
export function filterDeals(deals: HubDeal[], f: HubFilter, sort: HubSort = 'best', now = Date.now()): HubDeal[] {
  const q = (f.search || '').trim().toLowerCase()
  const out = deals.filter((d) => {
    if (d.endsAt != null && d.endsAt <= now) return false
    if (f.category && d.category !== f.category) return false
    if (f.minDiscount && (d.discountPct ?? 0) < f.minDiscount) return false
    if (f.minCommission && (d.commissionPct ?? 0) < f.minCommission) return false
    if (f.belowYtdOnly && !d.belowYtd) return false
    if (f.when === 'live' && d.startsAt != null && d.startsAt > now) return false
    if (f.when === 'upcoming' && (d.startsAt == null || d.startsAt <= now)) return false
    if (q && !`${d.title} ${d.brand ?? ''} ${d.asin}`.toLowerCase().includes(q)) return false
    return true
  })
  const by: Record<HubSort, (a: HubDeal, b: HubDeal) => number> = {
    best: (a, b) => dealScore(b) - dealScore(a),
    discount: (a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0),
    commission: (a, b) => (b.commissionPct ?? 0) - (a.commissionPct ?? 0),
    reviews: (a, b) => (b.reviews ?? 0) - (a.reviews ?? 0),
    soonest: (a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0),
  }
  if (sort !== 'best') return out.sort(by[sort])
  // A MIX OF BRANDS (Seb, 2026-10-19: Best deals first was six OLEVS watches,
  // all 91% off). Each further deal from the same brand ranks a little lower,
  // so the top of the list is a spread, and one brand's flood is still there
  // further down. Without a brand column, the title's first word stands in.
  const seen = new Map<string, number>()
  return out.sort(by.best)
    .map((d) => {
      const k = (d.brand || d.title.trim().split(/\s+/)[0] || d.asin).toLowerCase()
      const n = seen.get(k) ?? 0
      seen.set(k, n + 1)
      return { d, s: dealScore(d) - n * BRAND_REPEAT_PENALTY }
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.d)
}

/** How much lower each further deal from one brand ranks in Best deals first. */
export const BRAND_REPEAT_PENALTY = 25

/** How many deal posts one batch may write: picked, not mass imported (the
 *  June importer's posts were rarely looked at again). */
/** Where a member downloads the Deals Hub file: Amazon Associates' Deals Hub
 *  (Seb, 2026-10-19: "we also need to have the link for deals hub so people
 *  can go and download it"). */
export const AMAZON_DEALS_HUB_URL = 'https://affiliate-program.amazon.com/deals-hub'

export const MAX_PER_BATCH = 20
