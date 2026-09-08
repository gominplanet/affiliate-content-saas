import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createSession } from '@/services/bluesky'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'

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

    // Encrypt the app password at rest (2026-06-02).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // THE ERROR IS READ. Telling someone their account is connected when the
    // write failed is worse than telling them it did not work: they publish,
    // nothing goes out, and the screen said Connected the whole time. PostgREST
    // also rejects an entire write over one column it does not recognise, so a
    // column added ahead of its migration would silently no-op every connect on
    // the platform while still reporting success.
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: user.id,
        bluesky_handle: session.handle,
        bluesky_app_password: appPassword.trim(),
        bluesky_did: session.did,
      }),
      { onConflict: 'user_id' },
    )
    if (saveErr) {
      console.error('[auth/bluesky] connect succeeded but the save failed:', saveErr.message)
      return NextResponse.json(
        { error: 'Signed in to Bluesky, but we could not save the connection. Please try again.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, handle: session.handle, did: session.did })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Bluesky login failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
