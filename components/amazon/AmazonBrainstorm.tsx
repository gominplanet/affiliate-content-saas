// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AmazonBrainstorm — the storefront-grounded "what to post next" board for the
// Amazon Influencer tier. Calls /api/brainstorm/amazon, which ranks the
// creator's proven sellers (SCOUT earnings) + open campaigns + niche into 5-7
// next moves, each with a one-click ACTION so an idea becomes a real thumbnail /
// post / campaign — not a wall of text.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles, Wand2, Share2, Handshake, PackageSearch, ArrowRight, AlertCircle } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'

const ACCENT = '#C2410C'

interface Suggestion {
  title: string
  why: string
  action: 'thumbnail' | 'social' | 'campaign' | 'research'
  asin?: string | null
  label: string
}

const ACTION_META: Record<Suggestion['action'], { icon: React.ReactNode; href: (asin?: string | null) => string }> = {
  thumbnail: { icon: <Wand2 size={14} />, href: (asin) => (asin ? `/amazon/thumbnails?asin=${asin}` : '/amazon/thumbnails') },
  social: { icon: <Share2 size={14} />, href: () => '/amazon/social' },
  campaign: { icon: <Handshake size={14} />, href: () => '/cc-campaigns' },
  research: { icon: <PackageSearch size={14} />, href: () => '/amazon/research' },
}

export default function AmazonBrainstorm() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [grounded, setGrounded] = useState(true)

  async function generate() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/brainstorm/amazon', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || 'Could not generate ideas.'); return }
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
      setGrounded(data.grounded !== false)
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero
        accent={ACCENT}
        title="Your next moves, from what’s working"
        subtitle="MVP looks at your proven sellers, your open brand campaigns and your niche, then hands you specific next posts — each one a click away from being made."
      />

      <div className="rounded-2xl border p-5 sm:p-6 mb-6" style={{ borderColor: 'rgba(234,88,12,0.25)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}><Sparkles size={16} /></span>
          <div>
            <p className="font-bold text-[15px]" style={{ color: 'var(--text)' }}>Brainstorm my next posts</p>
            <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
              Grounded in your storefront: your best earners get amplified, high-click products get a fresh angle, and your strongest campaigns get chased. We don’t pull your private Amazon sales page — this is built on what SCOUT syncs plus your live campaigns and niche.
            </p>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          style={{ backgroundColor: ACCENT }}
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Thinking…</> : <><Sparkles size={15} /> Generate my next moves</>}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border p-4 flex items-center gap-2 text-[13px] mb-6" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.06)', color: '#c0392b' }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <>
          {!grounded && (
            <p className="text-[12.5px] mb-3" style={{ color: 'var(--text-soft)' }}>
              No storefront earnings yet, so these are research-first starters. Once SCOUT syncs your sales, Brainstorm builds on your proven winners.
            </p>
          )}
          <ol className="grid grid-cols-1 gap-3">
            {suggestions.map((s, i) => {
              const meta = ACTION_META[s.action] ?? ACTION_META.research
              return (
                <li key={i} className="rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}>{i + 1}</span>
                      <p className="font-semibold text-[14px] leading-snug" style={{ color: 'var(--text)' }}>{s.title}</p>
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{s.why}</p>
                  </div>
                  <Link
                    href={meta.href(s.asin)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white whitespace-nowrap shadow-sm transition-transform hover:-translate-y-0.5 flex-shrink-0"
                    style={{ backgroundColor: ACCENT }}
                  >
                    {meta.icon} {s.label} <ArrowRight size={13} />
                  </Link>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}
