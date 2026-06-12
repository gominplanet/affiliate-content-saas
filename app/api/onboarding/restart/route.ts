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
  }).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 2. Remove any multi-site rows so a reconnect doesn't leave a stale site
  //    that publishing would still pick up. Best-effort.
  try { await sb.from('wordpress_sites').delete().eq('user_id', user.id) } catch { /* no rows / table absent */ }

  return NextResponse.json({ ok: true })
}
