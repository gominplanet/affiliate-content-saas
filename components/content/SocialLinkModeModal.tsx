'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Link settings: per-platform, two independent choices for Facebook, LinkedIn,
// and Bluesky — whether to include the affiliate ("buy it") link, and which
// content link to add (blog post, YouTube review video, or none). Saved to
// integrations.social_link_modes and applied server-side on every publish +
// schedule. Other platforms aren't shown (their link behavior is fixed).

import { useEffect, useState } from 'react'
import { X, Link2, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { LINK_MODE_PLATFORMS, type ContentLink, type PlatformLinkPref, type SocialLinkPrefs } from '@/lib/social-link-mode'

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', linkedin: 'LinkedIn', bluesky: 'Bluesky' }
const CONTENT_OPTS: { key: ContentLink; label: string }[] = [
  { key: 'blog', label: 'Blog' },
  { key: 'video', label: 'Review video' },
  { key: 'none', label: 'None' },
]
const DEFAULT_PREF: PlatformLinkPref = { product: false, content: 'blog' }

export default function SocialLinkModeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prefs, setPrefs] = useState<SocialLinkPrefs>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/social-link-modes')
      .then(r => r.json())
      .then(d => setPrefs(d.prefs || {}))
      .catch(() => setPrefs({}))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const prefOf = (p: string) => prefs[p as keyof SocialLinkPrefs] ?? DEFAULT_PREF
  const setPref = (p: string, patch: Partial<PlatformLinkPref>) =>
    setPrefs(m => ({ ...m, [p]: { ...(m[p as keyof SocialLinkPrefs] ?? DEFAULT_PREF), ...patch } }))

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/social-link-modes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs }),
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
      <div className="card w-full max-w-xl p-5 bg-white dark:bg-[#18181b]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2" style={{ color: '#7C3AED' }}>
            <Link2 size={18} />
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>Link settings</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        <p className="text-[12.5px] mb-4" style={{ color: 'var(--text-soft)' }}>
          For each platform, choose whether to include your <b>affiliate link</b> and which <b>content link</b> to add — your blog post or your YouTube review video. Applies to publishing and scheduling. Instagram/TikTok/Pinterest aren&rsquo;t affected.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
            <Loader2 size={15} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-[10.5px] uppercase tracking-wide px-1" style={{ color: 'var(--text-faint)' }}>
              <span>Platform</span><span>Also link to</span><span>Affiliate link</span>
            </div>
            {LINK_MODE_PLATFORMS.map(p => {
              const pref = prefOf(p)
              return (
                <div key={p} className="grid grid-cols-1 sm:grid-cols-[7rem_1fr_auto] items-center gap-2 sm:gap-3 rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{PLATFORM_LABEL[p]}</span>
                  {/* Content link segmented control */}
                  <div className="inline-flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: 'var(--border)' }}>
                    {CONTENT_OPTS.map(o => {
                      const active = pref.content === o.key
                      return (
                        <button key={o.key} onClick={() => setPref(p, { content: o.key })}
                          className="px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                          style={{ background: active ? '#7C3AED' : 'transparent', color: active ? '#fff' : 'var(--text-soft)' }}>
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                  {/* Affiliate toggle */}
                  <button onClick={() => setPref(p, { product: !pref.product })}
                    title="Include your affiliate ('buy it') link"
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold border w-fit justify-self-start sm:justify-self-end"
                    style={pref.product
                      ? { background: '#16a34a', borderColor: '#16a34a', color: '#fff' }
                      : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                    {pref.product ? <Check size={13} /> : null} {pref.product ? 'On' : 'Off'}
                  </button>
                </div>
              )
            })}
            <div className="text-[11.5px] pt-1 space-y-0.5" style={{ color: 'var(--text-faint)' }}>
              <p>With the affiliate link on, it leads the caption (with the disclosure); the content link follows the write-up.</p>
              <p><b>Review video</b> links to your YouTube video; posts with no source video fall back to the blog link.</p>
              <p>The &ldquo;buy it&rdquo; wording stays retailer-neutral unless the link is a confirmed Amazon URL.</p>
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
