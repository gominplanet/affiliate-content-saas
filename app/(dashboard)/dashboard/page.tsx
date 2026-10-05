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
//      AmazonSitesReminder, ReferralBanner, ChannelStats.
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
import { DEALS_HUB_PAUSED } from '@/lib/deal-occasion'
import FirstWinChecklist from '@/components/dashboard/FirstWinChecklist'
import TodayList from '@/components/dashboard/TodayList'
import ChannelStats from '@/components/dashboard/ChannelStats'
import NewsBanner from '@/components/dashboard/NewsBanner'
import ReconnectBanner from '@/components/dashboard/ReconnectBanner'
import LinkStyleNudge from '@/components/dashboard/LinkStyleNudge'
import YouTubeVerifiedNudge from '@/components/dashboard/YouTubeVerifiedNudge'
import WhatsNewCard from '@/components/dashboard/WhatsNewCard'
import ReferralBanner from '@/components/dashboard/ReferralBanner'
import WpUpdateBanner from '@/components/dashboard/WpUpdateBanner'
import WpUpdatePill from '@/components/dashboard/WpUpdatePill'
import ScoutUpdatePill from '@/components/dashboard/ScoutUpdatePill'
import ConsumptionGauge from '@/components/dashboard/ConsumptionGauge'
import AmazonSitesReminder from '@/components/dashboard/AmazonSitesReminder'
import ProTourBanner from '@/components/dashboard/ProTourBanner'
import RecommendedToolsCard from '@/components/dashboard/RecommendedToolsCard'
import MetaLiveBanner from '@/components/dashboard/MetaLiveBanner'
import DealRadarLaunchBanner from '@/components/dashboard/DealRadarLaunchBanner'
import { DashboardLiveCards } from '@/components/dashboard/DashboardLiveCards'
import AmazonDashboard from '@/components/dashboard/AmazonDashboard'
import DashboardTierGate from '@/components/dashboard/DashboardTierGate'
import PriceAlertsPanel from '@/components/dashboard/PriceAlertsPanel'
import DailyCcDigest from '@/components/dashboard/DailyCcDigest'
import TrialResearchRow from '@/components/dashboard/TrialResearchRow'
import {
  PlaySquare, FileText, Layers, Gauge,
  Facebook,
  Scale, ArrowUpRight, BadgePercent, Eye, Clock,
  Youtube, Link2, BookOpen, Send, Mail,
} from 'lucide-react'
import Link from 'next/link'
import { TIERS, billingWindow, type Tier } from '@/lib/tier'
import { NEWSLETTER_FOR_MEMBERS } from '@/lib/feature-flags'
import { PRIMARY_FEATURE } from '@/lib/usage-cap'
import { canUseDealRadar, canSeeNav } from '@/lib/feature-access'
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
  // Second (and final) query wave. Only the period-scoped counts depend on
  // periodStartISO (derived from wave 1's integration row); the opportunity
  // counts and recentVideos need only user.id. They used to run as two more
  // serial waves after this one — merged here so they all hit the DB together
  // (this is the most-visited SSR page; each saved round-trip is first-paint time).
  const [
    { count: postsThisPeriod },
    { count: collabsThisPeriod },
    { count: thumbnailsThisPeriod },
    { count: metadataGensThisPeriod },
    { data: recentVideos },
  ] = await Promise.all([
    sb.from('blog_posts').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).gte('published_at', periodStartISO),
    sb.from('collaborations').select('id', { count: 'estimated', head: true }).eq('user_id', user!.id).gte('created_at', periodStartISO),
    // Count EVERY thumbnail-image feature the generator can log (nano-banana,
    // ideogram, gpt-image, kontext, flux, flux-lora) via the shared
    // PRIMARY_FEATURE list — the SAME set the cap enforcement in
    // lib/usage-cap.ts uses. Was hardcoded to just kontext+flux (both retired
    // paths), so the dashboard under-reported and disagreed with what Co-Pilot
    // actually enforces. Reusing the canonical list keeps them from drifting.
    sb.from('ai_usage').select('id', { count: 'estimated', head: true })
      .eq('user_id', user!.id)
      .in('feature', PRIMARY_FEATURE.thumbnail)
      .gte('created_at', periodStartISO),
    sb.from('ai_usage').select('id', { count: 'estimated', head: true })
      .eq('user_id', user!.id)
      .in('feature', PRIMARY_FEATURE.metadata)
      .gte('created_at', periodStartISO),
    // Recent catalog for the hero strip.
    sb.from('youtube_videos')
      .select('id, title, published_at, thumbnail_url, youtube_video_id, is_vertical')
      .eq('user_id', user!.id)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(6),
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
  // Pro (and admin) get the Today list; canSeeNav('labs') is the Pro test.
  const isPro = canSeeNav('labs', tier)

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

  // First-win onboarding state — read from the same real signals as above so
  // the checklist ticks itself off as the user connects and publishes.
  const brandReady = !!(
    (brandRow?.author_name as string | null)?.trim() ||
    (brandRow?.name as string | null)?.trim()
  )
  const youtubeConnected = !!(int?.youtube_oauth_access_token)
  const hasContent = publishedCount > 0
  const socialConnected = !!(
    int?.facebook_page_id ||
    int?.pinterest_access_token ||
    int?.instagram_user_id ||
    int?.threads_access_token ||
    int?.twitter_access_token ||
    int?.linkedin_access_token ||
    int?.bluesky_handle ||
    int?.telegram_channel_id
  )

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

  // recentVideos is fetched in the merged wave above.

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

  // Amazon Influencer gets a purpose-built dashboard: their toolkit on one side,
  // the upgrade pitch on the other. Real amazon users branch here server-side
  // (no flash); admins previewing via the view-as switcher get it client-side
  // through DashboardTierGate wrapping the default return below.
  if (tier === 'amazon') {
    return <AmazonDashboard firstName={firstName} today={todayLabel} />
  }

  return (
    <DashboardTierGate isAdmin={tier === 'admin'} amazon={<AmazonDashboard firstName={firstName} today={todayLabel} />}>
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
        <div className="relative px-6 sm:px-8 pt-10 pb-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Left column: date, greeting, meta, status pills. */}
          <div className="min-w-0">
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
          {/* Status pills, each a distinct bright colour: WordPress theme/plugin
              (green), SCOUT extension (orange), Tutorials (purple). */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <WpUpdatePill />
            <ScoutUpdatePill />
            <Link
              href="/tutorials"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #DB2777)', color: '#fff' }}
            >
              <BookOpen size={12} />
              Tutorials
            </Link>
            {!isNewUser && <WhatsNewCard />}
          </div>
          </div>
          {/* Right column: Pro capabilities tour — shown only to users who
              aren't Pro yet (upsell). Dismissible via localStorage. */}
          {(tier === 'trial' || tier === 'creator' || tier === 'admin') && (
            <div className="w-full lg:w-[380px] lg:flex-shrink-0">
              <ProTourBanner compact />
            </div>
          )}
        </div>
      </section>

      <div className="px-6 sm:px-8 py-8 flex flex-col gap-8">
        {/* First-win onboarding — reads real state and points at the single next
            step to a first published post. Self-hides once done or dismissed. */}
        <FirstWinChecklist
          brandReady={brandReady}
          wpConnected={wpConnected}
          youtubeConnected={youtubeConnected}
          hasContent={hasContent}
          socialConnected={socialConnected}
        />

        {/* Today (Pro): one ranked list of what needs the creator, in place of
            the stack of panels. The panels it points at move below the actions. */}
        {isPro && <TodayList />}

        {/* Amazon Deal Radar launch — pinned to the very top of the body, above
            "What do you want to do?", so paid users see it first. Dismissible. */}
        {canUseDealRadar(tier) && <DealRadarLaunchBanner />}

        {!isPro && (<>
        {/* Price Alerts — Keepa-detected new lows / stale-price nudges on watched
            products. Self-hides when there's nothing to show. */}
        <div id="price-alerts" className="scroll-mt-20"><PriceAlertsPanel /></div>

        {/* Daily CC Campaign Digest — ~25 Creator Connections campaigns picked
            for this creator from their blog + YouTube history, refreshed every
            24h. Self-hides for users without CC access or with no matches. */}
        <div id="cc-digest" className="scroll-mt-20"><DailyCcDigest /></div>
        </>)}

        {/* Free-research first — for Free Trial users the research finders ARE the
            reason they're here, so surface them above "What do you want to do?".
            Client component so it honors the admin "View as" preview; renders only
            for the trial tier, paid dashboards are untouched. */}
        <TrialResearchRow />

        {/* Primary actions. Big, clearly-labelled buttons — one per core
            workflow — so a user (especially a first-timer fresh off the
            YouTube + social setup) knows exactly where to go for each task.
            Sit just under the hero so the page is "action-first". */}
        <section className="rounded-2xl p-5 sm:p-6" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.18)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-3" style={{ color: 'var(--text-faint)' }}>What do you want to do?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Community first — most valuable "next thing to do" for a creator:
                support, what's-working tips, and member-only offers. Opens the
                Facebook group in a new tab (external). */}
            <BigAction href={FACEBOOK_GROUP_URL} external icon={<Facebook size={17} />} title="Join the community" desc="Support, tips & member-only offers (FB group)" accent="#1877F2" />
            <BigAction href="/co-pilot" icon={<Youtube size={17} />} title="YouTube metadata" desc="Description, tags & affiliate link" accent="#F43F5E" />
            <BigAction href="/content" icon={<PlaySquare size={17} />} title="Blog from a video" desc="Turn a YouTube video into a post" accent="#8B5CF6" />
            <BigAction href="/content?new=link" icon={<Link2 size={17} />} title="Blog from a link" desc="Paste any product or article URL" accent="#0EA5E9" />
            <BigAction href="/comparison" icon={<Scale size={17} />} title="Comparison post" desc="Rank multiple products head-to-head" accent="#F59E0B" />
            <BigAction href="/buying-guides" icon={<BookOpen size={17} />} title="Buying guide" desc="A multi-product guide post" accent="#10B981" />
            <BigAction href="/content?tab=posts" icon={<Send size={17} />} title="Push to socials" desc="Send blog posts to your social accounts" accent="#3B82F6" />
            {/* Deals Hub is hidden here while paused between Amazon sale events
                (DEALS_HUB_PAUSED). Comes back automatically when a sale starts. */}
            {!DEALS_HUB_PAUSED && (
              <BigAction href="/deals" icon={<BadgePercent size={17} />} title="Deals Hub post" desc="Blog from Amazon's daily deals" accent="#EC4899" />
            )}
            {/* Retired for members (lib/feature-flags NEWSLETTER_FOR_MEMBERS); admin keeps it. */}
            {(NEWSLETTER_FOR_MEMBERS || tier === 'admin') && (
              <BigAction href="/newsletter" icon={<Mail size={17} />} title="Newsletter" desc="Manage & send to subscribers" accent="#14B8A6" />
            )}
          </div>
        </section>

        {isPro && (<>
        {/* Price Alerts — Keepa-detected new lows / stale-price nudges on watched
            products. Self-hides when there's nothing to show. */}
        <div id="price-alerts" className="scroll-mt-20"><PriceAlertsPanel /></div>

        {/* Daily CC Campaign Digest — ~25 Creator Connections campaigns picked
            for this creator from their blog + YouTube history, refreshed every
            24h. Self-hides for users without CC access or with no matches. */}
        <div id="cc-digest" className="scroll-mt-20"><DailyCcDigest /></div>
        </>)}

        {/* ── Opportunities & to-dos ────────────────────────────────────
            Action-first: what to do next to earn more. Cheap to-do cards
            (rendered only when there's something to act on) + the two
            live cards (SEO ranking + link clicks) that lazy-load. Hidden
            for brand-new users: the first-post checklist is their focus. */}
        {!isNewUser && (
          <>
            {/* Recommended tools — green panel. Revenue-converting partner links,
                mirrored from the sidebar Recommended Tools group. Placed ABOVE
                "Your opportunities" per user request. */}
            <div className="rounded-2xl p-5 sm:p-6" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.18)' }}>
              <RecommendedToolsCard />
            </div>
            {/* Monthly-consumption gauge — placed right under Recommended Tools
                per user request. Standalone card; the detailed per-bucket bars
                still live in the "Plan & usage" section below. */}
            <ConsumptionGauge />
          </>
        )}

        {/* Pro capabilities tour now lives top-right of the greeting (compact,
            non-Pro users only) — see the hero section above. */}

        {/* Meta (FB/IG/Threads) just went live — nudge paid users who haven't
            connected a Meta account yet. Dismissible (localStorage). */}
        {showMetaNudge && <MetaLiveBanner platforms={metaNudgePlatforms} />}

        {/* ── Banners + welcome (preserved functional widgets) ──────── */}
        {/* Loud "reconnect needed" alert — a silently-dead Facebook/YouTube token
            surfaces here (proactive probe) so a creator fixes it in one click
            instead of churning over posts that quietly stopped going out. */}
        <ReconnectBanner />
        {/* The one setting MVP cannot guess: which cloaker every affiliate link
            it writes should use. Shows only until the creator has actually
            picked one, because until then their links are a default nobody
            chose. */}
        <LinkStyleNudge />
        {/* One-time, positive nudge for users who connected YouTube before we
            were Google-verified — reconnect once for the verified, durable link.
            Only shown when YouTube is actually connected. */}
        <YouTubeVerifiedNudge show={youtubeConnected} />
        <NewsBanner />
        <WpUpdateBanner />
        {int?.wordpress_url ? <AmazonSitesReminder siteUrl={int.wordpress_url as string} /> : null}
        <ReferralBanner />

        {/* "What's new" — its trigger pill now lives in the hero pills row
            (next to Tutorials); the modal is portaled to <body>. */}

        <ChannelStats />

      </div>
    </div>
    </DashboardTierGate>
  )
}

// ─── Sub-components (preview-shape, real-data wired) ──────────────────────

function BigAction({ href, icon, title, desc, accent, external }: { href: string; icon: React.ReactNode; title: string; desc: string; accent: string; external?: boolean }) {
  // accent drives a per-button colour. On hover the icon chip fills with the
  // solid accent (white glyph) and the border lights up to match — clear,
  // colourful contrast against the dark surface. `--accent`/`--accent-soft`
  // are set inline so the static Tailwind hover classes can reference them.
  // `external` swaps the Next <Link> for a plain anchor that opens in a new
  // tab (used for the Facebook community link).
  const className = "group rounded-xl border border-[color:var(--border)] p-4 flex items-start gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-[color:var(--accent)]"
  const style = { '--accent': accent, '--accent-soft': `${accent}1f`, backgroundColor: 'var(--surface)', boxShadow: 'var(--card-shadow)' } as React.CSSProperties
  const inner = (
    <>
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
    </>
  )
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={style} className={className}>
        {inner}
      </a>
    )
  }
  return (
    <Link href={href} style={style} className={className}>
      {inner}
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
