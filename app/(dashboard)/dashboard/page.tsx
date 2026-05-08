import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import SetupChecklist from '@/components/dashboard/SetupChecklist'
import ChannelStats from '@/components/dashboard/ChannelStats'
import { PlaySquare, CheckCircle, AlertTriangle, ArrowRight, Clock } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: videos }, { data: failures }] = await Promise.all([
    supabase.from('youtube_videos').select('id').eq('user_id', user!.id),
    supabase.from('job_failures').select('id').eq('user_id', user!.id).eq('status', 'pending_retry'),
  ])

  const videoCount = videos?.length ?? 0
  const failureCount = failures?.length ?? 0

  const stats = [
    { label: 'Videos Tracked', value: String(videoCount), icon: PlaySquare, color: 'text-[#0071e3]', bg: 'bg-[#0071e3]/8' },
    { label: 'Published', value: '0', icon: CheckCircle, color: 'text-[#34c759]', bg: 'bg-[#34c759]/8' },
    { label: 'Failures', value: String(failureCount), icon: AlertTriangle, color: 'text-[#ff3b30]', bg: 'bg-[#ff3b30]/8' },
  ]

  const { data: recentVideos } = await supabase
    .from('youtube_videos')
    .select('id, title, published_at, thumbnail_url, youtube_video_id')
    .eq('user_id', user!.id)
    .order('published_at', { ascending: false })
    .limit(4)

  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Your affiliate content pipeline at a glance."
        actions={
          <Link href="/content" className="btn-secondary">
            View all content <ArrowRight size={14} />
          </Link>
        }
      />

      <SetupChecklist />
      <ChannelStats />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="stat-card">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">{value}</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] font-medium">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Recent Videos */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Recent Videos</h2>
            <Link href="/content" className="text-xs text-[#0071e3] hover:underline font-medium">
              See all
            </Link>
          </div>

          {!recentVideos || recentVideos.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#86868b] dark:text-[#8e8e93]">No videos yet.</p>
              <Link href="/content" className="text-xs text-[#0071e3] hover:underline mt-1 inline-block">
                Sync your YouTube channel →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentVideos.map((video) => (
                <Link
                  key={video.id}
                  href={`/content`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#f5f5f7] dark:bg-[#000] border border-gray-200 dark:border-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {video.thumbnail_url
                      ? <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                      : <PlaySquare size={18} className="text-[#86868b] dark:text-[#8e8e93]" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{video.title}</p>
                    <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                      {new Date(video.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <span className="badge bg-gray-100 text-[#86868b] dark:text-[#8e8e93] flex-shrink-0">Pending</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Recent Activity</h2>
          {recentVideos && recentVideos.length > 0 ? (
            <div className="flex flex-col gap-3">
              {recentVideos.slice(0, 4).map((video) => (
                <div key={video.id} className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-[#0071e3]" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug truncate">{video.title}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock size={10} className="text-[#86868b] dark:text-[#8e8e93]" />
                      <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
                        {new Date(video.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">No activity yet.</p>
          )}
        </div>
      </div>
    </>
  )
}
