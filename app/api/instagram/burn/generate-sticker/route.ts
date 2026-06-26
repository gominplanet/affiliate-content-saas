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
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import {
  composeWithNanoBananaPro, rehostAll, removeBackground, NANO_BANANA_PRO_COST_MODEL,
} from '@/lib/thumbnail-generators'
import { CTA_STICKERS, ctaStickerUrl } from '@/lib/cta-stickers'

export const maxDuration = 120

/**
 * Safety-net transparency: flood-fill the near-white background (connected to
 * the image border) to alpha 0. Used ONLY when fal rembg fails — the badge is
 * generated on a plain white background, so without this we'd save an OPAQUE
 * box that shows as a white rectangle burned onto the video. Interior whites
 * (text, highlights) are NOT connected to the border, so they're preserved.
 */
async function whiteBgToTransparent(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: c } = info
  const N = w * h
  const near = (i: number, t: number) => data[i] >= t && data[i + 1] >= t && data[i + 2] >= t
  const visited = new Uint8Array(N)
  const stack: number[] = []
  const seed = (x: number, y: number) => { const p = y * w + x; if (!visited[p] && near(p * c, 230)) { visited[p] = 1; stack.push(p) } }
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1) }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y) }
  while (stack.length) {
    const p = stack.pop() as number
    data[p * c + (c - 1)] = 0
    const x = p % w, y = (p - x) / w
    if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y)
    if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1)
  }
  return await sharp(data, { raw: { width: w, height: h, channels: c } }).png().toBuffer()
}

// Example badges whose comic/pop look anchors the generated style.
const STYLE_REF_FILES = ['burner07.png', 'burner08.png', 'burner013.png']
// Monthly cap on AI CTA-box generation (the only paid step in the burner —
// ~$0.13/box on Nano Banana Pro). Pro gets this many designs per billing
// period; admin is unlimited. One number to tune.
const CTA_BOX_MONTHLY_CAP = 50

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations').select('tier,subscription_period_start,subscription_period_end').eq('user_id', user.id).single()
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

    // Per-period cap on AI CTA-box generation (admin = unlimited). Counts
    // cta_sticker_gen rows in ai_usage this billing window. Checked BEFORE we
    // spend on the model. Picking a saved box / built-in gallery box is free
    // and uncapped — only fresh generation counts.
    const capLimit = tier === 'admin' ? null : CTA_BOX_MONTHLY_CAP
    const capCheck = await checkUsageCap(
      supabase, user.id, PRIMARY_FEATURE.ctaBox, capLimit,
      (intRow?.subscription_period_start as string | null) ?? null,
      (intRow?.subscription_period_end as string | null) ?? null,
    )
    if (capCheck?.exceeded) {
      return NextResponse.json({
        error: `You've used all ${capLimit} custom CTA boxes for this billing period. Your saved boxes still work — reuse any of them free. Resets ${capCheck.resetLabel}.`,
        limitReached: true, cap: 'cta_box', currentTier: tier,
      }, { status: 429 })
    }

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

    // Strip the solid background → transparent PNG via fal rembg.
    const cutoutUrl = await removeBackground(rawUrl)
    const rembgOk = !!cutoutUrl
    const cutout = cutoutUrl || rawUrl

    // Persist to storage so the burner has a stable public URL (the fal URL is
    // ephemeral). Same bucket + {uid}/ path shape as the burner's own uploads.
    const imgRes = await fetch(cutout)
    if (!imgRes.ok) return NextResponse.json({ error: 'Could not fetch the generated badge.' }, { status: 502 })
    let inputBuf: Buffer = Buffer.from(await imgRes.arrayBuffer())
    // Safety net: if rembg FAILED, the badge is still on its white background —
    // flood-fill it to transparent so we never save an opaque box that burns a
    // white rectangle onto the video.
    if (!rembgOk) {
      try { inputBuf = await whiteBgToTransparent(inputBuf) } catch { /* keep raw — better than nothing */ }
    }
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
    const stickerUrl = urlData.publicUrl

    // Keep it in the creator's reusable "My boxes" list (migration 136) so they
    // don't pay to regenerate the same design later. Best-effort — a failed
    // insert shouldn't block the burn the user is about to do.
    let savedId: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabase as any)
        .from('cta_stickers')
        .insert({ user_id: user.id, url: stickerUrl, tag })
        .select('id')
        .single()
      savedId = (row?.id as string) ?? null
    } catch { /* table may not exist yet — non-fatal */ }

    return NextResponse.json({ ok: true, stickerUrl, tag, id: savedId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[burn/generate-sticker] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
