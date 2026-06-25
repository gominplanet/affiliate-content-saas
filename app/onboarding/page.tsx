/**
 * /onboarding — the guided new-user funnel (epic Phase 2).
 *
 * Lives OUTSIDE the (dashboard) route group on purpose: a brand-new user with
 * nothing connected should see this clean, focused funnel — NOT the full
 * dashboard chrome with every panel. The (dashboard) layout force-redirects
 * here whenever WordPress isn't connected yet (the one hard gate), so this is
 * the de-facto landing page after signup.
 *
 * Server component: resolves auth + the current completion state of each step,
 * then hands a plain snapshot to the client funnel. Finished users are bounced
 * to /dashboard (they revisit individual steps via the SET UP sidebar group).
 */
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import OnboardingFunnel from '@/components/onboarding/OnboardingFunnel'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: intRow }, { data: brand }, { count: faceCount }] = await Promise.all([
    sb.from('integrations')
      .select('wordpress_url, youtube_oauth_access_token, geniuslink_api_key, amazon_associates_tag, onboarding_step, onboarding_completed')
      .eq('user_id', user.id)
      .maybeSingle(),
    sb.from('brand_profiles')
      .select('author_name, niches, author_bio, learn_profile')
      .eq('user_id', user.id)
      .maybeSingle(),
    sb.from('face_models')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'ready'),
  ])

  // Finished users don't get trapped in the funnel — send them home.
  if (intRow?.onboarding_completed === true) redirect('/dashboard')

  const niches = Array.isArray(brand?.niches) ? brand!.niches : []
  const learn = brand?.learn_profile && typeof brand.learn_profile === 'object' ? brand.learn_profile : null

  const status = {
    wpConnected: !!intRow?.wordpress_url,
    ytConnected: !!intRow?.youtube_oauth_access_token,
    affiliateConnected: !!(intRow?.geniuslink_api_key || intRow?.amazon_associates_tag),
    brandStarted: !!(brand?.author_name || niches.length > 0),
    voiceStarted: !!(brand?.author_bio || (learn && Object.keys(learn).length > 0)),
    // Customize Blog writes to WordPress metadata, not a column we can cheaply
    // read here — treated as a manual "mark done" step in the funnel.
    faceReady: (faceCount ?? 0) > 0,
  }

  // New users (no saved step) land on step 0 = the intro video first.
  const savedStep = intRow?.onboarding_step != null ? Number(intRow.onboarding_step) : 0
  const initialStep = Math.min(7, Math.max(0, savedStep))

  return (
    <OnboardingFunnel
      email={user.email ?? ''}
      initialStep={initialStep}
      status={status}
    />
  )
}
