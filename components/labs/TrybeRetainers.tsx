'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// RETAINERS, in My brands (Seb, 2026-10-14: "build 1, 2, 3, and 4"; Colin
// Reich's smart retainer). From your last 30 days on TRYBE (read through
// SCOUT): the brands ready for you to ask, a draft of the ask from your real
// numbers that YOU send (copy, never sent by MVP), and once a brand says yes,
// the deal tracked: videos due, days left, the top up (lib/trybe-retainer).
// A read that failed says so, never "no brand is ready".

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Handshake, Loader2, Copy, Check, X, AlertTriangle } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats } from '@/lib/trybe-mybrands'
import { readBrandSubs } from '@/components/labs/TrybeMyBrands'
import { rememberMvpText } from '@/components/labs/useTrybeVoice'
import TrybeLink from '@/components/labs/TrybeLink'
import { retainerReady, suggestAmount, retainerAsk, trackRetainer, type Brand30, type Retainer, type RetainerKind } from '@/lib/trybe-retainer'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(d.error || `Request failed (${r.status})`), { needsMigration: !!d.needsMigration })
  return d
}

export default function TrybeRetainers({ canRead, scoutOpens }: { canRead: boolean; scoutOpens: boolean }) {
  const [b30, setB30] = useState<Brand30[] | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [deals, setDeals] = useState<Retainer[] | null>(null)
  const [dealError, setDealError] = useState<string | null>(null)
  const [sentSince, setSentSince] = useState<Record<string, number | null>>({})
  const [drafting, setDrafting] = useState<string | null>(null)

  useEffect(() => {
    if (!canRead) return
    let gone = false
    requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=30d').then((r) => {
      if (gone) return
      if (!r.ok) { setReadError('MVP could not read your last 30 days from TRYBE, so it cannot say which brands are ready for a retainer.'); return }
      setB30(readBrandStats(r.json).map((b) => ({ id: b.id, name: b.name, submitted: b.submitted, approved: b.approved, earnings: b.earnings })))
    }).catch(() => { if (!gone) setReadError('MVP could not read your last 30 days from TRYBE.') })
    api({ action: 'retainers' }).then((d) => { if (!gone) setDeals(d.retainers || []) }).catch((e) => { if (!gone) setDealError(e.message) })
    return () => { gone = true }
  }, [canRead])

  // Videos sent since each tracked retainer started, from that brand's submissions.
  useEffect(() => {
    if (!canRead || !deals?.length) return
    let gone = false
    ;(async () => {
      for (const d of deals) {
        if (sentSince[d.brandId] !== undefined) continue
        const s = await readBrandSubs(d.brandId).catch(() => null)
        if (gone) return
        const start = Date.parse(d.startedAt)
        setSentSince((m) => ({ ...m, [d.brandId]: s && !s.error && s.complete ? s.subs.filter((x) => x.at != null && (x.at as number) >= start).length : null }))
      }
    })()
    return () => { gone = true }
  }, [canRead, deals]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (r: Retainer) => {
    try { const d = await api({ action: 'retainer_save', retainer: r }); setDeals(d.retainers || []); setDrafting(null); toast.success(`Tracking your retainer with ${r.name}.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Not saved.') }
  }, [])
  const remove = useCallback(async (id: string) => {
    try { const d = await api({ action: 'retainer_remove', brandId: id }); setDeals(d.retainers || []) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Not removed.') }
  }, [])

  if (!canRead) return null
  const soft = { color: 'var(--text-soft)' }
  const tracked = new Set((deals || []).map((d) => d.brandId))
  const ready = (b30 || []).filter((b) => !tracked.has(b.id) && retainerReady(b).ready)
  const close = (b30 || []).filter((b) => !tracked.has(b.id) && !retainerReady(b).ready && (b.earnings ?? 0) > 0 && (b.submitted ?? 0) >= 12)
    .sort((a, b) => (b.submitted ?? 0) - (a.submitted ?? 0)).slice(0, 2)
  const of30 = (id: string) => (b30 || []).find((b) => b.id === id) || null

  return (
    <section className="rounded-xl border p-3.5 mb-4" style={{ borderColor: 'var(--border-2, var(--border))', background: 'var(--surface)' }} aria-label="Retainers">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}><Handshake size={16} /></span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[14.5px] font-bold leading-tight">Retainers</p>
          <p className="text-[12px]" style={soft}>After a month of steady videos for a brand that pays you, ask for a retainer: a set amount for a set number of videos. MVP drafts the ask; you send it.</p>
        </div>
      </div>

      {readError && <p className="text-[12.5px] mt-2 inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" />{readError}</p>}
      {dealError && <p className="text-[12.5px] mt-2" style={{ color: AMBER }}>{dealError}</p>}
      {!b30 && !readError && <p className="text-[12.5px] mt-2 inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your last 30 days on TRYBE...</p>}

      {/* Deals you track. */}
      {(deals || []).map((d) => {
        const t = trackRetainer(d, { sentSince: sentSince[d.brandId] ?? null, earned30: of30(d.brandId)?.earnings ?? null })
        return (
          <div key={d.brandId} className="mt-2 rounded-lg px-3 py-2" style={{ background: 'rgba(22,163,74,0.07)' }}>
            <p className="text-[13px] font-semibold flex flex-wrap items-center gap-2">
              {d.name}: ${d.amount.toLocaleString('en-US')} for {d.videos} videos ({d.kind === 'smart' ? 'smart retainer' : 'retainer'})
              <button onClick={() => void remove(d.brandId)} className="ml-auto text-[11.5px] font-normal inline-flex items-center gap-0.5 underline" style={soft}><X size={11} /> Stop tracking</button>
            </p>
            <p className="text-[12.5px]" style={{ color: t.done ? AMBER : 'var(--text-2)' }}>{sentSince[d.brandId] === undefined ? 'Counting your videos since it started... ' : ''}{t.says}</p>
          </div>
        )
      })}

      {/* Ready to ask. */}
      {b30 && ready.length === 0 && !(deals || []).length && (
        <p className="text-[12.5px] mt-2" style={soft}>
          No brand is ready yet: MVP looks for 25+ videos in 30 days, 10+ approved, and a payout.{close.length ? ` Closest: ${close.map((b) => `${b.name} (${retainerReady(b).why.replace(/^Not yet: /, '')})`).join('; ')}.` : ''}
        </p>
      )}
      {ready.map((b) => (
        <div key={b.id} className="mt-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[13px] font-semibold flex flex-wrap items-center gap-2">
            <span style={{ color: GREEN }}>Ready:</span> {b.name}
            <TrybeLink brandId={b.id} name={b.name} scout={scoutOpens} />
            <button onClick={() => setDrafting(drafting === b.id ? null : b.id)} className="ml-auto text-[12px] font-semibold rounded-lg px-2.5 py-1" style={{ background: PURPLE, color: '#fff' }}>{drafting === b.id ? 'Close' : 'Draft the ask'}</button>
          </p>
          <p className="text-[12px]" style={soft}>{retainerReady(b).why}</p>
          {drafting === b.id && <Draft b={b} onTrack={save} />}
        </div>
      ))}
    </section>
  )
}

function Draft({ b, onTrack }: { b: Brand30; onTrack: (r: Retainer) => void }) {
  const [kind, setKind] = useState<RetainerKind>('smart')
  const [amount, setAmount] = useState(suggestAmount(b.earnings))
  const [videos, setVideos] = useState(30)
  const [copied, setCopied] = useState(false)
  const text = retainerAsk({ brand: b.name, sent30: b.submitted ?? 0, approved30: b.approved ?? 0, amount, videos, kind })
  const field = 'w-20 rounded-md border px-2 py-1 text-[12.5px] bg-transparent tabular-nums'
  const soft = { color: 'var(--text-soft)' }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }} role="group" aria-label="Kind of retainer">
          {(['smart', 'standard'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className="px-2.5 py-1 font-semibold" style={kind === k ? { background: PURPLE, color: '#fff' } : undefined}
              title={k === 'smart' ? 'Your commission counts toward the amount; the brand tops up the rest.' : 'A set amount on top of your commission.'}>{k === 'smart' ? 'Smart' : 'Standard'}</button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1">$<input type="number" min={100} step={100} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} className={field} style={{ borderColor: 'var(--border)' }} aria-label="Amount" /></label>
        <label className="inline-flex items-center gap-1">for <input type="number" min={5} step={5} value={videos} onChange={(e) => setVideos(Math.max(1, Number(e.target.value) || 1))} className={field} style={{ borderColor: 'var(--border)' }} aria-label="Videos" /> videos in 30 days</label>
      </div>
      <p className="text-[11.5px]" style={soft}>Started from what {b.name} paid you in the last 30 days{b.earnings != null ? ` ($${Math.round(b.earnings).toLocaleString('en-US')})` : ''} plus a fifth. Change it to what feels right.</p>
      <p className="text-[12.5px] rounded-lg px-3 py-2 whitespace-pre-wrap" style={{ background: 'var(--surface-2, rgba(0,0,0,0.04))' }}>{text}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { void navigator.clipboard?.writeText(text).then(() => { rememberMvpText(text); setCopied(true); toast.success('Copied. Send it in their TRYBE chat.') }).catch(() => toast.error('Could not copy')) }}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ border: `1px solid ${PURPLE}`, color: PURPLE }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy the ask'}
        </button>
        <button onClick={() => onTrack({ brandId: b.id, name: b.name, amount, videos, kind, startedAt: new Date().toISOString() })}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: GREEN, color: '#fff' }}>They said yes: track it</button>
      </div>
      <p className="text-[11.5px]" style={soft}>MVP never sends this for you. It is the one message where the money is yours to raise.</p>
    </div>
  )
}
