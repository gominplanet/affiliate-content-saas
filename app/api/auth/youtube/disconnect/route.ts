/**
 * POST /api/auth/youtube/disconnect
 *
 * FULLY disconnect YouTube — not just the tokens. Clearing tokens alone left the
 * old channel identity behind (integrations.youtube_channel_id, the
 * youtube_channels rows, and the per-user sync cache), so:
 *   - the UI still showed the old channel "connected", and
 *   - re-connecting a DIFFERENT channel was blocked as "multi-channel is Pro"
 *     (the old row still counted), or landed as a non-default channel while the
 *     old one stayed the content source — i.e. it kept pulling the wrong
 *     channel's videos. (Gina, 2026-08-11.)
 *
 * Now disconnect revokes the grant at Google AND wipes the local connection:
 * tokens, the legacy channel id/url, every youtube_channels row, and the sync
 * cache — so the next connect starts clean and the newly authorized channel
 * becomes the default + content source.
 *
 * We deliberately do NOT delete youtube_videos: those rows are referenced by
 * scheduled posts, shorts and quality checks (ON DELETE CASCADE), so wiping them
 * on a disconnect would destroy unrelated work. The content list is scoped to
 * the connected channel instead.
 */
import { NextResponse } from 'next/server'
import { maybeDecrypt } from '@/lib/secrets'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The `integrations` row holds secrets and has layered RLS (VA sharing), under
  // which a plain user-context UPDATE can silently affect ZERO rows — which is
  // why "Disconnect" appeared to work but the token/channel came right back. Do
  // the actual clears with the service-role client (RLS-bypassing), always
  // scoped to THIS authenticated user's id.
  const admin = createAdminClient()

  // .maybeSingle() so disconnect doesn't 500 when there's no integrations row
  // yet (fresh trial user clicked Disconnect on a never-connected account).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from('integrations')
    .select('youtube_oauth_access_token,youtube_oauth_refresh_token')
    .eq('user_id', user.id)
    .maybeSingle()

  // Revoke at Google so access actually stops (not just forgotten locally).
  // Needs the plaintext token or the grant survives.
  const token = maybeDecrypt(row?.youtube_oauth_refresh_token) || maybeDecrypt(row?.youtube_oauth_access_token)
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* non-fatal — still clear locally */ }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // 1. Clear the legacy integrations connection: tokens AND the channel identity
  //    (the id/url that made the old channel linger as "connected" + the sync
  //    resolver's fallback).
  await sb.from('integrations').update({
    youtube_oauth_access_token: null,
    youtube_oauth_refresh_token: null,
    youtube_oauth_token_expiry: null,
    youtube_channel_id: null,
    youtube_channel_url: null,
  }).eq('user_id', user.id)

  // 2. Remove every connected-channel row (multi-channel table). Safe:
  //    wordpress_sites.default_youtube_channel_id is ON DELETE SET NULL, so a
  //    site just loses its default pointer rather than cascading.
  try { await sb.from('youtube_channels').delete().eq('user_id', user.id) } catch { /* table may not exist on old envs */ }

  // 3. Drop the per-user sync cache so the next Sync re-pulls fresh from the
  //    newly connected channel instead of serving the old channel's cached page.
  try { await sb.from('youtube_sync_cache').delete().eq('user_id', user.id) } catch { /* best-effort */ }

  return NextResponse.json({ ok: true })
}
