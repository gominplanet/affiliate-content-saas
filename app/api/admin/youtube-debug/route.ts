/**
 * GET /api/admin/youtube-debug — admin-only diagnostic for the "ghost channel
 * after disconnect" investigation. Shows the RAW server state (integrations
 * youtube fields + youtube_channels rows + what listYouTubeChannels resolves)
 * so we stop guessing. Never returns actual tokens — only booleans.
 *
 * GET /api/admin/youtube-debug?reset=1 — force-clears this admin's YouTube
 * connection with the service-role client (same as disconnect, belt-and-braces).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listYouTubeChannels } from '@/lib/youtube-channels'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  // Admin gate — read the tier with the service-role client.
  const { data: me } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(me?.tier) !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const reset = new URL(request.url).searchParams.get('reset') === '1'
  if (reset) {
    await admin.from('integrations').update({
      youtube_oauth_access_token: null,
      youtube_oauth_refresh_token: null,
      youtube_oauth_token_expiry: null,
      youtube_channel_id: null,
      youtube_channel_url: null,
    }).eq('user_id', user.id)
    try { await admin.from('youtube_channels').delete().eq('user_id', user.id) } catch { /* ignore */ }
    try { await admin.from('youtube_sync_cache').delete().eq('user_id', user.id) } catch { /* ignore */ }
  }

  const { data: intRow } = await admin
    .from('integrations')
    .select('youtube_channel_id, youtube_channel_url, youtube_oauth_access_token, youtube_oauth_refresh_token')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: chRows } = await admin
    .from('youtube_channels')
    .select('id, channel_id, channel_title, is_default, display_order, oauth_access_token')
    .eq('user_id', user.id)

  const resolved = await listYouTubeChannels(supabase, user.id)

  return NextResponse.json({
    reset,
    integrations: {
      youtube_channel_id: intRow?.youtube_channel_id ?? null,
      youtube_channel_url: intRow?.youtube_channel_url ?? null,
      has_access_token: !!intRow?.youtube_oauth_access_token,
      has_refresh_token: !!intRow?.youtube_oauth_refresh_token,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    youtube_channels_rows: (chRows ?? []).map((r: any) => ({
      id: r.id, channel_id: r.channel_id, channel_title: r.channel_title,
      is_default: r.is_default, display_order: r.display_order,
      has_oauth: !!r.oauth_access_token,
    })),
    listYouTubeChannels_returns: resolved,
  })
}
