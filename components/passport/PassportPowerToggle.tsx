// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The big, obvious ON/OFF switch for Passport Links. When ON, every link MVP
// makes (blog, social, YouTube, pins) geo-routes each visitor to their own
// country's Amazon with the creator's tag there. When OFF, MVP falls back to
// whatever else is configured (Geniuslink, a plain tag). Flips instantly and
// saves; the rest of the page reacts to the shared state via onChange.

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Globe, Loader2, Power } from 'lucide-react'

export default function PassportPowerToggle({ onChange }: { onChange?: (enabled: boolean) => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    fetch('/api/passport').then((r) => r.json()).then((d) => {
      if (d?.ok) { setEnabled(!!d.enabled); onChange?.(!!d.enabled) }
    }).catch(() => {}).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggle() {
    if (saving || loading) return
    const next = !enabled
    setEnabled(next); setSaving(true); onChange?.(next) // optimistic
    try {
      const res = await fetch('/api/passport', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || 'save failed')
      toast.success(next ? 'Passport Links is ON.' : 'Passport Links is OFF.')
    } catch {
      setEnabled(!next); onChange?.(!next) // revert
      toast.error('Could not change Passport Links. Try again.')
    } finally { setSaving(false) }
  }

  return (
    <div
      className="rounded-2xl border p-5 flex items-center gap-4 transition-colors"
      style={enabled
        ? { borderColor: 'rgba(124,58,237,0.55)', background: 'linear-gradient(120deg, rgba(124,58,237,0.16) 0%, rgba(52,199,89,0.12) 100%)', boxShadow: '0 0 0 1px rgba(124,58,237,0.25), 0 12px 32px -18px rgba(124,58,237,0.65)' }
        : { borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: enabled ? 'linear-gradient(135deg, #7C3AED, #34c759)' : 'var(--surface-2)', color: enabled ? '#fff' : 'var(--text-3)' }}>
        <Globe size={20} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>Passport Links</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={enabled ? { background: 'rgba(52,199,89,0.18)', color: '#34c759' } : { background: 'var(--surface-2)', color: 'var(--text-faint)' }}>
            {loading ? '…' : enabled ? 'On' : 'Off'}
          </span>
        </div>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {enabled
            ? 'Every link you make geo-routes each visitor to their own country’s Amazon and earns there.'
            : 'Turn on to route every link by country. Off, MVP uses whatever else you have set (Geniuslink or a plain tag).'}
        </p>
      </div>

      {/* Big switch */}
      <button
        role="switch" aria-checked={enabled} aria-label="Toggle Passport Links" onClick={toggle} disabled={loading || saving}
        className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-70"
        style={{ width: 68, height: 36, background: enabled ? 'linear-gradient(90deg, #7C3AED, #34c759)' : 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <span className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-all"
          style={{ width: 28, height: 28, left: enabled ? 36 : 4, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.35)', color: enabled ? '#7C3AED' : '#9aa0a6' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Power size={13} />}
        </span>
      </button>
    </div>
  )
}
