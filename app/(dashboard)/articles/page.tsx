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
import { Newspaper, Sparkles, Loader2, ExternalLink, UploadCloud, FlaskConical, Layers, ChevronDown, Check, AlertCircle, RefreshCw } from 'lucide-react'
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
  // True brand voice (add-on D): write in the creator's trained voice (their LEARN
  // profile + writing sample) instead of a generic tone preset. voiceReady is null
  // while we check, then true/false once we know whether anything is trained.
  const [useMyVoice, setUseMyVoice] = useState(true)
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null)
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
  // Bulk mode — paste many topics, publish them one after another.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkTopics, setBulkTopics] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResults, setBulkResults] = useState<Array<{ topic: string; status: 'queued' | 'writing' | 'done' | 'error'; url?: string; error?: string }>>([])
  // Refresh — re-research a published article and update it in place.
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [articles, setArticles] = useState<Array<{ id: string; title: string; url: string | null; updatedAt: string | null }>>([])
  const [articlesLoading, setArticlesLoading] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  useEffect(() => {
    if (!refreshOpen || articles.length || articlesLoading) return
    setArticlesLoading(true)
    fetch('/api/articles/refresh').then(r => r.json()).then((j: { articles?: typeof articles }) => setArticles(j.articles ?? []))
      .catch(() => {}).finally(() => setArticlesLoading(false))
  }, [refreshOpen, articles.length, articlesLoading])

  async function refreshArticle(id: string) {
    if (refreshingId) return
    setRefreshingId(id)
    const t = toast.loading('Re-researching and updating the article…')
    try {
      const res = await fetch('/api/articles/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: id }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Refresh failed')
      setArticles(prev => prev.map(a => a.id === id ? { ...a, updatedAt: new Date().toISOString() } : a))
      toast.success('Article refreshed.', { id: t, action: j.url ? { label: 'View', onClick: () => window.open(j.url, '_blank') } : undefined, duration: 8000 })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Refresh failed', { id: t, duration: 8000 }) }
    finally { setRefreshingId(null) }
  }
  const [suggestions, setSuggestions] = useState<{ topic: string; angle: string; keywords: string }[]>([])

  // 'preview' = Generate preview button, 'publish' = Generate & publish,
  // 'publishing' = the preview's "Publish to my blog" button. null = idle.
  const [busy, setBusy] = useState<null | 'preview' | 'publish' | 'publishing'>(null)
  const [preview, setPreview] = useState<{ title: string; html: string; heroUrl: string | null; meta: string; seoScore: number | null; termCoverage: { score: number; covered: string[]; missing: string[] } | null; voiceUsed?: boolean; voiceWhy?: { fingerprint: string | null; usedLearn: boolean; usedSample: boolean; usedAvoid: number } | null } | null>(null)
  const [voiceWhyOpen, setVoiceWhyOpen] = useState(false)

  // Detect whether the creator has trained a voice yet (writing sample or any
  // filled LEARN section). If not, default the toggle off so we don't promise a
  // voice we can't deliver, and point them to Voice Training.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/learn')
        const j = await r.json().catch(() => ({}))
        const sample = (j?.writing_sample || '').trim()
        const lp = j?.learn_profile || {}
        const hasLearn = !!(lp && (
          (lp.voice && Object.keys(lp.voice).length) ||
          (lp.style && Object.values(lp.style).some(Boolean)) ||
          (Array.isArray(lp.speech_patterns) && lp.speech_patterns.length) ||
          (Array.isArray(lp.thought_process) && lp.thought_process.length)
        ))
        const ready = !!sample || hasLearn
        if (!cancelled) { setVoiceReady(ready); setUseMyVoice(ready) }
      } catch {
        if (!cancelled) { setVoiceReady(false); setUseMyVoice(false) }
      }
    })()
    return () => { cancelled = true }
  }, [])

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
        body: JSON.stringify({ topic: cleaned, angle, sections, tone, length, keywords, notes, publish, heroStyle, productImageUrl, productMode, inArticleImages, voiceMode: useMyVoice ? 'brand' : 'preset' }),
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
        setVoiceWhyOpen(false)
        setPreview({ title: j.title, html: j.html, heroUrl: j.heroUrl ?? null, meta: j.meta ?? '', seoScore: j.seoScore ?? null, termCoverage: j.termCoverage ?? null, voiceUsed: j.voiceUsed ?? false, voiceWhy: j.voiceWhy ?? null })
        toast.success('Preview ready — review it below.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setBusy(null)
    }
  }

  /** Bulk: publish one article per pasted topic, sequentially, using the current
   *  sections / tone / length. Each reuses the single-article endpoint. */
  async function runBulk() {
    const topics = bulkTopics.split('\n').map(t => t.trim()).filter(Boolean).slice(0, 25)
    if (!topics.length) { toast.error('Paste at least one topic (one per line).'); return }
    if (sections.length === 0) { toast.error('Pick at least one section to include'); return }
    setBulkRunning(true)
    setBulkResults(topics.map(t => ({ topic: t, status: 'queued' as const })))
    for (let i = 0; i < topics.length; i++) {
      setBulkResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'writing' } : r))
      try {
        const res = await fetch('/api/articles/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topics[i], angle, sections, tone, length, keywords, notes, publish: true, heroStyle, productMode, inArticleImages, voiceMode: useMyVoice ? 'brand' : 'preset' }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'Failed')
        setBulkResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'done', url: j.url } : r))
      } catch (e) {
        setBulkResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: e instanceof Error ? e.message : 'Failed' } : r))
      }
    }
    setBulkRunning(false)
    toast.success('Bulk run finished.')
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
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Articles</h1>
              <p className="text-sm mt-2" style={{ color: 'var(--text-2)' }}>
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
      <div className="rounded-xl border p-6 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
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
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Articles</h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,.12)', color: '#7C3AED' }}>
                New
              </span>
            </div>
            <p className="text-sm mt-1.5" style={{ color: 'var(--text-2)' }}>
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
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
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
            style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
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
                  <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{s.topic}</div>
                  {s.angle && <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{s.angle}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Angle */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
            Your angle / take <span style={{ color: 'var(--text-2)' }}>(optional)</span>
          </label>
          <textarea
            value={angle}
            onChange={e => setAngle(e.target.value)}
            placeholder="What's your opinion or spin? e.g. 'It's less about weight loss and more about long-term heart health.'"
            rows={2}
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border resize-y"
            style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
          />
        </div>

        {/* Sections */}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>
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
                    <span className="block text-sm font-medium" style={{ color: 'var(--text)' }}>{s.label}</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{s.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Voice: the creator's trained voice vs a generic tone preset. */}
        <div>
          <div className="flex items-start gap-3 rounded-xl border p-3.5"
            style={{ borderColor: useMyVoice ? 'rgba(124,58,237,0.35)' : 'var(--border)', background: useMyVoice ? 'linear-gradient(135deg, rgba(124,58,237,0.07), rgba(52,199,89,0.04))' : 'var(--bg)' }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: useMyVoice ? 'linear-gradient(135deg,#7C3AED,#34c759)' : 'rgba(124,58,237,0.10)', color: useMyVoice ? '#fff' : '#7C3AED' }}>
              <Sparkles size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Write in my trained voice</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useMyVoice}
                  disabled={generating}
                  onClick={() => setUseMyVoice(v => !v)}
                  className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition disabled:opacity-60"
                  style={{ background: useMyVoice ? '#7C3AED' : 'var(--border)' }}
                >
                  <span className="inline-block h-5 w-5 transform rounded-full bg-white transition" style={{ transform: useMyVoice ? 'translateX(22px)' : 'translateX(2px)' }} />
                </button>
              </div>
              <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-2)' }}>
                {useMyVoice
                  ? 'Uses your Voice Training (writing sample, taste and style) so the article sounds like you, not a generic AI blog.'
                  : 'Off — the article uses the plain tone preset below instead of your trained voice.'}
              </p>
              {voiceReady === false && (
                <p className="text-xs mt-1.5 leading-snug" style={{ color: '#b45309' }}>
                  You haven’t set up Voice Training yet, so this falls back to the tone preset.{' '}
                  <a href="/learn" className="underline font-medium" style={{ color: '#7C3AED' }}>Train your voice</a> to make articles sound like you.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tone + Length */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Tone</label>
            <select
              value={tone}
              onChange={e => setTone(e.target.value)}
              disabled={generating || useMyVoice}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none border disabled:opacity-50"
              style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
            >
              {TONES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {useMyVoice && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>Your trained voice is on, so the tone preset is set aside.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Length</label>
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
                    color: length === l.key ? '#fff' : 'var(--text-2)',
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
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
            Keywords <span style={{ color: 'var(--text-2)' }}>(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            placeholder="e.g. olive oil, heart health, longevity, blue zones"
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border"
            style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
            Notes <span style={{ color: 'var(--text-2)' }}>(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything else the writer should know, sources to lean on, points to make…"
            rows={2}
            disabled={generating}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none border resize-y"
            style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
          />
        </div>

        {/* Products / monetization mode */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Your products</label>
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
                style={{ background: productMode === m.key ? '#7C3AED' : 'transparent', color: productMode === m.key ? '#fff' : 'var(--text-2)' }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-2)' }}>
            {productMode === 'throughout'
              ? 'MVP links your most relevant reviews inline where they fit the article.'
              : 'Keeps the article informational; your related reviews appear in a block at the end.'}
          </p>
        </div>

        {/* Hero image style */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Hero image</label>
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
                style={{ background: heroStyle === h.key ? '#7C3AED' : 'transparent', color: heroStyle === h.key ? '#fff' : 'var(--text-2)' }}
              >
                {h.label}
              </button>
            ))}
          </div>
          {heroStyle === 'face' && (
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-2)' }}>Uses your Face Model. If you haven&rsquo;t set one up, it falls back to a generic image.</p>
          )}
          {heroStyle === 'product' && (
            <input
              type="url"
              value={productImageUrl}
              onChange={e => setProductImageUrl(e.target.value)}
              placeholder="Paste a product image URL (used as the hero subject)"
              disabled={generating}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none border mt-2"
              style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
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
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>
              <b style={{ color: 'var(--text)' }}>Add images inside the article</b> &mdash; puts the hero photo at the top of the body and adds one more editorial image partway down, both with alt text. Adds one extra image to the render.
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
            style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
          >
            {busy === 'publish'
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Publishing…</>
              : <><UploadCloud className="w-4 h-4 mr-2" /> Generate &amp; publish</>}
          </Button>
        </div>
        {generating && (
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>
            Researching the topic and writing the article. This usually takes 30 to 90 seconds.
          </p>
        )}
      </form>

      {/* ── Bulk generate ────────────────────────────────────────────── */}
      <div className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <button onClick={() => setBulkOpen(o => !o)} className="w-full flex items-center justify-between gap-2 p-4 text-left">
          <span className="inline-flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4" style={{ color: '#7C3AED' }} />
            <span className="font-semibold" style={{ color: 'var(--text)' }}>Bulk generate</span>
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>Publish many articles from a list of topics</span>
          </span>
          <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-2)', transform: bulkOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        {bulkOpen && (
          <div className="px-4 pb-4">
            <textarea
              value={bulkTopics}
              onChange={e => setBulkTopics(e.target.value)}
              rows={5}
              placeholder={'One topic per line, e.g.\nHow to pack a carry-on without wrinkles\nWhy your lumbar pillow isn’t working\nEmergency food storage: what lasts vs. what spoils'}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'var(--border)' }}
            />
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Button onClick={() => void runBulk()} disabled={bulkRunning || !bulkTopics.trim()} className="px-5" style={{ background: '#7C3AED', color: '#fff' }}>
                {bulkRunning ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Publishing…</> : <><UploadCloud className="w-4 h-4 mr-2" /> Publish all</>}
              </Button>
              <span className="text-xs" style={{ color: 'var(--text-2)' }}>Uses your current sections, tone and length. Up to 25 at a time; each takes ~1 minute.</span>
            </div>
            {bulkResults.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {bulkResults.map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {r.status === 'done' ? <Check className="w-3.5 h-3.5" style={{ color: '#248a3d' }} />
                      : r.status === 'error' ? <AlertCircle className="w-3.5 h-3.5" style={{ color: '#c0392b' }} />
                      : r.status === 'writing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#7C3AED' }} />
                      : <span className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: 'var(--border)' }} />}
                    <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{r.topic}</span>
                    {r.status === 'done' && r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium inline-flex items-center gap-0.5" style={{ color: '#7C3AED' }}>View <ExternalLink className="w-3 h-3" /></a>}
                    {r.status === 'error' && <span className="text-xs" style={{ color: '#c0392b' }}>{r.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Refresh published articles ───────────────────────────────── */}
      <div className="rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <button onClick={() => setRefreshOpen(o => !o)} className="w-full flex items-center justify-between gap-2 p-4 text-left">
          <span className="inline-flex items-center gap-2 min-w-0">
            <RefreshCw className="w-4 h-4" style={{ color: '#7C3AED' }} />
            <span className="font-semibold" style={{ color: 'var(--text)' }}>Refresh a published article</span>
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>Re-research and update the facts, in place</span>
          </span>
          <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-2)', transform: refreshOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        {refreshOpen && (
          <div className="px-4 pb-4">
            {articlesLoading ? (
              <p className="text-sm inline-flex items-center gap-2" style={{ color: 'var(--text-2)' }}><Loader2 className="w-4 h-4 animate-spin" /> Loading your articles…</p>
            ) : articles.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-2)' }}>No published articles yet. Publish one above and it will show here to refresh later.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {articles.map(a => (
                  <li key={a.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{a.title}</span>
                    {a.updatedAt && <span className="text-[11px] shrink-0" style={{ color: 'var(--text-2)' }}>updated {new Date(a.updatedAt).toLocaleDateString()}</span>}
                    <button onClick={() => void refreshArticle(a.id)} disabled={!!refreshingId} className="text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50" style={{ color: '#7C3AED' }}>
                      {refreshingId === a.id ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…</> : <><RefreshCw className="w-3.5 h-3.5" /> Refresh</>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Preview ──────────────────────────────────────────────────── */}
      {preview && (
        <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{preview.title}</h2>
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
                {preview.termCoverage && (
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    title={preview.termCoverage.missing.length ? `Not yet covered: ${preview.termCoverage.missing.join(', ')}` : 'Covers every key subtopic the top pages cover'}
                    style={{
                      background: preview.termCoverage.score >= 80 ? 'rgba(52,199,89,.15)' : preview.termCoverage.score >= 60 ? 'rgba(255,149,0,.15)' : 'rgba(255,59,48,.15)',
                      color: preview.termCoverage.score >= 80 ? '#248a3d' : preview.termCoverage.score >= 60 ? '#b26a00' : '#c0392b',
                    }}
                  >
                    Topic coverage {preview.termCoverage.score}%
                  </span>
                )}
                {preview.voiceUsed && (
                  <button
                    type="button"
                    onClick={() => setVoiceWhyOpen(o => !o)}
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 transition-opacity hover:opacity-80"
                    title="See why this sounds like you"
                    style={{ background: 'rgba(124,58,237,.15)', color: '#6d28d9' }}
                  >
                    <Sparkles size={11} /> In your voice
                    <ChevronDown size={11} style={{ transform: voiceWhyOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                  </button>
                )}
              </div>
              {preview.voiceUsed && voiceWhyOpen && (
                <div className="mt-2 rounded-lg border p-3 text-xs" style={{ borderColor: 'rgba(124,58,237,0.25)', background: 'rgba(124,58,237,0.05)', color: 'var(--text)' }}>
                  <p className="font-semibold mb-1" style={{ color: '#6d28d9' }}>Why this sounds like you</p>
                  {preview.voiceWhy?.fingerprint && (
                    <p className="leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{preview.voiceWhy.fingerprint}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {preview.voiceWhy?.fingerprint && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>Learned from your videos</span>}
                    {preview.voiceWhy?.usedLearn && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>Your Voice Training answers</span>}
                    {preview.voiceWhy?.usedSample && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>Your writing sample</span>}
                    {!!preview.voiceWhy?.usedAvoid && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>{preview.voiceWhy.usedAvoid} words you avoid</span>}
                  </div>
                  <p className="mt-2" style={{ color: 'var(--text-2)' }}>
                    Want to shape this? <a href="/learn" className="underline font-medium" style={{ color: '#7C3AED' }}>Edit your Voice Training</a>.
                  </p>
                </div>
              )}
              {preview.termCoverage && preview.termCoverage.missing.length > 0 && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>
                  Competitors also cover: {preview.termCoverage.missing.slice(0, 8).join(', ')}. Add a line on the relevant ones to rank fuller.
                </p>
              )}
              {preview.meta && <p className="text-xs mt-1 italic" style={{ color: 'var(--text-2)' }}>{preview.meta}</p>}
              <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>Preview — nothing has been published yet.</p>
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
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)', lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      )}
    </div>
  )
}
