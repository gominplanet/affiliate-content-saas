'use client'

import { useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { AnalyticsGuide } from '@/components/guide/tool-guides'
import Link from 'next/link'
import { TrendingUp, MousePointerClick, Eye, ExternalLink, Loader2, AlertCircle, Link2, Youtube, Globe, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import ScoutTokenStrip from '@/components/dashboard/ScoutTokenStrip'

interface AnalyticsPost {
  postId: string
  title: string
  url: string
  code: string | null
  clicks: number
}

interface SourceGroup {
  name: string
  kind: 'youtube' | 'blog'
  clicks: number
  linkCount: number
}

interface AnalyticsResponse {
  connected: boolean
  totals: { clicks: number; posts: number; topClicks: number }
  posts: AnalyticsPost[]
  groups: SourceGroup[]
  error?: string
}

interface StorefrontProduct {
  asin: string
  title: string
  image: string | null
  clicks: number
  pieceCount: number
  blogCount: number
  videoCount: number
  hasContent: boolean
  monthlySold: number | null
  priceNow: number | null
  commissionPct: number | null
  units: number | null
  revenue: number | null
  commission: number | null
  revenueDeltaPct: number | null
  conversionPct: number | null
  pieces: Array<{ type: 'blog' | 'youtube'; title: string; url: string | null }>
  amazonUrl: string
}
interface StorefrontResponse {
  connected: boolean
  period: 'weekly' | 'monthly'
  products: StorefrontProduct[]
  totals: { products: number; clicks: number; topClicks: number; revenue: number; commission: number }
  lastSyncedAt: string | null
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
  const [store, setStore] = useState<StorefrontResponse | null>(null)
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('monthly')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Storefront rollup — reloads on its own when the period toggle changes, so we
  // don't re-run the (slower) Geniuslink click fan-out just to switch periods.
  const loadStore = (p: 'weekly' | 'monthly') => {
    fetch(`/api/analytics/storefront?period=${p}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => setStore(j as StorefrontResponse | null))
      .catch(() => setStore(null))
  }
  useEffect(() => { loadStore(period) }, [period])

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
        <PageHero title="Storefront Stats" subtitle="Click data from your affiliate links." />
        <div className="card p-12 flex flex-col items-center gap-2 text-sm text-[#86868b]">
          <Loader2 size={20} className="animate-spin text-[#7C3AED]" />
          <span>Loading click data from Geniuslink…</span>
        </div>
      </>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <>
        <PageHero title="Storefront Stats" subtitle="Click data from your affiliate links." />
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
          <AlertCircle size={20} className="text-[#ff3b30]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Couldn&apos;t load analytics</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{error}</p>
          <button onClick={load} className="text-xs text-[#7C3AED] hover:underline">Retry</button>
        </div>
      </>
    )
  }

  // ── Not connected state ───────────────────────────────────────────────────
  if (data && !data.connected) {
    return (
      <>
        <PageHero title="Storefront Stats" subtitle="Click data from your affiliate links." />
        <div className="card p-8 max-w-lg flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
            <Link2 size={22} className="text-[#7C3AED]" />
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
          <a href="https://geni.us/Y70p9R" target="_blank" rel="noopener noreferrer" className="text-xs text-[#7C3AED] hover:underline">
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
        <PageHero title="Storefront Stats" subtitle="Click data from your affiliate links." />
        <ScoutTokenStrip />
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3 mt-3">
          <MousePointerClick size={22} className="text-[#86868b]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No clicks tracked yet</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] max-w-sm leading-relaxed">
            Publish a few reviews, share them on socials, and clicks will start appearing here.
            Geniuslink updates click counts within a few minutes of each click.
          </p>
          <button onClick={load} className="text-xs text-[#7C3AED] hover:underline">Refresh</button>
        </div>
      </>
    )
  }

  // ── Real data view ────────────────────────────────────────────────────────
  const totals = data!.totals
  const posts = data!.posts
  const maxClicks = posts[0]?.clicks ?? 1
  const avgClicksPerPost = totals.posts > 0 ? Math.round(totals.clicks / totals.posts) : 0

  return (
    <>
      <PageHero
        guide={<AnalyticsGuide />}
        title="Storefront Stats"
        subtitle="Last 30 days, human clicks only (bot/junk filtered to match Geniuslink's default). Only shortcodes tied to MVP-generated posts — your Geniuslink dashboard total will include codes from outside MVP."
        actions={
          <button onClick={load} className="btn-secondary text-sm">
            Refresh
          </button>
        }
      />

      {/* SCOUT token — handy right here, since earnings sync (revenue/units)
          rides on SCOUT being connected with this token. Self-gates: only shows
          when SCOUT is installed + not yet dismissed. */}
      <ScoutTokenStrip />

      {/* Top stats — three tiles (Geniuslink click data). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={MousePointerClick}
          label="Total clicks"
          value={totals.clicks.toLocaleString()}
          sub="Last 30 days · human traffic on MVP-attributed posts"
          color="text-[#7C3AED]"
          bg="bg-[#7C3AED]/8"
        />
        <StatCard
          icon={Eye}
          label="Posts with clicks"
          value={String(totals.posts)}
          sub={`Top ${posts.length} shown below`}
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

      {/* Your products — per-ASIN rollup. Real clicks (Geniuslink) + real sales
          (SCOUT → storefront_earnings) + Keepa demand. The "storefront" view. */}
      {store?.products && store.products.length > 0 && (() => {
        const pMax = store.products[0]?.clicks || 1
        const hasSales = store.products.some((p) => p.revenue != null || p.units != null)
        const syncedAgo = store.lastSyncedAt ? new Date(store.lastSyncedAt).toLocaleDateString() : null
        return (
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your products</p>
                <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                  {store.totals.products} product{store.totals.products === 1 ? '' : 's'}
                  {hasSales && <> · ${store.totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} sales · ${store.totals.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })} earned this {period === 'weekly' ? 'week' : 'month'}</>}
                  {syncedAgo && <> · synced {syncedAgo}</>}
                </p>
              </div>
              {/* Weekly / Monthly toggle */}
              <div className="flex rounded-lg border border-[var(--border-2)] overflow-hidden">
                {(['weekly', 'monthly'] as const).map((p) => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-[#7C3AED] text-white' : 'text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'}`}>
                    {p === 'weekly' ? 'Weekly' : 'Monthly'}
                  </button>
                ))}
              </div>
            </div>

            {/* Header row (sales columns only show once we have sales data) */}
            <div className="hidden sm:flex items-center gap-3 px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93]">
              <span className="w-11 flex-shrink-0" />
              <span className="flex-1">Product</span>
              {hasSales && <span className="w-20 text-right">Revenue</span>}
              {hasSales && <span className="w-14 text-right">Units</span>}
              {hasSales && <span className="w-20 text-right">Earned</span>}
              <span className="w-14 text-right">Clicks</span>
            </div>

            <div className="flex flex-col">
              {store.products.map((p) => (
                <div key={p.asin} className="flex items-center gap-3 py-3 border-b border-gray-100 dark:border-white/5 last:border-b-0">
                  <div className="w-11 h-11 rounded-lg bg-[var(--surface-2)] border border-[var(--border-2)] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {p.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.image} alt="" className="w-full h-full object-contain p-0.5" />
                      : <span className="text-[9px] text-[var(--text-3)]">—</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a href={p.amazonUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-medium truncate hover:text-[#7C3AED] block">{p.title}</a>
                    <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#5856d6]" style={{ width: `${Math.max((p.clicks / pMax) * 100, 1)}%` }} />
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-[#86868b] dark:text-[#8e8e93] flex-wrap">
                      {!p.hasContent && <span className="text-[#ff9500] font-semibold">No content yet</span>}
                      <span>{p.blogCount > 0 && `${p.blogCount} post${p.blogCount > 1 ? 's' : ''}`}{p.blogCount > 0 && p.videoCount > 0 && ' · '}{p.videoCount > 0 && `${p.videoCount} video${p.videoCount > 1 ? 's' : ''}`}</span>
                      {p.conversionPct != null && <span>· {p.conversionPct}% conv</span>}
                      {p.monthlySold != null && <span>· {p.monthlySold.toLocaleString()}+ sold/mo</span>}
                      {p.commissionPct != null && <span className="text-[#1c7a35] font-semibold">· {p.commissionPct}% CC</span>}
                    </div>
                  </div>
                  {hasSales && (
                    <div className="w-20 text-right flex-shrink-0 hidden sm:block">
                      {p.revenue != null ? (
                        <>
                          <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">${p.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          {p.revenueDeltaPct != null && (
                            <span className={`flex items-center justify-end gap-0.5 text-[10px] ${p.revenueDeltaPct >= 0 ? 'text-[#1c7a35]' : 'text-[#b3261e]'}`}>
                              {p.revenueDeltaPct >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(p.revenueDeltaPct)}%
                            </span>
                          )}
                        </>
                      ) : <span className="text-xs text-[#86868b]">—</span>}
                    </div>
                  )}
                  {hasSales && <div className="w-14 text-right flex-shrink-0 hidden sm:block"><span className="text-sm tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{p.units != null ? p.units.toLocaleString() : '—'}</span></div>}
                  {hasSales && <div className="w-20 text-right flex-shrink-0 hidden sm:block"><span className="text-sm font-semibold tabular-nums text-[#1c7a35]">{p.commission != null ? `$${p.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</span></div>}
                  <div className="w-14 text-right flex-shrink-0">
                    <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{p.clicks.toLocaleString()}</span>
                    <span className="block text-[10px] text-[#86868b] dark:text-[#8e8e93] sm:hidden">clicks</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-4 leading-relaxed">
              Clicks are real (Geniuslink, last 30 days).{' '}
              {hasSales
                ? <>Revenue, units &amp; earnings are your real Amazon Influencer sales for the selected {period === 'weekly' ? 'week' : 'month'}, synced by the SCOUT extension.</>
                : <><DollarSign size={11} className="inline -mt-0.5" /> Sales &amp; revenue fill in once the SCOUT extension syncs your Amazon earnings. &ldquo;Sold/mo&rdquo; is a Keepa demand estimate until then.</>}
            </p>
          </div>
        )
      })()}

      {/* Clicks by source — per-Geniuslink-group breakdown. Lets the user
          see at a glance whether YouTube descriptions or blog posts are
          driving the traffic. Shipped 2026-06-09 alongside the MVP-YOUTUBE
          vs site-domain grouping in services/geniuslink. */}
      {data!.groups && data!.groups.length > 0 && (() => {
        const groupMax = Math.max(...data!.groups.map(g => g.clicks), 1)
        return (
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Clicks by source</p>
              <span className="text-xs text-[#86868b] dark:text-[#8e8e93]">YouTube vs blogs · last 30 days</span>
            </div>
            <div className="flex flex-col gap-3">
              {data!.groups.map((g) => {
                const Icon = g.kind === 'youtube' ? Youtube : Globe
                const iconColor = g.kind === 'youtube' ? 'text-[#ff3b30]' : 'text-[#7C3AED]'
                const iconBg = g.kind === 'youtube' ? 'bg-[#ff3b30]/8' : 'bg-[#7C3AED]/8'
                const barFill = g.kind === 'youtube'
                  ? 'bg-gradient-to-r from-[#ff3b30] to-[#ff9500]'
                  : 'bg-gradient-to-r from-[#7C3AED] to-[#5856d6]'
                const sharePct = (g.clicks / groupMax) * 100
                return (
                  <div key={`${g.kind}-${g.name}`} className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
                      <Icon size={16} className={iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 mb-1.5">
                        <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                          {g.name}
                          <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93] font-normal ml-1.5">
                            · {g.linkCount} {g.linkCount === 1 ? 'link' : 'links'}
                          </span>
                        </p>
                        <span className="text-sm font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] flex-shrink-0">
                          {g.clicks.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full ${barFill}`} style={{ width: `${Math.max(sharePct, 1)}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-4 leading-relaxed">
              YouTube clicks come from links in your video descriptions (MVP-YOUTUBE Geniuslink group).
              Blog clicks come from links inside published posts (each blog routes to its own group).
            </p>
          </div>
        )
      })()}

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
                  <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-medium truncate group-hover:text-[#7C3AED] transition-colors">
                    {p.title || <span className="italic text-[#86868b]">Untitled</span>}
                  </p>
                  <div className="mt-1.5 h-1 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#5856d6]"
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
                  <ExternalLink size={12} className="text-[#86868b] dark:text-[#8e8e93] flex-shrink-0 group-hover:text-[#7C3AED] transition-colors" />
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
