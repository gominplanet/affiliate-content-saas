// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Articles v1 (ADMIN-ONLY) — informational long-form article generator UI.
//
// Mirrors the Buying Guides page styling (PageHero-style hero card, purple
// #7C3AED accents, sonner toasts). Two flows:
//   1. Generate preview (publish:false) → render the returned HTML + a
//      "Publish to my blog" button.
//   2. Generate & publish (publish:true) → publish straight to WordPress.
//
// Admin-gated on the client too: non-admins see a short "early testing"
// notice instead of the form. The API enforces the real gate regardless.

'use client'

import { useEffect, useState, FormEvent } from 'react'
import { toast } from 'sonner'
import { Newspaper, Sparkles, Loader2, ExternalLink, UploadCloud, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createBrowserClient } from '@/lib/supabase/client'
import { TIERS, normalizeTier } from '@/lib/tier'

// The section toggles, in display order. Keys match the API's SECTION_ORDER.
const SECTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'intro', label: 'Introduction', hint: 'Set up the topic and why it matters' },
  { key: 'history', label: 'History / background', hint: 'How it came to be, key milestones' },
  { key: 'key_facts', label: 'Key facts', hint: 'The concrete things a reader should know' },
  { key: 'stats', label: 'Stats & data', hint: 'A data table AND a hand-built SVG bar chart' },
  { key: 'tips', label: 'Practical tips', hint: 'Actionable advice the reader can use' },
  { key: 'myths', label: 'Myths vs facts', hint: 'Common misconceptions, corrected' },
  { key: 'faq', label: 'FAQ', hint: '4-6 real questions, answer-first' },
  { key: 'conclusion', label: 'Conclusion', hint: 'A short opinionated takeaway' },
]
const DEFAULT_SECTIONS = ['intro', 'key_facts', 'stats', 'faq', 'conclusion']

const TONES = [
  { key: 'conversational', label: 'Conversational' },
  { key: 'authoritative', label: 'Authoritative' },
  { key: 'friendly', label: 'Friendly' },
]
const LENGTHS: { key: 'short' | 'medium' | 'long'; label: string; words: string }[] = [
  { key: 'short', label: 'Short', words: '~800 words' },
  { key: 'medium', label: 'Medium', words: '~1,500 words' },
  { key: 'long', label: 'Long', words: '~2,500 words' },
]

