/**
 * POST /api/instagram/burn/generate-sticker
 *
 * Turn a short typed tag (e.g. "BUY BEFORE IT'S GONE") into a transparent CTA
 * badge PNG, styled like the hand-designed burner0X boxes, ready to burn onto a
 * vertical video. Pro-only.
 *
 *   1. Nano Banana Pro (Gemini 3 Pro Image) renders the badge from the tag,
 *      conditioned on a few of our example badges so the look matches — on a
 *      plain solid background, exact spelling.
 *   2. fal rembg strips the background → clean transparent PNG (segmentation,
 *      so the white inside the badge is preserved).
 *   3. Upload to Supabase storage → public URL the burner uses as a sticker.
 *
 * Input:  { tag: string }
 * Output: { ok: true, stickerUrl } | { error }
 */
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createServerClient } from '@/lib/supabase/server'
import { fal } from '@fal-ai/client'
import { normalizeTier, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { recordUsage } from '@/lib/ai-usage'
import {
  composeWithNanoBananaPro, rehostAll, removeBackground, NANO_BANANA_PRO_COST_MODEL,
} from '@/lib/thumbnail-generators'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'

export const maxDuration = 120

// Example badges whose comic/pop look anchors the generated style.
const STYLE_REF_FILES = ['burner07.png', 'burner08.png', 'burner013.png']

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Custom CTA boxes are a Pro feature.',
        limitReached: true, cap: 'instagram_burner', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }

    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked

    const body = await request.json() as { tag?: string }
    const tag = (body.tag || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!tag || tag.split(' ').length > 6) {
      return NextResponse.json({ error: 'Enter a short tag (1–6 words, e.g. “BUY BEFORE IT’S GONE”).' }, { status: 400 })
    }

    if (!process.env.FAL_KEY) return NextResponse.json({ error: 'Image generation is not configured.' }, { status: 503 })
    fal.config({ credentials: process.env.FAL_KEY })

    // Style references — our own example badges, rehosted so fal can fetch them.
    const refUrls = await rehostAll(STYLE_REF_FILES.map(f => ctaStickerUrl(f)))
    if (refUrls.length === 0) return NextResponse.json({ error: 'Could not load style references.' }, { status: 502 })

    const prompt = `Design a single die-cut "call to action" sticker badge that reads EXACTLY: "${tag}".
Match the visual style of the reference badges: bold chunky display lettering with a thick contrasting outline, vibrant gradient fill, a punchy comic/pop-art shape behind the text (banner, burst or speech-bubble), small confetti shapes / halftone dots / sparkles as accents, and a soft drop shadow so it pops.
Spell the text PERFECTLY and make every word large and legible — "${tag}" — no other words, no extra letters, no brand names, no logos.
The badge must be a self-contained graphic centred on a PLAIN SOLID FLAT WHITE background with NOTHING else around it (no scene, no device, no hands, no photo). Crisp vector-sticker look, high contrast, vivid colors.`

    const generated = await composeWithNanoBananaPro({ prompt, referenceImageUrls: refUrls, aspectRatio: '4:3', numImages: 1 })
    const rawUrl = generated[0]
    if (!rawUrl) return NextResponse.json({ error: 'Could not generate the badge — try again or tweak the wording.' }, { status: 502 })
    recordUsage({ userId: user.id, tier, feature: 'cta_sticker_gen', model: NANO_BANANA_PRO_COST_MODEL, images: 1 })

    // Strip the solid background → transparent PNG. Fall back to the raw image
    // only if removal fails (still usable, just not transparent).
    const cutout = await removeBackground(rawUrl) || rawUrl

    // Persist to storage so the burner has a stable public URL (the fal URL is
    // ephemeral). Same bucket + {uid}/ path shape as the burner's own uploads.
    const imgRes = await fetch(cutout)
    if (!imgRes.ok) return NextResponse.json({ error: 'Could not fetch the generated badge.' }, { status: 502 })
    const inputBuf = Buffer.from(await imgRes.arrayBuffer())
    // Trim the transparent margins so the badge's bounding box is tight — this
    // is what makes the lower-/upper-LEFT placement actually sit against the
    // left edge instead of looking centred (the generated canvas has wide
    // transparent padding around the graphic). Best-effort.
    let bytes: Buffer | Uint8Array
    try {
      bytes = await sharp(inputBuf).trim().png().toBuffer()
    } catch {
      bytes = new Uint8Array(inputBuf)
    }
    const path = `${user.id}/cta-${crypto.randomUUID()}.png`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, bytes, {
      cacheControl: '3600', upsert: false, contentType: 'image/png',
    })
    if (upErr) return NextResponse.json({ error: `Could not save the badge: ${upErr.message}` }, { status: 500 })
    const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)

    return NextResponse.json({ ok: true, stickerUrl: urlData.publicUrl, tag })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[burn/generate-sticker] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
