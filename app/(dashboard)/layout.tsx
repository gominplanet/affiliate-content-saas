import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url')
    .eq('user_id', user.id)
    .maybeSingle()

  const wpSiteUrl = intRow?.wordpress_url || null

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar email={user.email} wpSiteUrl={wpSiteUrl} />
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
    </div>
  )
}
