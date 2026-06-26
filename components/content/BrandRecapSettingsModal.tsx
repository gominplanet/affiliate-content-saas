'use client'

/**
 * BrandRecapSettingsModal — the global "Brand message settings" editor opened
 * from the top of the Blog Post Generator. Lets the creator customize the
 * recap message every "Share with brand" modal pre-fills from: the template
 * body (with placeholders), tone (used by Polish-with-AI), and their sign-off
 * name + site. Saved to brand_profiles.brand_recap_settings via the settings
 * route. Platform-neutral default — never assumes Amazon.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Save, RotateCcw } from 'lucide-react'
import { DEFAULT_RECAP_TEMPLATE, type BrandRecapSettings } from '@/lib/brand-recap'

const TONES: Array<{ key: BrandRecapSettings['tone']; label: string }> = [
  { key: 'warm', label: 'Warm & friendly' },
  { key: 'professional', label: 'Professional' },
  { key: 'casual', label: 'Casual' },
]

export default function BrandRecapSettingsModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [s, setS] = useState<BrandRecapSettings>({ template: DEFAULT_RECAP_TEMPLATE, tone: 'warm', senderName: '', siteUrl: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/blog/brand-recap/settings')
        const d = await res.json()
        if (!cancelled && d.settings) setS(d.settings as BrandRecapSettings)
      } catch { /* keep defaults */ } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/blog/brand-recap/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      toast.success('Saved — new recaps use this message')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[88vh] overflow-y-auto p-5" style={{ background: 'var(--surface, #fff)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Brand message settings</h3>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">The message every &ldquo;Share with brand&rdquo; recap starts from.</p>
          </div>
          <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white p-1" title="Close"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Tone</label>
                <select value={s.tone} onChange={e => setS(v => ({ ...v, tone: e.target.value as BrandRecapSettings['tone'] }))} className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-sm focus:outline-none focus:border-[#7C3AED]">
                  {TONES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <p className="text-[10px] text-[#86868b] mt-1">Used by &ldquo;Polish with AI&rdquo;.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Your name (sign-off)</label>
                <input value={s.senderName} onChange={e => setS(v => ({ ...v, senderName: e.target.value }))} placeholder="e.g. Seb & Michelle" className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-sm focus:outline-none focus:border-[#7C3AED]" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Blog URL (sign-off)</label>
              <input value={s.siteUrl} onChange={e => setS(v => ({ ...v, siteUrl: e.target.value }))} placeholder="https://www.yourblog.com" className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-sm font-mono focus:outline-none focus:border-[#7C3AED]" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Message template</label>
                <button onClick={() => setS(v => ({ ...v, template: DEFAULT_RECAP_TEMPLATE }))} className="text-[11px] text-[#86868b] hover:text-[#7C3AED] inline-flex items-center gap-1"><RotateCcw size={11} /> Reset to default</button>
              </div>
              <textarea
                value={s.template}
                onChange={e => setS(v => ({ ...v, template: e.target.value }))}
                rows={11}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-[var(--surface,#fff)] text-[13px] leading-relaxed resize-none focus:outline-none focus:border-[#7C3AED]"
                spellCheck
              />
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                Placeholders MVP fills in automatically: <code className="bg-[var(--surface-2,#f5f5f7)] px-1 rounded">{'{{brand}}'}</code> <code className="bg-[var(--surface-2,#f5f5f7)] px-1 rounded">{'{{product}}'}</code> <code className="bg-[var(--surface-2,#f5f5f7)] px-1 rounded">{'{{links}}'}</code> <code className="bg-[var(--surface-2,#f5f5f7)] px-1 rounded">{'{{name}}'}</code> <code className="bg-[var(--surface-2,#f5f5f7)] px-1 rounded">{'{{site}}'}</code>. Keep <code className="bg-[var(--surface-2,#f5f5f7)] px-1 rounded">{'{{links}}'}</code> on its own line — that&rsquo;s where every live URL drops in.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-2,#e5e5e7)] pt-4">
              <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] hover:bg-[var(--surface-hover,#f5f5f7)]">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
