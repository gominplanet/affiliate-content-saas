/**
 * Server-side gate for the dashboard redesign preview.
 *
 * /preview/** was reachable by ANY logged-in user — leaks unreleased product
 * UI to all paying customers. Behind admin tier only until #143 is unblocked
 * and the redesign ships to production routes.
 *
 * The actual chrome (sidebar, topbar, theme toggle, etc.) lives in
 * PreviewClientShell.tsx — kept as 'use client' because it relies on
 * sessionStorage + useState for theme persistence.
 */
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import PreviewClientShell from './PreviewClientShell'

export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/preview')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .maybeSingle()
  const tier = (integ?.tier as string | null) || 'trial'
  if (tier !== 'admin') redirect('/dashboard')

  return <PreviewClientShell>{children}</PreviewClientShell>
}
