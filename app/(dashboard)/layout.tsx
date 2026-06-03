import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
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

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar email={user.email} wpSiteUrl={wpSiteUrl} showBuyingGuides={showBuyingGuides} />
      <main className="flex-1 overflow-y-auto w-full" style={{ background: 'var(--bg)' }}>
        {/* pt-16 on mobile leaves room for the fixed hamburger button; px-4 keeps
            content from kissing the screen edge on phones. lg: restores the
            generous desktop padding. */}
        {/* max-w-6xl kept so long copy doesn't run to absurd line lengths
            on ultra-wide monitors, but mx-auto dropped so the content
            sits flush against the sidebar instead of floating in the
            middle of the viewport. */}
        <div className="max-w-6xl px-4 sm:px-6 lg:px-8 pt-16 lg:pt-8 pb-8">
          {children}
        </div>
      </main>
      {/* Single Toaster mount for every dashboard route — see
          components/ui/toaster.tsx for usage. */}
      <Toaster />
    </div>
  )
}