export default function ArticlesPage() {
  // Entitlement gate — null = still loading (avoid flashing the notice).
  const [canUse, setCanUse] = useState<boolean | null>(null)

  const [topic, setTopic] = useState('')
  const [angle, setAngle] = useState('')
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS)
  const [tone, setTone] = useState('conversational')
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium')
  const [keywords, setKeywords] = useState('')
  const [notes, setNotes] = useState('')
  const [heroStyle, setHeroStyle] = useState<'generic' | 'face' | 'product'>('generic')
  const [productImageUrl, setProductImageUrl] = useState('')
  // Opt-in: place images inside the article body (hero at top + one distinct
  // editorial image mid-article). Off by default (one extra image generation).
  const [inArticleImages, setInArticleImages] = useState(false)
  // Monetization: mention the creator's products/reviews THROUGHOUT the body, or
  // keep the article purely informational and only surface them at the end.
  const [productMode, setProductMode] = useState<'throughout' | 'end'>('end')
  // Topic suggestions (tied to the creator's existing reviews + niche).
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<{ topic: string; angle: string; keywords: string }[]>([])

  // 'preview' = Generate preview button, 'publish' = Generate & publish,
  // 'publishing' = the preview's "Publish to my blog" button. null = idle.
  const [busy, setBusy] = useState<null | 'preview' | 'publish' | 'publishing'>(null)
  const [preview, setPreview] = useState<{ title: string; html: string; heroUrl: string | null; meta: string; seoScore: number | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { if (!cancelled) setCanUse(false); return }
        const { data } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        const tier = normalizeTier((data as { tier?: string } | null)?.tier)
        // Entitled when the tier has an articles allowance: null (admin) or >0.
        // Only 0 (trial, Amazon) is blocked. Don't coalesce null→0 (that blocked admin).
        if (!cancelled) setCanUse(TIERS[tier]?.articlesPerMonth !== 0)
      } catch {
        if (!cancelled) setCanUse(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  function toggleSection(key: string) {
    setSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  async function run(publish: boolean) {
    const cleaned = topic.trim()
    if (!cleaned) { toast.error('Type a topic first'); return }
    if (sections.length === 0) { toast.error('Pick at least one section to include'); return }

    setBusy(publish ? 'publish' : 'preview')
    if (!publish) setPreview(null)
    try {
      const r = await fetch('/api/articles/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: cleaned, angle, sections, tone, length, keywords, notes, publish, heroStyle, productImageUrl, productMode, inArticleImages }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Generation failed')
      if (publish) {
        toast.success(`Published "${j.title}"`, {
          action: j.url ? { label: 'View', onClick: () => window.open(j.url, '_blank') } : undefined,
          duration: 12_000,
        })
        setPreview(null)
      } else {
        setPreview({ title: j.title, html: j.html, heroUrl: j.heroUrl ?? null, meta: j.meta ?? '', seoScore: j.seoScore ?? null })
        toast.success('Preview ready — review it below.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setBusy(null)
    }
  }

  /** Ask MVP for informational article topics tied to the creator's own
   *  reviews + niche. Picking one fills the topic / angle / keywords fields. */
  async function suggest() {
    setSuggesting(true)
    try {
      const r = await fetch('/api/articles/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not suggest topics')
      const list = Array.isArray(j.suggestions) ? j.suggestions : []
      setSuggestions(list)
      if (j.empty) toast.message(j.reason || 'Publish a few reviews or set your niche first.')
      else if (!list.length) toast.message('No suggestions right now — try again in a moment.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not suggest topics')
    } finally {
      setSuggesting(false)
    }
  }

  function useSuggestion(s: { topic: string; angle: string; keywords: string }) {
    setTopic(s.topic)
    setAngle(s.angle || '')
    if (s.keywords) setKeywords(s.keywords)
    setSuggestions([])
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Publish the exact article shown in the preview box — sends back the
   *  previewed title + HTML so the published post matches what was reviewed
   *  (no fresh writer run, no drift). */
  async function publishPreview() {
    if (!preview) return
    setBusy('publishing')
    try {
      const r = await fetch('/api/articles/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), sections, publish: true, title: preview.title, html: preview.html, heroUrl: preview.heroUrl, meta: preview.meta }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Publish failed')
      toast.success(`Published "${j.title}"`, {
        action: j.url ? { label: 'View', onClick: () => window.open(j.url, '_blank') } : undefined,
        duration: 12_000,
      })
      setPreview(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setBusy(null)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void run(false)
  }

  const generating = busy !== null

  // ── Entitlement gate ──────────────────────────────────────────────────
  if (canUse === false) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border p-8" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
              <FlaskConical className="w-6 h-6" style={{ color: '#7C3AED' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Articles</h1>
              <p className="text-sm mt-2" style={{ color: 'var(--fg-muted)' }}>
                Articles is a Creator, Studio and Pro feature. Upgrade to publish researched
                informational articles alongside your reviews.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (canUse === null) {
    return (
      <div className="rounded-xl border p-6 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
        <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
            <Newspaper className="w-6 h-6" style={{ color: '#7C3AED' }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Articles</h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,.12)', color: '#7C3AED' }}>
                New
              </span>
            </div>
            <p className="text-sm mt-1.5" style={{ color: 'var(--fg-muted)' }}>
              Generate a researched, opinionated informational article (not a product review). Give it a topic and your
              take, tick which sections to include, and MVP researches the topic on the web and writes a full article with
              facts, stats, a data table and chart, and an FAQ.
            </p>
          </div>
        </div>
      </div>

      {/* ── Form ─────────────────────────────────────────────────────── */}
      <form onSubmit={onSubmit} className="rounded-xl border p-6 space-y-5" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        {/* Topic */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>
            Topic <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="e.g. The health benefits of a Mediterranean diet"
            maxLength={200}
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border"
            style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
          />
          {/* Suggest topics tied to the creator's own reviews + niche */}
          <button
            type="button"
            onClick={suggest}
            disabled={generating || suggesting}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 border disabled:opacity-50"
            style={{ background: 'transparent', color: '#7C3AED', borderColor: '#7C3AED' }}
          >
            {suggesting ? 'Thinking…' : '✨ Suggest topics from my content'}
          </button>
          {suggestions.length > 0 && (
            <div className="mt-3 space-y-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => useSuggestion(s)}
                  className="w-full text-left rounded-lg border px-3.5 py-2.5 transition hover:border-[#7C3AED]"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{s.topic}</div>
                  {s.angle && <div className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>{s.angle}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Angle */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>
            Your angle / take <span style={{ color: 'var(--fg-muted)' }}>(optional)</span>
          </label>
          <textarea
            value={angle}
            onChange={e => setAngle(e.target.value)}
            placeholder="What's your opinion or spin? e.g. 'It's less about weight loss and more about long-term heart health.'"
            rows={2}
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border resize-y"
            style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
          />
        </div>

        {/* Sections */}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--fg)' }}>
            Include these sections
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {SECTIONS.map(s => {
              const on = sections.includes(s.key)
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSection(s.key)}
                  disabled={generating}
                  className="flex items-start gap-2.5 rounded-lg border p-3 text-left transition disabled:opacity-50"
                  style={{
                    background: on ? 'rgba(124,58,237,.08)' : 'var(--bg)',
                    borderColor: on ? '#7C3AED' : 'var(--border)',
                  }}
                >
                  <span
                    className="mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                    style={{ background: on ? '#7C3AED' : 'transparent', border: on ? 'none' : '1.5px solid var(--border)', color: '#fff' }}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium" style={{ color: 'var(--fg)' }}>{s.label}</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>{s.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Tone + Length */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>Tone</label>
            <select
              value={tone}
              onChange={e => setTone(e.target.value)}
              disabled={generating}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border"
              style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
            >
              {TONES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>Length</label>
            <div className="inline-flex items-center rounded-lg border p-1 w-full" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
              {LENGTHS.map(l => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLength(l.key)}
                  disabled={generating}
                  title={l.words}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition"
                  style={{
                    background: length === l.key ? '#7C3AED' : 'transparent',
                    color: length === l.key ? '#fff' : 'var(--fg-muted)',
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Keywords */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>
            Keywords <span style={{ color: 'var(--fg-muted)' }}>(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            placeholder="e.g. olive oil, heart health, longevity, blue zones"
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border"
            style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>
            Notes <span style={{ color: 'var(--fg-muted)' }}>(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything else the writer should know, sources to lean on, points to make…"
            rows={2}
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border resize-y"
            style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
          />
        </div>

        {/* Products / monetization mode */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>Your products</label>
          <div className="inline-flex items-center rounded-lg border p-1 w-full max-w-md" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
            {([
              { key: 'end', label: 'Only at the end' },
              { key: 'throughout', label: 'Throughout' },
            ] as const).map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => setProductMode(m.key)}
                disabled={generating}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold transition"
                style={{ background: productMode === m.key ? '#7C3AED' : 'transparent', color: productMode === m.key ? '#fff' : 'var(--fg-muted)' }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--fg-muted)' }}>
            {productMode === 'throughout'
              ? 'MVP links your most relevant reviews inline where they fit the article.'
              : 'Keeps the article informational; your related reviews appear in a block at the end.'}
          </p>
        </div>

        {/* Hero image style */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>Hero image</label>
          <div className="inline-flex items-center rounded-lg border p-1 w-full max-w-md" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
            {([
              { key: 'generic', label: 'Generic' },
              { key: 'face', label: 'With my face' },
              { key: 'product', label: 'Product' },
            ] as const).map(h => (
              <button
                key={h.key}
                type="button"
                onClick={() => setHeroStyle(h.key)}
                disabled={generating}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold transition"
                style={{ background: heroStyle === h.key ? '#7C3AED' : 'transparent', color: heroStyle === h.key ? '#fff' : 'var(--fg-muted)' }}
              >
                {h.label}
              </button>
            ))}
          </div>
          {heroStyle === 'face' && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--fg-muted)' }}>Uses your Face Model. If you haven&rsquo;t set one up, it falls back to a generic image.</p>
          )}
          {heroStyle === 'product' && (
            <input
              type="url"
              value={productImageUrl}
              onChange={e => setProductImageUrl(e.target.value)}
              placeholder="Paste a product image URL (used as the hero subject)"
              disabled={generating}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none border mt-2"
              style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
            />
          )}

          {/* In-article images toggle */}
          <label className="flex items-start gap-2.5 mt-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={inArticleImages}
              onChange={e => setInArticleImages(e.target.checked)}
              disabled={generating}
              className="mt-0.5 w-4 h-4 rounded accent-[#7C3AED] flex-shrink-0"
            />
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              <b style={{ color: 'var(--fg)' }}>Add images inside the article</b> &mdash; puts the hero photo at the top of the body and adds one more editorial image partway down, both with alt text. Adds one extra image to the render.
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button
            type="submit"
            disabled={generating || !topic.trim()}
            className="px-5"
            style={{ background: '#7C3AED', color: '#fff' }}
          >
            {busy === 'preview'
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Writing…</>
              : <><Sparkles className="w-4 h-4 mr-2" /> Generate preview</>}
          </Button>
          <Button
            type="button"
            onClick={() => void run(true)}
            disabled={generating || !topic.trim()}
            className="px-5"
            style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)' }}
          >
            {busy === 'publish'
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Publishing…</>
              : <><UploadCloud className="w-4 h-4 mr-2" /> Generate &amp; publish</>}
          </Button>
        </div>
        {generating && (
          <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            Researching the topic and writing the article. This usually takes 30 to 90 seconds.
          </p>
        )}
      </form>

      {/* ── Preview ──────────────────────────────────────────────────── */}
      {preview && (
        <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold" style={{ color: 'var(--fg)' }}>{preview.title}</h2>
                {typeof preview.seoScore === 'number' && (
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    title="On-page SEO / AI-discoverability score"
                    style={{
                      background: preview.seoScore >= 80 ? 'rgba(52,199,89,.15)' : preview.seoScore >= 60 ? 'rgba(255,149,0,.15)' : 'rgba(255,59,48,.15)',
                      color: preview.seoScore >= 80 ? '#248a3d' : preview.seoScore >= 60 ? '#b26a00' : '#c0392b',
                    }}
                  >
                    SEO {preview.seoScore}/100
                  </span>
                )}
              </div>
              {preview.meta && <p className="text-xs mt-1 italic" style={{ color: 'var(--fg-muted)' }}>{preview.meta}</p>}
              <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>Preview — nothing has been published yet.</p>
            </div>
            <Button
              onClick={() => void publishPreview()}
              disabled={generating}
              className="px-5 whitespace-nowrap flex-shrink-0"
              style={{ background: '#7C3AED', color: '#fff' }}
            >
              {busy === 'publishing'
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Publishing…</>
                : <><ExternalLink className="w-4 h-4 mr-2" /> Publish to my blog</>}
            </Button>
          </div>
          {preview.heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.heroUrl}
              alt=""
              className="w-full rounded-lg border mb-4 object-cover"
              style={{ borderColor: 'var(--border)', maxHeight: 360 }}
            />
          )}
          <div
            className="mvp-article-preview rounded-lg border p-5 overflow-x-auto"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--fg)', lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      )}
    </div>
  )
}
