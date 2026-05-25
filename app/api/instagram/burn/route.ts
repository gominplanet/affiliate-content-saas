/**
 * POST /api/instagram/burn
 *
 * Instagram Burner — takes a user-uploaded video (public URL), burns a styled
 * caption (e.g. "LINK IN BIO") into it via Cloudinary, and optionally researches
 * a product (ASIN or URL) to compose a Reel caption (3 niche hashtags + FTC
 * disclaimer). Returns the burned video URL + the composed caption for the user
 * to review. This route does NOT publish — publishing is a separate, explicit
 * user action via /api/instagram/publish-burned (Meta policy: no auto-posting).
 * Pro-only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { cloudinaryConfigured, overlayCaptionOnVideo, getLastOverlayError, type OverlayPosition, type CaptionStyle } from '@/services/cloudinary'
import { recordUsage } from '@/lib/ai-usage'
import { researchProductContext, composeReelCaption } from '@/lib/ig-burn'
import { metaEnabled } from '@/lib/feature-flags'

export const maxDuration = 300

const POSITIONS: OverlayPosition[] = ['lower-third', 'center']
const STYLES: CaptionStyle[] = ['white-pill', 'black-pill', 'yellow-pill', 'white-shadow']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!metaEnabled()) return NextResponse.json({ error: 'Instagram publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier,instagram_user_id,instagram_access_token,instagram_username')
      .eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Instagram Burner is a Pro feature. Upgrade to Pro to caption and publish your videos.',
        limitReached: true, cap: 'instagram_burner', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }
    if (!cloudinaryConfigured()) {
      return NextResponse.json({ error: 'Video captioning is not configured yet. Try again shortly.' }, { status: 503 })
    }

    const body = await request.json() as {
      videoUrl?: string; caption?: string; position?: string; style?: string
      product?: string
    }
    const videoUrl = (body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'Upload a video first.' }, { status: 400 })
    const overlayText = (body.caption || 'LINK IN BIO').trim().slice(0, 60) || 'LINK IN BIO'
    const position = (POSITIONS.includes(body.position as OverlayPosition) ? body.position : 'lower-third') as OverlayPosition
    const style = (STYLES.includes(body.style as CaptionStyle) ? body.style : 'white-pill') as CaptionStyle
    const productInput = (body.product || '').trim()

    // ── 1. Burn the styled caption into the video (1080×1920) ─────────────────
    const burned = await overlayCaptionOnVideo(videoUrl, overlayText, { position, style })
    if (!burned?.url) {
      return NextResponse.json({ error: `Could not burn the caption: ${getLastOverlayError() || 'unknown error'}` }, { status: 500 })
    }
    recordUsage({ userId: user.id, tier, feature: 'instagram_burn', model: 'cloudinary', images: 1 })

    // ── 2. Research the product (if given) + compose the Reel caption ─────────
    // Publishing is intentionally NOT done here. The user reviews the preview +
    // caption, then publishes via an explicit action (/api/instagram/publish-burned).
    const productContext = productInput ? await researchProductContext(productInput, { userId: user.id, tier }) : ''
    const composedCaption = productContext ? await composeReelCaption(productContext, { userId: user.id, tier }) : null

    return NextResponse.json({
      ok: true,
      url: burned.url,
      caption: composedCaption,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instagram/burn] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
