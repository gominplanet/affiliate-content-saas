'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NOT ON TRYBE'S DISCOVER LIST, What changed's third view (Seb, 2026-10-17:
// "do ... ten", after TrybeDaily's "Not in public catalogue"). Two kinds, each
// said for what it is: brands MVP's last whole read of TRYBE's list did not
// have, and brands TRYBE itself marks as not listed. Nobody finds them on
// Discover, so Find brands leaves them out; here they are in one place, with
// where each stands on your list. A read that failed says so.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, EyeOff } from 'lucide-react'
import TrybeLink from '@/components/labs/TrybeLink'
import { BrandMark } from '@/components/labs/TrybeFinderControls'
import { readJoinedBrandIds } from '@/lib/trybe-joined'

const PURPLE = '#7C3AED'
const AMBER = '#B45309'
const RED = '#DC2626'
const SHOWN = 40

interface OffBrand { brand_id: string; name: string; website: string | null; categories: string[] | null; pay_text: string | null; left_at: string | null; last_seen_at: string | null; total_creators: number | null; reason: 'left' | 'unlisted'; status: string | null }
interface OffRead { joinedRead?: boolean; healed?: number; leftCount: number | null; unlistedCount: number | null; unlistedError: string | null; lastCollectedAt: string | null; brands: OffBrand[] }

const STATUS_WORDS: Record<string, string> = { drafted: 'In your Ready to send', sending: 'Sending', sent: 'You asked', already: 'You asked', failed: 'Your send failed', skipped: 'You passed', removed: 'You removed it', not_fit: 'Not a fit', new: 'On your list' }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

export default function TrybeOffDiscover({ scoutOpens }: { scoutOpens: boolean }) {
  const [data, setData] = useState<OffRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'left' | 'unlisted' | 'mine'>('all')
  const [limit, setLimit] = useState(SHOWN)

  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        // Your joined brands, read live, clear any false "gone" first (as What changed does).
        const joined = scoutOpens ? await readJoinedBrandIds() : null
        const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'off_discover', ...(joined ? { joined } : {}) }), signal: AbortSignal.timeout(45_000) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
        if (!gone) setData({ ...(d as OffRead), joinedRead: !!joined })
      } catch (e) { if (!gone) setError(e instanceof Error ? e.message : 'MVP could not read the brands off TRYBE’s Discover list.') }
    })()
    return () => { gone = true }
  }, [scoutOpens])

  const mine = useMemo(() => (data?.brands || []).filter((b) => b.status && b.status !== 'removed'), [data])
  const shown = useMemo(() => (data?.brands || []).filter((b) => show === 'all' || (show === 'mine' ? !!b.status && b.status !== 'removed' : b.reason === show)), [data, show])
  const soft = { color: 'var(--text-soft)' }
  const chip = (on: boolean) => ({ className: 'rounded-full px-3 py-1 text-[12.5px] font-semibold border', style: on ? { background: 'rgba(124,58,237,0.10)', color: PURPLE, borderColor: 'transparent' } : { borderColor: 'var(--border)', color: 'var(--text)' } })

  if (error) return <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
  if (!data) return <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading the brands off TRYBE&rsquo;s Discover list...</p>

  const leftN = data.leftCount ?? data.brands.filter((b) => b.reason === 'left').length
  const unlistedN = data.unlistedCount
  return (
    <section className="space-y-3" aria-label="Not on TRYBE's Discover list">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[20px] font-bold tracking-tight inline-flex items-center gap-2"><EyeOff size={18} style={{ color: PURPLE }} /> Not on TRYBE&rsquo;s Discover list</h3>
        {data.lastCollectedAt && <span className="ml-auto text-[12px]" style={soft}>MVP&rsquo;s last whole read of TRYBE: {new Date(data.lastCollectedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
      </div>
      <p className="text-[13px]" style={soft}>
        Creators cannot find these on TRYBE&rsquo;s Discover, so Find brands leaves them out. Some left TRYBE; some are only hidden from Discover.{' '}
        {data.joinedRead ? 'The brands you joined were checked against your own TRYBE first, so none of them shows here by mistake.' : 'MVP could not read the brands you joined on TRYBE this time, so one of them may show here by mistake: TRYBE leaves joined brands out of your Discover list.'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Tile label="Gone from the list" n={leftN} sub="Not in MVP's last whole read of TRYBE's list" tone={RED} />
        <Tile label="Marked not listed" n={unlistedN} sub={data.unlistedError ? 'MVP could not check this just now' : 'TRYBE marks them as not shown on Discover'} tone={AMBER} />
        <Tile label="On your list" n={mine.length} sub="Brands here you asked, wrote to or keep" tone={PURPLE} />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        <button onClick={() => { setShow('all'); setLimit(SHOWN) }} aria-pressed={show === 'all'} {...chip(show === 'all')}>All {data.brands.length}</button>
        <button onClick={() => { setShow('left'); setLimit(SHOWN) }} aria-pressed={show === 'left'} {...chip(show === 'left')}>Gone from the list</button>
        <button onClick={() => { setShow('unlisted'); setLimit(SHOWN) }} aria-pressed={show === 'unlisted'} {...chip(show === 'unlisted')}>Marked not listed</button>
        <button onClick={() => { setShow('mine'); setLimit(SHOWN) }} aria-pressed={show === 'mine'} {...chip(show === 'mine')}>On your list ({mine.length})</button>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-2xl border p-5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)', ...soft }}>
          {data.brands.length === 0 ? (data.lastCollectedAt ? 'Every brand MVP knows was on TRYBE’s Discover list at its last whole read.' : 'MVP has not finished a whole read of TRYBE’s list yet, so it cannot tell which brands left it.') : 'None of this kind.'}
        </div>
      ) : (
        <ul className="rounded-2xl border divide-y overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {shown.slice(0, limit).map((b) => (
            <li key={b.brand_id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ borderColor: 'var(--border)' }}>
              <BrandMark name={b.name} website={b.website} size={32} />
              <span className="min-w-0 flex-1">
                <span className="text-[13.5px] font-semibold">{b.name}</span>
                {b.status && STATUS_WORDS[b.status] && <span className="ml-2 text-[10.5px] font-bold rounded-full px-1.5 py-0.5 align-middle" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{STATUS_WORDS[b.status]}</span>}
                <span className="block text-[12.5px]" style={{ color: b.reason === 'left' ? RED : AMBER }}>
                  {b.reason === 'left' ? `Gone from TRYBE's list since ${when(b.left_at)}` : 'TRYBE marks it as not listed on Discover'}
                  <span style={soft}>{[b.pay_text, b.categories?.slice(0, 2).join(', ')].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                </span>
              </span>
              <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && <button onClick={() => setLimit((n) => n + 100)} className="text-[13px] font-semibold" style={{ color: PURPLE }}>Show more ({shown.length - limit} left)</button>}
    </section>
  )
}

function Tile({ label, n, sub, tone }: { label: string; n: number | null; sub: string; tone: string }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderTopWidth: 3, borderTopColor: tone }}>
      <p className="text-[12px] font-semibold" style={{ color: 'var(--text-soft)' }}>{label}</p>
      <p className="text-[26px] font-bold leading-tight tabular-nums" style={{ color: n ? tone : 'var(--text-soft)' }}>{n == null ? 'Not read' : n.toLocaleString()}</p>
      <p className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>{sub}</p>
    </div>
  )
}
