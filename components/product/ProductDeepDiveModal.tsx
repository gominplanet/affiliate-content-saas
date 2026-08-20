'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-ASIN research snapshot: price vs its typical + all-time low (the "deal
// check" position bar), rating/reviews, recent sales, and carousel-video count —
// so a creator can judge a product before committing. Opens over any product
// card; ends with one-click "Write review". Data: GET /api/product/deep-dive.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatSalesRank, formatAgeWithDate, formatRankTrend } from '@/lib/product-card-signals'
import {
  X, Star, TrendingUp, Video, ShieldCheck, ShieldAlert, PenLine,
  ExternalLink, Loader2, Check, ArrowRight,
} from 'lucide-react'

interface DeepDive {
  asin: string
  imageUrl: string | null
  priceNow: number | null
  typical: number | null
  allTimeLow: number | null
  pctBelowAvg90: number | null
  quality: string | null
  label: string | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  videoCount: number | null
  category: string | null
  parentAsin: string | null
  salesRank: number | null
  salesRankAvg90: number | null
  salesRankCategory: string | null
  listedSince: string | null
  rankSparkline?: number[]
  monthsTracked?: number
  sellsConsistently?: boolean
}

const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`)

/** Sales-rank sparkline. Rank is inverted (lower rank = better-selling), so the
 *  line rises when the product is climbing — reads like a "sales" line, not a
 *  "rank number" line. Pure inline SVG, no deps. */
function RankSparkline({ ranks }: { ranks: number[] }) {
  if (!ranks || ranks.length < 2) return null
  const W = 132, H = 34, pad = 2
  const min = Math.min(...ranks), max = Math.max(...ranks)
  const span = max - min || 1
  const pts = ranks.map((r, i) => {
    const x = pad + (i / (ranks.length - 1)) * (W - pad * 2)
    // Invert: a LOWER rank (better) should sit HIGHER on the chart.
    const y = pad + ((r - min) / span) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  // Rising line (last better than first) → green; else amber.
  const improving = ranks[ranks.length - 1] <= ranks[0]
  const stroke = improving ? '#059669' : '#d97706'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function ProductDeepDiveModal({ asin, title, imageUrl, onClose }: {
  asin: string; title?: string | null; imageUrl?: string | null; onClose: () => void
}) {
  const [data, setData] = useState<DeepDive | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gen, setGen] = useState<'idle' | 'working' | 'done'>('idle')
  const [postUrl, setPostUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/product/deep-dive?asin=${encodeURIComponent(asin)}`)
      .then(r => r.json())
      .then(d => { if (cancelled) return; if (d.error) setError(d.error); else setData(d) })
      .catch(() => { if (!cancelled) setError('Could not load this product.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [asin])

  const writeReview = async () => {
    if (gen === 'working') return
    setGen('working')
    try {
      const res = await fetch('/api/blog/from-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: `https://www.amazon.com/dp/${asin}`, productName: title || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not write the review.'); setGen('idle'); return }
      setPostUrl(d.url || null); setGen('done')
      toast.success('Review published to your blog.')
    } catch { toast.error('Could not write the review.'); setGen('idle') }
  }

  const img = data?.imageUrl || imageUrl || null
  // Position of "now" between all-time low (left) and typical (right).
  const pos = (() => {
    if (!data) return null
    const { priceNow: n, typical: t, allTimeLow: l } = data
    if (n == null || t == null || l == null || t <= l) return null
    return Math.max(0, Math.min(100, Math.round(((n - l) / (t - l)) * 100)))
  })()

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col max-h-[92vh] bg-white dark:bg-[#111113]" style={{ border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 p-4 pb-3">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="w-16 h-16 rounded-lg object-contain bg-white border flex-shrink-0" style={{ borderColor: 'var(--border)' }} />
          ) : (
            <div className="w-16 h-16 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.06)' }} />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Product research</p>
            <p className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text)' }}>{title || asin}</p>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-faint)' }}>{asin}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 flex-shrink-0" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        <div className="px-4 pb-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 py-10 justify-center text-[13px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={16} className="animate-spin" /> Checking Amazon price history…</div>
          ) : error ? (
            <div className="text-center py-10 text-[13px]" style={{ color: 'var(--text-faint)' }}>{error}</div>
          ) : data ? (
            <div className="space-y-4">
              {/* Price + verdict */}
              <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border-2)' }}>
                <div className="flex items-baseline gap-2 mb-1">
                  {money(data.priceNow) && <span className="text-[22px] font-extrabold" style={{ color: '#16a34a' }}>{money(data.priceNow)}</span>}
                  {data.discountPct != null && data.discountPct > 0 && <span className="text-[13px] font-bold" style={{ color: '#e11d48' }}>{data.discountPct}% off</span>}
                </div>
                {data.quality && <VerdictBadge quality={data.quality} label={data.label} />}
                {pos != null && (
                  <div className="mt-3">
                    <div className="relative h-2 rounded-full" style={{ background: 'linear-gradient(90deg,#16a34a,#e5e7eb)' }}>
                      <div className="absolute -top-1 w-4 h-4 rounded-full bg-white" style={{ left: `${pos}%`, transform: 'translateX(-50%)', border: '3px solid #16a34a', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                    </div>
                    <div className="flex justify-between text-[10px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                      <span>All-time low{money(data.allTimeLow) ? ` · ${money(data.allTimeLow)}` : ''}</span>
                      <span>Typical{money(data.typical) ? ` · ${money(data.typical)}` : ''}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Signals */}
              <div className="grid grid-cols-3 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-2)' }}>
                <Cell label="Rating" value={data.rating != null ? `${data.rating.toFixed(1)}★` : '—'} sub={data.reviewCount != null ? `${data.reviewCount.toLocaleString()} reviews` : undefined} />
                <Cell label="Bought / mo" value={data.monthlySold != null ? `${data.monthlySold.toLocaleString()}+` : '—'} divider />
                <Cell label="Carousel videos" value={data.videoCount != null ? String(data.videoCount) : '—'} divider />
              </div>

              {/* Keepa detail signals — category, rank, age, parent (parity with Oink) */}
              {(() => {
                const rank = formatSalesRank(data.salesRank, data.salesRankCategory)
                const age = formatAgeWithDate(data.listedSince)
                const trend = formatRankTrend(data.salesRank, data.salesRankAvg90)
                const rows: Array<[string, string]> = []
                if (data.category) rows.push(['Category', data.category])
                if (rank) rows.push(['Sales rank', rank])
                if (trend) rows.push(['Rank trend', `${trend.label} (${trend.detail})`])
                if (age) rows.push(['Age', age])
                if (data.parentAsin && data.parentAsin !== data.asin) rows.push(['Parent ASIN', data.parentAsin])
                if (!rows.length) return null
                return (
                  <div className="rounded-xl border divide-y" style={{ borderColor: 'var(--border-2)' }}>
                    {rows.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[12px]">
                        <span style={{ color: 'var(--text-faint)' }}>{k}</span>
                        <span className="font-medium text-right" style={{ color: 'var(--text)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Tier B: sales-rank history — steady-seller read + sparkline. */}
              {(() => {
                const spark = data.rankSparkline
                if (!spark || spark.length < 2) return null
                const months = data.monthsTracked ?? 0
                const soldLine = data.monthlySold ? ` · ~${data.monthlySold.toLocaleString()}+/mo` : ''
                const headline = data.sellsConsistently
                  ? `Steady seller — ranked every month${months ? ` for ${months} month${months === 1 ? '' : 's'}` : ''}${soldLine}`
                  : `Ranked ${months} of the last 12 months${soldLine}`
                return (
                  <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: 'var(--border-2)' }}>
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>Sales-rank history</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>last 12 mo · higher = selling better</span>
                    </div>
                    <RankSparkline ranks={spark} />
                    <p className="text-[11.5px] mt-1.5 font-medium" style={{ color: data.sellsConsistently ? '#059669' : 'var(--text-soft)' }}>
                      {headline}
                    </p>
                  </div>
                )
              })()}

              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                Fewer carousel videos = less competition. A price near its all-time low is the strongest reason to post now.
              </p>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="p-4 pt-2 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          {gen === 'done' && postUrl ? (
            <a href={postUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full py-2.5 text-white" style={{ background: '#34c759' }}>
              <Check size={14} /> View review
            </a>
          ) : (
            <button onClick={writeReview} disabled={gen === 'working'}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full py-2.5 text-white disabled:opacity-60 transition"
              style={{ background: '#7C3AED' }}>
              {gen === 'working' ? <><Loader2 size={13} className="animate-spin" /> Writing…</> : <><PenLine size={13} /> Write review <ArrowRight size={13} /></>}
            </button>
          )}
          <a href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-2.5 border" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            Amazon <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  )
}

function Cell({ label, value, sub, divider }: { label: string; value: string; sub?: string; divider?: boolean }) {
  return (
    <div className="px-1.5 py-2 text-center min-w-0" style={divider ? { borderLeft: '1px solid var(--border-2)' } : undefined}>
      <div className="text-[14px] font-bold leading-tight truncate" style={{ color: 'var(--text)' }}>{value}</div>
      {sub ? <div className="text-[9px] leading-tight truncate" style={{ color: 'var(--text-faint)' }}>{sub}</div> : null}
      <div className="text-[9px] uppercase tracking-wide mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{label}</div>
    </div>
  )
}

function VerdictBadge({ quality, label }: { quality: string; label: string | null }) {
  if (quality === 'excellent') return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 rounded px-1.5 py-0.5 w-fit"><ShieldCheck size={12} /> {label || 'All-time low'}</span>
  if (quality === 'genuine') return <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-blue-500/10 rounded px-1.5 py-0.5 w-fit"><ShieldCheck size={12} /> {label || 'Real discount'}</span>
  if (quality === 'fair') return <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 w-fit"><ShieldCheck size={12} /> {label || 'Below usual'}</span>
  return <span className="inline-flex items-center gap-1 text-xs text-amber-600 w-fit" title="The list-price discount isn't below this item's typical selling price."><ShieldAlert size={12} /> {label || 'Around usual price'}</span>
}
