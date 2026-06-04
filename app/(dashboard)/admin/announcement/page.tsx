'use client'

import { useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Megaphone, Sparkles, X, ArrowRight, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

type Variant = 'news' | 'feature'

interface Announcement {
  id: string
  title: string
  body: string
  cta_label: string | null
  cta_href: string | null
  variant?: string | null
}

export default function AdminAnnouncementPage() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaHref, setCtaHref] = useState('')
  const [variant, setVariant] = useState<Variant>('news')
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hiding, setHiding] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function loadCurrent() {
    setLoading(true)
    try {
      const res = await fetch('/api/announcement')
      const data = await res.json().catch(() => ({}))
      setCurrent((data?.announcement as Announcement | null) ?? null)
    } catch {
      setCurrent(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCurrent() }, [])

  async function publish() {
    if (!title.trim() || !body.trim()) {
      setMsg({ ok: false, text: 'Title and message are both required.' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', title, body, ctaLabel, ctaHref, variant }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      setMsg({ ok: true, text: 'Published — every user sees it on the dashboard until they dismiss it.' })
      setTitle(''); setBody(''); setCtaLabel(''); setCtaHref(''); setVariant('news')
      await loadCurrent()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Publish failed' })
    } finally {
      setSaving(false)
    }
  }

  async function hide() {
    setHiding(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hide' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Hide failed')
      setMsg({ ok: true, text: 'Banner hidden — no announcement is showing now.' })
      await loadCurrent()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Hide failed' })
    } finally {
      setHiding(false)
    }
  }

  return (
    <>
      <PageHero
        title="News banner"
        subtitle="Post a dismissible announcement to everyone's dashboard. No deploy needed."
      />

      <div className="max-w-2xl space-y-6">
        {/* Currently live */}
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-3">Currently live</p>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[#6e6e73]"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : current ? (
            <>
              {(() => {
                const feat = current.variant === 'feature'
                return (
                  <div
                    className="rounded-xl p-4 relative"
                    style={feat
                      ? { background: 'linear-gradient(135deg, rgba(240, 148, 51, 0.06) 0%, rgba(220, 39, 67, 0.06) 50%, rgba(188, 24, 136, 0.06) 100%)', border: '1px solid rgba(220, 39, 67, 0.25)' }
                      : { background: 'linear-gradient(180deg, rgba(220, 38, 38, 0.08) 0%, rgba(220, 38, 38, 0.02) 100%)', border: '1px solid rgba(220, 38, 38, 0.3)' }}
                  >
                    <div className="flex items-start gap-3 pr-6">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${feat ? '' : 'bg-[#dc2626]/10'}`}
                        style={feat ? { background: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' } : undefined}
                      >
                        {feat ? <Sparkles size={16} className="text-white" /> : <Megaphone size={16} className="text-[#dc2626]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {feat && <span className="text-[10px] font-bold uppercase tracking-wider text-[#bc1888]">New</span>}
                          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{current.title}</p>
                        </div>
                        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">{current.body}</p>
                        {current.cta_label && current.cta_href && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold mt-2" style={{ color: feat ? '#bc1888' : '#dc2626' }}>
                            {current.cta_label} <ArrowRight size={11} />
                          </span>
                        )}
                      </div>
                    </div>
                    <X size={14} className="absolute top-3 right-3 text-[#86868b]" />
                  </div>
                )
              })()}
              <button
                onClick={hide}
                disabled={hiding}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#86868b] hover:text-[#ff3b30] transition-colors disabled:opacity-50"
              >
                {hiding ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Hide this banner
              </button>
            </>
          ) : (
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">No announcement is showing right now.</p>
          )}
        </div>

        {/* Compose new */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93]">Publish a new announcement</p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed -mt-2">
            Publishing replaces the current banner and re-shows to everyone — even people who dismissed the last one.
          </p>

          <div>
            <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Style</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVariant('news')}
                className={`text-left p-3 rounded-lg border transition-colors ${variant === 'news' ? 'border-[#dc2626] bg-[#dc2626]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]"><Megaphone size={13} className="text-[#dc2626]" /> News (red)</span>
                <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">Alerts, heads-ups, maintenance.</span>
              </button>
              <button
                type="button"
                onClick={() => setVariant('feature')}
                className={`text-left p-3 rounded-lg border transition-colors ${variant === 'feature' ? 'border-[#bc1888] bg-[#bc1888]/5' : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]"><Sparkles size={13} className="text-[#bc1888]" /> Feature (colorful)</span>
                <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">New features, with a &ldquo;NEW&rdquo; badge.</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Scheduled maintenance tonight"
              maxLength={80}
              className="input-field text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={3}
              placeholder="The full announcement text shown to users."
              maxLength={500}
              className="input-field text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Button label <span className="text-[#86868b]">(optional)</span></label>
              <input
                type="text"
                value={ctaLabel}
                onChange={e => setCtaLabel(e.target.value)}
                placeholder="Learn more"
                maxLength={40}
                className="input-field text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Button link <span className="text-[#86868b]">(optional)</span></label>
              <input
                type="text"
                value={ctaHref}
                onChange={e => setCtaHref(e.target.value)}
                placeholder="/community or https://…"
                className="input-field text-sm"
              />
            </div>
          </div>

          {msg && (
            <p className={`text-xs flex items-center gap-1.5 ${msg.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
              {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {msg.text}
            </p>
          )}

          <button
            onClick={publish}
            disabled={saving || !title.trim() || !body.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
            {saving ? 'Publishing…' : 'Publish announcement'}
          </button>
        </div>
      </div>
    </>
  )
}
