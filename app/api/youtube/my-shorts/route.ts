/**
 * GET /api/youtube/my-shorts?asin=<asin>
 *
 * Lists the authenticated creator's recent YouTube Shorts. If asin is
 * provided, a Short whose title contains that ASIN gets flagged as the
 * auto-suggested match (isAsinMatch: true) and floated to the top.
 *
 * Used by the Instagram publish modal to let users pick a Short to
 * publish without leaving MVP — no URL pasting required.
 *
 * Gated to Pro (matches Instagram tier).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const asin = request.nextUrl.searchParams.get('asin')

    // Tier gate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier,youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', user.id)
      .single()
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json(
        { error: 'Fetching YouTube Shorts is a Pro plan feature.' },
        { status: 403 },
      )
    }
    if (!intRow?.youtube_oauth_access_token) {
      return NextResponse.json({ error: 'YouTube not connected.', needsYoutubeAuth: true }, { status: 400 })
    }

    const token = await getValidYouTubeToken(intRow)
    const yt = createYouTubeOAuthService(token)
    const shorts = await yt.getMyShorts({ asin: asin || null, limit: 50 })
    return NextResponse.json({ shorts })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
