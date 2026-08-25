// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Compact Passport Links on/off control for the Brand → Important Connections
// section. The full Passport page (/passport) owns setup + per-country tags +
// analytics; this is just the switch, placed here because the connections copy
// references Passport as the primary Amazon-link router. Same account flag and
// same tier gate as PassportPowerToggle (Studio + Pro only), driven by the same
// /api/passport GET/POST endpoint so both surfaces stay in sync.

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Globe, Loader2, Power, ArrowRight, Lock } from 'lucide-react'

export default function PassportConnectionCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canUse, setCanUse] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    fetch('/api/passport').then((r) => r.json()).then((d) => {
      if (d?.ok) { setCanUse(!!d.canUse); setEnabled(!!d.enabled) }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function toggle() {
    if (saving || loading || !canUse) return
    const next = !enabled
    setEnabled(next); setSaving(true) // optimistic
    try {
      const res = await fetch('/api/passport', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || 'save failed')
      toast.success(next ? 'Passport Links is ON.' : 'Passport Links is OFF.')
    } catch {
      setEnabled(!next) // revert
      toast.error('Could not change Passport Links. Try again.')
    } finally { setSaving(false) }
  }

  const on = canUse && enabled

  return (
    <div className="rounded-xl border p-4 mb-3 transition-colors"
      style={on
        ? { borderColor: 'rgba(124,58,237,0.5)', background: 'linear-gradient(120deg, rgba(124,58,237,0.10) 0%, rgba(52,199,89,0.08) 100%)' }
        : { borderColor: 'var(--border, #e5e5e7)' }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: on ? 'linear-gradient(135deg, #7C3AED, #34c759)' : 'rgba(124,58,237,0.10)', color: on ? '#fff' : '#7C3AED' }}>
          <Globe size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Passport Links</p>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={on ? { background: 'rgba(52,199,89,0.18)', color: '#1f7a4d' } : { background: 'var(--surface-2, #f5f5f7)', color: '#86868b' }}>
              {loading ? '…' : !canUse ? 'Paid plans' : enabled ? 'On' : 'Off'}
            </span>
          </div>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">Geo-route every Amazon link to the shopper&rsquo;s own country</p>
        </div>

        {canUse ? (
          <button
            role="switch" aria-checked={enabled} aria-label="Toggle Passport Links" onClick={toggle} disabled={loading || saving}
            className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-70"
            style={{ width: 52, height: 28, background: enabled ? 'linear-gradient(90deg, #7C3AED, #34c759)' : 'var(--surface-2, #e5e5e7)', border: '1px solid var(--border, #d2d2d7)' }}>
            <span className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-all"
              style={{ width: 22, height: 22, left: enabled ? 27 : 3, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', color: enabled ? '#7C3AED' : '#9aa0a6' }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Power size={11} />}
            </span>
          </button>
        ) : (
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#86868b] flex-shrink-0">
            <Lock size={12} /> Locked
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed flex-1 min-w-[180px]">
          {!canUse
            ? 'Available on the Amazon, Studio, and Pro plans. When on, it routes every Amazon link by country automatically, so Geniuslink below is optional.'
            : enabled
              ? 'On, so every Amazon link MVP makes geo-routes by country and takes priority over Geniuslink below.'
              : 'Off, so MVP uses Geniuslink below (if connected) or your plain Associates tag.'}
        </p>
        <a href="/passport" className="inline-flex items-center gap-1 text-[11px] font-semibold flex-shrink-0" style={{ color: '#7C3AED' }}>
          {canUse ? 'Manage Passport Links' : 'See Passport Links'} <ArrowRight size={11} />
        </a>
      </div>
    </div>
  )
}
