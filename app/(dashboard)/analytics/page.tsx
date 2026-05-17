'use client'

/**
 * Analytics PREVIEW page — shape + UX only. All numbers below are mock
 * data so the user can decide whether to build the real version.
 *
 * If we commit to this feature, replace `MOCK_*` constants with calls
 * to /api/analytics/clicks (new) that pulls from:
 *   - Geniuslink Insights API for click + estimated commission data
 *   - WordPress posts table for titles + URLs + thumbnails
 * Daily series → Geniuslink /reports endpoint grouped by day.
 *
 * Everything else (UI structure, the chart, the table, the empty states)
 * stays as-is — only the data source changes.
 */

import Header from '@/components/layout/Header'
import { TrendingUp, MousePointerClick, DollarSign, ExternalLink, Eye } from 'lucide-react'

// ── MOCK DATA — replace with Geniuslink API in the next commit ─────────────
const MOCK_TOTALS = {
  clicks: 1247,
  earnings: 187.50,
  posts: 32,
  topClicks: 247,
  topEarnings: 42.10,
}

const MOCK_DAILY_CLICKS = [
  18, 22, 31, 28, 19, 24, 35, 41, 33, 27, 19, 22, 38, 45, 52, 48, 39, 31, 28,
  35, 42, 58, 67, 53, 41, 38, 49, 62, 71, 64,
]

interface AnalyticsPost {
  postId: string
  title: string
  url: string
  thumbnail: string | null
  clicks: number
  earnings: number
  lastClickedAgo: string
}

const MOCK_POSTS: AnalyticsPost[] = [
  { postId: '1', title: 'The Anti-Fatigue Mat That Saved Our Kitchen — Knoworld Review',          url: 'https://yourdomain.com/anti-fatigue-mat', thumbnail: null, clicks: 247, earnings: 42.10, lastClickedAgo: '2h ago'  },
  { postId: '2', title: 'Best Knife Sharpeners for Home Cooks (Tested 8)',                       url: 'https://yourdomain.com/knife-sharpeners',  thumbnail: null, clicks: 198, earnings: 35.80, lastClickedAgo: '4h ago'  },
  { postId: '3', title: '10ft Cobweb Duster Tested: Worth It or Skip?',                          url: 'https://yourdomain.com/cobweb-duster',     thumbnail: null, clicks: 156, earnings: 24.50, lastClickedAgo: '7h ago'  },
  { postId: '4', title: '2-in-1 Tuning Fork Fidget Spinner Review',                              url: 'https://yourdomain.com/tuning-fork',       thumbnail: null, clicks: 134, earnings: 19.20, lastClickedAgo: '1d ago'  },
  { postId: '5', title: 'Knoworld 24" Farmhouse Nightstand — Real Bedroom Upgrade?',             url: 'https://yourdomain.com/nightstand',        thumbnail: null, clicks: 121, earnings: 18.70, lastClickedAgo: '1d ago'  },
  { postId: '6', title: 'Should You Add This to Your Daily Routine?',                            url: 'https://yourdomain.com/daily-routine',     thumbnail: null, clicks: 98,  earnings: 14.30, lastClickedAgo: '2d ago'  },
  { postId: '7', title: 'Are These Running Shoes Good for Both Gym and Track?',                  url: 'https://yourdomain.com/running-shoes',     thumbnail: null, clicks: 87,  earnings: 11.95, lastClickedAgo: '2d ago'  },
  { postId: '8', title: 'Worth It? — The 5-Star Mattress Review',                                url: 'https://yourdomain.com/mattress-review',   thumbnail: null, clicks: 76,  earnings: 9.40,  lastClickedAgo: '3d ago'  },
  { postId: '9', title: 'Espresso Equipment Roundup — Sub-$300',                                 url: 'https://yourdomain.com/espresso-sub-300',  thumbnail: null, clicks: 64,  earnings: 7.20,  lastClickedAgo: '3d ago'  },
  { postId: '10', title: 'Best Cordless Vacuums Compared (Dyson vs. Tineco vs. Shark)',          url: 'https://yourdomain.com/cordless-vacuums',  thumbnail: null, clicks: 38,  earnings: 4.15,  lastClickedAgo: '5d ago'  },
]

// ── Stats card ─────────────────────────────────────────────────────────────
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

