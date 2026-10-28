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
import { burnErrorMessage, cloudinaryHandOff, cloudinaryAccountDown } from '@/lib/burn-error'
import { renderCta } from '@/lib/youtube-ingest'
import { researchProductContext, composeReelCaption } from '@/lib/ig-burn'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { getCtaSticker, ctaStickerUrl } from '@/lib/cta-stickers'

// A long clip can go to MVP's own render server after Cloudinary turns it
// down, and that re-encode alone can take minutes.
export const maxDuration = 600

const POSITIONS: OverlayPosition[] = ['lower-left', 'upper-left']
const STYLES: CaptionStyle[] = ['white-pill', 'black-pill', 'yellow-pill', 'white-shadow']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Instagram publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
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
      product?: string; productName?: string; stickerId?: string; customStickerUrl?: string
      stickerDurationSec?: number
      placement?: { xPct?: number; yPct?: number }; stickerWidthPct?: number
      /** The clip's length, when the page knows it. */
      durationSec?: number
    }
    // How long the CTA stays on screen: 5 / 10 / 30s, or 0 = the whole video.
    // Clamp to the allowed set so a bad value can't produce a weird transform.
    const ALLOWED_DURATIONS = [0, 5, 10, 30]
    const stickerDurationSec = ALLOWED_DURATIONS.includes(Number(body.stickerDurationSec))
      ? Number(body.stickerDurationSec) : 0
    const videoUrl = (body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'Upload a video first.' }, { status: 400 })
    const overlayText = (body.caption || 'LINK IN BIO').trim().slice(0, 60) || 'LINK IN BIO'
    const position = (POSITIONS.includes(body.position as OverlayPosition) ? body.position : 'lower-left') as OverlayPosition
    const style = (STYLES.includes(body.style as CaptionStyle) ? body.style : 'white-pill') as CaptionStyle
    // Optional CTA sticker. Either a pre-designed PNG from the gallery
    // (stickerId → public/cta-burner/) OR an AI-generated badge the user just
    // made (customStickerUrl, hosted on our Supabase storage). Custom wins.
    const sticker = body.stickerId ? getCtaSticker(body.stickerId.trim()) : undefined
    const customStickerUrl = (body.customStickerUrl || '').trim()
    // Only accept generated badges from our own Supabase storage — never an
    // arbitrary remote URL passed in by the client.
    const customOk = /^https:\/\/[^/]+\.supabase\.(co|in)\//i.test(customStickerUrl)
    const productInput = (body.product || '').trim()
    // Creator-supplied product name — used as the caption source for TikTok Shop
    // links (which we never scrape) and as a fallback when a store URL won't parse.
    const productName = (body.productName || '').trim()

    // Free placement + size from the drag preview (WYSIWYG). Both clamped so a
    // bad client value can't produce a broken transform.
    const px = Number(body.placement?.xPct), py = Number(body.placement?.yPct)
    const placement = Number.isFinite(px) && Number.isFinite(py)
      ? { xPct: Math.min(1, Math.max(0, px)), yPct: Math.min(1, Math.max(0, py)) }
      : undefined
    const cw = Number(body.stickerWidthPct)
    const clientWidthPct = Number.isFinite(cw) && cw >= 0.1 && cw <= 0.95 ? cw : undefined

    // ── 1. Burn the overlay into the video (1080×1920) ────────────────────────
    // A CTA sticker (PNG) takes precedence over the text caption when picked.
    const stickerOverlayUrl = customOk ? customStickerUrl : sticker ? ctaStickerUrl(sticker.file) : null
    const widthPct = clientWidthPct ?? (customOk ? 0.55 : sticker?.widthPct)
    const started = Date.now()
    // TOO BIG FOR CLOUDINARY GOES TO MVP'S OWN RENDER SERVER (Seb,
    // 2026-10-12: a 3:41 whole-video clip, "This video is too big for the
    // overlay burner"). Cloudinary caps the file it takes; the render server
    // that cut the clip has no such cap. A clip over LONG_CLIP_SEC goes there
    // first; a shorter one goes there when Cloudinary says too big or too slow,
    // or turns MVP's account away (Alejandro, 2026-10-28: "cloud_name is
    // disabled (401)").
    const LONG_CLIP_SEC = 120
    const dur = Number(body.durationSec)
    const long = Number.isFinite(dur) && dur > LONG_CLIP_SEC
    let burnedUrl: string | null = null
    let via: 'cloudinary' | 'render-server' = 'cloudinary'
    let cloudReason: string | null = null
    if (!long) {
      const burned = await overlayCaptionOnVideo(videoUrl, overlayText, stickerOverlayUrl
        ? { position, placement, stickerUrl: stickerOverlayUrl, stickerWidthPct: widthPct, stickerDurationSec }
        : { position, style, stickerDurationSec })
      burnedUrl = burned?.url ?? null
      if (!burnedUrl) cloudReason = getLastOverlayError()
    }
    if (!burnedUrl && (long || cloudinaryHandOff(cloudReason))) {
      // What is left of this route's time, less a margin for the caption.
      const left = 600_000 - (Date.now() - started) - 60_000
      const out = await renderCta(videoUrl, {
        text: stickerOverlayUrl ? '' : overlayText,
        style: 'lowerthird',
        startSec: 0,
        // Whole clip: a window longer than any clip.
        endSec: stickerDurationSec > 0 ? stickerDurationSec : 86_400,
        ...(stickerOverlayUrl ? {
          stickerUrl: stickerOverlayUrl,
          // The same size the preview showed: Cloudinary scales a preset
          // position by 0.75, a dragged one as-is.
          widthPct: (widthPct ?? 0.85) * (placement ? 1 : 0.75),
          position,
          ...(placement ? { xPct: placement.xPct, yPct: placement.yPct } : {}),
        } : {}),
      }, user.id, Math.max(60_000, left))
      if (out.ok) { burnedUrl = out.url; via = 'render-server' }
      else {
        const why = out.reason === 'render-timeout' ? 'it ran out of time' : out.reason === 'render-service-not-configured' ? 'it is not set up' : out.reason
        return NextResponse.json({
          error: `${cloudReason ? burnErrorMessage(cloudReason) + ' ' : ''}MVP's own render server could not burn it either (${why}). Use a shorter clip, or press "Skip and publish as is" to post it without the overlay.`,
          detail: { cloudinary: cloudReason, renderServer: out.reason },
        }, { status: 500 })
      }
    }
    if (!burnedUrl) {
      return NextResponse.json({ error: burnErrorMessage(cloudReason), detail: cloudReason }, { status: 500 })
    }
    recordUsage({ userId: user.id, tier, feature: 'instagram_burn', model: via, images: 1 })

    // ── 2. Research the product (if given) + compose the Reel caption ─────────
    // Publishing is intentionally NOT done here. The user reviews the preview +
    // caption, then publishes via an explicit action (/api/instagram/publish-burned).
    const productContext = (productInput || productName)
      ? await researchProductContext(productInput, { userId: user.id, tier }, { productName })
      : ''
    const composedCaption = productContext ? await composeReelCaption(productContext, { userId: user.id, tier }) : null

    return NextResponse.json({
      ok: true,
      url: burnedUrl,
      caption: composedCaption,
      // Said, not hidden: which burner made it, why, and whether the picked
      // caption look survived (the render server draws text in its own
      // lower-third style; a sticker keeps its place and size).
      via,
      ...(via === 'render-server' ? {
        viaWhy: long ? 'long' : cloudinaryAccountDown(cloudReason) ? 'unavailable' : 'refused',
        lookKept: !!stickerOverlayUrl,
      } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instagram/burn] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
