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
import { BookOpen, Sparkles, ExternalLink, Loader2, ArrowRight, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Suggestion { topic: string; count: number }
interface GuideRow { id: string; title: string; url: string | null; topic: string | null; created_at: string }

export default function BuyingGuidesPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [guides, setGuides] = useState<GuideRow[]>([])
  const [reviewCount, setReviewCount] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState('')
  const [generating, setGenerating] = useState(false)
  // Catalogue gate — the GET returns { locked: true, threshold, currentPostCount }
  // when the user's live WP catalogue is below 500 posts. We render a
  // locked card instead of the topic input.
  const [locked, setLocked] = useState<{ threshold: number; current: number } | null>(null)

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

  async function generate(t: string) {
    const cleaned = t.trim()
    if (!cleaned) {
      toast.error('Type a topic first')
      return
    }
    setGenerating(true)
    try {
      const r = await fetch('/api/buying-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: cleaned }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Generation failed')
      toast.success(`Published "${j.title}"`, {
        action: { label: 'View', onClick: () => window.open(j.url, '_blank') },
        duration: 12_000,
      })
      setTopic('')
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void generate(topic)
  }

  // ── Locked state ────────────────────────────────────────────────
  // Renders a single explanatory card when the live WP catalogue is
  // below the unlock threshold. Sidebar already hides the entry; this
  // is the safety net for direct-URL navigation.
  if (locked) {
    const remaining = Math.max(0, locked.threshold - locked.current)
    return (
      <div className="space-y-6">
        <div className="rounded-xl border p-8" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
              <Lock className="w-6 h-6" style={{ color: '#7C3AED' }} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Buying Guides — locked</h1>
              <p className="text-sm mt-2" style={{ color: 'var(--fg-muted)' }}>
                The round-up format needs a wide catalogue to produce diverse, useful guides. Unlocks automatically
                once your live blog has <strong>{locked.threshold} published posts</strong>.
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
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Hero + topic input ─────────────────────────────────────── */}
      <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-4 mb-5">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
            <BookOpen className="w-6 h-6" style={{ color: '#7C3AED' }} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Buying Guides</h1>
            <p className="text-sm mt-1.5" style={{ color: 'var(--fg-muted)' }}>
              Generate a long-form &ldquo;Best [topic] for {new Date().getUTCFullYear()}&rdquo; round-up from your published reviews.
              The AI picks 5–7 best-fit reviews, slots them as Best Overall / Best Budget / Best for X, writes the guide, and publishes to your blog tagged{' '}
              <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>buying-guide</span>.
            </p>
          </div>
        </div>

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
        </p>
      </div>

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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
