import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { clearChannelFailures } from '@/lib/channel-health'
import { resolveManualPage } from '@/services/facebook'
import { syncFacebookAccounts } from '@/lib/social-accounts'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'

/**
 * POST /api/auth/facebook/connect-manual
 *
 * Manual Facebook Page connect — the escape hatch for Pages OAuth can't surface
 * (Business-Manager Pages need `business_management`, which Facebook drops for
 * customers until App Review). The user pastes a Page ID + a Page/System-User
 * access token from their Business Manager; we validate it against Graph, store
 * it exactly like the OAuth callback does, and posting works immediately.
 *
 * Body: { accessToken: string, pageId?: string }
 * → 200 { ok: true, pageName }               connected
 * → 200 { needsPageChoice: true, pages: [] }  token reaches several Pages; pick one
 * → 4xx { error }                             bad token / no access
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!(await metaEnabledForUser(supabase, user))) {
    return NextResponse.json({ error: 'Facebook connections are not enabled on your account yet.' }, { status: 403 })
  }

  let body: { accessToken?: string; pageId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const accessToken = (body.accessToken || '').trim()
  const pageId = (body.pageId || '').trim() || undefined
  if (!accessToken || accessToken.length < 20) {
    return NextResponse.json({ error: 'Paste the access token from your Business Manager (System-User or Page token).' }, { status: 400 })
  }

  let resolved
  try {
    resolved = await resolveManualPage(accessToken, pageId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // The token reaches several Pages and the user didn't say which — hand the
    // list back so the UI can show a chooser instead of guessing.
    if (msg.startsWith('MULTIPLE:')) {
      try {
        const pages = JSON.parse(msg.slice('MULTIPLE:'.length)) as Array<{ id: string; name: string }>
        return NextResponse.json({ needsPageChoice: true, pages })
      } catch { /* fall through to generic error */ }
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // Store exactly like the OAuth callback: active Page columns (token encrypted)
  // + the full list stashed for the in-app picker, then mirror into
  // social_accounts so every post route resolves it the same way.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: user.id,
        facebook_page_id: resolved.pageId,
        facebook_page_name: resolved.pageName,
        facebook_page_access_token: resolved.pageAccessToken,
        facebook_pages_json: JSON.stringify(resolved.allPages),
      }),
      { onConflict: 'user_id' },
    )
    try { await syncFacebookAccounts(supabase, user.id, resolved.allPages, resolved.pageId) } catch { /* best-effort mirror */ }
    // A manual reconnect is a fresh, working connection — clear any dead-channel
    // streak so the "reconnect Facebook" nag and auto-skip stop immediately.
    try { await clearChannelFailures(supabase, user.id, 'facebook') } catch { /* non-fatal */ }
  } catch (e) {
    return NextResponse.json({ error: `Could not save the connection: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, pageName: resolved.pageName, pageId: resolved.pageId })
}
