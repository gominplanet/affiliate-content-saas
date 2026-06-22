import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import DashboardShellV2 from '@/components/layout/DashboardShellV2'
import { Toaster } from '@/components/ui/toaster'
import MigrationDriftBanner from '@/components/admin/MigrationDriftBanner'
import { HelpDeskProvider, HelpDeskPanel } from '@/components/HelpDeskSidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, tier, wp_post_count, wp_post_count_updated_at, onboarding_completed')
    .eq('user_id', user.id)
    .maybeSingle()

  const wpSiteUrl = intRow?.wordpress_url || null
  const tier = (intRow?.tier as string | null) || 'trial'

  // ── Onboarding funnel hard gate (epic Phase 2) ──────────────────────────────
  // A brand-new user has no connected WordPress site — nothing in the app works
  // without it, so route them into the guided /onboarding funnel instead of a
  // dashboard full of dead options. The gate is WordPress-only: once a site is
  // connected the user can reach the dashboard freely even mid-funnel ("Skip
  // for now" on the optional steps). onboarding_completed lets an existing user
  // who has since disconnected WP avoid being re-funneled. /onboarding lives
  // OUTSIDE this layout, so there's no redirect loop.
  // `as any`: onboarding_completed ships in migration 125, not yet in the
  // generated DB types (treat a missing column as not-completed → safe).
  const onboardingCompleted = (intRow as { onboarding_completed?: boolean } | null)?.onboarding_completed === true
  if (!wpSiteUrl && !onboardingCompleted) {
    redirect('/onboarding')
  }

  // Buying Guides feature gate (500-post threshold). The round-up
  // format only earns its keep on a wide catalogue.
  //
  // Audit perf fix 2026-06-07: read the count from the cached
  // integrations.wp_post_count column (refreshed nightly by
  // /api/cron/refresh-wp-post-counts). The previous implementation
  // hit WordPress on every non-admin dashboard navigation — 300ms-
  // 2.5s per route change with the layout blocked behind it. Big
  // win.
  //
  // Fallback: if no cached value yet (brand new user, migration 106
  // not applied, cache >24h stale), do a single live fetch — same
  // path as before. Fail-open as "not unlocked" on timeout.
  let showBuyingGuides = tier === 'admin'
  if (!showBuyingGuides) {
    const cachedCount = intRow?.wp_post_count as number | null | undefined
    const cachedAt = intRow?.wp_post_count_updated_at as string | null | undefined
    const cacheAgeHours = cachedAt
      ? (Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60)
      : Infinity
    if (typeof cachedCount === 'number' && cacheAgeHours < 24) {
      // Fresh cache — instant decision, no WP fetch.
      showBuyingGuides = cachedCount >= 500
    } else if (wpSiteUrl) {
      // Stale or missing — one-time live fetch as fallback. Same as
      // the legacy path so users with new accounts / first dashboard
      // load still get the gate. The cron will populate the cache for
      // next time.
      try {
        const wpBase = wpSiteUrl.replace(/\/+$/, '')
        const res = await fetch(`${wpBase}/wp-json/wp/v2/posts?per_page=1&_fields=id`, {
          signal: AbortSignal.timeout(2500),
          headers: { Accept: 'application/json' },
          next: { revalidate: 300 },
        })
        if (res.ok) {
          const total = parseInt(res.headers.get('x-wp-total') || '0', 10)
          showBuyingGuides = total >= 500
        }
      } catch { /* timeout / network error — leave gated */ }
    }
  }

  // Deals Hub gate: Studio + Pro + Admin only. Unlike Buying Guides, there's
  // no post-volume threshold — a brand-new Studio user should be able to ship
  // a deal post on day one. The sidebar entry hides outright for Trial/
  // Creator so we don't tease a feature they can't reach. Admin always sees
  // it (so the View-as-Studio/Pro preview also exposes it for screenshots).
  const showDeals = tier === 'studio' || tier === 'pro' || tier === 'admin'

  // Instagram Burner gate — Pro-only (the publish route requires Pro), and only
  // now that Meta publishing is approved (metaEnabled is globally on as of
  // 2026-06-15). Admin sees it too for testing / view-as previews. Re-surfaced
  // 2026-06-22 after a live burn→publish test confirmed the pipeline works.
  const showBurner = tier === 'pro' || tier === 'admin'

  return (
    <HelpDeskProvider>
      <DashboardShellV2
        email={user.email}
        wpSiteUrl={wpSiteUrl}
        tier={tier}
        showBuyingGuides={showBuyingGuides}
        showDeals={showDeals}
        showBurner={showBurner}
      >
        {/* Migration drift banner — admin-only sticky warning that
            recent feature-gating migrations haven't been applied on the
            target DB. Renders nothing for non-admins. See
            components/admin/MigrationDriftBanner.tsx for which migs are
            checked. */}
        <MigrationDriftBanner />
        {children}
      </DashboardShellV2>
      {/* Single Toaster mount for every dashboard route — see
          components/ui/toaster.tsx for usage. */}
      <Toaster />
      {/* Help Desk panel — persists across all dashboard pages */}
      <HelpDeskPanel />
    </HelpDeskProvider>
  )
}
