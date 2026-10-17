'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MOST ACTIVE BRANDS, What changed's second view (Seb, 2026-10-17: "do one",
// after TrybeDaily's Today). The brands creators are joining fastest, from
// MVP's own daily copies of TRYBE's list (lib/trybe-active), with TRYBE's
// payout range, its Top 100 videos and Meta ads next to each. TRYBE's list
// carries no count of a brand's posts, so the board says what it ranks by and
// over how many days, and a board MVP cannot work out yet says why.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, ChevronDown, Users, TrendingUp } from 'lucide-react'
import TrybeLink from '@/components/labs/TrybeLink'
import TrybeBrandPeek, { type PeekActions } from '@/components/labs/TrybeBrandPeek'
import { BrandMark, PaidOutChip } from '@/components/labs/TrybeFinderControls'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const SHOWN = 25

interface ActiveBrand {
  brand_id: string; name: string; website: string | null; categories: string[]; pay_text: string | null
  creators: number | null; joined: number | null; joinedDay: number | null; videos: number | null; videosDay: number | null
  earnings_bucket: string | null; tier_up: { before: string | null; after: string | null } | null
  top100_hits: number | null; top100_best_rank: number | null; meta_ads: number | null; status: string | null
}
interface Board { by: 'videos' | 'creators'; days: number | null; latest: string | null; hasDay: boolean; copies: number; since: string | null; brands: ActiveBrand[]; categories: Array<{ name: string; n: number }> }

const STATUS_WORDS: Record<string, string> = { drafted: 'In Ready to send', sending: 'Sending', sent: 'You asked', already: 'You asked', failed: 'Send failed', skipped: 'You passed', removed: 'You removed it', not_fit: 'Not a fit', new: 'On your list' }
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

export default function TrybeActive({ scoutOpens, actions }: { scoutOpens: boolean; actions?: PeekActions }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cat, setCat] = useState<string | null>(null)
  const [limit, setLimit] = useState(SHOWN)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'active' }), signal: AbortSignal.timeout(60_000) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
        if (!gone) setBoard(d as Board)
      } catch (e) { if (!gone) setError(e instanceof Error ? e.message : 'MVP could not work out the most active brands.') }
    })()
    return () => { gone = true }
  }, [])

  const shown = useMemo(() => (board?.brands || []).filter((b) => !cat || b.categories.some((c) => c.toLowerCase() === cat.toLowerCase())), [board, cat])
  const soft = { color: 'var(--text-soft)' }
  const chip = (on: boolean) => ({ className: 'rounded-full px-3 py-1 text-[12.5px] font-semibold border whitespace-nowrap', style: on ? { background: 'rgba(124,58,237,0.10)', color: PURPLE, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' } })

  if (error) return <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
  if (!board) return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Working out the most active brands from MVP&rsquo;s daily copies of TRYBE...</p>

  const measure = board.by === 'videos' ? 'videos approved' : 'creators who joined'
  const windowWords = board.days ? `in the last ${board.days} day${board.days === 1 ? '' : 's'}` : ''

  return (
    <section className="space-y-3" aria-label="Most active brands">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[20px] font-bold tracking-tight">Most active brands</h3>
        {board.brands.length > 0 && <span className="text-[12px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{board.brands.length} brands</span>}
        {board.latest && <span className="ml-auto text-[12px]" style={soft}>From MVP&rsquo;s copy of TRYBE&rsquo;s list on {day(board.latest)}</span>}
      </div>
      <p className="text-[13px]" style={soft}>
        Ranked by {measure} {windowWords || 'since the day before'}, from MVP&rsquo;s own daily copies of TRYBE&rsquo;s list{board.since ? ` (kept since ${day(board.since)})` : ''}.
        {board.by === 'creators' ? ' TRYBE’s list does not give a brand’s posts, so the brands creators are joining fastest lead.' : ''}
        {board.days != null && board.days < 30 ? ` The window grows to 30 days as MVP keeps more copies.` : ''}
      </p>

      {board.brands.length === 0 ? (
        <div className="rounded-2xl border p-5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', ...soft }}>
          {board.copies < 2
            ? 'MVP needs two daily copies of TRYBE’s list to see which brands creators are joining. The next full read of TRYBE adds one.'
            : 'No brand gained creators between MVP’s copies of TRYBE’s list yet. The board fills in as the copies differ.'}
        </div>
      ) : (<>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          <button onClick={() => { setCat(null); setLimit(SHOWN) }} aria-pressed={!cat} {...chip(!cat)}>All {board.brands.length}</button>
          {board.categories.slice(0, 14).map((c) => (
            <button key={c.name} onClick={() => { setCat(cat === c.name ? null : c.name); setLimit(SHOWN) }} aria-pressed={cat === c.name} {...chip(cat === c.name)}>{c.name} <span className="tabular-nums" style={soft}>{c.n}</span></button>
          ))}
        </div>
        <ol className="space-y-2">
          {shown.slice(0, limit).map((b) => {
            const rank = board.brands.indexOf(b) + 1
            const moved = board.by === 'videos' ? b.videos : b.joined
            const movedDay = board.by === 'videos' ? b.videosDay : b.joinedDay
            return (
              <li key={b.brand_id} className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[12.5px] font-bold tabular-nums shrink-0" style={rank <= 3 ? { background: PURPLE, color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-2)' }}>{rank}</span>
                  <BrandMark name={b.name} website={b.website} size={38} />
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-[14.5px] font-semibold leading-tight flex flex-wrap items-center gap-1.5">
                      {b.name}
                      {b.status && STATUS_WORDS[b.status] && <span className="text-[10.5px] font-bold rounded-full px-1.5 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{STATUS_WORDS[b.status]}</span>}
                    </p>
                    {b.categories.length > 0 && <p className="text-[12px]" style={soft}>{b.categories.slice(0, 2).join(' · ')}</p>}
                    {b.pay_text && <p className="text-[12.5px] font-semibold mt-0.5" style={{ color: PURPLE }}>{b.pay_text}</p>}
                  </div>
                  <div className="text-left sm:text-right min-w-[7.5rem]">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={soft}>{board.by === 'videos' ? 'Videos' : 'Creators joined'}{board.days ? ` · ${board.days}d` : ''}</p>
                    <p className="text-[18px] font-bold tabular-nums inline-flex items-center gap-1" style={{ color: GREEN }}><TrendingUp size={14} />+{(moved ?? 0).toLocaleString()}</p>
                    {board.hasDay && movedDay != null && <p className="text-[11.5px] tabular-nums" style={soft}>{movedDay ? `+${movedDay.toLocaleString()} since the day before` : 'none since the day before'}</p>}
                  </div>
                  <div className="text-left sm:text-right min-w-[6rem]">
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={soft}>Creators</p>
                    <p className="text-[16px] font-bold tabular-nums inline-flex items-center gap-1"><Users size={13} style={soft} />{b.creators != null ? b.creators.toLocaleString() : '?'}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:pl-11">
                  <PaidOutChip bucket={b.earnings_bucket} up={b.tier_up} />
                  {b.top100_hits != null && b.top100_hits > 0 && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}>{b.top100_hits} in TRYBE&rsquo;s Top 100{b.top100_best_rank ? ` (best #${b.top100_best_rank})` : ''}</span>}
                  {b.meta_ads != null && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{b.meta_ads.toLocaleString()} Meta ad{b.meta_ads === 1 ? '' : 's'} running</span>}
                  <span className="ml-auto inline-flex items-center gap-3">
                    <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
                    <button onClick={() => setOpen(open === b.brand_id ? null : b.brand_id)} aria-expanded={open === b.brand_id} className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
                      {open === b.brand_id ? 'Hide' : actions ? 'Details and message' : 'Details'} <ChevronDown size={13} className={open === b.brand_id ? 'rotate-180' : ''} />
                    </button>
                  </span>
                </div>
                {open === b.brand_id && <div className="mt-2"><TrybeBrandPeek brandId={b.brand_id} name={b.name} actions={actions} /></div>}
              </li>
            )
          })}
        </ol>
        {shown.length > limit && <button onClick={() => setLimit((n) => n + 50)} className="text-[13px] font-semibold" style={{ color: PURPLE }}>Show more ({shown.length - limit} left)</button>}
      </>)}
    </section>
  )
}
