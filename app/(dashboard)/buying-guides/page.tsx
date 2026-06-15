// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Buying Guides v1.1 — keyword/topic-centric UI.
//
// Two ways to start a guide:
//   1. Type a topic in the input (free-text, lowest friction)
//   2. Click a SUGGESTED-TOPIC chip — these come from the server, which
//      clusters reviews by shared seo_keyword tokens (any phrase that
//      appears across ≥3 reviews surfaces here)
//
// One in-flight generation at a time. Toast carries a "View" action linking
// to the live published post.

'use client'

import { useEffect, useState, FormEvent } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { BookOpen, Sparkles, ExternalLink, Loader2, ArrowRight, Lock, Zap, Eye, X, CheckCircle2, Trash2, Library, ListChecks, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { type Tier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'

// "Pick my own" mode shares the same URL count cap as /comparison did.
const MAX_MANUAL_URLS = 10

interface Suggestion { topic: string; count: number }
interface GuideRow { id: string; title: string; url: string | null; topic: string | null; created_at: string }
interface PreviewPick { wordpress_url: string; title: string; excerpt: string | null; image: string | null; label: string }

type Mode = 'auto' | 'review'

export default function BuyingGuidesPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [guides, setGuides] = useState<GuideRow[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reviewCount, setReviewCount] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState('')
  const [generating, setGenerating] = useState(false)
  // Catalogue gate — the GET returns { locked: true, threshold, currentPostCount }
  // when the user's live WP catalogue is below 500 posts. We render a
  // locked card instead of the topic input.
  const [locked, setLocked] = useState<{ threshold: number; current: number } | null>(null)
  // Tier restructure 2026-06-04: Buying Guides is Pro-only. Creator + Studio
  // users see the FeatureLockedCard upsell instead of the catalogue-lock OR
  // the topic input. tier === null = still loading (avoids flashing the
  // lock card to Pro users while we fetch).
  const [tier, setTier] = useState<Tier | null>(null)
  // FULL AUTO vs LET ME SEE — review the AI's picks before publishing.
  // Persisted in localStorage so the preference sticks across visits.
  const [mode, setMode] = useState<Mode>('review')

  // Source: 'catalogue' = auto-pick from your existing reviews (the
  // headline feature, but needs 500+ posts). 'manual' = paste YouTube
  // URLs of specific products (the workflow that used to live in
  // /comparison's Guide mode — moved here 2026-06-04 to consolidate).
  // 'manual' has no catalogue threshold; Pro tier is the only gate.
  const [source, setSource] = useState<'catalogue' | 'manual'>('catalogue')
  const [manualUrls, setManualUrls] = useState<string[]>(['', ''])
  const [manualTopic, setManualTopic] = useState<string>('')
  const manualValidCount = manualUrls.filter(u => u.trim()).length
  const setManualUrl = (i: number, v: string) =>
    setManualUrls(prev => prev.map((u, idx) => (idx === i ? v : u)))
  const addManualUrl = () =>
    setManualUrls(prev => prev.length >= MAX_MANUAL_URLS ? prev : [...prev, ''])
  const removeManualUrl = (i: number) =>
    setManualUrls(prev => prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i))
  // Two-phase preview state. When the user (in review mode) submits a
  // topic, the server returns picks; we render them as editable cards
  // until the user clicks Publish.
  const [previewPicks, setPreviewPicks] = useState<PreviewPick[] | null>(null)
  const [previewTopic, setPreviewTopic] = useState<string>('')

  // Prefill the topic from ?topic= (deep link from the /seo "Search demand
  // you're missing" card — Phase 3 GSC loop). window.location instead of
  // useSearchParams so we don't need a Suspense boundary on this page. Fills
  // BOTH topic inputs so the prefill survives a catalogue↔manual mode switch.
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('topic')
      if (t && t.trim()) { setTopic(t.trim()); setManualTopic(t.trim()) }
    } catch { /* SSR / no window */ }
  }, [])

  // Load mode pref once on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mvp_bg_mode')
      if (saved === 'auto' || saved === 'review') setMode(saved)
    } catch { /* localStorage unavailable */ }
  }, [])

  function updateMode(next: Mode) {
    setMode(next)
    try { localStorage.setItem('mvp_bg_mode', next) } catch { /* ignore */ }
  }

  // Fetch user tier on mount + re-resolve when the admin View-as override
  // changes. effectiveTier() honors the localStorage override for admins
  // so this page renders the FeatureLockedCard when an admin "views as"
  // Creator/Trial/Studio. Non-admins always see their real tier.
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }

    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        const { data } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch {
        realTier = 'trial'
        apply()
      }
    })()

    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])

  useEffect(() => { void refresh() }, [])

  async function refresh() {
    setLoading(true)
    try {
      const r = await fetch('/api/buying-guides')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      if (j.locked) {
        setLocked({ threshold: j.threshold ?? 500, current: j.currentPostCount ?? 0 })
        setSuggestions([])
        setGuides([])
        setReviewCount(0)
      } else {
        setLocked(null)
        setSuggestions(j.suggestions || [])
        setGuides(j.guides || [])
        setReviewCount(j.reviewCount || 0)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  /** Phase 1: run the picker. If mode === 'auto', the server then writes
   *  + publishes in the same request (preview flag false). If mode ===
   *  'review', the server returns picks for the user to approve. */
  async function generate(t: string) {
    const cleaned = t.trim()
    if (!cleaned) {
      toast.error('Type a topic first')
      return
    }
    setGenerating(true)
    setPreviewPicks(null)
    try {
      const r = await fetch('/api/buying-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: cleaned, preview: mode === 'review' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Generation failed')
      if (j.preview) {
        // LET ME SEE — render the picks for approval.
        setPreviewPicks(j.picks || [])
        setPreviewTopic(j.topic || cleaned)
      } else {
        // FULL AUTO — published already.
        toast.success(`Published "${j.title}"`, {
          action: { label: 'View', onClick: () => window.open(j.url, '_blank') },
          duration: 12_000,
        })
        setTopic('')
        void refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  /** Phase 2: user approved the picks (possibly modified). Server skips
   *  the picker and runs writer + publish on the approved set. */
  async function publishApproved() {
    if (!previewPicks || previewPicks.length < 3) {
      toast.error('Keep at least 3 picks to publish')
      return
    }
    setGenerating(true)
    try {
      const r = await fetch('/api/buying-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: previewTopic,
          approvedPicks: previewPicks.map(p => ({ wordpress_url: p.wordpress_url, label: p.label })),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Publish failed')
      toast.success(`Published "${j.title}"`, {
        action: { label: 'View', onClick: () => window.open(j.url, '_blank') },
        duration: 12_000,
      })
      setTopic('')
      setPreviewPicks(null)
      setPreviewTopic('')
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setGenerating(false)
    }
  }

  function removePick(url: string) {
    setPreviewPicks(prev => prev ? prev.filter(p => p.wordpress_url !== url) : prev)
  }
  function updatePickLabel(url: string, label: string) {
    setPreviewPicks(prev => prev ? prev.map(p => p.wordpress_url === url ? { ...p, label } : p) : prev)
  }
  function discardPreview() {
    setPreviewPicks(null)
    setPreviewTopic('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void generate(topic)
  }

  /** "Pick my own" mode submit — paste 2-10 YouTube URLs, MVP writes a
   *  guide ranking just those products. Hits /api/blog/comparison with
   *  format='guide', same code path the old /comparison page used. */
  async function generateManual(e: FormEvent) {
    e.preventDefault()
    const urls = manualUrls.map(u => u.trim()).filter(Boolean)
    if (urls.length < 2) {
      toast.error('Add at least 2 product videos')
      return
    }
    setGenerating(true)
    try {
      const r = await fetch('/api/blog/comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrls: urls,
          format: 'guide',
          topic: manualTopic.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      // Duplicate guard: a guide/comparison from these exact videos already
      // exists. Point the user at it instead of posting a second one.
      if (r.status === 409 && j.duplicate) {
        toast.error(j.error || 'You already published a guide from these videos.', {
          action: j.existingUrl ? { label: 'View existing', onClick: () => window.open(j.existingUrl, '_blank') } : undefined,
          duration: 12_000,
        })
        return
      }
      if (!r.ok) throw new Error(j.error || 'Generation failed')
      toast.success(`Published "${j.title}"`, {
        action: { label: 'View', onClick: () => window.open(j.url, '_blank') },
        duration: 12_000,
      })
      // Reset form + refresh the Recent guides list so the new post
      // shows up. Catalogue-side refresh() is fine here even though we
      // didn't go through /api/buying-guides — the new row has
      // post_type='guide' so the list query picks it up.
      setManualUrls(['', ''])
      setManualTopic('')
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  /** Delete a guide. Two-step: confirm → DELETE /api/buying-guides which
   *  removes the WP post AND the MVP blog_posts row (if any). */
  async function deleteGuide(g: GuideRow) {
    const ok = await confirm({
      title: 'Delete this guide?',
      description: `"${g.title}" will be removed from your WordPress blog and your library. This can't be undone.`,
      confirmLabel: 'Delete guide',
      destructive: true,
    })
    if (!ok) return
    setDeletingId(g.id)
    // Optimistic remove so the row goes away immediately — if the request
    // errors we put it back.
    const prevGuides = guides
    setGuides(prev => prev.filter(x => x.id !== g.id))
    try {
      const r = await fetch('/api/buying-guides', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: g.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Delete failed (${r.status})`)
      toast.success('Guide deleted.')
    } catch (err) {
      setGuides(prevGuides) // rollback
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Tier gate ────────────────────────────────────────────────────
  // Buying Guides is Pro-only as of the 2026-06-04 tier restructure.
  // Non-Pro users see the FeatureLockedCard upsell. Render this BEFORE
  // the catalogue lock so a Creator with 500+ WP posts doesn't get a
  // misleading "you have enough posts!" view.
  if (tier !== null && tier !== 'pro' && tier !== 'admin') {
    return (
      <FeatureLockedCard
        icon={<BookOpen size={28} strokeWidth={1.8} />}
        feature="Buying Guides"
        description='Long-form "Best [topic] for 2026" round-ups in your voice — either auto-curated from your existing review catalogue or built from a handful of YouTube URLs you specify. Slots picks into Best Overall / Best Budget / Best for X, writes the guide, publishes to WordPress.'
        bullets={[
          'Two ways to start: pick from your catalogue OR paste 2-10 YouTube URLs of your own',
          '"Pick from my catalogue" auto-curates 5-7 best-fit reviews (unlocks at 500+ published posts)',
          '"Pick my own" works immediately — no catalogue threshold',
          'Auto-slots picks into Best Overall, Best Budget, Best for X categories',
          'Tagged "buying-guide" in WordPress for clean filtering',
          'Full Auto (publish immediately) or Let Me See (approve picks first) sub-modes',
        ]}
        requiredTier="pro"
        currentTier={tier}
      />
    )
  }

  // ── Catalogue-locked state ──────────────────────────────────────
  // Only blocks when source === 'catalogue'. Users in 'manual' mode
  // bypass the 500-post threshold entirely — they're picking products
  // themselves. The lock card now offers a one-click switch to manual
  // mode so creators aren't dead-ended.
  if (locked && source === 'catalogue') {
    const remaining = Math.max(0, locked.threshold - locked.current)
    return (
      <div className="space-y-6">
        <div className="rounded-xl border p-8" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
              <Lock className="w-6 h-6" style={{ color: '#7C3AED' }} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Auto-curate is locked</h1>
              <p className="text-sm mt-2" style={{ color: 'var(--fg-muted)' }}>
                The catalogue round-up format needs a wide library to produce diverse picks. Unlocks automatically
                once your live blog has <strong>{locked.threshold} published posts</strong>. Or skip the wait
                and pick the products yourself below.
              </p>
              <div className="mt-4 rounded-lg border p-4" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-bold" style={{ color: 'var(--fg)' }}>{locked.current}</div>
                  <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>/ {locked.threshold} posts</div>
                </div>
                <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full" style={{
                    width: `${Math.min(100, (locked.current / locked.threshold) * 100)}%`,
                    background: '#7C3AED',
                  }} />
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--fg-muted)' }}>
                  {remaining > 0 ? `${remaining} more to unlock.` : 'Refresh — you should be unlocked.'}
                </p>
              </div>
              <Button
                onClick={() => setSource('manual')}
                className="mt-5 px-5"
                style={{ background: '#7C3AED', color: '#fff' }}
              >
                <ListChecks className="w-4 h-4 mr-2" />
                Pick the products myself instead
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Source toggle: pick from catalogue vs paste your own URLs.
          Sits at the very top so the user knows what input shape they
          are about to fill in. */}
      <div
        role="tablist"
        aria-label="Where do the products come from?"
        className="inline-flex items-center rounded-lg border p-1 text-xs font-semibold"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={source === 'catalogue'}
          onClick={() => setSource('catalogue')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md transition"
          style={{
            background: source === 'catalogue' ? '#7C3AED' : 'transparent',
            color: source === 'catalogue' ? '#fff' : 'var(--fg-muted)',
          }}
        >
          <Library className="w-3.5 h-3.5" /> Pick from my catalogue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'manual'}
          onClick={() => setSource('manual')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md transition"
          style={{
            background: source === 'manual' ? '#7C3AED' : 'transparent',
            color: source === 'manual' ? '#fff' : 'var(--fg-muted)',
          }}
        >
          <ListChecks className="w-3.5 h-3.5" /> Pick my own
        </button>
      </div>

      {/* ── Hero + topic input ─────────────────────────────────────── */}
      <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
            <BookOpen className="w-6 h-6" style={{ color: '#7C3AED' }} />
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Buying Guides</h1>
                <p className="text-sm mt-1.5" style={{ color: 'var(--fg-muted)' }}>
                  {source === 'catalogue' ? (
                    <>
                      Generate a long-form &ldquo;Best [topic] for {new Date().getUTCFullYear()}&rdquo; round-up from your published reviews.
                      The AI picks 5–7 best-fit reviews, slots them as Best Overall / Best Budget / Best for X, writes the guide, and publishes to your blog tagged{' '}
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>buying-guide</span>.
                    </>
                  ) : (
                    <>
                      Paste 2–10 YouTube URLs (one product per video). MVP ranks them, writes a &ldquo;best for ___&rdquo; guide, generates images, and publishes to your blog tagged{' '}
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>buying-guide</span>. No catalogue threshold — works from day one.
                    </>
                  )}
                </p>
              </div>
              {/* Mode toggle — FULL AUTO publishes immediately; LET ME SEE
                  shows picks first so you can edit labels or drop ones you
                  don't like before the writer runs. Only shown for the
                  catalogue source; manual mode always renders a single
                  preview-free generate flow (no picker stage to review). */}
              {source === 'catalogue' && (
                <div
                  role="radiogroup"
                  aria-label="Generation mode"
                  className="inline-flex items-center rounded-lg border p-1 text-xs font-semibold flex-shrink-0"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'auto'}
                    onClick={() => updateMode('auto')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition"
                    style={{
                      background: mode === 'auto' ? '#7C3AED' : 'transparent',
                      color: mode === 'auto' ? '#fff' : 'var(--fg-muted)',
                    }}
                  >
                    <Zap className="w-3.5 h-3.5" /> Full auto
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'review'}
                    onClick={() => updateMode('review')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition"
                    style={{
                      background: mode === 'review' ? '#7C3AED' : 'transparent',
                      color: mode === 'review' ? '#fff' : 'var(--fg-muted)',
                    }}
                  >
                    <Eye className="w-3.5 h-3.5" /> Let me see
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CATALOGUE source — type a topic, AI picks from your reviews. */}
        {source === 'catalogue' && (
          <>
            <form onSubmit={onSubmit} className="flex gap-2">
              <input
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="e.g. sleep masks for side sleepers, cooling pillows, under-eye masks…"
                maxLength={200}
                disabled={generating}
                className="flex-1 rounded-lg px-4 py-3 text-sm outline-none border"
                style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
              />
              <Button
                type="submit"
                disabled={generating || !topic.trim()}
                className="px-5 whitespace-nowrap"
                style={{ background: '#7C3AED', color: '#fff' }}
              >
                {generating ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Writing…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Generate</>
                )}
              </Button>
            </form>

            <p className="text-xs mt-3" style={{ color: 'var(--fg-muted)' }}>
              {loading ? 'Scanning your library…' : `${reviewCount} published reviews in your catalogue.`}
              {mode === 'auto' && <span className="ml-2" style={{ color: '#dc2626' }}>· Full auto mode publishes immediately.</span>}
            </p>
          </>
        )}

        {/* MANUAL source — paste 2-10 YouTube URLs, MVP ranks + writes
            the guide. No catalogue threshold. */}
        {source === 'manual' && (
          <form onSubmit={generateManual} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>
                Topic / title <span style={{ color: 'var(--fg-muted)' }}>(optional — MVP infers it from your videos)</span>
              </label>
              <input
                type="text"
                value={manualTopic}
                onChange={e => setManualTopic(e.target.value)}
                placeholder='e.g. "Best Wine Travel Protectors in 2026"'
                maxLength={200}
                disabled={generating}
                className="w-full rounded-lg px-4 py-3 text-sm outline-none border"
                style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--fg)' }}>
                YouTube video URLs <span style={{ color: 'var(--fg-muted)' }}>({manualValidCount}/{MAX_MANUAL_URLS} — one product per video)</span>
              </label>
              <div className="flex flex-col gap-2">
                {manualUrls.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs w-5 text-right" style={{ color: 'var(--fg-muted)' }}>{i + 1}.</span>
                    <input
                      type="url"
                      value={u}
                      onChange={e => setManualUrl(i, e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=…"
                      disabled={generating}
                      className="flex-1 rounded-lg px-3 py-2 text-sm outline-none border"
                      style={{ background: 'var(--bg)', color: 'var(--fg)', borderColor: 'var(--border)' }}
                    />
                    {manualUrls.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeManualUrl(i)}
                        disabled={generating}
                        className="p-1.5 rounded-md transition"
                        style={{ color: 'var(--fg-muted)' }}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {manualUrls.length < MAX_MANUAL_URLS && (
                <button
                  type="button"
                  onClick={addManualUrl}
                  disabled={generating}
                  className="mt-2 flex items-center gap-1.5 text-xs font-medium hover:underline disabled:opacity-50"
                  style={{ color: '#7C3AED' }}
                >
                  <Plus size={13} /> Add another product
                </button>
              )}
            </div>

            <Button
              type="submit"
              disabled={generating || manualValidCount < 2}
              className="px-5"
              style={{ background: '#7C3AED', color: '#fff' }}
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Researching & writing…</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate guide</>
              )}
            </Button>
            {generating && (
              <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                Resolving each product, ranking, generating images, and publishing. Usually a minute or two.
              </p>
            )}
          </form>
        )}
      </div>

      {/* ── LET ME SEE preview cards (only shown after picker runs) ─ */}
      {previewPicks && previewPicks.length > 0 && (
        <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--fg)' }}>
                Review the AI&rsquo;s picks
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--fg-muted)' }}>
                Topic: <strong>&ldquo;{previewTopic}&rdquo;</strong> · {previewPicks.length} pick{previewPicks.length === 1 ? '' : 's'} · edit labels or remove any you don&rsquo;t want before publishing.
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                onClick={discardPreview}
                disabled={generating}
                className="px-4"
                style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)' }}
              >
                Discard
              </Button>
              <Button
                onClick={() => void publishApproved()}
                disabled={generating || previewPicks.length < 3}
                className="px-5 whitespace-nowrap"
                style={{ background: '#7C3AED', color: '#fff' }}
              >
                {generating ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Writing…</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Publish these {previewPicks.length} picks</>
                )}
              </Button>
            </div>
          </div>
          {previewPicks.length < 3 && (
            <p className="text-xs mb-3" style={{ color: '#dc2626' }}>
              Need at least 3 picks to publish.
            </p>
          )}
          <div className="grid gap-3">
            {previewPicks.map((p, i) => (
              <div
                key={p.wordpress_url}
                className="flex items-start gap-3 rounded-lg border p-3"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div className="flex-shrink-0 w-20 h-14 rounded-md overflow-hidden bg-gray-100" style={{
                  backgroundImage: p.image ? `url(${p.image})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold" style={{ background: 'rgba(124,58,237,.12)', color: '#7C3AED' }}>
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={p.label}
                      onChange={e => updatePickLabel(p.wordpress_url, e.target.value.slice(0, 60))}
                      disabled={generating}
                      className="flex-1 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded outline-none border"
                      style={{ background: 'var(--panel)', color: '#7C3AED', borderColor: 'var(--border)' }}
                    />
                  </div>
                  <div className="font-medium text-sm truncate" style={{ color: 'var(--fg)' }} title={p.title}>{p.title}</div>
                  {p.excerpt && (
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--fg-muted)' }}>{p.excerpt}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removePick(p.wordpress_url)}
                  disabled={generating}
                  className="flex-shrink-0 p-1.5 rounded-md hover:bg-red-50 disabled:opacity-40"
                  title="Remove this pick"
                  aria-label="Remove pick"
                >
                  <X className="w-4 h-4" style={{ color: '#dc2626' }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Suggested topics (from clustering) ─────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--fg-muted)' }}>
          Suggested topics from your library
        </h2>
        {loading ? (
          <div className="rounded-xl border p-6 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" /> Loading…
          </div>
        ) : suggestions.length === 0 ? (
          <div className="rounded-xl border p-6 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            <p>No topic clusters with 3+ reviews yet.</p>
            <p className="text-xs mt-2">You can still type any topic above — the AI will pull whatever matches.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button
                key={s.topic}
                onClick={() => { setTopic(s.topic); void generate(s.topic) }}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition hover:border-purple-400 disabled:opacity-50"
                style={{ background: 'var(--panel)', color: 'var(--fg)', borderColor: 'var(--border)' }}
              >
                <span className="capitalize">{s.topic}</span>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,.12)', color: '#7C3AED' }}>
                  {s.count}
                </span>
                <ArrowRight className="w-3.5 h-3.5 opacity-50" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent guides ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--fg-muted)' }}>
          Recent guides
        </h2>
        {guides.length === 0 ? (
          <div className="rounded-xl border p-6 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            No guides published yet.
          </div>
        ) : (
          <div className="rounded-xl border divide-y" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
            {guides.map(g => (
              <div key={g.id} className="p-4 flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate" style={{ color: 'var(--fg)' }} title={g.title}>{g.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    {g.topic && <span className="capitalize">{g.topic}</span>}
                    {g.topic && ' · '}
                    {new Date(g.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {g.url && (
                    <Link
                      href={g.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ background: 'var(--bg)', color: 'var(--fg)' }}
                      title={g.title}
                    >
                      View <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteGuide(g)}
                    disabled={deletingId === g.id}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg border transition hover:border-red-300 hover:bg-red-50 disabled:opacity-40"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    title="Delete guide"
                    aria-label="Delete guide"
                  >
                    {deletingId === g.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmHost />
    </div>
  )
}
