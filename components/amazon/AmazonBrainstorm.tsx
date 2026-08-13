// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AmazonBrainstorm — the storefront ANALYTICS dashboard for the Amazon Influencer
// tier. Reads SCOUT-synced storefront_earnings via /api/storefront/analytics:
// headline KPIs (earnings, revenue, units, clicks, conversion, earnings/click)
// with period-over-period trend, plus a sortable per-product table where each
// row shows its own trend vs the prior period and one-click actions. Below the
// numbers, a compact AI "next moves" strip (/api/brainstorm/amazon) turns the
// data into specific posts to make. Weekly/monthly toggle; both are SCOUT-synced.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, Sparkles, Wand2, Share2, Handshake, PackageSearch, ArrowRight, ArrowUpRight, ArrowDownRight,
  AlertCircle, DollarSign, MousePointerClick, Package, Percent, TrendingUp, ExternalLink,
} from 'lucide-react'
import PageHero from '@/components/layout/PageHero'

const ACCENT = '#C2410C'
const GREEN = '#15803d'
const RED = '#b91c1c'

// ── Types mirrored from /api/storefront/analytics ────────────────────────────
interface Totals { earnings: number; revenue: number; units: number; clicks: number; products: number; conversion: number; epc: number }
interface Product {
  asin: string; title: string; earnings: number; revenue: number; units: number; clicks: number
  conversion: number; epc: number; commissionPct: number | null
  earningsPrev: number | null; earningsDelta: number | null; isNew: boolean; amazonUrl: string
}
interface Analytics {
  period: 'weekly' | 'monthly'; hasData: boolean
  available: { weekly: number; monthly: number }
  latest: { start: string; end: string | null } | null
  previous: { start: string } | null
  totals: Totals | null; totalsPrev: Totals | null; products: Product[]
}

// ── AI next-moves (unchanged endpoint) ───────────────────────────────────────
interface Suggestion { title: string; why: string; action: 'thumbnail' | 'social' | 'campaign' | 'research'; asin?: string | null; label: string }
const ACTION_META: Record<Suggestion['action'], { icon: React.ReactNode; href: (asin?: string | null) => string }> = {
  thumbnail: { icon: <Wand2 size={14} />, href: (asin) => (asin ? `/amazon/thumbnails?asin=${asin}` : '/amazon/thumbnails') },
  social: { icon: <Share2 size={14} />, href: () => '/amazon/social' },
  campaign: { icon: <Handshake size={14} />, href: () => '/cc-campaigns' },
  research: { icon: <PackageSearch size={14} />, href: () => '/amazon/research' },
}

// ── Formatting ───────────────────────────────────────────────────────────────
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usdShort = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : usd(n))
const int = (n: number) => n.toLocaleString('en-US')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtPeriod(period: 'weekly' | 'monthly', start?: string | null, end?: string | null): string {
  if (!start) return ''
  const [ys, ms, ds] = start.split('-').map(Number)
  if (period === 'monthly') return `${MONTHS[(ms || 1) - 1]} ${ys}`
  const s = `${MONTHS[(ms || 1) - 1]} ${ds}`
  if (end) { const [, me, de] = end.split('-').map(Number); return `${s} – ${MONTHS[(me || 1) - 1]} ${de}` }
  return s
}
function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

// ── Delta chip (period-over-period % on a KPI) ───────────────────────────────
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>no prior period</span>
  if (pct === 0) return <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>flat</span>
  const up = pct > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: up ? GREEN : RED }}>
      <Icon size={12} /> {Math.abs(pct)}%
    </span>
  )
}

type SortKey = 'earnings' | 'revenue' | 'units' | 'clicks' | 'conversion' | 'epc'

