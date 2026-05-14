import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createSession } from '@/services/bluesky'

/**
 * Bluesky connect endpoint.
 *
 * Bluesky does not (yet) have a stable OAuth flow — we use the per-user
 * **App Password** model. The user generates an app password in
 * Bluesky Settings → Privacy and Security → App Passwords, then pastes
 * the handle + password into our setup UI. We validate the credentials
 * by logging in once, then store the credentials so we can re-login at
 * post time (App Password tokens expire after ~2 hours, so we don't
 * cache the JWT).
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { handle, appPassword } = await request.json() as { handle?: string; appPassword?: string }
  if (!handle || !appPassword) {
    return NextResponse.json({ error: 'handle and appPassword required' }, { status: 400 })
  }

  // Normalize handle: strip @ prefix, trim, lowercase
  const cleanHandle = handle.trim().replace(/^@/, '').toLowerCase()

  try {
    const session = await createSession(cleanHandle, appPassword.trim())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      {
        user_id: user.id,
        bluesky_handle: session.handle,
        bluesky_app_password: appPassword.trim(),
        bluesky_did: session.did,
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.json({ ok: true, handle: session.handle, did: session.did })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Bluesky login failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
