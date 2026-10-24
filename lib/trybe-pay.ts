// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A VIDEO PAYS (Seb, 2026-10-14, after Rob's Oink Suite video: "build
// all 4"). Oink turns TRYBE's payout terms into one dollar figure per
// approved video; this does the same, the honest way:
//
//   1. TRYBE's own pay lines, read from the brand's entry. TRYBE's page code
//      writes each rule as displayValue + displayLabel ("15%" "of GMV") or a
//      displayText, and MVP read only text/label/description before, so most
//      brands had no pay at all. Every way TRYBE pays is read: a flat fee per
//      video, % of sales (GMV), % of ad spend, a fee per order, a guaranteed
//      retainer ("Guaranteed $500 this period if you submit 10 videos"), a
//      bonus, and a cap ("up to $100").
//   2. One figure per approved video, from the best source there is: what
//      YOU earned per approved video with the brand, then what MVP members
//      earned (pooled, never one member), then the fixed part of its terms.
//      A % of sales or ad spend is never turned into a guessed dollar amount:
//      it is said as "plus 15% of sales", and a brand that pays only that way
//      reads "depends on sales", never $0. Terms MVP cannot read say so.
//
// This is for the creator's own choice of brands. It never goes into a
// message to a brand: on TRYBE the brand sets the pay. Pure, so it is tested
// (scripts/test-trybe-pay).

import { readPay, type PayRead } from '@/lib/trybe-outreach'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const clean = (v: unknown, max = 160): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/** One pay rule's words, the way TRYBE's own page shows it. Pure. */
export function ruleText(r: unknown): string {
  if (typeof r === 'string') return clean(r)
  if (!isObj(r)) return ''
  const value = clean(r.displayValue), label = clean(r.displayLabel)
  if (value && label) return `${value} ${label}`
  return clean(r.displayText) || value || clean(r.text) || clean(r.label) || clean(r.description) || clean(r.title)
}

/** Every pay line in a TRYBE brand entry: its commission rules (on the entry,
 *  its brand, or its programs), then commissionRate and perSubmission, then a
 *  pay line MVP kept before. Duplicates once. Pure. */
export function payLines(raw: unknown, kept?: string | null): string[] {
  const out: string[] = []
  const add = (s: string) => { const t = s.trim(); if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t) }
  if (isObj(raw)) {
    const brand = isObj(raw.brand) ? raw.brand : null
    const programs = [raw.programs, brand?.programs].find(Array.isArray) as unknown[] | undefined
    const ruleLists = [raw.commissionRules, brand?.commissionRules, ...(programs || []).map((p) => (isObj(p) ? p.commissionRules : null))]
    for (const list of ruleLists) if (Array.isArray(list)) for (const r of list.slice(0, 12)) add(ruleText(r))
    for (const v of [raw.commissionRate, raw.perSubmission, brand?.commissionRate, brand?.perSubmission]) add(clean(v))
    for (const p of programs || []) {
      if (!isObj(p)) continue
      const pct = Number((p.program && isObj(p.program) ? p.program.commissionPercentage : p.commissionPercentage))
      if (Number.isFinite(pct) && pct > 0) add(`${Math.trunc(pct * 100) / 100}% of GMV`)
    }
  }
  // MVP's own kept line splits on " · " (how it joined rules before).
  for (const part of String(kept || '').split(/\s+·\s+/)) add(clean(part))
  return out.slice(0, 12)
}

export type TermKind = 'flat' | 'gmv' | 'adSpend' | 'perOrder' | 'retainer' | 'bonus'
export interface PayTerm {
  kind: TermKind
  /** Dollars for flat, perOrder, retainer, bonus; a percent for gmv and adSpend. */
  amount: number
  /** "up to $100": the most this term pays per video, in dollars. */
  cap: number | null
  /** A retainer's videos ("if you submit 10 videos"). */
  videos: number | null
  text: string
}

