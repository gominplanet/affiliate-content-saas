import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { canSeeNav } from '@/lib/feature-access'
import type { Tier } from '@/lib/tier'
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
    // wp_post_count / wp_post_count_updated_at dropped 2026-07-20: the
    // Buying Guides nav no longer depends on post volume, and nothing
    // else in this layout reads them.
    .select('wordpress_url, tier, onboarding_completed, content_only, youtube_oauth_access_token, youtube_channel_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const wpSiteUrl = intRow?.wordpress_url || null
  const tier = (intRow?.tier as string | null) || 'trial'
  // Content-only ("bring your own theme") user: hide MVP-theme-dependent
  // surfaces like Customize Blog. Read from the legacy integrations mirror so
  // single-site content-only onboarders are covered (migration 144). Multi-site
  // users with a mix of modes keep the full nav.
  const contentOnly = (intRow as { content_only?: boolean } | null)?.content_only === true

  // ── Onboarding funnel hard gate ─────────────────────────────────────────────
  // The hard requirement to enter the app is now a connected YOUTUBE channel, NOT
  // WordPress (2026-07-30). A free user who's made an account and connected
  // YouTube can explore the whole app and get teased by what each tier unlocks;
  // WordPress is only demanded later, when they actually go to spend one of their
  // 5 free posts (enforced at generation time — see lib/free-tier-gate.ts). This
  // lets the value land before we ask for the heavier WordPress setup.
  // onboarding_completed lets an existing user who finished the funnel through
  // (or connected WP the old way) skip the gate. /onboarding lives OUTSIDE this
  // layout, so there's no redirect loop.
  const ytConnected = !!(intRow as { youtube_oauth_access_token?: string | null; youtube_channel_id?: string | null } | null)?.youtube_oauth_access_token
    || !!(intRow as { youtube_channel_id?: string | null } | null)?.youtube_channel_id
  const onboardingCompleted = (intRow as { onboarding_completed?: boolean } | null)?.onboarding_completed === true
  if (!ytConnected && !wpSiteUrl && !onboardingCompleted) {
    redirect('/onboarding')
  }

  // Sidebar visibility. Every rule lives in lib/feature-access.ts: tier
  // only, never post counts or connection state, and each rule names the
  // route that does the real enforcing. See that file for why the nav and
  // the enforcement are deliberately allowed to differ.
  const showBuyingGuides = canSeeNav('buyingGuides', tier as Tier)
  const showDeals = canSeeNav('deals', tier as Tier)
  const showBurner = canSeeNav('burner', tier as Tier)

  return (
    <HelpDeskProvider>
      <DashboardShellV2
        email={user.email}
        wpSiteUrl={wpSiteUrl}
        tier={tier}
        showBuyingGuides={showBuyingGuides}
        showDeals={showDeals}
        showBurner={showBurner}
        contentOnly={contentOnly}
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
