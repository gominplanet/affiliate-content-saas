'use client'

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, AlertCircle } from 'lucide-react'
import { TIERS } from '@/lib/tier'

interface TierAgg { cost: number; calls: number; activeUsers: number }
interface FeatureAgg { cost: number; calls: number }
interface CostData {
  days: number
  total: number
  calls: number
  totalPosts: number
  byTier: Record<string, TierAgg>
  byFeature: Record<string, FeatureAgg>
  postsByTier: Record<string, number>
  payingByTier: Record<string, number>
}

const TIER_ORDER = ['admin', 'pro', 'studio', 'creator', 'trial', 'unknown']
const PAID_TIERS = ['creator', 'studio', 'pro'] as const

export default function AdminCostsPage() {
  const [days, setDays] = useState(30)
  const [excludeAdmin, setExcludeAdmin] = useState(false)
  const [data, setData] = useState<CostData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch(`/api/admin/costs?days=${days}${excludeAdmin ? '&excludeAdmin=1' : ''}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setData(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [days, excludeAdmin])

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
      <PageHero title="AI Cost (admin)" subtitle="Real model spend from ai_usage telemetry. Pricing is approximate list pricing." />

      <div className="flex items-center gap-2 mb-5">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              days === d ? 'bg-[#7C3AED] text-white' : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
            }`}
          >
            Last {d}d
          </button>
        ))}
        {loading && <Loader2 size={14} className="animate-spin text-[#86868b] ml-1" />}

        {/* Exclude-admin toggle — strips the founder's own testing accounts so
            the numbers reflect real customer economics. */}
        <button
          onClick={() => setExcludeAdmin(v => !v)}
          className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            excludeAdmin ? 'bg-[#34c759] text-white' : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
          }`}
          title="Hide the admin tier (your own testing) to see customer-only spend"
        >
          {excludeAdmin ? '✓ Excluding admin (customers only)' : 'Exclude admin testing'}
        </button>
      </div>

      {err && (
        <div className="card p-4 mb-5 flex items-center gap-2 text-sm text-[#ff3b30]">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            <div className="card p-5">
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-1">Total spend · last {data.days}d</p>
              <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">${data.total.toFixed(2)}</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">{data.calls.toLocaleString()} billable AI calls</p>
            </div>
            <div className="card p-5">
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-1">New posts created · last {data.days}d</p>
              <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">{data.totalPosts.toLocaleString()}</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">
                Avg cost / post: <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">${data.totalPosts > 0 ? (data.total / data.totalPosts).toFixed(2) : '—'}</span>
              </p>
            </div>
            <div className="card p-5">
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-1">Currently paying users</p>
              <p className="text-3xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {PAID_TIERS.reduce((s, t) => s + (data.payingByTier[t] || 0), 0)}
              </p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">
                {PAID_TIERS.map(t => `${data.payingByTier[t] || 0} ${t}`).join(' · ')}
              </p>
            </div>
          </div>

          {/* Unit economics — answers "what's my margin per tier?" */}
          <div className="card p-5 mb-6">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Unit economics · last {data.days}d</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-4">
              <span className="font-semibold">Realized</span> = actual AI spend ÷ active users (people who generated this window).{' '}
              <span className="font-semibold">Worst-case</span> = the tier&apos;s monthly AI-spend ceiling, the hard cap <code className="text-[10px]">spendGate</code> enforces.
              Both margins use the price + ceiling from <code className="text-[10px]">lib/tier.ts</code>. Newsletter email (Resend) and fixed infra are NOT included.
            </p>
            <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] text-left">
                  <th className="pb-2">Tier</th>
                  <th className="pb-2 text-right">Price</th>
                  <th className="pb-2 text-right">Ceiling</th>
                  <th className="pb-2 text-right">Paying</th>
                  <th className="pb-2 text-right">Active</th>
                  <th className="pb-2 text-right">AI spend</th>
                  <th className="pb-2 text-right">Posts</th>
                  <th className="pb-2 text-right">$/post</th>
                  <th className="pb-2 text-right">Cost/user</th>
                  <th className="pb-2 text-right">Margin/user</th>
                  <th className="pb-2 text-right">Worst-case margin</th>
                </tr>
              </thead>
              <tbody>
                {PAID_TIERS.map(t => {
                  const tierInfo = TIERS[t]
                  const price = tierInfo.price
                  const ceiling = tierInfo.monthlyAiSpendCeilingUsd ?? 0
                  const paying = data.payingByTier[t] || 0
                  const tierSpend = data.byTier[t]?.cost || 0
                  const tierPosts = data.postsByTier[t] || 0
                  const activeUsers = data.byTier[t]?.activeUsers || 0
                  // Cost-per-user uses the count of users who actually
                  // generated this period (denominator), not the total
                  // paying count — otherwise dormant subs deflate the
                  // number and make margins look better than they are.
                  const costPerActiveUser = activeUsers > 0 ? tierSpend / activeUsers : 0
                  const costPerPost = tierPosts > 0 ? tierSpend / tierPosts : 0
                  const marginPerUser = price - costPerActiveUser
                  // Worst case is the spend ceiling — spendGate stops most AI
                  // paths once a user burns that much, so it's the true max
                  // AI COGS the tier can incur in a month.
                  const worstCaseMargin = price - ceiling
                  const worstPct = price > 0 ? Math.round((worstCaseMargin / price) * 100) : 0
                  return (
                    <tr key={t} className="border-t border-gray-100 dark:border-white/5">
                      <td className="py-2 capitalize font-medium">{t}</td>
                      <td className="py-2 text-right">${price}</td>
                      <td className="py-2 text-right text-[#86868b]">${ceiling}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{paying}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{activeUsers}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">${tierSpend.toFixed(2)}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{tierPosts}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{tierPosts > 0 ? `$${costPerPost.toFixed(2)}` : '—'}</td>
                      <td className="py-2 text-right text-[#6e6e73] dark:text-[#ebebf0]">{activeUsers > 0 ? `$${costPerActiveUser.toFixed(2)}` : '—'}</td>
                      <td className={`py-2 text-right font-semibold ${marginPerUser < 0 ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{activeUsers > 0 ? `$${marginPerUser.toFixed(2)}` : '—'}</td>
                      <td className={`py-2 text-right font-semibold ${worstCaseMargin < 0 ? 'text-[#ff3b30]' : worstPct < 40 ? 'text-[#FF9500]' : 'text-[#34c759]'}`} title="Price − monthly AI-spend ceiling (the hard cap)">
                        ${worstCaseMargin}<span className="text-[10px] font-normal text-[#86868b]"> / {worstPct}%</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-3 leading-relaxed">
              <span className="font-semibold">Worst-case margin = Price − Ceiling.</span> Amber = under 40% (thin); red = negative.
              This is AI-only — a tier&apos;s newsletter email volume (Resend) and fixed infra sit on top, so true margin is a few points lower,
              heaviest on Pro. If realized Cost/user is far below the ceiling, the cap is generous headroom; if it&apos;s near the ceiling, power users are the risk.
            </p>
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
