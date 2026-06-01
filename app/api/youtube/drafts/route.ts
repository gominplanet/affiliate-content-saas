import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.youtube_oauth_access_token) {
    return NextResponse.json({ error: 'YouTube OAuth not connected', needsAuth: true }, { status: 401 })
  }

  try {
    const intData = intRow as Record<string, unknown>
    const expiry = intData.youtube_oauth_token_expiry as number | null
    const needsRefresh = expiry && Date.now() > expiry - 120_000
    const token = await getValidYouTubeToken(intData)

    // Persist refreshed token
    if (needsRefresh) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase
        .from('integrations')
        .update({
          youtube_oauth_access_token: token,
          youtube_oauth_token_expiry: Date.now() + 3600 * 1000,
        })
        .eq('user_id', user.id)
    }

    const { searchParams } = new URL(request.url)
    const pageToken = searchParams.get('pageToken') || undefined
    // q triggers full-catalogue search (search.list, forMine=true) instead
    // of the default uploads-playlist listing. Trimmed + length-capped so a
    // pathological query can't blow the YouTube quota in one call.
    const q = (searchParams.get('q') || '').trim().slice(0, 200)

    const yt = createYouTubeOAuthService(token)

    // When the Studio's search bar is in use we hit the search endpoint
    // (covers the whole channel) and skip the ASIN-only filter — creators
    // searching for a specific video shouldn't have the result hidden just
    // because they didn't put an ASIN in the title yet.
    if (q) {
      const result = await yt.searchMyVideos(q, 25, pageToken)
      return NextResponse.json({ drafts: result.videos, nextPageToken: result.nextPageToken, query: q })
    }

    // Default listing: fetch one page of 50, filter for ASIN videos,
    // return with cursor for next page
    const ASIN_RE = /\b([A-Z0-9]{10})\b/
    const result = await yt.getDraftVideos(50, pageToken)
    const asinVideos = result.videos.filter(v => v.detectedAsin || ASIN_RE.test(v.title))

    return NextResponse.json({ drafts: asinVideos, nextPageToken: result.nextPageToken })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Token refresh failed or token rejected by Google → ask user to reconnect
    const isAuthError =
      msg.includes('Failed to refresh YouTube token') ||
      msg.includes('YouTube OAuth not connected') ||
      msg.includes('YouTube token expired') ||
      msg.includes('401')
    if (isAuthError) {
      return NextResponse.json({ error: 'YouTube session expired', needsAuth: true }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
