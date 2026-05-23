/**
 * POST /api/photobooth
 *
 * Professional headshot generator. Uses the photos the user already uploaded
 * under "Your Face" (face_models.source_images) as identity references and
 * gpt-image-1/2 to produce a polished headshot — for logos, email, profiles,
 * speaker bios, etc. Optional style preset + free-text prompt.
 *
 * Pro-only. Returns a base64 PNG data URL (no storage needed).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { type Tier } from '@/lib/tier'
import { createOpenAIService, OpenAIService, normalizeToPng } from '@/services/openai'
import { recordUsage } from '@/lib/ai-usage'

export const maxDuration = 300

/** Built-in looks. Free-text customPrompt is appended on top of these. */
const STYLES: Record<string, string> = {
  studio:    'Clean professional studio headshot on a smooth neutral backdrop (soft grey or white), crisp even studio lighting, sharp focus.',
  office:    'Modern office setting — a computer/desk and workspace softly blurred in the background, approachable and professional.',
  cinematic: 'Cinematic portrait — moody directional lighting, shallow depth of field, filmic colour grade, premium editorial feel.',
  magazine:  'Bright, well-lit editorial magazine-style headshot — polished, high-end commercial lighting, glossy professional finish.',
  outdoor:   'Natural outdoor daylight, soft bokeh background, warm and friendly.',
  linkedin:  'Classic LinkedIn-style professional headshot — business-casual attire, simple neutral background, confident friendly expression.',
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Pro gate ──────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Photobooth is a Pro feature. Upgrade to Pro to generate professional headshots.',
        limitReached: true, cap: 'photobooth', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }

    const body = await request.json() as {
      faceModelId?: string
      style?: string
      customPrompt?: string
      size?: '1024x1024' | '1024x1536' | '1536x1024'
    }
    if (!body.faceModelId) return NextResponse.json({ error: 'Pick a face first.' }, { status: 400 })

    // ── Load the face's reference photos ──────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fm } = await (supabase as any)
      .from('face_models')
      .select('name,source_images')
      .eq('id', body.faceModelId)
      .eq('user_id', user.id)
      .single()
    const srcImages: string[] = Array.isArray(fm?.source_images) ? fm.source_images : []
    if (!fm || srcImages.length === 0) {
      return NextResponse.json({ error: 'That face has no photos. Add one under "Your Face" first.' }, { status: 400 })
    }

    const refImages: Array<{ data: Uint8Array; filename: string; mime: string }> = []
    for (const path of srcImages.slice(0, 5)) {
      const { data: file } = await supabase.storage.from('headshots').download(path)
      if (!file) continue
      try {
        const png = await normalizeToPng(new Uint8Array(await file.arrayBuffer()))
        refImages.push({ data: png, filename: `face_${refImages.length}.png`, mime: 'image/png' })
      } catch (e) {
        console.warn('[photobooth] skipping unreadable reference photo', path, e)
      }
    }
    if (refImages.length === 0) {
      return NextResponse.json({ error: 'Could not load the reference photos. Try re-adding your face.' }, { status: 500 })
    }

    // ── Build the headshot prompt ─────────────────────────────────────────
    const styleLine = (body.style && STYLES[body.style]) ? STYLES[body.style] : STYLES.studio
    const custom = (body.customPrompt || '').trim().slice(0, 400)
    const size = (body.size === '1024x1536' || body.size === '1536x1024') ? body.size : '1024x1024'

    const prompt = `Professional headshot portrait, photorealistic, high resolution.

REFERENCE IMAGES: all of the provided photos are the SAME ONE person. Use them ONLY to capture that person's exact facial identity, hair, and likeness.
IDENTITY (critical): render EXACTLY that one person. Do NOT blend, merge, average, or mix in any other face. It must clearly be the same individual — flattering but unmistakably them.

SHOT: head-and-shoulders portrait, person centred, looking at the camera, relaxed confident professional expression, natural realistic skin texture (not plastic or over-retouched), flattering professional lighting, sharp focus on the eyes.
LOOK: ${styleLine}${custom ? `\nADDITIONAL DIRECTION: ${custom}` : ''}
Do NOT render any text, captions, watermarks, or logos.`

    const imageModel = OpenAIService.imageModel()
    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({ prompt, images: refImages, size, quality: 'high', model: imageModel })

    recordUsage({
      userId: user.id, tier,
      feature: 'photobooth_image', model: imageModel, images: 1,
    })

    return NextResponse.json({
      ok: true,
      image: `data:image/png;base64,${b64}`,
      style: body.style && STYLES[body.style] ? body.style : 'studio',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[photobooth] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
