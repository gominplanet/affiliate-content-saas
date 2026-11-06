'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND BRANDS AS A TABLE (Seb, 2026-11-06: "we need to be able to have a
// proper find brands"). TrybeDaily shows about six brand cards a screen. This
// shows the same search as rows, twenty and more a screen, one column per
// thing a creator compares, each sortable with a press on its heading. A
// value MVP has not read says so in grey, never a zero. The brand's name opens
// its page; the box picks it for Write messages, as on the cards.

import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Trophy } from 'lucide-react'
import { BrandMark } from '@/components/labs/TrybeFinderControls'
import { BrandName } from '@/components/labs/trybe-dossier-context'
import { GRADE } from '@/components/labs/trybe-ui'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

type Col = 'pick' | 'brand' | 'pay' | 'paidOut' | 'meta' | 'top100' | 'rating' | 'samples' | 'room' | 'decides'
const TIERS = ['$1K+', '$5K+', '$10K+', '$25K+', '$50K+', '$100K+', '$200K+', '$500K+', '$1M+']
const tierRank = (b: string | null | undefined) => { if (!b) return -1; const i = TIERS.indexOf(b.trim()); if (i >= 0) return i; const n = parseFloat(String(b).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n / 1000 : -1 }
const metaOf = (b: Row): number | null => (typeof b.meta_ads === 'number' && b.meta_fresh && (b.meta_trust === 'own' || b.meta_trust === 'unchecked') ? b.meta_ads : null)
const roomRank = (l: string | null | undefined) => (l === 'open' ? 3 : l === 'filling' ? 2 : l === 'crowded' ? 1 : 0)

/** The value each column sorts by: unknown always last. */
function key(b: Row, c: Col): number | string | null {
  switch (c) {
    case 'pick': return typeof b.pick === 'number' ? b.pick : null
    case 'brand': return String(b.name || '').toLowerCase()
    case 'pay': return b.pay_est?.dollars ?? null
    case 'paidOut': return tierRank(b.earnings_bucket) >= 0 ? tierRank(b.earnings_bucket) : null
    case 'meta': return metaOf(b)
    case 'top100': return typeof b.top100_hits === 'number' ? b.top100_hits : null
    case 'rating': return typeof b.review_rating === 'number' ? b.review_rating : null
    case 'samples': return b.stats?.samples === true ? 1 : b.stats?.samples === false ? 0 : null
    case 'room': return roomRank(b.crowd?.level) || null
    case 'decides': return typeof b.review?.reviewDays === 'number' ? -b.review.reviewDays : null
  }
}

const COLS: Array<{ id: Col; label: string; title: string; align?: 'right' }> = [
  { id: 'brand', label: 'Brand', title: 'A to Z' },
  { id: 'pick', label: 'MVP pick', title: 'Best bets score: less competition, real ad spend, pay, samples', align: 'right' },
  { id: 'pay', label: 'A video pays', title: 'What one approved video pays, from your results, members’ results, or its terms', align: 'right' },
  { id: 'paidOut', label: 'Paid out', title: 'TRYBE’s payout range for the brand, all time' },
  { id: 'meta', label: 'Meta ads', title: 'Its own Meta ads running, counted in the last four weeks', align: 'right' },
  { id: 'top100', label: 'Top 100', title: 'Its videos seen in TRYBE’s Top 100', align: 'right' },
  { id: 'rating', label: 'Rating', title: 'Creators’ stars on TRYBE', align: 'right' },
  { id: 'samples', label: 'Samples', title: 'Takes sample requests, from TRYBE or its products' },
  { id: 'room', label: 'Room', title: 'How crowded it is with creators' },
  { id: 'decides', label: 'Decides', title: 'Days to decide a video, from MVP members', align: 'right' },
]

const muted: CSSProperties = { color: 'var(--text-3)' }
const Unknown = ({ children = 'Not read' }: { children?: string }) => <span className="text-[11.5px]" style={muted}>{children}</span>

export default function TrybeBrandTable({ brands, picked, onPick, taken, preview, whereOf }: {
  brands: Row[]
  picked: Set<string>
  onPick: (id: string, on: boolean) => void
  /** Statuses a brand cannot be picked in (already written or sent). */
  taken: string[]
  preview: boolean
  /** Where the brand stands on the creator's list, in words. */
  whereOf: (b: Row) => string | null
}) {
  const [sort, setSort] = useState<{ col: Col; desc: boolean } | null>(null)
  const rows = useMemo(() => {
    if (!sort) return brands
    const out = [...brands]
    out.sort((a, b) => {
      const x = key(a, sort.col), y = key(b, sort.col)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      const r = typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number)
      return sort.desc ? -r : r
    })
    return out
  }, [brands, sort])
  const flip = (c: Col) => setSort((s) => (s && s.col === c ? (s.desc ? { col: c, desc: false } : null) : { col: c, desc: c !== 'brand' }))

  return (
    <div className="rounded-2xl overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <table className="w-full text-[13px] min-w-[1060px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr className="text-left" style={{ borderBottom: '1px solid var(--border)' }}>
            {!preview && <th className="pl-4 pr-1 py-2.5 w-8"><span className="sr-only">Pick</span></th>}
            {COLS.map((c) => {
              const on = sort?.col === c.id
              return (
                <th key={c.id} className={`px-2.5 py-2.5 font-semibold text-[11px] uppercase whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`} style={{ letterSpacing: '0.06em', color: on ? 'var(--text)' : 'var(--text-3)' }} aria-sort={on ? (sort!.desc ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => flip(c.id)} title={`${c.title}. Press to sort.`} className="inline-flex items-center gap-1 uppercase hover:underline underline-offset-4">
                    {c.label}{on && (sort!.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const isTaken = taken.includes(b.status)
            const on = picked.has(b.brand_id)
            const where = whereOf(b)
            const meta = metaOf(b)
            return (
              <tr key={b.brand_id} className="transition-colors hover:bg-[rgb(var(--brand-rgb)/0.04)]" style={{ borderTop: '1px solid var(--border)', background: on ? 'rgb(var(--brand-rgb) / 0.06)' : undefined, opacity: isTaken ? 0.62 : 1 }}>
                {!preview && (
                  <td className="pl-4 pr-1 py-2.5 align-middle">
                    <input type="checkbox" className="w-4 h-4" style={{ accentColor: 'var(--accent)' }} checked={on} disabled={isTaken} aria-label={`Pick ${b.name}`} onChange={(e) => onPick(b.brand_id, e.target.checked)} />
                  </td>
                )}
                <td className="px-2.5 py-2.5 align-middle">
                  <div className="flex items-center gap-2.5 min-w-[220px] max-w-[300px]">
                    <BrandMark name={b.name} website={b.website} size={30} />
                    <div className="min-w-0">
                      <BrandName id={b.brand_id} name={b.name} className="text-[13.5px] font-semibold block truncate max-w-[240px]" style={{ color: 'var(--text)' }} />
                      <span className="text-[11px] block truncate max-w-[240px]" style={muted}>
                        {where ? <span style={{ color: 'var(--accent-text, var(--accent))', fontWeight: 600 }}>{where}</span> : b.is_new ? <span style={{ color: 'var(--hot, #C2410C)', fontWeight: 600 }}>New on TRYBE</span> : (b.categories || []).slice(0, 2).join(', ')}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-2.5 py-2.5 text-right align-middle">
                  {typeof b.pick === 'number' ? (
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="w-10 h-1.5 rounded-full overflow-hidden inline-block" style={{ background: 'var(--surface-2)' }}><span className="block h-full rounded-full" style={{ width: `${Math.max(6, Math.min(100, b.pick))}%`, background: b.pick >= 70 ? GRADE.strong.color : b.pick >= 45 ? GRADE.fair.color : GRADE.weak.color }} /></span>
                      <span className="font-bold" style={{ color: 'var(--text)' }}>{Math.round(b.pick)}</span>
                    </span>
                  ) : <Unknown />}
                </td>
                <td className="px-2.5 py-2.5 text-right align-middle whitespace-nowrap" title={b.pay_text || undefined}>
                  {b.pay_est?.dollars != null ? <span className="font-bold" style={{ color: 'var(--text)' }}>${Math.round(b.pay_est.dollars)}</span>
                    : b.pay_est?.short || b.pay_text ? <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{String(b.pay_est?.short || b.pay_text).slice(0, 26)}</span> : <Unknown>Not shown</Unknown>}
                </td>
                <td className="px-2.5 py-2.5 align-middle whitespace-nowrap">
                  {b.earnings_bucket ? <span className="font-semibold" style={{ color: 'var(--text)' }}>{b.earnings_bucket}{b.tier_up && <ArrowUpRight size={12} className="inline -mt-0.5 ml-0.5" style={{ color: GRADE.strong.color }} aria-label="Went up lately" />}</span> : <Unknown>Not shown</Unknown>}
                </td>
                <td className="px-2.5 py-2.5 text-right align-middle whitespace-nowrap">
                  {meta != null ? <span className="font-bold" style={{ color: meta > 0 ? 'var(--text)' : 'var(--text-3)' }}>{meta}</span>
                    : typeof b.meta_ads === 'number' && b.meta_fresh ? <Unknown>Unclear</Unknown> : <Unknown>Not counted</Unknown>}
                </td>
                <td className="px-2.5 py-2.5 text-right align-middle">
                  {typeof b.top100_hits === 'number' && b.top100_hits > 0 ? <span className="inline-flex items-center gap-1 font-bold" style={{ color: 'var(--text)' }}><Trophy size={12} style={{ color: '#F59E0B' }} />{b.top100_hits}</span> : <span style={muted}>0</span>}
                </td>
                <td className="px-2.5 py-2.5 text-right align-middle whitespace-nowrap">
                  {typeof b.review_rating === 'number' ? <span><span className="font-bold" style={{ color: 'var(--text)' }}>{b.review_rating.toFixed(1)}</span> <span className="text-[11px]" style={muted}>({b.review_count ?? 0})</span></span> : <Unknown>None</Unknown>}
                </td>
                <td className="px-2.5 py-2.5 align-middle whitespace-nowrap">
                  {b.stats?.samples === true ? <Dot c="strong">Yes</Dot> : b.stats?.samples === false ? <Dot c="weak">No</Dot> : <Unknown>Not known</Unknown>}
                </td>
                <td className="px-2.5 py-2.5 align-middle whitespace-nowrap">
                  {b.crowd?.level ? <Dot c={b.crowd.level === 'open' ? 'strong' : b.crowd.level === 'filling' ? 'fair' : 'weak'}>{b.crowd.level === 'open' ? 'Open' : b.crowd.level === 'filling' ? 'Filling' : 'Crowded'}</Dot> : <Unknown>Not known</Unknown>}
                </td>
                <td className="px-2.5 py-2.5 pr-4 text-right align-middle whitespace-nowrap">
                  {typeof b.review?.reviewDays === 'number' ? <span className="font-semibold" style={{ color: 'var(--text)' }}>{b.review.reviewDays}d</span> : <Unknown>Not yet</Unknown>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Dot({ c, children }: { c: 'strong' | 'fair' | 'weak'; children: string }) {
  return <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}><span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: GRADE[c].color }} />{children}</span>
}
