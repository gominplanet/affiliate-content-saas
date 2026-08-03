'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Link settings: per-platform default for where a fanned-out post's link points
// — Blog, Affiliate, or Both — for Facebook, LinkedIn, and Bluesky. Saved to
// integrations.social_link_modes and applied server-side on every publish +
// schedule. Other platforms aren't shown (their link behavior is fixed).

import { useEffect, useState } from 'react'
import { X, Link2, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { LINK_MODE_PLATFORMS, type LinkMode, type SocialLinkModes } from '@/lib/social-link-mode'

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', linkedin: 'LinkedIn', bluesky: 'Bluesky' }
const MODES: { key: LinkMode; label: string; hint: string }[] = [
  { key: 'blog', label: 'Blog', hint: 'Link goes to your blog post' },
  { key: 'affiliate', label: 'Affiliate', hint: 'Link goes straight to the Amazon product' },
  { key: 'both', label: 'Both', hint: 'Affiliate link up top, blog link below' },
]

export default function SocialLinkModeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [modes, setModes] = useState<SocialLinkModes>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/social-link-modes')
      .then(r => r.json())
      .then(d => setModes(d.modes || {}))
      .catch(() => setModes({}))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const set = (platform: string, mode: LinkMode) => setModes(m => ({ ...m, [platform]: mode }))

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/social-link-modes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modes }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not save')
      toast.success('Link settings saved')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="card w-full max-w-lg p-5 bg-white dark:bg-[#18181b]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2" style={{ color: '#7C3AED' }}>
            <Link2 size={18} />
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>Link settings</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        <p className="text-[12.5px] mb-4" style={{ color: 'var(--text-soft)' }}>
          Choose where the link points when you post to each platform. Applies to publishing and scheduling. Other platforms aren&rsquo;t affected.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
            <Loader2 size={15} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            {LINK_MODE_PLATFORMS.map(p => {
              const current = modes[p] ?? 'blog'
              return (
                <div key={p} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold w-24 flex-shrink-0" style={{ color: 'var(--text)' }}>{PLATFORM_LABEL[p]}</span>
                  <div className="inline-flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {MODES.map(m => {
                      const active = current === m.key
                      return (
                        <button key={m.key} onClick={() => set(p, m.key)} title={m.hint}
                          className="px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                          style={{
                            background: active ? '#7C3AED' : 'transparent',
                            color: active ? '#fff' : 'var(--text-soft)',
                          }}>
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div className="text-[11.5px] pt-1 space-y-0.5" style={{ color: 'var(--text-faint)' }}>
              <p><b>Both</b> = affiliate link + disclaimer, then your write-up, then the blog link.</p>
              <p><b>Affiliate</b> falls back to the blog link on posts with no product link.</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-[13px] font-medium border" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>Cancel</button>
          <button onClick={save} disabled={saving || loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Check size={15} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  )
}
