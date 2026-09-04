// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The per-product half of Amazon Earnings.
//
// The totals above this answer "how much". This answers the two questions a
// creator actually acts on: which products are carrying the month, and which
// ones have started sliding while nobody was looking. Plus the one Amazon can
// never answer, because it doesn't know what you've published: which earners
// have no content behind them yet.
//
// The honesty rules from the totals carry through unchanged. No trend is shown
// unless two FINISHED months both reported. The running month is excluded from
// every comparison. And the coverage line says out loud how much of the month's
// money this breakdown explains, because Amazon hides low-volume rows and the
// parts genuinely do not always sum to the whole.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown, Video, ExternalLink } from 'lucide-react'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

export interface EarningsProduct {
  asin: string
  title: string | null
  earningsCents: number | null
  revenueCents: number | null
  clicks: number | null
  orders: number | null
  months: Record<string, number>
  streams: string[]
  scopes: string[]
  recentCents: number | null
  priorCents: number | null
  deltaCents: number | null
  deltaPct: number | null
  videoCount: number
  lastVideoAt: string | null
}

interface Payload {
  ok?: boolean
  error?: string
  synced?: boolean
  months?: string[]
  recentMonth?: string | null
  priorMonth?: string | null
  products?: EarningsProduct[]
  coverage?: { productCents: number | null; periodCents: number | null } | null
}

