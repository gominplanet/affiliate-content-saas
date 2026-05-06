'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlaySquare, RefreshCw, Plus } from 'lucide-react'
import { formatNumber, formatDate } from '@/lib/utils'

interface Video {
  id: string
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  channel_title: string
  published_at: string
  view_count: number | null
}

function VideoCard({ video }: { video: Video }) {
  return (
    <div className="card p-5">
      <div className="flex items-start gap-4">
        <div className="w-32 h-[72px] rounded-lg bg-[#f5f5f7] border border-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {video.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnail_url}
              alt={video.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <PlaySquare size={24} className="text-[#d2d2d7]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] leading-snug">{video.title}</h3>
              <p className="text-xs text-[#86868b] mt-0.5">
                {video.channel_title} · {formatDate(video.published_at)} · {formatNumber(video.view_count ?? 0)} views
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a
                href={`https://youtube.com/watch?v=${video.youtube_video_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs px-3 py-1.5"
              >
                View ↗
              </a>
              <button className="btn-primary text-xs px-3 py-1.5">
                <Plus size={12} />
                Generate
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6e6e73] font-medium">Blog post</span>
              <span className="badge bg-gray-100 text-[#86868b]">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6e6e73] font-medium">Socials</span>
              <span className="text-xs text-[#86868b]">No drafts yet</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ContentList({ videos }: { videos: Video[] }) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/youtube/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSyncMsg(`Synced ${data.synced} video${data.synced !== 1 ? 's' : ''}`)
      router.refresh()
    } catch (err: unknown) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {['All', 'Published', 'Draft', 'Failed', 'Pending'].map((f) => (
            <button
              key={f}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                f === 'All'
                  ? 'bg-[#1d1d1f] text-white'
                  : 'bg-white border border-gray-200 text-[#6e6e73] hover:border-gray-300 hover:text-[#1d1d1f]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <span className="text-xs text-[#6e6e73]">{syncMsg}</span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary text-sm"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync YouTube'}
          </button>
        </div>
      </div>

      {/* Video list */}
      {videos.length === 0 ? (
        <div className="card p-16 text-center">
          <PlaySquare size={32} className="text-[#d2d2d7] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#1d1d1f] mb-1">No videos yet</p>
          <p className="text-xs text-[#86868b] mb-4">Click "Sync YouTube" to import your channel videos.</p>
          <button onClick={handleSync} disabled={syncing} className="btn-primary mx-auto">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync YouTube'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </>
  )
}
