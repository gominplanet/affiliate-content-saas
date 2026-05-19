import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import SetupChecklist from '@/components/dashboard/SetupChecklist'
import ChannelStats from '@/components/dashboard/ChannelStats'
import WhatsNew from '@/components/dashboard/WhatsNew'
import ReferralBanner from '@/components/dashboard/ReferralBanner'
import WpUpdateBanner from '@/components/dashboard/WpUpdateBanner'
import { PlaySquare, ArrowRight, Clock, Sparkles, FileText, Layers, Gauge } from 'lucide-react'
import Link from 'next/link'
import { TIERS, billingWindow, type Tier } from '@/lib/tier'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [
    { data: videos },
    { count: postCount },
    { data: integration },
  ] = await Promise.all([
    supabase.from('youtube_videos').select('id').eq('user_id', user!.id),
    supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user!.id),
    sb.from('integrations').select('tier,subscription_period_start,subscription_period_end,wordpress_url,youtube_oauth_access_token,facebook_page_id,pinterest_access_token,threads_access_token,twitter_access_token,linkedin_access_token,bluesky_handle,telegram_channel_id,instagram_user_id').eq('user_id', user!.id).single(),
  ])

  // ── Plan & usage ────────────────────────────────────────────────────────
  // Window honors the user's Stripe billing cycle when known; falls back
  // to calendar month for free / pre-Stripe / legacy rows.
  const intAny = integration as Record<string, unknown> | null
  const tier = ((intAny?.tier as Tier) ?? 'free')
  const plan = TIERS[tier] ?? TIERS.free
  const { startISO: periodStartISO, resetLabel: resetsOn } = billingWindow({
    periodStart: (intAny?.subscription_period_start as string | null) ?? null,
    periodEnd: (intAny?.subscription_period_end as string | null) ?? null,
  })
  const onBillingCycle = !!intAny?.subscription_period_start
  const [{ count: postsThisPeriod }, { count: collabsThisPeriod }] = await Promise.all([
    sb.from('blog_posts').select('id', { count: 'exact', head: true }).eq('user_id', user!.id).gte('published_at', periodStartISO),
    sb.from('collaborations').select('id', { count: 'exact', head: true }).eq('user_id', user!.id).gte('created_at', periodStartISO),
  ])
  // Posts: free tier is lifetime-capped; paid tiers count per billing period.
  const postsUsed = plan.lifetimeMax !== null ? (postCount ?? 0) : (postsThisPeriod ?? 0)
  const postsLimit = plan.lifetimeMax !== null ? plan.lifetimeMax : plan.postsPerMonth // null = unlimited
  const usage = [
    {
      label: plan.lifetimeMax !== null ? 'Posts (lifetime)' : 'Posts this period',
      used: postsUsed,
      limit: postsLimit,
    },
    // Collab is Pro+; collabsPerMonth 0 = not on plan (hide the row).
    ...(plan.collabsPerMonth !== 0
      ? [{ label: 'Collab emails this period', used: collabsThisPeriod ?? 0, limit: plan.collabsPerMonth }]
      : []),
  ]

  const videoCount = videos?.length ?? 0
  const publishedCount = postCount ?? 0
  const isNewUser = publishedCount === 0

  const int = integration as Record<string, unknown> | null
  const platformFlags = [
    !!(int?.wordpress_url),
    !!(int?.youtube_oauth_access_token),
    !!(int?.facebook_page_id),
    !!(int?.pinterest_access_token),
    !!(int?.threads_access_token),
    !!(int?.twitter_access_token),
    !!(int?.linkedin_access_token),
    !!(int?.bluesky_handle),
    !!(int?.telegram_channel_id),
    !!(int?.instagram_user_id),
  ]
  const platformsTotal = platformFlags.length
  const platformsConnected = platformFlags.filter(Boolean).length

  const stats = [
    { label: 'Videos Tracked',     value: String(videoCount),      icon: PlaySquare, color: 'text-[#0071e3]',  bg: 'bg-[#0071e3]/8' },
    { label: 'Posts Published',     value: String(publishedCount),  icon: FileText,   color: 'text-[#34c759]',  bg: 'bg-[#34c759]/8' },
    { label: 'Platforms Connected', value: `${platformsConnected}/${platformsTotal}`, icon: Layers,  color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
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
        subtitle="Your affiliate pipeline at a glance — YouTube drafts, generated reviews, and published posts."
        actions={
          <Link href="/content" className="btn-secondary">
            View all content <ArrowRight size={14} />
          </Link>
        }
      />

      {/* Welcome card — shown until user generates their first post */}
      {isNewUser && (
        <div className="card p-6 mb-6 border border-[#0071e3]/20 bg-gradient-to-br from-[#f0f7ff] to-white dark:from-[#0071e3]/5 dark:to-transparent">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#0071e3] flex items-center justify-center flex-shrink-0">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Welcome — let&apos;s ship your first review</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-5">Three quick steps and you&apos;re live on YouTube + your site. About 5 minutes end to end.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/brand" className="flex items-center gap-2.5 flex-1 p-3.5 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40 transition-colors group">
                  <div className="w-6 h-6 rounded-full bg-[#0071e3] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Build your Brand Profile</p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Tone, niche, writing sample — every review writes in your voice</p>
                  </div>
                  <ArrowRight size={13} className="text-[#86868b] ml-auto group-hover:text-[#0071e3] transition-colors flex-shrink-0" />
                </Link>
                <Link href="/setup" className="flex items-center gap-2.5 flex-1 p-3.5 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40 transition-colors group">
                  <div className="w-6 h-6 rounded-full bg-[#0071e3] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Connect YouTube + your site</p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">One-time OAuth. We auto-install your theme + plugin.</p>
                  </div>
                  <ArrowRight size={13} className="text-[#86868b] ml-auto group-hover:text-[#0071e3] transition-colors flex-shrink-0" />
                </Link>
                <Link href="/content" className="flex items-center gap-2.5 flex-1 p-3.5 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40 transition-colors group">
                  <div className="w-6 h-6 rounded-full bg-[#0071e3] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Generate from a YouTube draft</p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Pick an ASIN draft. We ship the rest.</p>
                  </div>
                  <ArrowRight size={13} className="text-[#86868b] ml-auto group-hover:text-[#0071e3] transition-colors flex-shrink-0" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <WpUpdateBanner />
      <WhatsNew />
      <ReferralBanner />
      <SetupChecklist />
      <ChannelStats />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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

      {/* Plan & usage */}
      <div className="card p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-[#0071e3]" />
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Plan &amp; usage</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3]">{plan.label}</span>
          </div>
          <Link href="/billing" className="text-xs text-[#0071e3] hover:underline font-medium">
            {tier === 'pro' || tier === 'admin' ? 'Manage plan' : 'Upgrade'}
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {usage.map(({ label, used, limit }) => {
            const unlimited = limit === null
            const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit as number)) * 100))
            const near = !unlimited && pct >= 80
            return (
              <div key={label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-[#6e6e73] dark:text-[#ebebf0] font-medium">{label}</span>
                  <span className={`tabular-nums font-semibold ${near ? 'text-[#ff9500]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
                    {used}{unlimited ? ' / ∞' : ` / ${limit}`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${unlimited ? 'bg-[#34c759]' : near ? 'bg-[#ff9500]' : 'bg-[#0071e3]'}`}
                    style={{ width: unlimited ? '100%' : `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {/* Footer copy only when something is actually capped — admin
            and any future fully-unlimited tier just see the ∞ bars. */}
        {usage.some(u => u.limit !== null) && (
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-3">
            {plan.lifetimeMax !== null
              ? 'Free plan posts are a one-time lifetime allowance.'
              : onBillingCycle
                ? `Your billing period resets ${resetsOn}.`
                : `Limits reset ${resetsOn}.`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Videos */}
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Recent Videos</h2>
            <Link href="/content" className="text-xs text-[#0071e3] hover:underline font-medium">
              See all
            </Link>
          </div>

          {!recentVideos || recentVideos.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#86868b] dark:text-[#8e8e93]">No videos synced yet.</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Connect YouTube and we&apos;ll pull every draft with an Amazon ASIN in the title.</p>
              <Link href="/content" className="text-xs text-[#0071e3] hover:underline mt-3 inline-block">
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
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Nothing yet — your generated reviews and published posts will show up here.</p>
          )}
        </div>
      </div>
    </>
  )
}
