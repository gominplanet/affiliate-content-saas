// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TRYBE HOME (Seb, 2026-11-06: "I really want MVP to be much more than
// [TrybeDaily] ... a very high-end output of information, of data that comes
// from Tribe"). What moved on TRYBE, read from MVP's own daily copy: how many
// brands joined and left each day, which brands are pouring money into Meta
// ads, who raised or cut pay, who climbed a payout tier or entered the Top
// 100, and what TRYBE brands pay, kind by kind, as a market. Every figure is
// counted from what MVP saw, with the window it covers.
//
// Pure, so the server, the page and the tests read one copy.

import { readTerms, type TermKind } from '@/lib/trybe-pay'

const DAY = 86_400_000

export interface ChangeRow { brand_id: string; kind: string; before: string | null; after: string | null; at: string }

/** Counts per day for each kind, oldest first, `days` long, ending today. Pure. */
export function dailySeries(changes: ChangeRow[], kinds: string[], days: number, now = Date.now()): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const k of kinds) out[k] = Array(days).fill(0)
  const today = Math.floor(now / DAY)
  for (const c of changes) {
    const t = Date.parse(c.at)
    if (!Number.isFinite(t) || !out[c.kind]) continue
    const i = days - 1 - (today - Math.floor(t / DAY))
    if (i >= 0 && i < days) out[c.kind][i]++
  }
  return out
}

/** The total in the last `days` of a daily series, and the same span before it. Pure. */
export function windowTotals(series: number[], days: number): { now: number; before: number } {
  const n = series.slice(-days).reduce((a, b) => a + b, 0)
  const b = series.slice(-2 * days, -days).reduce((a, x) => a + x, 0)
  return { now: n, before: b }
}

export interface AdsMover { brand_id: string; from: number; to: number; gain: number; at: string }

/** Brands whose Meta ads grew most in the window: from the first count in it
 *  to the last. A count that fell is not a mover. Pure. */
export function adsMovers(changes: ChangeRow[], days: number, now = Date.now(), limit = 10): AdsMover[] {
  const since = now - days * DAY
  const num = (v: string | null) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : null }
  const by = new Map<string, ChangeRow[]>()
  for (const c of changes) {
    if (c.kind !== 'ads') continue
    const t = Date.parse(c.at)
    if (!Number.isFinite(t) || t < since) continue
    const l = by.get(c.brand_id) || []; l.push(c); by.set(c.brand_id, l)
  }
  const out: AdsMover[] = []
  for (const [id, list] of Array.from(by.entries())) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    const from = num(list[0].before) ?? 0
    const to = num(list[list.length - 1].after)
    if (to == null || to <= from) continue
    out.push({ brand_id: id, from, to, gain: to - from, at: list[list.length - 1].at })
  }
  return out.sort((a, b) => b.gain - a.gain || b.to - a.to).slice(0, limit)
}

/** A pay text's flat dollars per approved video and its percent of sales, read. */
export function payFigures(text: string | null): { flat: number | null; gmv: number | null; adSpend: number | null; kinds: TermKind[] } {
  if (!text) return { flat: null, gmv: null, adSpend: null, kinds: [] }
  const { terms } = readTerms(String(text).split(/\s*[+;\n]\s*|\s+and\s+/i).filter(Boolean))
  const best = (k: TermKind) => { const a = terms.filter((t) => t.kind === k).map((t) => t.amount); return a.length ? Math.max(...a) : null }
  return { flat: best('flat'), gmv: best('gmv'), adSpend: best('adSpend'), kinds: Array.from(new Set(terms.map((t) => t.kind))) }
}

export interface PayMove { brand_id: string; before: string; after: string; dir: 'up' | 'down' | 'changed'; at: string; delta: string | null }