const MONEY = /\$\s*(\d+(?:\.\d+)?)\s*(k)?/i
const dollarsIn = (s: string): number | null => {
  const m = s.replace(/,(?=\d{3}\b)/g, '').match(MONEY)
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? n : null
}
const pctIn = (s: string): number | null => {
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null
}
const capIn = (s: string): number | null => {
  const m = s.replace(/,(?=\d{3}\b)/g, '').match(/(?:up to|max(?:imum)?(?: of)?|capped at|cap(?:ped)? of|no more than)\s*\$\s*(\d+(?:\.\d+)?)\s*(k)?/i)
  const n = m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** One pay line, read. Null when it has no number MVP can place. Pure. */
export function readTerm(text: string): PayTerm | null {
  const s = clean(text, 200)
  if (!s) return null
  const low = s.toLowerCase()
  const cap = capIn(s)
  // A cap's own dollars are not the amount: read the amount without it.
  const body = cap != null ? s.replace(/(?:up to|max(?:imum)?(?: of)?|capped at|cap(?:ped)? of|no more than)\s*\$\s*[\d.,]+\s*k?/i, ' ') : s
  const pct = pctIn(body)
  const usd = dollarsIn(body)
  if (/guarantee|retainer/.test(low)) {
    const v = low.match(/(\d+)\s*(?:videos?|submissions?|pieces?|posts?)/)
    const amount = usd ?? cap
    return amount != null ? { kind: 'retainer', amount, cap: null, videos: v ? parseInt(v[1], 10) || null : null, text: s } : null
  }
  if (pct != null && /ad spend|ad performance|of spend|media spend/.test(low)) return { kind: 'adSpend', amount: pct, cap, videos: null, text: s }
  if (pct != null) return { kind: 'gmv', amount: pct, cap, videos: null, text: s }
  if (usd != null && /bonus/.test(low)) return { kind: 'bonus', amount: usd, cap, videos: null, text: s }
  if (usd != null && /per\s+(order|sale|conversion|purchase)|\/\s*(order|sale)|each (order|sale)/.test(low)) return { kind: 'perOrder', amount: usd, cap, videos: null, text: s }
  if (usd != null) return { kind: 'flat', amount: usd, cap, videos: null, text: s }
  // "50 per video" with no currency sign is still a flat fee.
  const bare = low.match(/(\d+(?:\.\d+)?)\s*(?:usd|dollars?)?\s*(?:per|\/|a|each)\s*(?:approved\s+)?(?:video|submission|post|piece|content|creative)/)
  if (bare) { const n = parseFloat(bare[1]); if (n > 0) return { kind: 'flat', amount: n, cap, videos: null, text: s } }
  if (cap != null) return { kind: 'flat', amount: cap, cap, videos: null, text: s }
  return null
}

/** Every pay line read; the ones MVP could not place are kept as words. Pure. */
export function readTerms(lines: string[]): { terms: PayTerm[]; unread: string[] } {
  const terms: PayTerm[] = [], unread: string[] = []
  for (const l of lines) { const t = readTerm(l); if (t) terms.push(t); else if (/\d/.test(l)) unread.push(l) }
  return { terms, unread }
}

export type PayBasis = 'yours' | 'members' | 'terms' | 'variable' | 'unknown'
export interface PayEstimate {
  /** Dollars per approved video; null when no dollar figure is honest. */
  dollars: number | null
  basis: PayBasis
  /** The short label for a brand card. */
  short: string
  /** How the figure was worked out, line by line. */
  math: string[]
  /** What it pays on top that is not in the figure ("plus 15% of sales"). */
  plus: string[]
  /** A term's cap held the figure down. */
  capped: boolean
  /** Part of the figure is guaranteed (a flat fee or a retainer). */
  guaranteed: boolean
  /** The kinds of pay it has, for the pay filter. */
  kinds: TermKind[]
}

export const money = (n: number) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.00$/, '')}`

/** The figure per approved video. `yours` and `members` are dollars per
 *  approved video from real results (yours with the brand, MVP members'
 *  pooled); they come first. Pure. */
export function estimatePay(input: { lines: string[]; yours?: { earnings: number; approved: number } | null; members?: number | null }): PayEstimate {
  const { terms, unread } = readTerms(input.lines)
  const kinds = Array.from(new Set(terms.map((t) => t.kind)))
  const plus: string[] = []
  const math: string[] = []
  let capped = false
  for (const t of terms) {
    const cap = t.cap != null ? `, up to ${money(t.cap)}` : ''
    if (t.kind === 'gmv') plus.push(`plus ${t.amount}% of the sales your videos make${cap}`)
    if (t.kind === 'adSpend') plus.push(`plus ${t.amount}% of what the brand spends running your videos as ads${cap}`)
    if (t.kind === 'perOrder') plus.push(`plus ${money(t.amount)} per order${cap}`)
    if (t.kind === 'bonus') plus.push(`a ${money(t.amount)} bonus (${t.text})`)
  }
  // The fixed part: the best flat fee (a cap holds it down) plus a retainer
  // spread over the videos it asks for.
  const flats = terms.filter((t) => t.kind === 'flat')
  const bestFlat = flats.length ? Math.max(...flats.map((t) => (t.cap != null ? Math.min(t.amount, t.cap) : t.amount))) : null
  if (flats.some((t) => t.cap != null && t.cap < t.amount)) capped = true
  const ret = terms.find((t) => t.kind === 'retainer') || null
  const retPer = ret ? (ret.videos ? ret.amount / ret.videos : null) : null
  const fixed = bestFlat != null || retPer != null ? (bestFlat ?? 0) + (retPer ?? 0) : null
  if (bestFlat != null) math.push(`${money(bestFlat)} flat fee per approved video${capped ? ' (capped)' : ''}`)
  if (ret && retPer != null) math.push(`${money(ret.amount)} guaranteed for ${ret.videos} videos: ${money(retPer)} a video`)
  else if (ret) plus.push(`${money(ret.amount)} guaranteed (${ret.text})`)

  const y = input.yours
  if (y && y.approved > 0 && y.earnings > 0) {
    const per = y.earnings / y.approved
    return { dollars: per, basis: 'yours', short: `${money(per)} a video (yours)`, capped, guaranteed: fixed != null, kinds,
      math: [`You earned ${money(y.earnings)} for ${y.approved} approved video${y.approved === 1 ? '' : 's'} with it: ${money(per)} each`, ...math], plus }
  }
  const m = input.members
  if (typeof m === 'number' && m > 0) {
    return { dollars: m, basis: 'members', short: `About ${money(m)} a video (members)`, capped, guaranteed: fixed != null, kinds,
      math: [`MVP members earned ${money(m)} per approved video with it, on average (5 members at least)`, ...math], plus }
  }
  if (fixed != null) {
    return { dollars: fixed, basis: 'terms', short: `${money(fixed)} a video${plus.length ? ' +' : ''}`, capped, guaranteed: true, kinds, math, plus }
  }
  if (terms.length) {
    const lead = terms.find((t) => t.kind === 'gmv') ? 'Depends on sales' : terms.find((t) => t.kind === 'adSpend') ? 'Depends on ad spend' : 'Depends on orders'
    return { dollars: null, basis: 'variable', short: lead, capped, guaranteed: false, kinds,
      math: ['It pays on results only, so MVP gives no dollar figure until members have results with it.'], plus }
  }
  return { dollars: null, basis: 'unknown', short: input.lines.length || unread.length ? 'Pay terms unclear' : 'Pay not listed', capped: false, guaranteed: false, kinds,
    math: [input.lines.length ? `MVP could not read these pay terms: ${input.lines.slice(0, 3).join(' · ')}. Open the brand on TRYBE to see them.` : 'TRYBE’s list gives no pay for it. Open the brand on TRYBE to see its terms.'], plus }
}

/** The pay line for the pay filter and Highest pay: the fixed dollars per
 *  video (never a retainer's whole amount), the best percent, and every kind
 *  of pay it has. Lines MVP could not place fall back to the plain reading. Pure. */
export function payReadOf(lines: string[]): PayRead {
  const { terms } = readTerms(lines)
  if (!terms.length) return { ...readPay(lines.join(' · ')), kinds: [] }
  const est = estimatePay({ lines })
  // A percent of SALES only: a percent of ad spend is another kind of pay
  // (kinds has 'adSpend', the Pay filter's own choice), and counting it here
  // passed "% of sales" and read "Pays 3% of sales" for a brand paying none.
  const pcts = terms.filter((t) => t.kind === 'gmv').map((t) => t.amount)
  const dollars = est.basis === 'terms' ? est.dollars : null
  const percent = pcts.length ? Math.max(...pcts) : null
  const kind = dollars != null && percent != null ? 'both' : dollars != null ? 'flat' : percent != null ? 'percent' : null
  return { kind, dollars, percent, kinds: est.kinds }
}
