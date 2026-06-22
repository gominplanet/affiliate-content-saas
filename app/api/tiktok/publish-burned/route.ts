/**
 * POST /api/tiktok/publish-burned — Direct Post a Shop Burner video (a burned
 * Cloudinary URL) to TikTok. No blog post or youtube_videos row involved.
 *
 * Mirrors /api/blog/tiktok-post/video but takes a direct `videoUrl` instead of
 * resolving one from a videoId. FILE_UPLOAD path: directPostVideoUpload fetches
 * the bytes from the (public) Cloudinary URL server-side and pushes them to
 * TikTok — no domain verification needed. Pro + video.publish scope gated.
 *
 * Status is polled (stateless) via GET /api/tiktok/publish-burned/status.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import {
  getValidTikTokToken,
  directPostVideoUpload,
  scopesIncludePublish,
  type DirectPostOptions,
} from '@/services/tiktok'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    videoUrl?: string
    caption?: string
    privacyLevel?: DirectPostOptions['privacyLevel']
    disableComment?: boolean
    disableDuet?: boolean
    disableStitch?: boolean
    brandContentToggle?: boolean
    brandOrganicToggle?: boolean
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const videoUrl = (body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A burned video is required.' }, { status: 400 })
  if (!body.privacyLevel) return NextResponse.json({ error: 'Pick a privacy option before posting.' }, { status: 400 })

  // ── Tier gate ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integ } = await sb
    .from('integrations')
    .select('tier,tiktok_scopes')
    .eq('user_id', user.id)
    .single()
  const tier = (integ?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'tiktok')) {
    return NextResponse.json({ error: 'TikTok posting is a Pro feature.', tierRequired: 'pro' }, { status: 403 })
  }

  // ── Scope gate ────────────────────────────────────────────────────────────
  if (!scopesIncludePublish(integ?.tiktok_scopes)) {
    return NextResponse.json({
      error: "Your TikTok connection doesn't include the video.publish scope. Disconnect and reconnect TikTok to grant it.",
      reconnectRequired: true,
    }, { status: 412 })
  }

  // ── Token gate ────────────────────────────────────────────────────────────
  const token = await getValidTikTokToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({ error: "TikTok isn't connected. Connect it first.", reconnectRequired: true }, { status: 412 })
  }

  // ── Direct Post (FILE_UPLOAD) ──────────────────────────────────────────────
  const caption = (body.caption || '').slice(0, 2200)
  try {
    const { publishId } = await directPostVideoUpload(token, {
      title: caption,
      privacyLevel: body.privacyLevel,
      disableComment: !!body.disableComment,
      disableDuet: !!body.disableDuet,
      disableStitch: !!body.disableStitch,
      brandContentToggle: !!body.brandContentToggle,
      brandOrganicToggle: !!body.brandOrganicToggle,
      upstreamUrl: videoUrl,
    })
    return NextResponse.json({ ok: true, publishId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'TikTok publish failed.'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
