// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Buying Guides v1 — minimum-viable UI so the user can click a category +
// publish a "Best X for [year]" guide that lives on their blog.
//
// Layout: hero card explaining what this does, then two sections —
//   1. Categories with ≥3 published reviews ("Generate" button each)
//   2. Recently published guides (link out)
//
// Future passes will add: scheduling, custom titles, image regeneration per
// pick, per-pick reorder, multi-site picker. v1 picks defaults.

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { BookOpen, Sparkles, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CategoryRow { category: string; count: number }
interface GuideRow { id: string; title: string; url: string | null; category: string | null; created_at: string }

export default function BuyingGuidesPage() {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [guides, setGuides] = useState<GuideRow[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)

  useEffect(() => { void refresh() }, [])

  async function refresh() {
    setLoading(true)
    try {
      const r = await fetch('/api/buying-guides')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      setCategories(j.categories || [])
      setGuides(j.guides || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function generate(category: string) {
    setGenerating(category)
    try {
      const r = await fetch('/api/buying-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Generation failed')
      toast.success(`Published "${j.title}"`, {
        action: { label: 'View', onClick: () => window.open(j.url, '_blank') },
        duration: 10_000,
      })
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(124,58,237,.12)' }}>
            <BookOpen className="w-6 h-6" style={{ color: '#7C3AED' }} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--fg)' }}>Buying Guides</h1>
            <p className="text-sm mt-1.5" style={{ color: 'var(--fg-muted)' }}>
              Auto-generate &ldquo;Best [category] for {new Date().getUTCFullYear()}&rdquo; round-ups from your existing
              reviews. Pulls your top picks, writes a long-form ranked guide, and publishes to your blog tagged{' '}
              <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>buying-guide</span>.
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--fg-muted)' }}>
              Categories appear here once you have at least <strong>3 published reviews</strong> in that category.
            </p>
          </div>
        </div>
      </div>

      {/* ── Categories ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--fg-muted)' }}>
          Available categories
        </h2>
        {loading ? (
          <div className="rounded-xl border p-8 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading your reviews…
          </div>
        ) : categories.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-sm" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            <p>No categories yet with 3+ reviews.</p>
            <p className="text-xs mt-2">Publish more reviews in the same category, then come back.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map(c => (
              <div key={c.category} className="rounded-xl border p-4 flex flex-col gap-3" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                <div>
                  <div className="font-semibold text-base capitalize" style={{ color: 'var(--fg)' }}>{c.category}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>{c.count} reviews</div>
                </div>
                <Button
                  onClick={() => void generate(c.category)}
                  disabled={generating !== null}
                  className="w-full"
                  style={{ background: '#7C3AED', color: '#fff' }}
                >
                  {generating === c.category ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Generating…</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-2" /> Generate guide</>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent guides ────────────────────────────────────────────── */}
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
                  <div className="font-medium truncate" style={{ color: 'var(--fg)' }}>{g.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    {g.category && <span className="capitalize">{g.category}</span>}
                    {g.category && ' · '}
                    {new Date(g.created_at).toLocaleDateString()}
                  </div>
                </div>
                {g.url && (
                  <Link
                    href={g.url}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--bg)', color: 'var(--fg)' }}
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
