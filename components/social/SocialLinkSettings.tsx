'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LINK SETTINGS: for each platform, whether a post carries the creator's
// affiliate link, and which content link it adds (the blog post, the YouTube
// review video, or none). Saved to integrations.social_link_modes and applied
// on every publish and every scheduled post.
//
// Facebook, LinkedIn and Bluesky had it, behind a toolbar button in the
// Library. X, Threads and Telegram joined, and it lives on Your setup → Socials
// too (Seb, 2026-11-23: "yes add and put in settings", after a Pro creator
// asked to choose blog link, affiliate link, or both on each platform). The
// same panel renders in both places (variant).

import { useEffect, useState } from 'react'
import { Link2, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { LINK_MODE_PLATFORMS, type ContentLink, type PlatformLinkPref, type SocialLinkPrefs } from '@/lib/social-link-mode'

export const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', linkedin: 'LinkedIn', bluesky: 'Bluesky', twitter: 'X', threads: 'Threads', telegram: 'Telegram' }
const CONTENT_OPTS: { key: ContentLink; label: string }[] = [
  { key: 'blog', label: 'Blog' },
  { key: 'video', label: 'Review video' },
  { key: 'none', label: 'None' },
]
const DEFAULT_PREF: PlatformLinkPref = { product: false, content: 'blog' }

export default function SocialLinkSettings({ variant, onDone }: { variant: 'card' | 'modal'; onDone?: () => void }) {
  const [prefs, setPrefs] = useState<SocialLinkPrefs>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let gone = false
    setLoading(true)
    fetch('/api/social-link-modes', { signal: AbortSignal.timeout(15_000) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (gone) return
        if (!r.ok) { setLoadError(d.error || 'Your link settings did not load.'); return }
        setPrefs(d.prefs || {})
      })
      .catch(() => { if (!gone) setLoadError('Your link settings did not load. Reload the page to try again.') })
      .finally(() => { if (!gone) setLoading(false) })
    return () => { gone = true }
  }, [])

  const prefOf = (p: string) => prefs[p as keyof SocialLinkPrefs] ?? DEFAULT_PREF
  const setPref = (p: string, patch: Partial<PlatformLinkPref>) => {
    setDirty(true)
    setPrefs((m) => ({ ...m, [p]: { ...(m[p as keyof SocialLinkPrefs] ?? DEFAULT_PREF), ...patch } }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/social-link-modes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs }), signal: AbortSignal.timeout(15_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save')
      if (d.prefs) setPrefs(d.prefs)
      setDirty(false)
      toast.success('Link settings saved')
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const body = loading ? (
    <div className="flex items-center gap-2 py-6 justify-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
      <Loader2 size={15} className="animate-spin" /> Loading your link settings...
    </div>
  ) : loadError ? (
    <p className="text-[13px] py-3" style={{ color: '#B45309' }}>{loadError}</p>
  ) : (
    <div className="space-y-2.5">
      <div className="hidden sm:grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-[10.5px] uppercase tracking-wide px-1" style={{ color: 'var(--text-faint)' }}>
        <span>Platform</span><span>Also link to</span><span>Affiliate link</span>
      </div>
      {LINK_MODE_PLATFORMS.map((p) => {
        const pref = prefOf(p)
        return (
          <div key={p} className="grid grid-cols-1 sm:grid-cols-[7rem_1fr_auto] items-center gap-2 sm:gap-3 rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{PLATFORM_LABEL[p]}</span>
            <div className="inline-flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: 'var(--border)' }} role="group" aria-label={`${PLATFORM_LABEL[p]}: also link to`}>
              {CONTENT_OPTS.map((o) => {
                const active = pref.content === o.key
                return (
                  <button key={o.key} type="button" onClick={() => setPref(p, { content: o.key })} aria-pressed={active}
                    className="px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                    style={{ background: active ? '#7C3AED' : 'transparent', color: active ? '#fff' : 'var(--text-soft)' }}>
                    {o.label}
                  </button>
                )
              })}
            </div>
            <button type="button" onClick={() => setPref(p, { product: !pref.product })} aria-pressed={pref.product}
              aria-label={`${PLATFORM_LABEL[p]}: affiliate link ${pref.product ? 'on' : 'off'}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold border w-fit justify-self-start sm:justify-self-end"
              style={pref.product ? { background: '#16a34a', borderColor: '#16a34a', color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              {pref.product ? <Check size={13} /> : null} {pref.product ? 'On' : 'Off'}
            </button>
          </div>
        )
      })}
      <div className="text-[11.5px] pt-1 space-y-0.5" style={{ color: 'var(--text-faint)' }}>
        <p>With the affiliate link on, it comes first, with words that name the store (for example &ldquo;Get it on Amazon&rdquo;), wrapped in your Link style.</p>
        <p><b>Review video</b> links to your YouTube video; a post with no video uses the blog link.</p>
        <p>Each post carries one link to your blog at most, and one disclosure line: yours from Brand, or Amazon&rsquo;s.</p>
      </div>
    </div>
  )

  const saveButton = (
    <button type="button" onClick={() => void save()} disabled={saving || loading || !!loadError || (variant === 'card' && !dirty)}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
      {saving ? <><Loader2 size={15} className="animate-spin" /> Saving...</> : <><Check size={15} /> Save</>}
    </button>
  )

  if (variant === 'modal') {
    return (
      <>
        {body}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onDone} className="px-3 py-2 rounded-xl text-[13px] font-medium border" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>Cancel</button>
          {saveButton}
        </div>
      </>
    )
  }
  return (
    <section className="card p-5 mt-5" aria-label="Link settings">
      <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--accent)' }}>
        <Link2 size={18} />
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>What your posts link to</h2>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--text-soft)' }}>
        For each platform, choose whether to add your <b>affiliate link</b> and which <b>content link</b> to add: your blog post, your YouTube review video, or none. Applies when you post and when posts go out on schedule. Instagram, TikTok and Pinterest have their own settings.
      </p>
      {body}
      {!loading && !loadError && (
        <div className="flex items-center justify-end gap-3 mt-4">
          {dirty && <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Not saved yet</span>}
          {saveButton}
        </div>
      )}
    </section>
  )
}
