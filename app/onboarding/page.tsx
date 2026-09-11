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
import { after } from 'next/server'
import { cookies, headers } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import OnboardingFunnel from '@/components/onboarding/OnboardingFunnel'
import AmazonOnboarding from '@/components/onboarding/AmazonOnboarding'
import { resolveOnboardingPath, onboardingDestination } from '@/lib/onboarding-path'
import MetaTrack from '@/components/analytics/MetaTrack'
import { sendMetaEvent, registrationEventId } from '@/lib/meta-capi'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>
}) {
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

  // ── Which onboarding? ─────────────────────────────────────────────────────
  //
  // The main funnel's first step is "Connect YouTube", required, with everything
  // after it locked. An Amazon influencer has no channel, so that is where they
  // stop, having clicked an ad about product links and designs.
  //
  // onboarding_path is read on its own and defensively: it ships in migration
  // 328, and naming a missing column in the select above would fail that whole
  // read and break onboarding for everybody. A database one migration behind
  // simply falls back to the ?for= parameter, which is where the choice comes
  // from on the first visit anyway.
  let storedPath: string | null = null
  try {
    const { data: pathRow } = await sb.from('integrations').select('onboarding_path').eq('user_id', user.id).maybeSingle()
    storedPath = (pathRow?.onboarding_path as string | null) ?? null
  } catch { /* pre-328 database */ }

  const { for: forParam } = await searchParams
  const chosen = resolveOnboardingPath({
    param: forParam,
    stored: storedPath,
    hasYouTube: !!intRow?.youtube_oauth_access_token,
    hasWordPress: !!intRow?.wordpress_url,
    hasAmazonTag: !!intRow?.amazon_associates_tag,
  })

  // Finished users don't get trapped in the funnel — send them home, to the
  // home their path actually has.
  if (intRow?.onboarding_completed === true) redirect(onboardingDestination(chosen.path))

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

  // Reaching onboarding means the account is confirmed and the free trial has
  // started, so this is the registration. Report it BOTH ways.
  //
  // The browser tag alone was losing roughly two thirds of them: ad blockers,
  // iOS/Safari tracking prevention and a cleared localStorage (the onceKey
  // guard) each eat one silently. Between 2026-09-08 and 2026-09-11 the
  // database recorded 6 confirmed registrations and Meta received 2 — and this
  // is the event the ad campaign optimizes on, so delivery was being steered
  // against a third of reality.
  //
  // Both halves carry registrationEventId(), so Meta counts one conversion,
  // not two. after() runs this once the response is already on its way, so a
  // slow Graph call never delays the page.
  const eventId = registrationEventId(user.id)
  after(async () => {
    const [jar, hdrs] = await Promise.all([cookies(), headers()])
    await sendMetaEvent({
      eventName: 'CompleteRegistration',
      eventId,
      email: user.email,
      externalId: user.id,
      eventSourceUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://mvpaffiliate.io'}/onboarding`,
      fbp: jar.get('_fbp')?.value || null,
      fbc: jar.get('_fbc')?.value || null,
      clientIpAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      clientUserAgent: hdrs.get('user-agent'),
      custom: { content_name: 'Free trial signup' },
    })
  })

  return (
    <>
      {/* Browser half of the pair above. onceKey keeps repeat visits from
          re-firing it; the shared eventId keeps it from double-counting
          against the server event. */}
      <MetaTrack event="CompleteRegistration" onceKey="reg" eventId={eventId} />
      <MetaTrack event="StartTrial" onceKey="trial" />
      {chosen.path === 'amazon' ? (
        <AmazonOnboarding
          email={user.email ?? ''}
          initialTag={(intRow?.amazon_associates_tag as string | null) ?? ''}
          hasFace={status.faceReady}
          hasSocial={false}
        />
      ) : (
        <OnboardingFunnel
          email={user.email ?? ''}
          initialStep={initialStep}
          status={status}
        />
      )}
    </>
  )
}
