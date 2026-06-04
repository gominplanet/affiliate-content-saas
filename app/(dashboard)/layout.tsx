import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import DashboardShellV2 from '@/components/layout/DashboardShellV2'
import { Toaster } from '@/components/ui/toaster'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('wordpress_url, tier')
    .eq('user_id', user.id)
    .maybeSingle()

  const wpSiteUrl = intRow?.wordpress_url || null
  const tier = (intRow?.tier as string | null) || 'trial'

  // Buying Guides feature gate: the round-up format only earns its keep
  // on a wide catalogue (diverse picks, multiple clusters, viable
  // "Best for X" splits). Below 500 published posts the output reads
  // thin, so hide the entry entirely until the user crosses that
  // threshold on their LIVE blog. Admins always see it for testing.
  //
  // Count source: WP REST X-WP-Total header (the truth on the live
  // blog — many users have posts that predate MVP). Cached 5 min via
  // Next's fetch cache so we don't hit WP on every dashboard render.
  // Fail-open as "not unlocked" if the call times out.
  let showBuyingGuides = tier === 'admin'
  if (!showBuyingGuides && wpSiteUrl) {
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

  // Deals Hub gate: Studio + Pro + Admin only. Unlike Buying Guides, there's
  // no post-volume threshold — a brand-new Studio user should be able to ship
  // a deal post on day one. The sidebar entry hides outright for Trial/
  // Creator so we don't tease a feature they can't reach. Admin always sees
  // it (so the View-as-Studio/Pro preview also exposes it for screenshots).
  const showDeals = tier === 'studio' || tier === 'pro' || tier === 'admin'

  return (
    <>
      {/* DashboardShellV2 is the new chrome (per task #143). The legacy
          Sidebar.tsx + the old wrapper stayed in components/layout/
          intentionally for rollback; once the new look is locked in for
          a few days a follow-up commit deletes them. */}
      <DashboardShellV2
        email={user.email}
        wpSiteUrl={wpSiteUrl}
        tier={tier}
        showBuyingGuides={showBuyingGuides}
        showDeals={showDeals}
      >
        {children}
      </DashboardShellV2>
      {/* Single Toaster mount for every dashboard route — see
          components/ui/toaster.tsx for usage. */}
      <Toaster />
    </>
  )
}
