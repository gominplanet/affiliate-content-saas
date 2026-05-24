/**
 * POST /api/instagram/burn
 *
 * Instagram Burner — takes a user-uploaded video (public URL) and burns a
 * caption (e.g. "LINK IN BIO") into it via Cloudinary, returning a downloadable
 * URL of the overlaid video. Pro-only. The overlay itself is fallback-safe in
 * the service; here we surface a clear error if Cloudinary isn't configured.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { cloudinaryConfigured, overlayCaptionOnVideo, type OverlayPosition } from '@/services/cloudinary'
import { recordUsage } from '@/lib/ai-usage'

export const maxDuration = 300

const POSITIONS: OverlayPosition[] = ['lower-third', 'bottom', 'center', 'top']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Instagram Burner is a Pro feature. Upgrade to Pro to caption your videos.',
        limitReached: true, cap: 'instagram_burner', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }

    if (!cloudinaryConfigured()) {
      return NextResponse.json({ error: 'Video captioning is not configured yet. Try again shortly.' }, { status: 503 })
    }

    const body = await request.json() as { videoUrl?: string; caption?: string; position?: string }
    const videoUrl = (body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) {
      return NextResponse.json({ error: 'Upload a video first.' }, { status: 400 })
    }
    const caption = (body.caption || 'LINK IN BIO').trim().slice(0, 60) || 'LINK IN BIO'
    const position = (POSITIONS.includes(body.position as OverlayPosition) ? body.position : 'lower-third') as OverlayPosition

    const result = await overlayCaptionOnVideo(videoUrl, caption, { position })
    if (!result?.url) {
      return NextResponse.json({ error: 'Could not burn the caption onto the video. Please try again.' }, { status: 500 })
    }

    recordUsage({ userId: user.id, tier, feature: 'instagram_burn', model: 'cloudinary', images: 1 })

    return NextResponse.json({ ok: true, url: result.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instagram/burn] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