export default function AmazonBrainstorm() {
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('monthly')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('earnings')

  // AI next-moves
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [grounded, setGrounded] = useState(true)

  const load = useCallback(async (p: 'weekly' | 'monthly') => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/storefront/analytics?period=${p}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json?.error || 'Could not load your storefront data.'); setData(null); return }
      setData(json as Analytics)
    } catch {
      setError('Network error — try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(period) }, [period, load])

  async function generate() {
    setAiBusy(true); setAiError(null)
    try {
      const res = await fetch('/api/brainstorm/amazon', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setAiError(json?.error || 'Could not generate ideas.'); return }
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : [])
      setGrounded(json.grounded !== false)
    } catch {
      setAiError('Network error — try again.')
    } finally {
      setAiBusy(false)
    }
  }

  const t = data?.totals
  const tp = data?.totalsPrev
  const products = data?.products ?? []
  const sorted = [...products].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
  const periodLabel = fmtPeriod(period, data?.latest?.start, data?.latest?.end)

  const KPIS: { key: SortKey | 'products'; label: string; icon: React.ReactNode; value: string; pct: number | null }[] = t ? [
    { key: 'earnings', label: 'Earnings', icon: <DollarSign size={14} />, value: usd(t.earnings), pct: pctChange(t.earnings, tp?.earnings) },
    { key: 'revenue', label: 'Revenue', icon: <TrendingUp size={14} />, value: usd(t.revenue), pct: pctChange(t.revenue, tp?.revenue) },
    { key: 'units', label: 'Units shipped', icon: <Package size={14} />, value: int(t.units), pct: pctChange(t.units, tp?.units) },
    { key: 'clicks', label: 'Clicks', icon: <MousePointerClick size={14} />, value: int(t.clicks), pct: pctChange(t.clicks, tp?.clicks) },
    { key: 'conversion', label: 'Conversion', icon: <Percent size={14} />, value: `${t.conversion}%`, pct: pctChange(t.conversion, tp?.conversion) },
    { key: 'epc', label: 'Earnings / click', icon: <DollarSign size={14} />, value: usd(t.epc), pct: pctChange(t.epc, tp?.epc) },
  ] : []

  return (
    <div className="max-w-6xl mx-auto">
      <PageHero
        accent={ACCENT}
        title="Your storefront, by the numbers"
        subtitle="What SCOUT synced from your Amazon report: your proven sellers, ranked by what they actually earn, with the trend since last period and a one-click way to post more of what works."
      />

      {/* Period toggle */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="inline-flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {(['monthly', 'weekly'] as const).map((p) => {
            const has = (data?.available?.[p] ?? 0) > 0
            const active = period === p
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="px-4 py-2 text-[13px] font-semibold capitalize transition-colors disabled:opacity-40"
                style={active ? { background: ACCENT, color: '#fff' } : { background: 'transparent', color: 'var(--text-soft)' }}
                title={has ? '' : 'No ' + p + ' data synced yet'}
              >
                {p}
              </button>
            )
          })}
        </div>
        {periodLabel && (
          <span className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
            Showing <span className="font-semibold" style={{ color: 'var(--text)' }}>{periodLabel}</span>
            {data?.previous ? ' vs the period before' : ''}
          </span>
        )}
      </div>

      {loading && (
        <div className="rounded-2xl border p-10 flex items-center justify-center gap-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading your storefront…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border p-4 flex items-center gap-2 text-[13px]" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.06)', color: '#c0392b' }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Empty state — no earnings synced yet */}
      {!loading && !error && data && !data.hasData && (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: 'rgba(234,88,12,0.3)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}>
          <span className="w-11 h-11 rounded-2xl grid place-items-center text-white mx-auto mb-3" style={{ backgroundColor: ACCENT }}><PackageSearch size={20} /></span>
          <p className="font-bold text-[16px] mb-1" style={{ color: 'var(--text)' }}>No storefront earnings synced yet</p>
          <p className="text-[13px] max-w-md mx-auto mb-4" style={{ color: 'var(--text-soft)' }}>
            Install SCOUT and open your Amazon earnings report once. It reads your own report in your browser and syncs your per-product sales here. Amazon only reports products with a few shipments, so everything that lands is a proven seller.
          </p>
          <Link href="/amazon" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white" style={{ backgroundColor: ACCENT }}>
            Set up SCOUT <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* KPIs + table */}
      {!loading && !error && data?.hasData && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {KPIS.map((k) => (
              <div key={k.label} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="flex items-center gap-1.5 mb-1.5" style={{ color: ACCENT }}>
                  <span className="w-6 h-6 rounded-lg grid place-items-center flex-shrink-0" style={{ background: 'rgba(234,88,12,0.12)' }}>{k.icon}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>{k.label}</span>
                </div>
                <p className="text-[20px] font-bold leading-none mb-1.5" style={{ color: 'var(--text)' }}>{k.value}</p>
                <Delta pct={k.pct} />
              </div>
            ))}
          </div>

          {/* Per-product table */}
          <div className="rounded-2xl border overflow-hidden mb-8" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
              <p className="font-bold text-[14px]" style={{ color: 'var(--text)' }}>Your products this period <span className="font-normal" style={{ color: 'var(--text-soft)' }}>({products.length})</span></p>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-soft)' }}>
                Sort by:
                {(['earnings', 'revenue', 'units', 'clicks', 'conversion', 'epc'] as SortKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    className="px-2 py-0.5 rounded-full capitalize font-semibold transition-colors"
                    style={sortKey === k ? { background: 'rgba(234,88,12,0.12)', color: ACCENT } : { color: 'var(--text-soft)' }}
                  >
                    {k === 'epc' ? 'EPC' : k}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-soft)' }}>
                    <th className="font-semibold px-4 py-2.5">Product</th>
                    <th className="font-semibold px-3 py-2.5 text-right">Earnings</th>
                    <th className="font-semibold px-3 py-2.5 text-right">Trend</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden sm:table-cell">Revenue</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden md:table-cell">Units</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden md:table-cell">Clicks</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden lg:table-cell">Conv.</th>
                    <th className="font-semibold px-3 py-2.5 text-right hidden lg:table-cell">EPC</th>
                    <th className="font-semibold px-3 py-2.5 text-right">Act</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => (
                    <tr key={p.asin} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold w-5 flex-shrink-0" style={{ color: 'var(--text-soft)' }}>{i + 1}</span>
                          <div className="min-w-0">
                            <a href={p.amazonUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline inline-flex items-center gap-1 max-w-[280px] truncate align-bottom" style={{ color: 'var(--text)' }} title={p.title}>
                              <span className="truncate">{p.title}</span><ExternalLink size={11} className="flex-shrink-0 opacity-60" />
                            </a>
                            <div className="text-[11px]" style={{ color: 'var(--text-soft)' }}>{p.asin}{p.isNew ? ' · new this period' : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>{usdShort(p.earnings)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {p.earningsDelta == null ? (
                          <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>{p.isNew ? 'new' : '—'}</span>
                        ) : p.earningsDelta === 0 ? (
                          <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>flat</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: p.earningsDelta > 0 ? GREEN : RED }}>
                            {p.earningsDelta > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{usdShort(Math.abs(p.earningsDelta))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell" style={{ color: 'var(--text-soft)' }}>{usdShort(p.revenue)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden md:table-cell" style={{ color: 'var(--text-soft)' }}>{int(p.units)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden md:table-cell" style={{ color: 'var(--text-soft)' }}>{int(p.clicks)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden lg:table-cell" style={{ color: 'var(--text-soft)' }}>{p.conversion}%</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap hidden lg:table-cell" style={{ color: 'var(--text-soft)' }}>{usd(p.epc)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/amazon/thumbnails?asin=${p.asin}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white whitespace-nowrap" style={{ backgroundColor: ACCENT }} title="Make a thumbnail for this product">
                          <Wand2 size={12} /> Post
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* AI next moves — grounded in the numbers above */}
      {!loading && !error && (
        <div className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'rgba(234,88,12,0.25)', background: 'linear-gradient(180deg, rgba(234,88,12,0.05), transparent)' }}>
          <div className="flex items-start gap-3 mb-4">
            <span className="w-9 h-9 rounded-xl grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}><Sparkles size={16} /></span>
            <div>
              <p className="font-bold text-[15px]" style={{ color: 'var(--text)' }}>Turn the numbers into your next posts</p>
              <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
                MVP reads the table above plus your open brand campaigns and niche, then hands you specific next moves — amplify your best earners, re-angle high-click products that under-convert, chase your strongest campaigns. Each is one click from being made.
              </p>
            </div>
          </div>
          <button
            onClick={generate}
            disabled={aiBusy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {aiBusy ? <><Loader2 size={15} className="animate-spin" /> Thinking…</> : <><Sparkles size={15} /> Generate my next moves</>}
          </button>

          {aiError && (
            <div className="mt-4 rounded-xl border p-3 flex items-center gap-2 text-[13px]" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.06)', color: '#c0392b' }}>
              <AlertCircle size={15} /> {aiError}
            </div>
          )}

          {suggestions && suggestions.length > 0 && (
            <>
              {!grounded && (
                <p className="text-[12.5px] mt-4 mb-1" style={{ color: 'var(--text-soft)' }}>
                  No storefront earnings yet, so these are research-first starters. Once SCOUT syncs your sales, these build on your proven winners.
                </p>
              )}
              <ol className="grid grid-cols-1 gap-3 mt-4">
                {suggestions.map((s, i) => {
                  const meta = ACTION_META[s.action] ?? ACTION_META.research
                  return (
                    <li key={i} className="rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}>{i + 1}</span>
                          <p className="font-semibold text-[14px] leading-snug" style={{ color: 'var(--text)' }}>{s.title}</p>
                        </div>
                        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{s.why}</p>
                      </div>
                      <Link href={meta.href(s.asin)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white whitespace-nowrap shadow-sm transition-transform hover:-translate-y-0.5 flex-shrink-0" style={{ backgroundColor: ACCENT }}>
                        {meta.icon} {s.label} <ArrowRight size={13} />
                      </Link>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  )
}
