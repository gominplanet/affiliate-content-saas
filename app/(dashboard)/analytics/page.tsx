'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import Link from 'next/link'
import { TrendingUp, MousePointerClick, Eye, ExternalLink, Loader2, AlertCircle, Link2 } from 'lucide-react'

interface AnalyticsPost {
  postId: string
  title: string
  url: string
  code: string | null
  clicks: number
}

interface AnalyticsResponse {
  connected: boolean
  totals: { clicks: number; posts: number; topClicks: number }
  posts: AnalyticsPost[]
  /** Dense 30-day series. Caller renders a sparkline from this. */
  daily?: Array<{ date: string; clicks: number }>
  error?: string
}

/** Compact SVG sparkline — no chart library. */
function Sparkline({ data, color = '#0071e3' }: { data: number[]; color?: string }) {
  if (!data.length) return null
  const W = 800
  const H = 120
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const stepX = W / Math.max(data.length - 1, 1)
  const points = data.map((v, i) => `${i * stepX},${H - ((v - min) / range) * H}`).join(' ')
  const area = `0,${H} ${points} ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-grad)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function StatCard({
  icon: Icon, label, value, sub, color, bg,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  sub: string
  color: string
  bg: string
}) {
  return (
    <div className="card p-5">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
        <Icon size={18} className={color} />
      </div>
      <p className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] font-medium mt-0.5">{label}</p>
      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">{sub}</p>
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/clicks')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json as AnalyticsResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Header title="Analytics" subtitle="Click data from your affiliate links." />
        <div className="card p-12 flex flex-col items-center gap-2 text-sm text-[#86868b]">
          <Loader2 size={20} className="animate-spin text-[#0071e3]" />
          <span>Loading click data from Geniuslink…</span>
        </div>
      </>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <>
        <Header title="Analytics" subtitle="Click data from your affiliate links." />
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
          <AlertCircle size={20} className="text-[#ff3b30]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Couldn&apos;t load analytics</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{error}</p>
          <button onClick={load} className="text-xs text-[#0071e3] hover:underline">Retry</button>
        </div>
      </>
    )
  }

  // ── Not connected state ───────────────────────────────────────────────────
  if (data && !data.connected) {
    return (
      <>
        <Header title="Analytics" subtitle="Click data from your affiliate links." />
        <div className="card p-8 max-w-lg flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
            <Link2 size={22} className="text-[#0071e3]" />
          </div>
          <div>
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect Geniuslink to see your data</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] max-w-md leading-relaxed">
              Analytics pulls clicks + estimated traffic from your Geniuslink account. Without it,
              your affiliate links go straight to Amazon and there&apos;s nothing to measure here.
              Geniuslink also routes international visitors to their local Amazon (which pays you).
            </p>
          </div>
          <Link href="/setup?tab=integrations" className="btn-primary text-sm">
            Connect Geniuslink
          </Link>
          <a href="https://geni.us/Y70p9R" target="_blank" rel="noopener noreferrer" className="text-xs text-[#0071e3] hover:underline">
            Don&apos;t have an account? Sign up for Geniuslink
          </a>
        </div>
      </>
    )
  }

  // ── No data yet state ─────────────────────────────────────────────────────
  if (data && data.totals.clicks === 0 && data.posts.length === 0) {
    return (
      <>
        <Header title="Analytics" subtitle="Click data from your affiliate links." />
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
          <MousePointerClick size={22} className="text-[#86868b]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No clicks tracked yet</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] max-w-sm leading-relaxed">
            Publish a few reviews, share them on socials, and clicks will start appearing here.
            Geniuslink updates click counts within a few minutes of each click.
          </p>
          <button onClick={load} className="text-xs text-[#0071e3] hover:underline">Refresh</button>
        </div>
      </>
    )
  }

  // ── Real data view ────────────────────────────────────────────────────────
  const totals = data!.totals
  const posts = data!.posts
  const daily = data!.daily ?? []
  const maxClicks = posts[0]?.clicks ?? 1
  const avgClicksPerPost = totals.posts > 0 ? Math.round(totals.clicks / totals.posts) : 0

  return (
    <>
      <Header
        title="Analytics"
        subtitle="Last 30 days of click data from your affiliate links. Refreshed live from Geniuslink."
        actions={
          <button onClick={load} className="btn-secondary text-sm">
            Refresh
          </button>
        }
      />

      {/* Top stats — three tiles. No estimated $ until we wire Amazon Associates reports. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={MousePointerClick}
          label="Total clicks"
          value={totals.clicks.toLocaleString()}
          sub="Last 30 days · all Geniuslink links"
          color="text-[#0071e3]"
          bg="bg-[#0071e3]/8"
        />
        <StatCard
          icon={Eye}
          label="Posts with clicks"
          value={String(totals.posts)}
          sub={`Out of ${posts.length} matched`}
          color="text-purple-600"
          bg="bg-purple-50 dark:bg-purple-900/20"
        />
        <StatCard
          icon={TrendingUp}
          label="Top performer"
          value={`${totals.topClicks}`}
          sub={`${avgClicksPerPost} clicks/post on average`}
          color="text-[#ff9500]"
          bg="bg-[#ff9500]/8"
        />
      </div>

      {/* Daily clicks sparkline */}
      {daily.length > 0 && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Daily clicks</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Last 30 days · all posts combined</p>
            </div>
            <span className="text-xs text-[#86868b] dark:text-[#8e8e93] tabular-nums">
              {daily[0]?.date.slice(5)} → {daily[daily.length - 1]?.date.slice(5)}
            </span>
          </div>
          <Sparkline data={daily.map(d => d.clicks)} />
        </div>
      )}

      {/* Top performing posts */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">All posts by clicks</p>
          <span className="text-xs text-[#86868b] dark:text-[#8e8e93]">Last 30 days · sorted descending</span>
        </div>
        <div className="flex flex-col">
          {posts.map((p, i) => {
            const sharePct = (p.clicks / maxClicks) * 100
            return (
              <a
                key={p.postId}
                href={p.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-3 sm:gap-4 py-3 border-b border-gray-100 dark:border-white/5 last:border-b-0 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors rounded-lg px-2 -mx-2 group ${!p.url ? 'pointer-events-none opacity-60' : ''}`}
              >
                <span className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] w-6 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-medium truncate group-hover:text-[#0071e3] transition-colors">
                    {p.title || <span className="italic text-[#86868b]">Untitled</span>}
                  </p>
                  <div className="mt-1.5 h-1 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#0071e3] to-[#5856d6]"
                      style={{ width: `${Math.max(sharePct, 1)}%` }}
                    />
                  </div>
                  {!p.code && (
                    <p className="text-[10px] text-[#ff9500] mt-1">No Geniuslink found for this post — couldn&apos;t match it.</p>
                  )}
                </div>
                <div className="hidden sm:flex flex-col items-end flex-shrink-0 w-20 text-right">
                  <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{p.clicks}</span>
                  <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">clicks</span>
                </div>
                {p.url && (
                  <ExternalLink size={12} className="text-[#86868b] dark:text-[#8e8e93] flex-shrink-0 group-hover:text-[#0071e3] transition-colors" />
                )}
              </a>
            )
          })}
        </div>
      </div>

      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-6 text-center leading-relaxed max-w-2xl mx-auto">
        Clicks come from your Geniuslink account. We match each shortlink back to its blog post by
        the Note field (set to the post title when we create the link). Posts created before we
        added link-tracking are auto-backfilled by title match — accurate but not perfect.
      </p>
    </>
  )
}
