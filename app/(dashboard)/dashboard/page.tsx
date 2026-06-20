// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Dashboard landing page — ported to the V2 design (task #143 Phase 2.1).
//
// Visual structure mirrors /app/preview/dashboard but wired to real data:
//   1. Hero banner with violet/pink radial gradients, today's date, the
//      reviewer's name, and a one-line meta (sites · tier · posts/period).
//   2. Quick-action chips for the most common workflows.
//   3. Real stat tiles: videos tracked, posts published, platforms
//      connected, posts this period.
//   4. Functional widgets preserved: NewsBanner, WpUpdateBanner,
//      AmazonSitesReminder, ReferralBanner, SetupChecklist, ChannelStats.
//      They render with their existing styling INSIDE the new chrome —
//      they're banners/widgets, not the focal hero, so a separate
//      restyling pass is acceptable.
//   5. Plan & usage block in the new card style.
//   6. Recent Videos as a 3-card grid + Activity Feed alongside.
//
// The new-user 3-step welcome card keeps its content (Brand Profile →
// Setup → Library) but uses the new CSS-variable color tokens so it
// reads correctly in both dark and light mode.

import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import SetupChecklist from '@/components/dashboard/SetupChecklist'
import ChannelStats from '@/components/dashboard/ChannelStats'
import NewsBanner from '@/components/dashboard/NewsBanner'
import WhatsNewCard from '@/components/dashboard/WhatsNewCard'
import ReferralBanner from '@/components/dashboard/ReferralBanner'
import WpUpdateBanner from '@/components/dashboard/WpUpdateBanner'
import WpUpdatePill from '@/components/dashboard/WpUpdatePill'
import AmazonSitesReminder from '@/components/dashboard/AmazonSitesReminder'
import ProTourBanner from '@/components/dashboard/ProTourBanner'
import MetaLiveBanner from '@/components/dashboard/MetaLiveBanner'
import { DashboardLiveCards } from '@/components/dashboard/DashboardLiveCards'
import {
  PlaySquare, ArrowRight, FileText, Layers, Gauge,
  Facebook, ExternalLink, Sparkles, Image as ImageIcon,
  Scale, ArrowUpRight, BadgePercent, Eye, Clock,
  Youtube, Link2, BookOpen, Send, Mail,
} from 'lucide-react'
import Link from 'next/link'
import { TIERS, billingWindow, type Tier } from '@/lib/tier'
import { FACEBOOK_GROUP_URL } from '@/lib/community'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [
    { count: videoCountRaw },
    { count: postCount },
    { data: integration },
    { data: brandRow },
  ] = await Promise.all([
    sb.from('youtube_videos').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id),
    sb.from('blog_posts').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id),
    sb.from('integrations').select('tier,subscription_period_start,subscription_period_end,wordpress_url,setup_status,youtube_oauth_access_token,facebook_page_id,pinterest_access_token,threads_access_token,twitter_access_token,linkedin_access_token,bluesky_handle,telegram_channel_id,instagram_user_id').eq('user_id', user!.id).maybeSingle(),
    sb.from('brand_profiles').select('author_name,name').eq('user_id', user!.id).maybeSingle(),
  ])

  // ── Plan & usage ────────────────────────────────────────────────────────
  const intAny = integration as Record<string, unknown> | null
  const tier = ((intAny?.tier as Tier) ?? 'trial')
  const plan = TIERS[tier] ?? TIERS.trial
  const { startISO: periodStartISO, resetLabel: resetsOn } = billingWindow({
    periodStart: (intAny?.subscription_period_start as string | null) ?? null,
    periodEnd: (intAny?.subscription_period_end as string | null) ?? null,
  })
  const onBillingCycle = !!intAny?.subscription_period_start
  const [
    { count: postsThisPeriod },
    { count: collabsThisPeriod },
    { count: thumbnailsThisPeriod },
    { count: metadataGensThisPeriod },
  ] = await Promise.all([
    sb.from('blog_posts').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).gte('published_at', periodStartISO),
    sb.from('collaborations').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).gte('created_at', periodStartISO),
    sb.from('ai_usage').select('id', { count: 'estimated', head: true })
      .eq('user_id', user!.id)
      .in('feature', ['yt_thumb_kontext_image', 'yt_thumb_flux_image'])
      .gte('created_at', periodStartISO),
    sb.from('ai_usage').select('id', { count: 'estimated', head: true })
      .eq('user_id', user!.id)
      .eq('feature', 'yt_meta_title_strategist')
      .gte('created_at', periodStartISO),
  ])
  const postsUsed = plan.lifetimeMax !== null ? (postCount ?? 0) : (postsThisPeriod ?? 0)
  const postsLimit = plan.lifetimeMax !== null ? plan.lifetimeMax : plan.postsPerMonth
  const usage = [
    {
      label: plan.lifetimeMax !== null ? 'Posts (lifetime)' : 'Posts this period',
      used: postsUsed,
      limit: postsLimit,
    },
    ...(plan.collabsPerMonth !== 0
      ? [{ label: 'Collab emails this period', used: collabsThisPeriod ?? 0, limit: plan.collabsPerMonth }]
      : []),
    ...(plan.thumbnailsPerMonth !== 0
      ? [{ label: 'YT thumbnails this period', used: thumbnailsThisPeriod ?? 0, limit: plan.thumbnailsPerMonth }]
      : []),
    ...(plan.metadataGensPerMonth !== 0
      ? [{ label: 'YT metadata generations', used: metadataGensThisPeriod ?? 0, limit: plan.metadataGensPerMonth }]
      : []),
  ]

  const videoCount = videoCountRaw ?? 0
  const publishedCount = postCount ?? 0
  const isNewUser = publishedCount === 0

  // ── Opportunities & to-dos (cheap Supabase counts only) ──────────────────
  // The dashboard should answer "what should I do next to earn more", not just
  // "what have I done". These three are fast count() queries; the slower
  // signals (SEO ranking, link clicks) load lazily client-side below.
  const [
    { count: postedVideoCount },
    { count: missingImagesCount },
    { count: scheduledCount },
  ] = await Promise.all([
    // Videos that already became a post (video-backed blog_posts).
    sb.from('blog_posts').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).not('video_id', 'is', null),
    // Published posts with no in-article images yet — a quick quality win.
    sb.from('blog_posts').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).eq('status', 'published').or('body_images_count.is.null,body_images_count.eq.0'),
    // Posts queued to auto-publish (pending = in the active queue, future =
    // dated for later). Both are "upcoming" from the user's point of view.
    sb.from('scheduled_posts').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).in('status', ['pending', 'future']),
  ])
  // Untapped catalog: synced videos not yet turned into a post. The single
  // biggest lever — a backlog of free content sitting idle.
  const catalogGap = Math.max(0, videoCount - (postedVideoCount ?? 0))
  const missingImages = missingImagesCount ?? 0
  const scheduledPending = scheduledCount ?? 0

  const int = integration as Record<string, unknown> | null
  const wpConnected = int?.setup_status === 'site_ready'
  const platformFlags = [
    wpConnected,
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

  // Newly-live channels — Meta (Facebook/Instagram/Threads, 2026-06-15) and
  // Pinterest (2026-06-16), both App Review approved. Nudge paid users to connect
  // the ones their tier unlocks that they haven't connected yet. Per-platform
  // filter (not all-or-nothing) so connecting one doesn't hide the rest.
  // Creator = FB + Threads; Studio+ adds Instagram + Pinterest.
  const newlyLiveChannels: Array<{ name: string; connected: boolean; tiers: string[] }> = [
    { name: 'Facebook',  connected: !!int?.facebook_page_id,       tiers: ['creator', 'studio', 'pro', 'admin'] },
    { name: 'Threads',   connected: !!int?.threads_access_token,   tiers: ['creator', 'studio', 'pro', 'admin'] },
    { name: 'Instagram', connected: !!int?.instagram_user_id,      tiers: ['studio', 'pro', 'admin'] },
    { name: 'Pinterest', connected: !!int?.pinterest_access_token, tiers: ['studio', 'pro', 'admin'] },
  ]
  const metaNudgePlatforms = newlyLiveChannels
    .filter(c => c.tiers.includes(tier) && !c.connected)
    .map(c => c.name)
  const showMetaNudge = metaNudgePlatforms.length > 0

  const { data: recentVideos } = await sb
    .from('youtube_videos')
    .select('id, title, published_at, thumbnail_url, youtube_video_id, is_vertical')
    .eq('user_id', user!.id)
    .order('published_at', { ascending: false })
    .limit(6)

  // ── Hero values ────────────────────────────────────────────────────────
  // Pulled from brand_profiles.author_name → brand_profiles.name → user
  // email local-part. Falls through gracefully so even fresh accounts get
  // a personalised hero instead of a generic "Welcome back".
  const reviewerName: string =
    (brandRow?.author_name as string | null)?.trim() ||
    (brandRow?.name as string | null)?.trim() ||
    (user?.email?.split('@')[0] ?? 'creator')
  const firstName = reviewerName.split(/[\s.@]/)[0]
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Meta line: pluralise "site" properly, capitalise the tier label, hide
  // posts row entirely when zero (fresh account → "Connect your channel
  // to get started" elsewhere).
  const planLabel = plan.label
  const wpHostname = int?.wordpress_url
    ? String(int.wordpress_url).replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : null
  const heroMetaParts = [
    wpHostname ? wpHostname : null,
    `${planLabel} plan`,
    postsThisPeriod ? `${postsThisPeriod} post${postsThisPeriod === 1 ? '' : 's'} this period` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6">
      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 'var(--hero-opacity)',
            background: `
              radial-gradient(60% 80% at 15% 20%, rgba(124, 58, 237, 0.45), transparent 60%),
              radial-gradient(50% 70% at 85% 10%, rgba(192, 38, 211, 0.35), transparent 65%),
              radial-gradient(80% 60% at 50% 90%, rgba(99, 102, 241, 0.20), transparent 70%)
            `,
          }}
        />
        <div className="relative px-6 sm:px-8 pt-10 pb-10">
          <p
            className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-3"
            style={{ color: 'var(--text-subtle)' }}
          >
            {todayLabel}
          </p>
          <h1
            className="text-[36px] sm:text-[40px] leading-[1.05] font-semibold tracking-tight"
            style={{ color: 'var(--text)' }}
          >
            Welcome back, {firstName}.
          </h1>
          {heroMetaParts.length > 0 && (
            <p className="text-[14px] mt-3" style={{ color: 'var(--text-soft)' }}>
              {heroMetaParts.join(' · ')}
            </p>
          )}
          {/* Site-version status, left-aligned just under the meta line:
              "Update now" button when an update is ready, else "Up to date". */}
          <div className="mt-4"><WpUpdatePill /></div>
        </div>
      </section>

      <div className="px-6 sm:px-8 py-8 flex flex-col gap-8">
        {/* Primary actions. Big, clearly-labelled buttons — one per core
            workflow — so a user (especially a first-timer fresh off the
            YouTube + social setup) knows exactly where to go for each task.
            Sit just under the hero so the page is "action-first". */}
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-faint)' }}>What do you want to do?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <BigAction href="/co-pilot" icon={<Youtube size={17} />} title="YouTube metadata" desc="Description, tags & affiliate link" accent="#F43F5E" />
            <BigAction href="/content" icon={<PlaySquare size={17} />} title="Blog from a video" desc="Turn a YouTube video into a post" accent="#8B5CF6" />
            <BigAction href="/content?new=link" icon={<Link2 size={17} />} title="Blog from a link" desc="Paste any product or article URL" accent="#0EA5E9" />
            <BigAction href="/comparison" icon={<Scale size={17} />} title="Comparison post" desc="Rank multiple products head-to-head" accent="#F59E0B" />
            <BigAction href="/buying-guides" icon={<BookOpen size={17} />} title="Buying guide" desc="A multi-product guide post" accent="#10B981" />
            <BigAction href="/content?tab=posts" icon={<Send size={17} />} title="Push to socials" desc="Send blog posts to your social accounts" accent="#3B82F6" />
            <BigAction href="/deals" icon={<BadgePercent size={17} />} title="Deals Hub post" desc="Blog from Amazon's daily deals" accent="#EC4899" />
            <BigAction href="/newsletter" icon={<Mail size={17} />} title="Newsletter" desc="Manage & send to subscribers" accent="#14B8A6" />
          </div>
        </section>

        {/* ── Opportunities & to-dos ────────────────────────────────────
            Action-first: what to do next to earn more. Cheap to-do cards
            (rendered only when there's something to act on) + the two
            live cards (SEO ranking + link clicks) that lazy-load. Hidden
            for brand-new users — the welcome card is their focus. */}
        {!isNewUser && (
          <section className="flex flex-col gap-3">
            {(catalogGap > 0 || missingImages > 0 || scheduledPending > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {catalogGap > 0 && (
                  <TodoCard
                    href="/content"
                    icon={<PlaySquare size={14} />}
                    accent="#7C3AED"
                    value={catalogGap.toLocaleString()}
                    title="videos not yet posted"
                    desc="Turn your back catalog into ranking blog posts — one click each."
                  />
                )}
                {missingImages > 0 && (
                  <TodoCard
                    href="/content"
                    icon={<ImageIcon size={14} />}
                    accent="#FF9500"
                    value={missingImages.toLocaleString()}
                    title="posts have no images"
                    desc="Add in-article photos — better engagement and on-page SEO."
                  />
                )}
                {scheduledPending > 0 && (
                  <TodoCard
                    href="/content"
                    icon={<Clock size={14} />}
                    accent="#10B981"
                    value={scheduledPending.toLocaleString()}
                    title="posts scheduled"
                    desc="Queued to auto-publish — the cron fires every minute."
                  />
                )}
              </div>
            )}
            <DashboardLiveCards />
          </section>
        )}

        {/* Pro capabilities tour — TOP placement, full-bleed gradient.
            Extracted to a client component so it can be dismissed
            ("don't show again") via localStorage. Component decides
            whether to render at all; we just slot it here. */}
        <ProTourBanner />

        {/* Meta (FB/IG/Threads) just went live — nudge paid users who haven't
            connected a Meta account yet. Dismissible (localStorage). */}
        {showMetaNudge && <MetaLiveBanner platforms={metaNudgePlatforms} />}

        {/* ── Banners + welcome (preserved functional widgets) ──────── */}
        <NewsBanner />
        <WpUpdateBanner />
        {int?.wordpress_url ? <AmazonSitesReminder siteUrl={int.wordpress_url as string} /> : null}
        <ReferralBanner />

        {/* "What's new" changelog for existing users — new users get the
            welcome flow instead, so we don't clutter their first run. */}
        {!isNewUser && <WhatsNewCard />}

        {/* New-user welcome card. Restyled to use the V2 surface tokens
            so it sits cohesively inside the new dark/light shell. */}
        {isNewUser && (
          <section
            className="rounded-2xl border p-6"
            style={{
              backgroundColor: 'rgba(124, 58, 237, 0.08)',
              borderColor: 'rgba(124, 58, 237, 0.25)',
            }}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#7C3AED] flex items-center justify-center flex-shrink-0">
                <Sparkles size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
                  Welcome, let&apos;s ship your first review
                </h2>
                <p className="text-[13px] mb-5" style={{ color: 'var(--text-soft)' }}>
                  Three quick steps and you&apos;re live on YouTube + your site. About 5 minutes end to end.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <WelcomeStep number={1} href="/brand" title="Build your Brand Profile" desc="Tone, niche, writing sample. Every review writes in your voice." />
                  <WelcomeStep number={2} href="/setup" title="Connect YouTube + your site" desc="One-time OAuth. We auto-install your theme + plugin." />
                  <WelcomeStep number={3} href="/content" title="Generate from a YouTube draft" desc="Pick an ASIN draft. We ship the rest." />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Community link — Facebook group invite, restyled */}
        <a
          href={FACEBOOK_GROUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl border p-4 flex items-center gap-3 transition-colors hover:scale-[1.005]"
          style={{
            backgroundColor: 'rgba(24, 119, 242, 0.06)',
            borderColor: 'rgba(24, 119, 242, 0.25)',
          }}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(24, 119, 242, 0.18)' }}>
            <Facebook size={18} className="text-[#1877F2]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Join the MVP Affiliate community</p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>Get support, share what&apos;s working, and catch member-only offers in our Facebook group.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white flex-shrink-0" style={{ background: '#1877F2' }}>
            Join <ExternalLink size={11} />
          </span>
        </a>

        <SetupChecklist />
        <ChannelStats />

        {/* ── Stat tiles ────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={<PlaySquare size={14} />} label="Videos tracked" value={String(videoCount)} />
          <StatTile icon={<FileText size={14} />} label="Posts published" value={String(publishedCount)} />
          <StatTile
            icon={<Layers size={14} />}
            label="Platforms connected"
            value={`${platformsConnected}/${platformsTotal}`}
          />
          <StatTile
            icon={<Gauge size={14} />}
            label={plan.lifetimeMax !== null ? 'Posts (lifetime)' : 'Posts this period'}
            value={String(postsUsed)}
            sublabel={postsLimit === null ? '∞ unlimited' : `of ${postsLimit}`}
          />
        </section>

        {/* ── Plan & usage ──────────────────────────────────────────── */}
        <section
          className="rounded-2xl border p-5"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Gauge size={15} className="text-[#7C3AED]" />
              <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Plan &amp; usage</h2>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(124, 58, 237, 0.18)', color: 'var(--nav-active-text)' }}
              >
                {plan.label}
              </span>
            </div>
            <Link href="/billing" className="text-[12px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] inline-flex items-center gap-1">
              {tier === 'pro' || tier === 'admin' ? 'Manage plan' : 'Upgrade'} <ArrowUpRight size={11} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {usage.map(({ label, used, limit }) => {
              const unlimited = limit === null
              const remaining = unlimited ? null : Math.max(0, (limit as number) - used)
              const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit as number)) * 100))
              const out = !unlimited && remaining === 0
              const near = !unlimited && !out && pct >= 60
              const accent = out ? '#FF3B30' : near ? '#FF9500' : '#7C3AED'
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-[12px] mb-2">
                    <span className="font-medium" style={{ color: 'var(--text-soft)' }}>{label}</span>
                    {/* Lead with what's LEFT — clearer than "used / cap" for deciding
                        whether to upgrade. Amber as the cap nears, red when spent. */}
                    <span className="tabular-nums font-semibold" style={{ color: (out || near) ? accent : 'var(--text)' }}>
                      {unlimited ? `${used} / ∞` : `${remaining} left`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-bright)' }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: unlimited ? '100%' : `${pct}%`,
                        backgroundColor: unlimited ? '#10B981' : accent,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {usage.some(u => u.limit !== null) && (
            <p className="text-[11px] mt-4" style={{ color: 'var(--text-faint)' }}>
              {plan.lifetimeMax !== null
                ? 'Free plan posts are a one-time lifetime allowance.'
                : onBillingCycle
                  ? `Your billing period resets ${resetsOn}.`
                  : `Limits reset ${resetsOn}.`}
            </p>
          )}
        </section>

        {/* ── Recent videos as a 3-card grid + activity column ──────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
              Recent videos
            </h2>
            <Link href="/content" className="text-[12px] inline-flex items-center gap-1" style={{ color: 'var(--text-soft)' }}>
              View all <ArrowUpRight size={11} />
            </Link>
          </div>

          {!recentVideos || recentVideos.length === 0 ? (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              <PlaySquare size={28} className="mx-auto mb-3 opacity-40" style={{ color: 'var(--text-soft)' }} />
              <p className="text-[14px] font-medium" style={{ color: 'var(--text)' }}>No videos synced yet</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-soft)' }}>Connect YouTube and we&apos;ll pull every draft with an Amazon ASIN in the title.</p>
              <Link href="/content" className="text-[12px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] mt-3 inline-flex items-center gap-1">
                Sync your YouTube channel <ArrowRight size={12} />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(recentVideos as any[]).slice(0, 6).map((video: any) => (
                <VideoCard
                  key={video.id}
                  title={video.title}
                  thumbnail={video.thumbnail_url}
                  publishedAt={video.published_at}
                  isVertical={video.is_vertical === true}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Sub-components (preview-shape, real-data wired) ──────────────────────

function BigAction({ href, icon, title, desc, accent }: { href: string; icon: React.ReactNode; title: string; desc: string; accent: string }) {
  // accent drives a per-button colour. On hover the icon chip fills with the
  // solid accent (white glyph) and the border lights up to match — clear,
  // colourful contrast against the dark surface. `--accent`/`--accent-soft`
  // are set inline so the static Tailwind hover classes can reference them.
  return (
    <Link
      href={href}
      style={{ '--accent': accent, '--accent-soft': `${accent}1f`, backgroundColor: 'var(--surface)', boxShadow: 'var(--card-shadow)' } as React.CSSProperties}
      className="group rounded-xl border border-[color:var(--border)] p-4 flex items-start gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-[color:var(--accent)]"
    >
      <span className="grid place-items-center w-9 h-9 rounded-lg flex-shrink-0 bg-[color:var(--accent-soft)] text-[color:var(--accent)] transition-colors duration-200 group-hover:bg-[color:var(--accent)] group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[13px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>
          {title}
          <ArrowUpRight size={13} className="opacity-0 group-hover:opacity-100 text-[color:var(--accent)] transition-opacity flex-shrink-0" />
        </span>
        <span className="block text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-faint)' }}>{desc}</span>
      </span>
    </Link>
  )
}

function TodoCard({ href, icon, accent, value, title, desc }: { href: string; icon: React.ReactNode; accent: string; value: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 flex flex-col"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center gap-2 mb-3" style={{ color: accent }}>
        <span className="grid place-items-center w-7 h-7 rounded-lg" style={{ backgroundColor: `${accent}1a` }}>{icon}</span>
        <ArrowUpRight size={13} className="ml-auto opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-faint)' }} />
      </div>
      <p className="leading-none" style={{ color: 'var(--text)' }}>
        <span className="text-[26px] font-semibold tabular-nums">{value}</span>{' '}
        <span className="text-[13px] font-medium" style={{ color: 'var(--text-soft)' }}>{title}</span>
      </p>
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>{desc}</p>
    </Link>
  )
}

function StatTile({ icon, label, value, sublabel }: { icon: React.ReactNode; label: string; value: string; sublabel?: string }) {
  return (
    <div
      className="rounded-2xl px-5 py-5 border"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--text-soft)' }}>
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p
        className="text-[32px] font-semibold tracking-tight tabular-nums leading-none"
        style={{ color: 'var(--text)' }}
      >
        {value}
      </p>
      {sublabel && (
        <p className="text-[11px] mt-3 font-medium" style={{ color: 'var(--text-faint)' }}>
          {sublabel}
        </p>
      )}
    </div>
  )
}

function WelcomeStep({ number, href, title, desc }: { number: number; href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 p-3.5 rounded-xl border transition-colors"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="w-6 h-6 rounded-full bg-[#7C3AED] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
        {number}
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>{title}</p>
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{desc}</p>
      </div>
      <ArrowRight size={13} className="ml-auto group-hover:text-[#7C3AED] transition-colors flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
    </Link>
  )
}

function VideoCard({ title, thumbnail, publishedAt, isVertical }: { title: string; thumbnail: string | null; publishedAt: string; isVertical: boolean }) {
  const date = new Date(publishedAt)
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  const ago = days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`
  return (
    <Link
      href="/content"
      className="group block rounded-2xl overflow-hidden border transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="aspect-video relative overflow-hidden" style={{ backgroundColor: 'var(--surface-bright)' }}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <PlaySquare size={28} className="opacity-40" style={{ color: 'var(--text-soft)' }} />
          </div>
        )}
        {isVertical && (
          <div
            className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider text-white"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          >
            Shorts
          </div>
        )}
      </div>
      <div className="p-4">
        <p className="text-[13px] font-semibold leading-snug line-clamp-2 mb-2" style={{ color: 'var(--text)' }}>{title}</p>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          <Clock size={11} />
          <span>{ago}</span>
          <Eye size={11} className="ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
        </div>
      </div>
    </Link>
  )
}
