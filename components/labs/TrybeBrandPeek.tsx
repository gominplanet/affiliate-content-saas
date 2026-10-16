'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE BRAND, OPENED WHERE YOU SAW IT (Seb, 2026-10-16: "we should be able to
// see more details on these brands here too.. and also send or queue
// messages from here as well"). What changed and Best new brands open a brand
// with the same details Find brands shows (action 'browse' by id), and write
// it a message into Ready to send, or send the one already written, with the
// same steps Find brands and Ready to send use. Messages never talk rates:
// the draft is the creator's own core message, as everywhere else.
//
// What it shows is what happened: a brand TRYBE no longer lists says so, a
// failed read says so, and the button reads where the brand stands now
// (Ready to send, Sent, Already requested), never the plan.

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, MessageCircle, Send, Globe, ExternalLink, ArrowRight } from 'lucide-react'
import { BrandExtras, PayChip, CrowdChip, NewChip, StaticsChip, SellsChip, VerdictChip, ReviewChip, type LiveAmazon, type LivePayEst } from '@/components/labs/TrybeFinderControls'
import { adLibraryUrl, type PickReason } from '@/lib/trybe-pick'
import type { DirStats, CrowdRead } from '@/lib/trybe-finder'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

/** Where a brand stands on your list (trybe_brands.status). */
export type PeekStatus = 'new' | 'not_fit' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already' | 'removed'

/** What the page around it lets you do. Absent: details only (the Amazon plan's preview). */
export interface PeekActions {
  /** Your list as the page holds it now: status and the written message. */
  mineOf: (brandId: string) => { status: PeekStatus; draft: string | null } | null
  /** Write this brand a message into Ready to send. */
  message: (brandId: string) => Promise<void>
  /** Send the message already in Ready to send, now. */
  send: (brandId: string) => Promise<void>
  /** Go to Ready to send (to read or edit it) or Sent. */
  openList: (where: 'queue' | 'sent') => void
  /** Something else is running (a send, a draft): buttons wait. */
  busy: boolean
  /** Why sending cannot start (SCOUT not allowed), else null. */
  sendBlocked: string | null
}

interface PeekBrand {
  brand_id: string; name: string; website: string | null; categories: string[]; about: string | null
  pay_text: string | null; trybe_score: number | null; total_creators: number | null
  products: string[]; status: PeekStatus | null
  pick?: number; pick_reasons?: PickReason[]; pick_read?: number
  amazon?: LiveAmazon | null; stats?: DirStats | null
  pay_est?: LivePayEst | null; crowd?: CrowdRead | null; is_new?: boolean; statics?: boolean | null
  review?: { reviewDays: number | null; slowShare: number | null } | null
  sells?: import('@/lib/trybe-sells').SellsRead | null
}

// Read once per page visit; a failed read is tried again next time.
const cache = new Map<string, Promise<PeekBrand | null>>()
function readBrand(id: string): Promise<PeekBrand | null> {
  let p = cache.get(id)
  if (!p) {
    p = fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ action: 'browse', ids: [id], categories: [], keywords: [], sort: 'picks', limit: 1, includeMine: true }) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
        return ((d.brands || []) as PeekBrand[]).find((b) => b.brand_id === id) ?? null
      })
    cache.set(id, p)
    p.catch(() => cache.delete(id))
  }
  return p
}

const WHERE: Partial<Record<PeekStatus, { text: string; color: string }>> = {
  drafted: { text: 'In Ready to send', color: PURPLE },
  sending: { text: 'Sending, or not confirmed yet', color: AMBER },
  sent: { text: 'Sent', color: GREEN },
  already: { text: 'Already requested on TRYBE', color: GREEN },
  failed: { text: 'Last send failed', color: RED },
  skipped: { text: 'You passed on it', color: 'var(--text-soft)' },
  removed: { text: 'You removed it', color: 'var(--text-soft)' },
}

