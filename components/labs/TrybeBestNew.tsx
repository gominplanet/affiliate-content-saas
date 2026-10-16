'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BEST NEW BRANDS (Huntr's "Today's Hunt"; Seb 2026-10-14: "do
// 1,2,3,4,5"). At the top of What changed: the brands new on TRYBE, ranked by
// Best bets with your priorities, five at a time. The same search as Find
// brands (action 'browse', New only, Best bets), so the two never disagree.
// A failed read says so, never "no new brands".

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, AlertTriangle, ChevronDown } from 'lucide-react'
import TrybeLink from '@/components/labs/TrybeLink'
import TrybeBrandPeek, { type PeekActions } from '@/components/labs/TrybeBrandPeek'
import { VerdictChip, CrowdChip, PayChip, type LivePayEst } from '@/components/labs/TrybeFinderControls'
import type { CrowdRead } from '@/lib/trybe-finder'
import type { PickReason } from '@/lib/trybe-pick'

const PURPLE = '#7C3AED'
const AMBER = '#B45309'

interface NewBrand { brand_id: string; name: string; pick?: number; pick_read?: number; pick_reasons?: PickReason[]; crowd?: CrowdRead | null; pay_est?: LivePayEst | null; pay_text?: string | null; categories?: string[] }

export default function TrybeBestNew({ scoutOpens, onSeeAll, actions }: { scoutOpens: boolean; onSeeAll?: () => void; actions?: PeekActions }) {
  const [open, setOpen] = useState<string | null>(null)
  const [list, setList] = useState<NewBrand[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({ action: 'browse', categories: [], keywords: [], sort: 'picks', limit: 5, filters: { newOnly: true } }) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
        if (!gone) { setList((d.brands || []) as NewBrand[]); setTotal(Number(d.matched) || 0) }
      } catch (e) { if (!gone) setError(e instanceof Error ? e.message : 'MVP could not read the new brands.') }
    })()
    return () => { gone = true }
  }, [])

  const soft = { color: 'var(--text-soft)' }
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} aria-label="Best new brands">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Sparkles size={15} style={{ color: PURPLE }} />
        <p className="text-[14px] font-bold flex-1 min-w-[12rem]">Best new brands on TRYBE</p>
        {onSeeAll && total > 0 && <button onClick={onSeeAll} className="text-[12.5px] font-semibold underline" style={{ color: PURPLE }}>See all {total.toLocaleString()} new</button>}
      </div>
      <p className="text-[12px] mb-2" style={soft}>New in the last weeks, ranked by Best bets with Your priorities. Getting in early is how you become a brand&rsquo;s top creator.</p>
      {error && <p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}</p>}
      {!error && !list && <p className="text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Ranking the new brands...</p>}
      {list && list.length === 0 && <p className="text-[12.5px]" style={soft}>No new brands on TRYBE that you have not already messaged. MVP checks again with every read of TRYBE&rsquo;s list.</p>}
      {list && list.length > 0 && (
        <ol className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {list.map((b, i) => {
            const why = (b.pick_reasons || []).find((r) => r.tone === 'good')?.text
            return (
              <li key={b.brand_id} className="py-2 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[12px] font-bold tabular-nums w-4" style={soft}>{i + 1}</span>
                <span className="text-[13.5px] font-semibold">{b.name}</span>
                <VerdictChip score={b.pick} read={b.pick_read} />
                <CrowdChip crowd={b.crowd} />
                <PayChip est={b.pay_est} payText={b.pay_text} />
                <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
                <button onClick={() => setOpen(open === b.brand_id ? null : b.brand_id)} aria-expanded={open === b.brand_id} className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
                  {open === b.brand_id ? 'Hide' : actions ? 'Details and message' : 'Details'} <ChevronDown size={13} className={open === b.brand_id ? 'rotate-180' : ''} />
                </button>
                {why && <span className="basis-full pl-6 text-[12px]" style={soft}>{why}</span>}
                {open === b.brand_id && <div className="basis-full pl-6"><TrybeBrandPeek brandId={b.brand_id} name={b.name} actions={actions} /></div>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
