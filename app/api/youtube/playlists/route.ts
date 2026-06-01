/**
 * GET /api/youtube/playlists
 *
 * Returns the authenticated creator's own playlists for the
 * "Add to playlist" dropdown in Studio. Pro-only.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'
import { tierAllowsPublishAll, type Tier } from '@/lib/tier'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Gate to Pro+ (Publish All / batch-apply is a Pro-tier feature).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', user.id)
      .single()
    const tier = ((intRow as Record<string, unknown> | null)?.tier as Tier) ?? 'trial'
    if (!tierAllowsPublishAll(tier)) {
      return NextResponse.json({ error: 'YouTube batch-apply is a Pro plan feature.' }, { status: 403 })
    }

    const intData = (intRow as Record<string, unknown> | null) ?? {}
    if (!intData.youtube_oauth_access_token) {
      return NextResponse.json({ error: 'YouTube not connected.' }, { status: 400 })
    }

    const token = await getValidYouTubeToken(intData)
    const yt = createYouTubeOAuthService(token)
    const playlists = await yt.listMyPlaylists()
    return NextResponse.json({ playlists })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
