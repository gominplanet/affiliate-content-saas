'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { Loader2, AlertCircle } from 'lucide-react'

interface Agg { cost: number; calls: number }
interface CostData {
  days: number
  total: number
  calls: number
  byTier: Record<string, Agg>
  byFeature: Record<string, Agg>
}

const TIER_ORDER = ['admin', 'pro', 'growth', 'starter', 'free', 'unknown']

export default function AdminCostsPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<CostData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/costs?days=${days}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setData(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const tierRows = data
    ? Object.entries(data.byTier).sort(
        (a, b) => (TIER_ORDER.indexOf(a[0]) - TIER_ORDER.indexOf(b[0])),
      )
    : []
  const featRows = data
    ? Object.entries(data.byFeature).sort((a, b) => b[1].cost - a[1].cost)
    : []

  return (
    <>
      <Header title="AI Cost (admin)" subtitle="Real model spend from ai_usage telemetry. Pricing is approximate list pricing." />

      <div className="flex items-center gap-2 mb-5">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              days === d ? 'bg-[#0071e3] text-white' : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
            }`}
          >
            Last {d}d
          </button>
        ))}
        {loading && <Loader2 size={14} className="animate-spin text-[#86868b] ml-1" />}
      </div>

      {err && (
        <div className="card p-4 mb-5 flex items-center gap-2 text-sm text-[#ff3b30]">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {data && (
        <>
          <div className="card p-5 mb-6 max-w-sm">
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-1">Total spend · last {data.days}d</p>
            <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">${data.total.toFixed(2)}</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">{data.calls.toLocaleString()} billable AI calls</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card p-5">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">By tier</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] text-left">
                    <th className="pb-2">Tier</th><th className="pb-2 text-right">Calls</th><th className="pb-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map(([t, v]) => (
                    <tr key={t} className="border-t border-gray-100 dark:border-white/5">
                      <td className="py-2 capitalize">{t}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{v.calls.toLocaleString()}</td>
                      <td className="py-2 text-right font-semibold">${v.cost.toFixed(2)}</td>
                    </tr>
                  ))}
                  {tierRows.length === 0 && <tr><td colSpan={3} className="py-3 text-[#86868b]">No data yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="card p-5">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">By feature</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] text-left">
                    <th className="pb-2">Feature</th><th className="pb-2 text-right">Calls</th><th className="pb-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {featRows.map(([f, v]) => (
                    <tr key={f} className="border-t border-gray-100 dark:border-white/5">
                      <td className="py-2">{f}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{v.calls.toLocaleString()}</td>
                      <td className="py-2 text-right font-semibold">${v.cost.toFixed(2)}</td>
                    </tr>
                  ))}
                  {featRows.length === 0 && <tr><td colSpan={3} className="py-3 text-[#86868b]">No data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-5 max-w-2xl leading-relaxed">
            Tracked: blog generation, CC campaign research + generation, Pinterest text + image.
            Minor Haiku calls (per-social captions, metadata helpers) are not yet instrumented,
            so true total is marginally higher. Fixed infra (Vercel, Supabase, domain) is not included.
          </p>
        </>
      )}
    </>
  )
}
