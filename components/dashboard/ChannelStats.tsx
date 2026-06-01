'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, TrendingUp, Users, Eye, PlaySquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/utils'

interface ChannelStatsData {
  title: string
  thumbnail: string
  currentStats: { subscribers: number; views: number; videos: number }
  growth: { subscribersGained: number; viewsGained: number; videosPublished: number }
  syncedAt: string
}

export default function ChannelStats() {
  const [stats, setStats] = useState<ChannelStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  async function fetchStats() {
    try {
      const res = await fetch('/api/youtube/channel-stats')
      if (res.ok) setStats(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

  async function handleSync() {
    setSyncing(true)
    await fetchStats()
    setSyncing(false)
  }

  if (loading) return null

  if (!stats) {
    return (
      <div className="card p-5 mb-6 border border-dashed border-gray-300 dark:border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Channel Analytics</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">Add your YouTube channel ID in Settings to see stats.</p>
          </div>
        </div>
      </div>
    )
  }

  const metrics = [
    {
      label: 'Subscribers',
      value: formatNumber(stats.currentStats.subscribers),
      sub: 'total',
      icon: Users,
      color: 'text-[#0071e3]',
      bg: 'bg-[#0071e3]/8',
    },
    {
      label: 'Total Views',
      value: formatNumber(stats.currentStats.views),
      sub: 'all time',
      icon: Eye,
      color: 'text-[#34c759]',
      bg: 'bg-[#34c759]/8',
    },
    {
      label: 'Videos',
      value: formatNumber(stats.currentStats.videos),
      sub: `+${stats.growth.videosPublished} last 30 days`,
      icon: PlaySquare,
      color: 'text-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-500/10',
    },
  ]

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          {stats.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={stats.thumbnail} alt={stats.title} className="w-7 h-7 rounded-full object-cover" />
          )}
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{stats.title}</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">YouTube channel · synced {stats.syncedAt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-[#34c759]" />
          <span className="text-xs font-medium text-[#34c759]">Live</span>
          <Button
            variant="secondary"
            size="icon"
            onClick={handleSync}
            disabled={syncing}
            loading={syncing}
            aria-label="Sync YouTube channel stats"
            className="ml-1 h-8 w-8"
            leftIcon={!syncing ? <RefreshCw size={12} /> : undefined}
          />

        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {metrics.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={15} className={color} />
            </div>
            <div>
              <p className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-tight">{value}</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">{label}</p>
              <p className="text-xs text-[#34c759] font-medium mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
