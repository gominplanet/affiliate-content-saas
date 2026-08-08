/**
 * GET /api/auth/facebook/status
 *
 * Live health of the caller's stored Facebook Page connection. MVP's UI
 * otherwise shows "Connected" purely because facebook_page_id is populated —
 * so a token Meta silently invalidated (revoked permissions, password change,
 * an Instagram account restricted for "3rd-party" use) keeps a false green while
 * posts fail. This pings Graph with the STORED page token and reports whether it
 * actually still works, so Connect Socials can show "Reconnect needed".
 *
 * Returns: { connected, live, pageName, pageId, expired, reason }
 *   - connected: a page id is stored
 *   - live: the stored token still works against Graph
 *   - expired: the failure is an auth/permission failure (reconnect), not transient
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { verifyPageToken } from '@/services/facebook'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: raw } = await supabase
    .from('integrations')
    .select('facebook_page_id,facebook_page_name,facebook_page_access_token')
    .eq('user_id', user.id)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = decryptIntegrationRow(raw as any) as {
    facebook_page_id?: string | null
    facebook_page_name?: string | null
    facebook_page_access_token?: string | null
  } | null

  const pageId = row?.facebook_page_id || ''
  const pageName = row?.facebook_page_name || ''
  const token = row?.facebook_page_access_token || ''
  if (!pageId || !token) {
    return NextResponse.json({ ok: true, connected: false, live: false })
  }

  const v = await verifyPageToken(token, pageId)
  return NextResponse.json({
    ok: true,
    connected: true,
    live: v.ok,
    expired: !v.ok && !!v.expired,
    pageId,
    pageName: v.pageName || pageName,
    reason: v.ok ? null : (v.error || null),
  })
}