export default function TrybeBrandPeek({ brandId, name, actions }: { brandId: string; name: string; actions?: PeekActions }) {
  const [brand, setBrand] = useState<PeekBrand | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [doing, setDoing] = useState<'message' | 'send' | null>(null)

  useEffect(() => {
    let live = true
    setBrand(undefined); setError(null)
    readBrand(brandId).then((b) => { if (live) setBrand(b) }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'MVP could not read this brand.') })
    return () => { live = false }
  }, [brandId])

  const soft = { color: 'var(--text-soft)' }
  const box = 'mt-2 rounded-xl border px-3.5 py-3 space-y-2'
  const boxStyle = { borderColor: 'var(--border)', background: 'rgba(124,58,237,0.03)' }
  if (error) return <div className={box} style={boxStyle}><p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Could not read {name}: {error}</p></div>
  if (brand === undefined) return <div className={box} style={boxStyle}><p className="text-[12.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading {name}&rsquo;s details...</p></div>
  if (!brand) {
    return (
      <div className={box} style={boxStyle}>
        <p className="text-[12.5px]" style={soft}>TRYBE no longer lists {name} on the latest read of its brand list, so it cannot be messaged. If it comes back, it shows here as back on TRYBE.</p>
      </div>
    )
  }

  const mine = actions?.mineOf(brand.brand_id) ?? null
  const status: PeekStatus | null = mine?.status ?? brand.status
  const where = status ? WHERE[status] : undefined
  const canWrite = !status || status === 'new' || status === 'not_fit'
  const run = async (what: 'message' | 'send') => {
    if (!actions) return
    setDoing(what)
    try { await (what === 'message' ? actions.message(brand.brand_id) : actions.send(brand.brand_id)) } finally { setDoing(null) }
  }
  const btn = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50'
  const reasons = (brand.pick_reasons || []).slice(0, 6)

  return (
    <div className={box} style={boxStyle}>
      <div className="flex flex-wrap items-center gap-1.5">
        <NewChip on={brand.is_new} />
        <VerdictChip score={brand.pick} read={brand.pick_read} />
        <CrowdChip crowd={brand.crowd} />
        <PayChip est={brand.pay_est} payText={brand.pay_text} />
        <ReviewChip review={brand.review} />
        <StaticsChip on={brand.statics} />
        <SellsChip sells={brand.sells} />
        {brand.trybe_score != null && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }} title="TRYBE's own rating of this brand, as shown on TRYBE.">TRYBE score {brand.trybe_score}</span>}
        {brand.total_creators != null && <span className="text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>{brand.total_creators.toLocaleString()} creator{brand.total_creators === 1 ? '' : 's'}</span>}
      </div>
      <BrandExtras amazon={brand.amazon} stats={brand.stats} />
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <span key={r.text} className="text-[11px] rounded-md px-2 py-0.5" style={r.tone === 'good' ? { background: 'rgba(22,163,74,0.10)', color: GREEN } : r.tone === 'bad' ? { background: 'rgba(220,38,38,0.08)', color: RED } : { background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>{r.text}</span>
          ))}
        </div>
      )}
      {brand.about && <p className="text-[12.5px] line-clamp-3" style={soft}>{brand.about}</p>}
      {brand.products.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {brand.products.map((pr) => <span key={pr} className="text-[11px] rounded-md border px-2 py-0.5 max-w-[16rem] truncate" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>{pr}</span>)}
        </div>
      )}
      {brand.categories.length > 0 && <p className="text-[11.5px]" style={soft}>{brand.categories.join(' • ')}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={adLibraryUrl(brand.name)} target="_blank" rel="noopener noreferrer" className="text-[12px] inline-flex items-center gap-0.5" style={soft} title="Its ads in Meta's Ad Library">Meta ads <ExternalLink size={10} /></a>
        {brand.website && <a href={brand.website} target="_blank" rel="noopener noreferrer" className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
      </div>

      {/* Where it stands, and the one next step from here. */}
      {actions && (
        <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
          {where && <p className="text-[12.5px] font-semibold" style={{ color: where.color }}>{where.text}</p>}
          {status === 'drafted' && mine?.draft && <p className="text-[12.5px] whitespace-pre-line rounded-lg border px-3 py-2 max-h-40 overflow-y-auto" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>{mine.draft}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <button onClick={() => void run('message')} disabled={actions.busy || !!doing} className={btn} style={{ border: `1px solid ${PURPLE}`, color: PURPLE }}
                title={actions.busy ? 'Busy with another send or draft. This unlocks when it finishes.' : 'Write this brand a message from your core message, into Ready to send'}>
                {doing === 'message' ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />} Write a message
              </button>
            )}
            {(status === 'drafted' || status === 'failed') && (
              <button onClick={() => void run('send')} disabled={actions.busy || !!doing || !!actions.sendBlocked} className={btn} style={{ background: PURPLE, color: '#fff' }}
                title={actions.sendBlocked || (actions.busy ? 'Busy with another send or draft. This unlocks when it finishes.' : 'SCOUT sends this message on TRYBE now. It counts toward your daily sends.')}>
                {doing === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send now
              </button>
            )}
            {(status === 'drafted' || status === 'failed' || status === 'sending') && (
              <button onClick={() => actions.openList(status === 'drafted' ? 'queue' : 'sent')} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
                {status === 'drafted' ? 'Edit in Ready to send' : 'See it in Sent'} <ArrowRight size={12} />
              </button>
            )}
            {actions.sendBlocked && (status === 'drafted' || status === 'failed') && <span className="text-[12px]" style={{ color: AMBER }}>{actions.sendBlocked}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
