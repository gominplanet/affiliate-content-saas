/**
 * POST /api/onboarding — persist the user's progress through the guided
 * onboarding funnel (epic Phase 2).
 *
 * Body: { step?: 1..7, completed?: boolean }
 *   - step:      resume point to remember (clamped 1..7).
 *   - completed: mark the funnel finished (or exited). Once true the dashboard
 *                layout stops force-routing the user to /onboarding.
 *
 * Writes the two columns added in migration 125 (onboarding_step,
 * onboarding_completed). Self-scoped to the signed-in user; no owner/VA
 * indirection — onboarding is always about the logged-in account.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const MAX_STEP = 7

/**
 * GET /api/onboarding — live completion snapshot for the funnel. Polled by the
 * client so a step that finishes out-of-band (WordPress connected via a new
 * tab, YouTube OAuth return, etc.) flips to ✓ without a manual refresh.
 */
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: intRow }, { data: brand }, { count: faceCount }] = await Promise.all([
    sb.from('integrations')
      .select('wordpress_url, youtube_oauth_access_token, geniuslink_api_key, amazon_associates_tag, onboarding_step, onboarding_completed')
      .eq('user_id', user.id).maybeSingle(),
    sb.from('brand_profiles')
      .select('author_name, niches, author_bio, learn_profile')
      .eq('user_id', user.id).maybeSingle(),
    sb.from('face_models')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'ready'),
  ])

  const niches = Array.isArray(brand?.niches) ? brand.niches : []
  const learn = brand?.learn_profile && typeof brand.learn_profile === 'object' ? brand.learn_profile : null

  return NextResponse.json({
    step: Math.min(MAX_STEP, Math.max(1, Number(intRow?.onboarding_step) || 1)),
    completed: intRow?.onboarding_completed === true,
    status: {
      wpConnected: !!intRow?.wordpress_url,
      ytConnected: !!intRow?.youtube_oauth_access_token,
      affiliateConnected: !!(intRow?.geniuslink_api_key || intRow?.amazon_associates_tag),
      brandStarted: !!(brand?.author_name || niches.length > 0),
      voiceStarted: !!(brand?.author_bio || (learn && Object.keys(learn).length > 0)),
      faceReady: (faceCount ?? 0) > 0,
    },
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { step?: number; completed?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { user_id: user.id }
  if (typeof body.step === 'number' && Number.isFinite(body.step)) {
    patch.onboarding_step = Math.min(MAX_STEP, Math.max(1, Math.round(body.step)))
  }
  if (typeof body.completed === 'boolean') {
    patch.onboarding_completed = body.completed
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // `as any`: onboarding_* columns ship in migration 125, not yet in the
  // generated DB types. Upsert keyed on user_id (every account has one row).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .upsert(patch, { onConflict: 'user_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
