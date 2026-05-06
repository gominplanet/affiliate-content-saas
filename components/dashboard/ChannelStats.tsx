'use client'

import { useState } from 'react'
import { RefreshCw, TrendingUp, Users, Eye, PlaySquare } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

interface DailySnapshot {
  date: string
  subscribers: number
  views: number
  videos: number
}

interface ChannelStatsData {
  title: string
  thumbnail: string
  currentStats: {
    subscribers: number
    views: number
    videos: number
  }
  growth: {
    subscribersGained: number
    viewsGained: number
    videosPublished: number
  }
  dailyStats: DailySnapshot[]
  syncedAt: string
}

export default function ChannelStats({ data }: { data: ChannelStatsData | null }) {
  const [syncing, setSyncing] = useState(false)
  const [stats, setStats] = useState<ChannelStatsData | null>(data)

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/vidiq/channel/sync', { method: 'POST' })
      const json = await res.json()
      if (res.ok) setStats(json)
    } finally {
      setSyncing(false)
    }
  }

  if (!stats) {
    return (
      <div className="card p-5 mb-6 border border-dashed border-gray-300">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f]">Channel Analytics</p>
            <p className="text-xs text-[#86868b] mt-0.5">Connect VidIQ to see your channel growth.</p>
          </div>
          <button onClick={handleSync} disabled={syncing} className="btn-secondary text-xs">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Loading…' : 'Load stats'}
          </button>
        </div>
      </div>
    )
  }

  const metrics = [
    {
      label: 'Subscribers',
      value: formatNumber(stats.currentStats.subscribers),
      growth: `+${formatNumber(stats.growth.subscribersGained)}`,
      icon: Users,
      color: 'text-[#0071e3]',
      bg: 'bg-[#0071e3]/8',
    },
    {
      label: 'Total Views',
      value: formatNumber(stats.currentStats.views),
      growth: `+${formatNumber(stats.growth.viewsGained)} this month`,
      icon: Eye,
      color: 'text-[#34c759]',
      bg: 'bg-[#34c759]/8',
    },
    {
      label: 'Videos',
      value: formatNumber(stats.currentStats.videos),
      growth: `+${stats.growth.videosPublished} this month`,
      icon: PlaySquare,
      color: 'text-purple-500',
      bg: 'bg-purple-50',
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
            <p className="text-sm font-semibold text-[#1d1d1f]">{stats.title}</p>
            <p className="text-xs text-[#86868b]">Last 30 days · synced {stats.syncedAt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-[#34c759]" />
          <span className="text-xs font-medium text-[#34c759]">Growing</span>
          <button onClick={handleSync} disabled={syncing} className="btn-secondary text-xs px-2.5 py-1.5 ml-1">
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {metrics.map(({ label, value, growth, icon: Icon, color, bg }) => (
          <div key={label} className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={15} className={color} />
            </div>
            <div>
              <p className="text-lg font-semibold text-[#1d1d1f] leading-tight">{value}</p>
              <p className="text-xs text-[#86868b]">{label}</p>
              <p className="text-xs text-[#34c759] font-medium mt-0.5">{growth}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