// ── Simple SVG sparkline ───────────────────────────────────────────────────
function Sparkline({ data, color = '#0071e3' }: { data: number[]; color?: string }) {
  if (data.length === 0) return null
  const W = 800
  const H = 120
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const stepX = W / (data.length - 1)
  const points = data.map((v, i) => `${i * stepX},${H - ((v - min) / range) * H}`).join(' ')
  // Area fill polygon (closes back to baseline)
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

export default function AnalyticsPage() {
  // Compute the "topShare" of total — used in the row bars below.
  const maxClicks = MOCK_POSTS[0]?.clicks ?? 1

  return (
    <>
      <Header
        title="Analytics"
        subtitle="The money MVP is making you. Click + commission data from your affiliate links."
      />

      {/* Preview banner — only present while we're showing mock data */}
      <div className="card mb-6 p-4 border border-[#ff9500]/30 bg-[#ff9500]/5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">📊 Preview — mock data</p>
        <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          This is a structural preview. Numbers below are placeholder. If we build this for real, the same UI shows your actual
          Geniuslink click data + estimated commissions from the last 30 days, refreshed daily.
        </p>
      </div>

      {/* Top stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={MousePointerClick}
          label="Total clicks"
          value={MOCK_TOTALS.clicks.toLocaleString()}
          sub="Last 30 days"
          color="text-[#0071e3]"
          bg="bg-[#0071e3]/8"
        />
        <StatCard
          icon={DollarSign}
          label="Estimated earnings"
          value={`$${MOCK_TOTALS.earnings.toFixed(2)}`}
          sub="Geniuslink commission est."
          color="text-[#34c759]"
          bg="bg-[#34c759]/8"
        />
        <StatCard
          icon={Eye}
          label="Posts with clicks"
          value={String(MOCK_TOTALS.posts)}
          sub={`Out of ${MOCK_POSTS.length + 12} published`}
          color="text-purple-600"
          bg="bg-purple-50 dark:bg-purple-900/20"
        />
        <StatCard
          icon={TrendingUp}
          label="Top performer"
          value={`${MOCK_TOTALS.topClicks}`}
          sub={`clicks · $${MOCK_TOTALS.topEarnings.toFixed(2)} earned`}
          color="text-[#ff9500]"
          bg="bg-[#ff9500]/8"
        />
      </div>

      {/* Sparkline */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Daily clicks</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Last 30 days · all posts combined</p>
          </div>
          <span className="text-xs text-[#34c759] font-semibold flex items-center gap-1">
            <TrendingUp size={11} /> +24% vs prev. 30 days
          </span>
        </div>
        <Sparkline data={MOCK_DAILY_CLICKS} />
      </div>

      {/* Top performing posts */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Top performing posts</p>
          <span className="text-xs text-[#86868b] dark:text-[#8e8e93]">Sorted by clicks · last 30 days</span>
        </div>
        <div className="flex flex-col">
          {MOCK_POSTS.map((p, i) => {
            const sharePct = (p.clicks / maxClicks) * 100
            return (
              <a
                key={p.postId}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 py-3 border-b border-gray-100 dark:border-white/5 last:border-b-0 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors rounded-lg px-2 -mx-2 group"
              >
                <span className="text-[11px] font-semibold text-[#86868b] dark:text-[#8e8e93] w-6 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] font-medium truncate group-hover:text-[#0071e3] transition-colors">
                    {p.title}
                  </p>
                  <div className="mt-1.5 h-1 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#0071e3] to-[#5856d6]"
                      style={{ width: `${sharePct}%` }}
                    />
                  </div>
                </div>
                <div className="hidden sm:flex flex-col items-end flex-shrink-0 w-20 text-right">
                  <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{p.clicks}</span>
                  <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">clicks</span>
                </div>
                <div className="hidden sm:flex flex-col items-end flex-shrink-0 w-20 text-right">
                  <span className="text-sm font-semibold text-[#34c759] tabular-nums">${p.earnings.toFixed(2)}</span>
                  <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">est.</span>
                </div>
                <div className="hidden md:flex flex-col items-end flex-shrink-0 w-20 text-right">
                  <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">{p.lastClickedAgo}</span>
                  <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">last click</span>
                </div>
                <ExternalLink size={12} className="text-[#86868b] dark:text-[#8e8e93] flex-shrink-0 group-hover:text-[#0071e3] transition-colors" />
              </a>
            )
          })}
        </div>
      </div>

      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-6 text-center leading-relaxed max-w-2xl mx-auto">
        Earnings are <em>estimates</em> from Geniuslink based on click-through rates and average commission. Real
        payouts come from Amazon Associates (and any other affiliate network you&apos;ve connected). Numbers reconcile
        within a few days of each click.
      </p>
    </>
  )
}