/** Pay changes in the window, raised or cut where the figures say which. Pure. */
export function payMoves(changes: ChangeRow[], days: number, now = Date.now()): PayMove[] {
  const since = now - days * DAY
  const out: PayMove[] = []
  for (const c of changes) {
    if (c.kind !== 'pay' || !c.before || !c.after) continue
    const t = Date.parse(c.at)
    if (!Number.isFinite(t) || t < since) continue
    const a = payFigures(c.before), b = payFigures(c.after)
    let dir: PayMove['dir'] = 'changed'
    let delta: string | null = null
    if (a.flat != null && b.flat != null && a.flat !== b.flat) { dir = b.flat > a.flat ? 'up' : 'down'; delta = `$${a.flat} to $${b.flat} a video` }
    else if (a.gmv != null && b.gmv != null && a.gmv !== b.gmv) { dir = b.gmv > a.gmv ? 'up' : 'down'; delta = `${a.gmv}% to ${b.gmv}% of sales` }
    else if (a.flat == null && b.flat != null) { dir = 'up'; delta = `now $${b.flat} a video` }
    out.push({ brand_id: c.brand_id, before: c.before, after: c.after, dir, at: c.at, delta })
  }
  return out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
}

export interface PayIndexRow { kind: 'flat' | 'gmv' | 'adSpend' | 'perOrder' | 'retainer'; label: string; brands: number; share: number; median: number | null; p25: number | null; p75: number | null; unit: '$' | '%' }
export interface PayIndex { brands: number; read: number; rows: PayIndexRow[]; flatBands: Array<{ label: string; n: number }> }

const quant = (a: number[], q: number) => (a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))] : null)

/** What TRYBE brands pay, as a market: per kind of pay, how many brands use
 *  it and the middle and typical range of the figure; and how flat fees per
 *  video spread. Brands whose pay text MVP could not read are counted apart. Pure. */
export function payIndex(texts: Array<string | null>): PayIndex {
  const vals: Record<PayIndexRow['kind'], number[]> = { flat: [], gmv: [], adSpend: [], perOrder: [], retainer: [] }
  let read = 0
  for (const t of texts) {
    if (!t) continue
    const { terms } = readTerms(String(t).split(/\s*[+;\n]\s*|\s+and\s+/i).filter(Boolean))
    if (!terms.length) continue
    read++
    const seen = new Set<string>()
    for (const term of terms) {
      if (term.kind === 'bonus' || seen.has(term.kind)) continue
      seen.add(term.kind)
      const k = term.kind as PayIndexRow['kind']
      // Implausible figures are left out of the middle and range.
      if ((k === 'gmv' || k === 'adSpend') && (term.amount <= 0 || term.amount > 80)) continue
      if ((k === 'flat' || k === 'perOrder') && (term.amount <= 0 || term.amount > 5000)) continue
      vals[k].push(term.amount)
    }
  }
  const LABEL: Record<PayIndexRow['kind'], string> = { flat: 'Flat fee per approved video', gmv: '% of sales', adSpend: '% of ad spend', perOrder: 'Per order', retainer: 'Monthly retainer' }
  const rows = (Object.keys(vals) as PayIndexRow['kind'][]).map((k) => {
    const a = vals[k].slice().sort((x, y) => x - y)
    return { kind: k, label: LABEL[k], brands: a.length, share: read ? Math.round((a.length / read) * 100) : 0, median: quant(a, 0.5), p25: quant(a, 0.25), p75: quant(a, 0.75), unit: (k === 'gmv' || k === 'adSpend' ? '%' : '$') as '$' | '%' }
  }).filter((r) => r.brands > 0).sort((x, y) => y.brands - x.brands)
  const flat = vals.flat
  const bands = [[0, 25, 'Under $25'], [25, 50, '$25 to $50'], [50, 100, '$50 to $100'], [100, 250, '$100 to $250'], [250, Infinity, '$250 or more']] as const
  const flatBands = bands.map(([lo, hi, label]) => ({ label, n: flat.filter((v) => v >= lo && v < hi).length }))
  return { brands: texts.length, read, rows, flatBands }
}
