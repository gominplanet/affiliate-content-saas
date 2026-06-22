/**
 * GET /api/tiktok/publish-burned/status?publishId=… — poll the status of a
 * Shop Burner TikTok publish. Stateless: there's no DB row for an ad-hoc burned
 * video, so we poll TikTok directly by publish_id. Mirrors the video status
 * route's response shape so the shared modal can consume either.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidTikTokToken, pollPublishStatus } from '@/services/tiktok'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const publishId = (searchParams.get('publishId') || '').trim()
  if (!publishId) return NextResponse.json({ error: 'publishId is required.' }, { status: 400 })

  const token = await getValidTikTokToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({ error: 'TikTok token expired. Reconnect TikTok.', reconnectRequired: true }, { status: 412 })
  }

  const result = await pollPublishStatus(token, publishId)
  if (result.status === 'PUBLISH_COMPLETE') {
    return NextResponse.json({ status: 'published', shareUrl: result.publicShareUrl, errorMessage: null, rawStatus: result.rawStatus })
  }
  if (result.status === 'SEND_TO_USER_INBOX') {
    return NextResponse.json({ status: 'inbox', shareUrl: null, errorMessage: 'TikTok routed it to your app inbox — open the TikTok app to publish.', rawStatus: result.rawStatus })
  }
  if (result.status === 'FAILED') {
    return NextResponse.json({ status: 'failed', shareUrl: null, errorMessage: result.failureReason ?? 'TikTok rejected the publish.', rawStatus: result.rawStatus })
  }
  return NextResponse.json({ status: 'processing', shareUrl: null, errorMessage: null, rawStatus: result.rawStatus })
}
