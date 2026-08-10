// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Affiliate IDs for the Amazon Influencer. A status row on the Social Influencer
// page + a setup modal to enter the Amazon Associates tag and Geniuslink
// credentials — the info every pin/post routes the affiliate link through.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tag, Link2, Check, Loader2, X, Pencil, AlertCircle } from 'lucide-react'

interface Status { amazonTag: string; geniuslinkKey: string; geniuslinkSet: boolean }

export default function AffiliateSetup() {
  const [status, setStatus] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/amazon/affiliate-setup').then(r => r.json())
      setStatus({ amazonTag: d.amazonTag || '', geniuslinkKey: d.geniuslinkKey || '', geniuslinkSet: !!d.geniuslinkSet })
    } catch { setStatus({ amazonTag: '', geniuslinkKey: '', geniuslinkSet: false }) }
  }, [])
  useEffect(() => { load() }, [load])

  const hasTag = !!status?.amazonTag
  const hasGeni = !!status?.geniuslinkSet
  const ready = hasGeni || hasTag

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>Affiliate IDs</h2>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: 'var(--text-soft)' }}>
          <Pencil size={11} /> {ready ? 'Edit' : 'Set up'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {/* Geniuslink (preferred) */}
        <div className="flex items-center gap-3 flex-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#7C3AED1a' }}>
            <Link2 size={15} style={{ color: '#7C3AED' }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Geniuslink</span>
              {hasGeni && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#34c759]"><Check size={11} /> Connected</span>}
            </div>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-soft)' }}>
              {status == null ? ' ' : hasGeni ? 'Geo-routed, tracked affiliate links' : 'Best: geo-routes every link to the right store'}
            </p>
          </div>
        </div>

        {/* Amazon Associates tag */}
        <div className="flex items-center gap-3 flex-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d977061a' }}>
            <Tag size={15} style={{ color: '#d97706' }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Amazon tag</span>
              {hasTag && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#34c759]"><Check size={11} /> Set</span>}
            </div>
            <p className="text-[11px] truncate font-mono" style={{ color: 'var(--text-soft)' }}>
              {status == null ? ' ' : hasTag ? status!.amazonTag : 'yourtag-20'}
            </p>
          </div>
        </div>
      </div>

      {status != null && !ready && (
        <p className="mt-2 text-[12px] flex items-start gap-1.5" style={{ color: 'var(--text-soft)' }}>
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#d97706' }} />
          Add your Amazon tag or Geniuslink so your pins and posts earn commission.
        </p>
      )}

      {open && <SetupModal initial={status} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load() }} />}
    </div>
  )
}

function SetupModal({ initial, onClose, onSaved }: { initial: Status | null; onClose: () => void; onSaved: () => void }) {
  const [amazonTag, setAmazonTag] = useState(initial?.amazonTag || '')
  const [geniuslinkKey, setGeniuslinkKey] = useState(initial?.geniuslinkKey || '')
  const [geniuslinkSecret, setGeniuslinkSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alreadyHasSecret = !!initial?.geniuslinkSet

  const save = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/amazon/affiliate-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazonTag: amazonTag.trim(), geniuslinkKey: geniuslinkKey.trim(), geniuslinkSecret: geniuslinkSecret.trim() || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((d.error as string) || 'Could not save. Try again.')
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.') } finally { setSaving(false) }
  }, [amazonTag, geniuslinkKey, geniuslinkSecret, onSaved])

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: 'var(--text)' }}>Affiliate setup</h3>
          <button onClick={onClose} className="text-[var(--text-soft)] hover:opacity-70"><X size={18} /></button>
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          Your pins and posts route the product link through this so you earn commission. Geniuslink is best (it geo-routes to each visitor&apos;s local store); an Amazon Associates tag alone also works.
        </p>

        {/* Geniuslink */}
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-white/10 p-3">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text)' }}><Link2 size={13} style={{ color: '#7C3AED' }} /> Geniuslink <span className="font-normal" style={{ color: 'var(--text-soft)' }}>(recommended)</span></span>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-soft)' }}>API key</span>
            <input value={geniuslinkKey} onChange={e => setGeniuslinkKey(e.target.value)} placeholder="Geniuslink API key" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-soft)' }}>API secret {alreadyHasSecret && <span style={{ color: '#34c759' }}>— saved, leave blank to keep</span>}</span>
            <input type="password" value={geniuslinkSecret} onChange={e => setGeniuslinkSecret(e.target.value)} placeholder={alreadyHasSecret ? '••••••••' : 'Geniuslink API secret'} className={inputCls} />
          </label>
          <a href="https://geni.us/account/api" target="_blank" rel="noreferrer" className="text-[11px] hover:underline" style={{ color: '#7C3AED' }}>Where do I find these?</a>
        </div>

        {/* Amazon tag */}
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-white/10 p-3">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text)' }}><Tag size={13} style={{ color: '#d97706' }} /> Amazon Associates tag</span>
          <input value={amazonTag} onChange={e => setAmazonTag(e.target.value)} placeholder="yourtag-20" className={`${inputCls} font-mono`} />
          <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>Used directly when you don&apos;t have Geniuslink set.</span>
        </div>

        {error && <p className="text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" />{error}</p>}

        <button onClick={save} disabled={saving}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm transition disabled:opacity-60" style={{ backgroundColor: '#d97706' }}>
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Check size={16} /> Save</>}
        </button>
      </div>
    </div>
  )
}
