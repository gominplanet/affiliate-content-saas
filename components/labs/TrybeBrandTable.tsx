'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND BRANDS AS A TABLE (Seb, 2026-11-06: "we need to be able to have a
// proper find brands"). TrybeDaily shows about six brand cards a screen. This
// shows the same search as rows, twenty and more a screen, one column per
// thing a creator compares, each sortable with a press on its heading. A
// value MVP has not read says so in grey, never a zero. The brand's name opens
// its page; the box picks it for Write messages, as on the cards.

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Trophy } from 'lucide-react'
import { BrandMark, proofTitle } from '@/components/labs/TrybeFinderControls'
import { retainerSource } from '@/lib/trybe-evidence'
import { BrandName, useBrandOpen } from '@/components/labs/trybe-dossier-context'
import { GRADE, APP, AppChip } from '@/components/labs/trybe-ui'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

type Col = 'pick' | 'brand' | 'pay' | 'retainer' | 'month' | 'paidOut' | 'meta' | 'top100' | 'rating' | 'samples' | 'tiktok' | 'room' | 'decides' | 'approves' | 'answers'
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
    case 'samples': return b.proof?.app ? 0.5 : b.stats?.samples === true ? 1 : b.stats?.samples === false ? 0 : null
    // Room and pay when MVP can judge both; else room alone, after them.
    case 'room': return b.room_pay?.rank ? 10 + b.room_pay.rank : roomRank(b.crowd?.level) || null
    case 'decides': return typeof b.review?.reviewDays === 'number' ? -b.review.reviewDays : null
    case 'month': return typeof b.spend?.dollars === 'number' ? b.spend.dollars : null
    // A retainer with an amount by its amount; one only mentioned after those.
    // Set in TRYBE's terms first (by its amount), then ones only mentioned.
    case 'retainer': return b.retainer ? (b.retainer.source === 'terms' ? (typeof b.retainer.amount === 'number' ? b.retainer.amount : 1) : 0.5) : null
    // Not on TikTok Shop is the better side (less competition), so it sorts first.
    case 'tiktok': return b.tiktok_shop === false ? 1 : b.tiktok_shop === true ? 0 : null
    case 'approves': return typeof b.approval === 'number' ? b.approval : null
    case 'answers': return typeof b.replies?.rate === 'number' ? b.replies.rate : null
  }
}

const COLS: Array<{ id: Col; label: string; short: string; title: string; align?: 'right' }> = [
  { id: 'brand', label: 'Brand', short: 'A to Z', title: 'A to Z' },
  { id: 'pick', label: 'MVP pick', short: 'MVP pick', title: 'Best bets score: less competition, real ad spend, pay, samples', align: 'right' },
  { id: 'pay', label: 'A video pays', short: 'a video', title: 'What one approved video pays, from your results, members’ results, or its terms', align: 'right' },
  { id: 'retainer', label: 'Retainer', short: 'retainer', title: 'Offers creators a retainer: in its TRYBE pay terms, or its own words. Hover one to read where' },
  { id: 'month', label: 'Pays a month', short: 'a month', title: 'What it pays TRYBE creators a month, estimated: its videos approved in the last 30 days times its pay per video', align: 'right' },
  { id: 'paidOut', label: 'Paid out', short: 'paid out', title: 'TRYBE’s payout range for the brand, all time' },
  { id: 'meta', label: 'Meta ads', short: 'Meta ads', title: 'Its own Meta ads running, counted in the last four weeks', align: 'right' },
  { id: 'top100', label: 'Top 100', short: 'Top 100', title: 'Its videos seen in TRYBE’s Top 100', align: 'right' },
  { id: 'rating', label: 'Rating', short: 'rating', title: 'Creators’ stars on TRYBE', align: 'right' },
  { id: 'samples', label: 'Samples', short: 'samples', title: 'Takes sample requests, from TRYBE or its products' },
  { id: 'tiktok', label: 'TikTok Shop', short: 'TikTok Shop', title: 'Sells on TikTok Shop, from its own website. Not on it means less competition' },
  { id: 'room', label: 'Room and pay', short: 'room', title: 'How crowded it is with creators, weighed with what it pays: Room and paying, Crowded but paying, Crowded, low pay' },
  { id: 'decides', label: 'Decides', short: 'decides', title: 'Days to decide a video, from MVP members', align: 'right' },
  { id: 'approves', label: 'Approves', short: 'approves', title: 'How many of MVP members’ videos it approved, once 5 members have results', align: 'right' },
  { id: 'answers', label: 'Answers', short: 'answers', title: 'How many of MVP members’ requests it answered, and the middle wait, once 5 members have messaged it', align: 'right' },
]

