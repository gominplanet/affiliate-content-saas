/**
 * POST /api/facebook/subscribe-feed
 *
 * Subscribe the signed-in user's connected Facebook Page to the `feed` webhook
 * (POST /{page-id}/subscribed_apps). We do this automatically on connect, but
 * that call is best-effort and can silently fail (token propagation, a single-
 * Page auto-select path that skips it, etc.). This gives a reliable one-click
 * repair from the Facebook Auto-DM status panel instead of making the user
 * disconnect + reconnect. Needs the token to carry pages_manage_metadata.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { subscribePageToFeed } from '@/services/facebook'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await supabase
    .from('integrations')
    .select('facebook_page_id,facebook_page_access_token')
    .eq('user_id', user.id)
    .maybeSingle()
  const integ = decryptIntegrationRow(raw)
  const pageId = integ?.facebook_page_id as string | undefined
  const token = integ?.facebook_page_access_token as string | undefined
  if (!pageId || !token) {
    return NextResponse.json({ error: 'No Facebook Page connected.' }, { status: 400 })
  }

  try {
    await subscribePageToFeed({ pageId, pageAccessToken: token })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // A permission error here means the token lacks pages_manage_metadata —
    // point the user at the reconnect-with-scopes path.
    return NextResponse.json({
      error: /permission|manage_metadata|OAuth/i.test(msg)
        ? 'Your Page token can’t manage webhooks — reconnect Facebook (with FB_DM_SCOPES=true live) so it picks up pages_manage_metadata.'
        : `Facebook rejected the subscribe: ${msg.slice(0, 200)}`,
    }, { status: 500 })
  }
}
