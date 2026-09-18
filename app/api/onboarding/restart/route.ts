/**
 * POST /api/onboarding/restart — disconnect WordPress and re-enter the guided
 * onboarding funnel from step 1.
 *
 * Clears the WordPress connection (the funnel's hard gate keys on
 * integrations.wordpress_url) and resets the funnel position, so the dashboard
 * layout's gate routes the user back to /onboarding. Also removes any
 * multi-site rows so a reconnect starts from a clean slate.
 *
 * Deliberately NON-destructive beyond WordPress: YouTube, Brand Profile, Voice,
 * and Face Models stay intact — "restart setup" means redo the WordPress
 * connection and walk the funnel again, not wipe the whole account. The funnel
 * will simply show those later steps already ✓.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1. Disconnect WordPress + reset the funnel to step 1, not-completed. The
  //    onboarding_* columns ship in migration 125, not yet in generated types.
  const { error } = await sb.from('integrations').update({
    wordpress_url: null,
    wordpress_username: null,
    wordpress_app_password: null,
    wordpress_api_token: null,
    onboarding_completed: false,
    onboarding_step: 1,
    // ── LOWER THE LATCH ────────────────────────────────────────────────────
    //
    // setup_status is what /dashboard, /content and /setup all read to answer
    // "is WordPress connected". Five routes raise it to 'site_ready' on a
    // successful connect and, until now, NOTHING ever lowered it. It was a
    // one-way flag being used as a live status.
    //
    // A creator on 48 published posts pressed Disconnect and start over on
    // 17 Sep. This ran, her credentials went, her site rows went, and her
    // setup_status stayed 'site_ready'. So the product kept telling her she was
    // connected on three screens while every publish attempt failed, and she
    // wrote in to apologise for having issues. Her row afterwards read
    // onboarding_completed=false, setup_status='site_ready', every WordPress
    // column NULL, zero rows in wordpress_sites: the exact fingerprint of this
    // update as it stood.
    setup_status: null,
  }).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 2. Remove any multi-site rows so a reconnect doesn't leave a stale site
  //    that publishing would still pick up. Best-effort.
  try { await sb.from('wordpress_sites').delete().eq('user_id', user.id) } catch { /* no rows / table absent */ }

  return NextResponse.json({ ok: true })
}
