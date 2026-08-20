'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Made for your channel" — products scored against the creator's affinity
// profile (what they earn in, their topics, their price band), not the same
// best-sellers everyone sees. Self-contained: fetches /api/products/for-you and
// renders the matched picks with a plain-English WHY on each, using the shared
// ProductSignalCard. A deep-dive opens on any card.

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, RefreshCw, BarChart3, ExternalLink, ChevronDown } from 'lucide-react'
import ProductSignalCard, { type ProductCardModel } from '@/components/product/ProductSignalCard'
import ProductDeepDiveModal from '@/components/product/ProductDeepDiveModal'

interface Pick { score: number; reasons: string[]; product: ProductCardModel & { imageHref?: string | null } }
interface Resp { ok?: boolean; hasProfile?: boolean; products?: Pick[] }

export default function MadeForYouFeed() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(true)
  const [dive, setDive] = useState<{ asin: string; title?: string | null; imageUrl?: string | null } | null>(null)

  const load = () => {
    setLoading(true)
    fetch('/api/products/for-you').then(r => r.json()).then(setData).catch(() => setData({ products: [] })).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const refresh = async () => {
    setRefreshing(true)
    try { await fetch('/api/creator/affinity', { method: 'POST' }) } catch { /* ignore */ }
    load()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 mb-4 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Finding products made for your channel…</span>
      </div>
    )
  }
  const picks = data?.products ?? []
  if (!picks.length) return null // nothing to match yet — stay out of the way
  const personalized = !!data?.hasProfile

  return (
    <div className="mb-5">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-2">
          <Sparkles size={16} style={{ color: '#7C3AED' }} />
          <span className="text-[13px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>{personalized ? 'Made for your channel' : 'Trending picks to try'}</span>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>
            {personalized ? '— matched to what already earns for you' : '— sync your storefront earnings to personalize these'}
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span onClick={(e) => { e.stopPropagation(); refresh() }} title="Recompute from your latest earnings"
            className="p-1 rounded-md cursor-pointer" style={{ color: 'var(--text-faint)' }}>
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </span>
          <ChevronDown size={16} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {picks.map(({ product: p, reasons }) => (
            <ProductSignalCard
              key={p.asin}
              model={p}
              overlays={personalized && reasons.length ? (
                <span className="absolute top-2 left-2 z-10 text-[10px] font-bold rounded-full px-2 py-0.5 text-white inline-flex items-center gap-1" style={{ background: '#7C3AED' }}>
                  <Sparkles size={9} /> Match
                </span>
              ) : undefined}
              extra={reasons.length ? (
                <div className="flex flex-col gap-0.5">
                  {reasons.map((r, i) => (
                    <span key={i} className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-soft, #6e6e73)' }}>
                      <span style={{ color: '#7C3AED' }}>✓</span> {r}
                    </span>
                  ))}
                </div>
              ) : undefined}
              footer={
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setDive({ asin: p.asin!, title: p.title, imageUrl: p.imageUrl })}
                    className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold rounded-full py-2 text-white" style={{ background: '#7C3AED' }}>
                    <BarChart3 size={12} /> Deep dive
                  </button>
                  {p.imageHref && (
                    <a href={p.imageHref} target="_blank" rel="noopener noreferrer" title="View on Amazon"
                      className="inline-flex items-center justify-center rounded-full px-2 py-2 border" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}

      {dive && <ProductDeepDiveModal asin={dive.asin} title={dive.title} imageUrl={dive.imageUrl} onClose={() => setDive(null)} />}
    </div>
  )
}