function money(cents: number | null | undefined): string {
  if (cents == null) return 'not reported'
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
const num = (n: number | null | undefined) => (n == null ? 'not reported' : n.toLocaleString())
const monthName = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Product title trimmed to something readable in a table cell without hiding
 *  which product it is. Amazon's titles run to 200 characters of keywords. */
const shortTitle = (t: string | null, asin: string) => {
  if (!t) return asin
  return t.length > 72 ? `${t.slice(0, 72).trimEnd()}…` : t
}

export default function ProductBreakdown({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(25)

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/amazon-earnings/products').then(r => r.json())
      setData(d)
    } catch {
      setData({ error: 'Could not load the product breakdown.' })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center gap-2 text-sm" style={muted}>
        <Loader2 size={16} className="animate-spin" /> Loading your products…
      </div>
    )
  }
  if (!data || data.error) {
    return (
      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-1" style={label}>By product</h2>
        <p className="text-[13px]" style={muted}>{data?.error || 'Could not load the product breakdown.'}</p>
        <p className="text-[11px] mt-2" style={muted}>
          A message about a missing column means a migration has not been run on this database yet. The monthly totals above are unaffected.
        </p>
      </div>
    )
  }

  const products = data.products ?? []
  if (products.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-sm font-semibold mb-1" style={label}>By product</h2>
        <p className="text-[13px]" style={muted}>
          No per-product rows yet. The next sync reads them alongside the monthly totals. If they stay empty after a sync, the diagnostics above will say what Amazon returned.
        </p>
      </div>
    )
  }

  const recent = data.recentMonth ?? null
  const prior = data.priorMonth ?? null
  const canTrend = !!(recent && prior)

  const winners = canTrend
    ? products.filter(p => (p.recentCents ?? 0) > 0).slice(0, 5)
    : products.slice(0, 5)
  const slipping = canTrend
    ? products.filter(p => p.deltaCents != null && p.deltaCents < 0)
        .sort((a, b) => (a.deltaCents ?? 0) - (b.deltaCents ?? 0)).slice(0, 5)
    : []
  const uncovered = products
    .filter(p => p.videoCount === 0 && (p.earningsCents ?? 0) > 0)
    .slice(0, 5)

  const cov = data.coverage
  const covPct = cov && cov.productCents != null && cov.periodCents
    ? Math.round((cov.productCents / cov.periodCents) * 100)
    : null

  const shown = products.slice(0, limit)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        <div className="card p-4">
          <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}>
            <TrendingUp size={14} style={{ color: '#10B981' }} /> Carrying the month
          </p>
          {winners.length === 0 ? (
            <p className="text-[12px]" style={muted}>Nothing reported earnings in {recent ? monthName(recent) : 'the last finished month'}.</p>
          ) : (
            <ul className="space-y-2">
              {winners.map(p => (
                <li key={p.asin} className="text-[12px]">
                  <span className="block font-medium truncate" style={label}>{shortTitle(p.title, p.asin)}</span>
                  <span style={muted}>
                    {money(canTrend ? p.recentCents : p.earningsCents)}
                    {p.deltaPct != null && (
                      <span style={{ color: p.deltaPct >= 0 ? '#10B981' : '#dc2626' }}>
                        {' '}{p.deltaPct >= 0 ? '+' : ''}{Math.round(p.deltaPct)}% vs {prior ? monthName(prior).split(' ')[0] : 'last month'}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] mt-2" style={muted}>
            {canTrend ? `Earnings in ${monthName(recent!)}, the last finished month.` : 'Total earnings across everything synced.'}
          </p>
        </div>

        <div className="card p-4">
          <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}>
            <TrendingDown size={14} style={{ color: '#dc2626' }} /> Losing ground
          </p>
          {!canTrend ? (
            <p className="text-[12px]" style={muted}>
              A direction needs two finished months. You have one so far, so nothing here would be a trend yet.
            </p>
          ) : slipping.length === 0 ? (
            <p className="text-[12px]" style={muted}>Nothing dropped between {monthName(prior!)} and {monthName(recent!)}.</p>
          ) : (
            <ul className="space-y-2">
              {slipping.map(p => (
                <li key={p.asin} className="text-[12px]">
                  <span className="block font-medium truncate" style={label}>{shortTitle(p.title, p.asin)}</span>
                  <span style={muted}>
                    {money(p.priorCents)} to {money(p.recentCents)}
                    <span style={{ color: '#dc2626' }}> {money(p.deltaCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] mt-2" style={muted}>
            A drop can be the product going out of stock or losing its campaign, not only your content. Worth opening before rewriting anything.
          </p>
        </div>

        <div className="card p-4">
          <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}>
            <Video size={14} style={{ color: '#7C3AED' }} /> Earning with no video
          </p>
          {uncovered.length === 0 ? (
            <p className="text-[12px]" style={muted}>Every product that earned has content behind it.</p>
          ) : (
            <ul className="space-y-2">
              {uncovered.map(p => (
                <li key={p.asin} className="text-[12px]">
                  <span className="block font-medium truncate" style={label}>{shortTitle(p.title, p.asin)}</span>
                  <span style={muted}>{money(p.earningsCents)} earned, nothing published</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] mt-2" style={muted}>
            These earn from your storefront or old links alone. Matched against videos MVP knows it published for you, so a video posted elsewhere will not count here.
          </p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold" style={label}>Every product</h2>
          <span className="text-[11px]" style={muted}>
            {products.length.toLocaleString()} product{products.length === 1 ? '' : 's'}
            {covPct != null ? `, covering ${covPct}% of the earnings in these months` : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={muted}>
                <th className="text-left font-medium py-2 pr-3">Product</th>
                <th className="text-right font-medium py-2 pr-3">Clicks</th>
                <th className="text-right font-medium py-2 pr-3">Orders</th>
                <th className="text-right font-medium py-2 pr-3">Earnings</th>
                <th className="text-right font-medium py-2 pr-3">Trend</th>
                <th className="text-right font-medium py-2">Videos</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.asin} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2 pr-3">
                    <span className="block" style={label}>{shortTitle(p.title, p.asin)}</span>
                    <a
                      href={`https://www.amazon.com/dp/${p.asin}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-[11px] inline-flex items-center gap-1 hover:underline"
                      style={muted}
                    >
                      {p.asin} <ExternalLink size={10} />
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(p.clicks)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(p.orders)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium" style={label}>{money(p.earningsCents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {p.deltaCents == null ? (
                      <span style={muted}>not enough months</span>
                    ) : (
                      <span style={{ color: p.deltaCents >= 0 ? '#10B981' : '#dc2626' }}>
                        {p.deltaCents >= 0 ? '+' : ''}{money(p.deltaCents)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={muted}>{p.videoCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {products.length > shown.length && (
          <button
            type="button"
            onClick={() => setLimit(l => l + 50)}
            className="text-[12px] underline underline-offset-2 mt-3"
            style={muted}
          >
            Show 50 more
          </button>
        )}
        <p className="text-[11px] mt-3" style={muted}>
          Trend compares {canTrend ? `${monthName(recent!)} against ${monthName(prior!)}` : 'the last two finished months'}, and reads &ldquo;not enough months&rdquo; where one of them had nothing to compare. The running month is left out on purpose: a few days against a whole month would show every product falling.
          {covPct != null && covPct < 95 ? ` These products account for ${covPct}% of the earnings in the same months. Amazon hides low-volume rows, so the rest is money it reported in the totals but would not break down.` : ''}
        </p>
      </div>
    </div>
  )
}