// FOUR COLUMNS, EVERY FACT (Seb, 2026-11-09: "Can we make this a table that
// actually sits on the page without having to scroll? ... I do love the
// information"). Fifteen columns needed 1,500px; beside the filter column
// the table has about 680. The facts are grouped by the question a creator
// asks, each group one column with its facts stacked, and every fact keeps
// its own sort button under the group's heading.
const GROUPS: Array<{ id: string; label: string; facts: Col[]; width: string }> = [
  { id: 'brand', label: 'Brand', facts: ['brand', 'pick'], width: '30%' },
  { id: 'pay', label: 'Pay', facts: ['pay', 'month', 'paidOut', 'retainer'], width: '23%' },
  { id: 'reach', label: 'Ads and reach', facts: ['meta', 'top100', 'tiktok'], width: '21%' },
  { id: 'creators', label: 'Room and creators', facts: ['room', 'rating', 'samples', 'approves', 'answers', 'decides'], width: '26%' },
]
const colOf = (c: Col) => COLS.find((x) => x.id === c)!

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
  // A press anywhere on a row opens the brand's page; the pick box and the
  // links in a row keep their own job (Seb, 2026-11-06).
  const onOpen = useBrandOpen()
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
  // The fact the list is sorted by stands out in every row.
  const hl = (c: Col): CSSProperties | undefined => (sort?.col === c ? { color: 'var(--accent-text, var(--accent))', textDecoration: 'underline', textUnderlineOffset: 3 } : undefined)

  // AS A SPREADSHEET: the rows as shown, in this order, each value as the
  // table says it (blank where MVP has not read it, never a zero).
  function download() {
    const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = ['Brand', 'Website', 'Categories', 'MVP pick', 'A video pays ($)', 'Pay on TRYBE', 'Retainer', 'Pays a month ($)', 'Paid out', 'Meta ads', 'Top 100 videos', 'Rating', 'Reviews', 'Samples', 'TikTok Shop', 'Room', 'Room and pay', 'Days to decide', 'Approves (%)', 'Answers (%)', 'On your list']
    const lines = rows.map((b) => [
      b.name, b.website, (b.categories || []).join('; '), typeof b.pick === 'number' ? Math.round(b.pick) : '',
      b.pay_est?.dollars != null ? Math.round(b.pay_est.dollars) : '', b.pay_text || '', b.retainer ? retainerSource(b.retainer) : '', typeof b.spend?.dollars === 'number' ? Math.round(b.spend.dollars) : '', b.earnings_bucket || '', metaOf(b) ?? '',
      typeof b.top100_hits === 'number' ? b.top100_hits : '', typeof b.review_rating === 'number' ? b.review_rating : '', typeof b.review_count === 'number' ? b.review_count : '',
      b.proof?.app ? 'App, none needed' : b.stats?.samples === true ? 'Yes' : b.stats?.samples === false ? 'No' : '', b.tiktok_shop === true ? 'Yes' : b.tiktok_shop === false ? 'No' : '', b.crowd?.level || '', b.room_pay?.words || '', typeof b.review?.reviewDays === 'number' ? b.review.reviewDays : '',
      typeof b.approval === 'number' ? Math.round(b.approval * 100) : '', typeof b.replies?.rate === 'number' ? Math.round(b.replies.rate * 100) : '', whereOf(b) || '',
    ].map(cell).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'trybe-brands.csv'
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const sub = 'text-[11.5px] leading-snug mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5'
  return (
    <div className="flex flex-col gap-2">
    <div className="flex justify-end">
      <button type="button" onClick={download} disabled={!rows.length} className="text-[12px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} title="The rows as shown, as a CSV file for Google Sheets or Excel">
        Download these {rows.length} as a spreadsheet
      </button>
    </div>
    {/* Fits beside the filters; only a phone narrower than the four columns scrolls sideways. */}
    <div className="rounded-2xl overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <table className="w-full text-[13px] min-w-[600px] table-fixed" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <colgroup>
          {!preview && <col style={{ width: 40 }} />}
          {GROUPS.map((g) => <col key={g.id} style={{ width: g.width }} />)}
        </colgroup>
        <thead>
          <tr className="text-left align-top" style={{ borderBottom: '1px solid var(--border)' }}>
            {!preview && <th className="pl-4 pr-1 py-2.5 sticky left-0 z-[2]" style={{ background: 'var(--surface)', width: 40, minWidth: 40, maxWidth: 40, boxSizing: 'border-box' }}><span className="sr-only">Pick</span></th>}
            {GROUPS.map((g) => {
              const on = g.facts.includes(sort?.col as Col)
              // THE NAME STAYS IN VIEW when a phone scrolls the table sideways.
              const pin: CSSProperties = g.id === 'brand' ? { position: 'sticky', left: preview ? 0 : 40, zIndex: 2, background: 'var(--surface)', boxShadow: '1px 0 0 var(--border)' } : {}
              return (
                <th key={g.id} className="px-2.5 py-2.5 font-semibold" style={pin} aria-sort={on ? (sort!.desc ? 'descending' : 'ascending') : 'none'}>
                  <span className="block text-[11px] uppercase" style={{ letterSpacing: '0.06em', color: on ? 'var(--text)' : 'var(--text-3)' }}>{g.label}</span>
                  {/* Each fact sorts on its own. */}
                  <span className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5">
                    {g.facts.map((f) => {
                      const c = colOf(f), active = sort?.col === f
                      return (
                        <button key={f} type="button" onClick={() => flip(f)} title={`${c.title}. Press to sort.`}
                          className="text-[11px] font-medium inline-flex items-center gap-0.5 rounded px-1 -mx-0.5 hover:underline underline-offset-2"
                          style={active ? { background: 'rgb(var(--brand-rgb) / 0.12)', color: 'var(--accent-text, var(--accent))', fontWeight: 700 } : { color: 'var(--text-3)' }}>
                          {c.short}{active && (sort!.desc ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
                        </button>
                      )
                    })}
                  </span>
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
            // An app or online service in My top 100: blue, said in words too.
            const isApp = !!b.proof?.app
            const edge: CSSProperties | undefined = isApp ? { boxShadow: `inset 3px 0 0 ${APP.color}` } : undefined
            // The pinned cells need a solid ground over what scrolls under them.
            const ground = on ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))' : isApp ? `color-mix(in srgb, ${APP.color} 7%, var(--surface))` : 'var(--surface)'
            // Members' results that MVP has, each short; none says so once.
            const members: ReactNode[] = []
            if (typeof b.approval === 'number') members.push(<span key="a" style={hl('approves')}>Approves <Dot c={b.approval >= 0.6 ? 'strong' : b.approval >= 0.35 ? 'fair' : 'weak'} small>{`${Math.round(b.approval * 100)}%`}</Dot></span>)
            if (typeof b.replies?.rate === 'number') members.push(<span key="r" style={hl('answers')} title={b.replies.days != null ? `Middle wait for an answer: about ${b.replies.days} days` : undefined}>Answers <Dot c={b.replies.rate >= 0.5 ? 'strong' : b.replies.rate >= 0.2 ? 'fair' : 'weak'} small>{`${Math.round(b.replies.rate * 100)}%${b.replies.days != null ? `, ${Math.round(b.replies.days)}d` : ''}`}</Dot></span>)
            if (typeof b.review?.reviewDays === 'number') members.push(<span key="d" style={hl('decides')}>Decides in {b.review.reviewDays}d</span>)
            return (
              <tr key={b.brand_id} className={`transition-colors hover:bg-[rgb(var(--brand-rgb)/0.04)]${onOpen ? ' cursor-pointer' : ''}`} onClick={onOpen?.(b.brand_id, b.name)} style={{ borderTop: '1px solid var(--border)', background: on ? 'rgb(var(--brand-rgb) / 0.06)' : isApp ? APP.soft : undefined, opacity: isTaken ? 0.62 : 1 }}>
                {!preview && (
                  <td className="pl-4 pr-1 py-2.5 align-top sticky left-0 z-[1]" style={{ ...edge, background: ground, width: 40, minWidth: 40, maxWidth: 40, boxSizing: 'border-box' }} data-own-click>
                    <input type="checkbox" className="w-4 h-4 mt-1.5" style={{ accentColor: 'var(--accent)' }} checked={on} disabled={isTaken} aria-label={`Pick ${b.name}`} onChange={(e) => onPick(b.brand_id, e.target.checked)} />
                  </td>
                )}
                {/* BRAND, with its MVP pick */}
                <td className="px-2.5 py-2.5 align-top" style={{ ...(preview ? edge : undefined), position: 'sticky', left: preview ? 0 : 40, zIndex: 1, background: ground, boxShadow: `${preview && edge ? `inset 3px 0 0 ${APP.color}, ` : ''}1px 0 0 var(--border)` }}>
                  <div className="flex items-start gap-2.5 min-w-0">
                    <BrandMark name={b.name} website={b.website} size={30} />
                    <div className="min-w-0 flex-1">
                      <BrandName id={b.brand_id} name={b.name} className="text-[13.5px] font-semibold block truncate" style={{ color: 'var(--text)', ...hl('brand') }} />
                      <span className="text-[11px] block truncate" style={muted}>
                        {isApp && !where ? <AppChip /> : where ? <span style={{ color: 'var(--accent-text, var(--accent))', fontWeight: 600 }}>{where}</span> : b.is_new ? <span style={{ color: 'var(--hot, #C2410C)', fontWeight: 600 }}>New on TRYBE</span> : (b.categories || []).slice(0, 2).join(', ')}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5" title={COLS[1].title}>
                        {typeof b.pick === 'number' ? (
                          <>
                            <span className="w-10 h-1.5 rounded-full overflow-hidden inline-block" style={{ background: 'var(--surface-2)' }}><span className="block h-full rounded-full" style={{ width: `${Math.max(6, Math.min(100, b.pick))}%`, background: b.pick >= 70 ? GRADE.strong.color : b.pick >= 45 ? GRADE.fair.color : GRADE.weak.color }} /></span>
                            <span className="text-[11.5px] font-bold" style={{ color: 'var(--text)', ...hl('pick') }}>{Math.round(b.pick)}</span>
                            <span className="text-[10.5px]" style={muted}>MVP pick</span>
                          </>
                        ) : <Unknown>MVP pick not read</Unknown>}
                      </span>
                    </div>
                  </div>
                </td>
                {/* PAY: a video, a month, paid out, retainer */}
                <td className="px-2.5 py-2.5 align-top">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span title={b.pay_text || undefined} style={hl('pay')}>
                      {b.pay_est?.dollars != null ? <><span className="font-bold" style={{ color: 'var(--text)' }}>${Math.round(b.pay_est.dollars)}</span> <span className="text-[11px]" style={muted}>a video</span></>
                        : b.pay_est?.short || b.pay_text ? <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{String(b.pay_est?.short || b.pay_text).slice(0, 26)}</span> : <Unknown>Pay not shown</Unknown>}
                    </span>
                    {b.retainer && <span title={retainerSource(b.retainer)} className={`inline-flex items-center rounded-full px-1.5 py-px text-[10.5px] ${b.retainer.source === 'terms' ? 'font-extrabold' : 'font-bold'} whitespace-nowrap`}
                      style={{ ...(b.retainer.source === 'terms' ? { background: '#F59E0B', color: '#1F1300' } : { border: '1.5px solid #F59E0B', color: 'var(--text)' }), ...(sort?.col === 'retainer' ? { boxShadow: '0 0 0 2px var(--accent)' } : {}) }}>{retainerCell(b.retainer)}</span>}
                  </div>
                  <div className={sub} style={muted}>
                    <span title={b.spend?.why || undefined} style={hl('month')}>{typeof b.spend?.dollars === 'number' ? <><span className="font-semibold" style={{ color: b.spend.dollars > 0 ? 'var(--text)' : 'var(--text-3)' }}>${Math.round(b.spend.dollars).toLocaleString()}</span> a month</> : 'A month not known'}</span>
                    <span title={proofTitle(b.evidence?.pays)} style={hl('paidOut')}>{b.earnings_bucket ? <>Paid out <span className="font-semibold" style={{ color: 'var(--text)' }}>{b.earnings_bucket}</span>{b.tier_up && <ArrowUpRight size={11} className="inline -mt-0.5" style={{ color: GRADE.strong.color }} aria-label="Went up lately" />}</> : 'Paid out not shown'}</span>
                  </div>
                </td>
                {/* ADS AND REACH: Meta ads, Top 100, TikTok Shop */}
                <td className="px-2.5 py-2.5 align-top">
                  <div title={proofTitle(b.evidence?.ads)} style={hl('meta')}>
                    {meta != null ? <><span className="font-bold" style={{ color: meta > 0 ? 'var(--text)' : 'var(--text-3)' }}>{meta}</span> <span className="text-[11px]" style={muted}>Meta ads</span></>
                      : typeof b.meta_ads === 'number' && b.meta_fresh ? <Unknown>Meta ads unclear</Unknown> : <Unknown>Meta ads not counted</Unknown>}
                  </div>
                  <div className={sub} style={muted}>
                    <span style={hl('top100')}>{typeof b.top100_hits === 'number' && b.top100_hits > 0 ? <span className="inline-flex items-center gap-0.5"><Trophy size={11} style={{ color: '#F59E0B' }} /><span className="font-semibold" style={{ color: 'var(--text)' }}>{b.top100_hits}</span> in Top 100</span> : 'Not in Top 100'}</span>
                    {/* Not on TikTok Shop is the better side for a creator: less competition. */}
                    <span style={hl('tiktok')}>{b.tiktok_shop === false ? <Dot c="strong" small>Not on TikTok Shop</Dot> : b.tiktok_shop === true ? <Dot c="fair" small>On TikTok Shop</Dot> : 'TikTok Shop not checked'}</span>
                  </div>
                </td>
                {/* ROOM AND CREATORS: room and pay, rating, samples, members' results */}
                <td className="px-2.5 py-2.5 pr-4 align-top">
                  <div style={hl('room')}>
                    {b.room_pay?.words && b.room_pay.tone ? <span title={b.room_pay.why}><Dot c={b.room_pay.tone}>{b.room_pay.words}</Dot></span>
                      : b.crowd?.level ? <span title={b.room_pay?.why || b.crowd.why}><Dot c={b.crowd.level === 'open' ? 'strong' : b.crowd.level === 'filling' ? 'fair' : 'weak'}>{b.crowd.level === 'open' ? 'Open' : b.crowd.level === 'filling' ? 'Filling' : 'Crowded'}</Dot></span> : <Unknown>Room not known</Unknown>}
                  </div>
                  <div className={sub} style={muted}>
                    <span style={hl('rating')}>{typeof b.review_rating === 'number' ? <><span className="font-semibold" style={{ color: 'var(--text)' }}>{b.review_rating.toFixed(1)}</span>{'★'} ({b.review_count ?? 0})</> : 'No rating'}</span>
                    <span style={hl('samples')}>{isApp ? <span title={b.proof?.samples}>App, none needed</span> : b.stats?.samples === true ? <Dot c="strong" small>Samples</Dot> : b.stats?.samples === false ? <Dot c="weak" small>No samples</Dot> : 'Samples not known'}</span>
                    {members.length ? members : <span>Members&rsquo; results not yet</span>}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </div>
  )
}

/** A retainer in a table cell: smart or standard when its words say, its
 *  amount and videos from TRYBE's terms, or that the brand only mentions one. */
function retainerCell(r: { amount: number | null; videos: number | null; source?: string; kind?: 'smart' | 'standard' | null }): string {
  const name = r.kind === 'smart' ? 'Smart retainer' : r.kind === 'standard' ? 'Standard retainer' : 'Retainer'
  if (r.source !== 'terms') return r.kind ? 'Mentions ' + name.toLowerCase() : 'Mentions retainers'
  return typeof r.amount === 'number' ? name + ' $' + Math.round(r.amount).toLocaleString() + (r.videos ? ' for ' + r.videos : '') : name
}

function Dot({ c, children, small = false }: { c: 'strong' | 'fair' | 'weak'; children: string; small?: boolean }) {
  return <span className={`inline-flex items-center ${small ? 'gap-1 text-[11.5px]' : 'gap-1.5 text-[12.5px]'} font-semibold`} style={{ color: 'var(--text)' }}><span aria-hidden="true" className={`${small ? 'w-1.5 h-1.5' : 'w-2 h-2'} rounded-full`} style={{ background: GRADE[c].color }} />{children}</span>
}
