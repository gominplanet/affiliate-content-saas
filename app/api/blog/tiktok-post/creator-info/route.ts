/**
 * GET /api/blog/tiktok-post/creator-info — return the LIVE creator_info
 * payload so the publish screen can render the privacy dropdown, comment/
 * duet/stitch toggles, and the max-video-duration cap with up-to-the-
 * second TikTok data.
 *
 * MUST be called every time the publish screen opens — that's a TikTok
 * app-review hard requirement (the privacy dropdown can't have a default
 * and the options can't be cached client-side).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { getValidTikTokToken, queryCreatorInfo } from '@/services/tiktok'

export async function GET() {
  // A Virtual Assistant sees the owner's (lib/agency-publish).
  const pub = await getPublishContext(await createServerClient(), 'view')
  if ('error' in pub) return pub.error
  const { supabase, user } = pub

  const token = await getValidTikTokToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({
      error: 'TikTok isn\'t connected. Connect it in Integrations first.',
      reconnectRequired: true,
    }, { status: 412 })
  }

  const info = await queryCreatorInfo(token)
  if (!info) {
    return NextResponse.json({
      error: "Couldn't reach TikTok to fetch your account settings. Try again in a moment.",
    }, { status: 502 })
  }

  return NextResponse.json({ info })
}
