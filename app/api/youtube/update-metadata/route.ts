import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { videoId, title, description, tags } = await request.json() as {
      videoId: string
      title: string
      description: string
      tags: string[]
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', user.id)
      .single()

    const intData = intRow as Record<string, unknown>
    const expiry = intData.youtube_oauth_token_expiry as number | null
    const needsRefresh = expiry && Date.now() > expiry - 120_000

    const token = await getValidYouTubeToken(intData)

    // Persist refreshed token so it stays valid for future calls
    if (needsRefresh) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('integrations')
        .update({
          youtube_oauth_access_token: token,
          youtube_oauth_token_expiry: Date.now() + 3600 * 1000,
        })
        .eq('user_id', user.id)
    }

    const yt = createYouTubeOAuthService(token)
    await yt.updateVideoMetadata(videoId, { title, description, tags })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
