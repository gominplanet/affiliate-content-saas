// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/social-launch-kit/image  { platform, kind, referenceImage?, headline?, features?, brandName? }
//
// COVER BANNER → a rich, designed, "viral" marketing graphic via gpt-image-1
// (OpenAI, the model that reliably bakes legible headlines + composes a real
// layout): the creator's logo placed on it, a bold headline, a value-prop
// checklist, a product hero shot, trust badges — in their brand colors.
// AVATAR → the creator's real logo/mark, grounded via Nano Banana Pro.
//
// Every image can also be steered by a user-uploaded inspiration image. Output
// is cropped to the platform's exact pixel size and returned as a base64 data
// URL. Never renders the banned word "honest".

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createServerClient } from '@/lib/supabase/server'
import { spendGate } from '@/lib/ai-spend'
import { recordUsage } from '@/lib/ai-usage'
import { composeWithNanoBananaPro, generateWithIdeogram, rehostAll, uploadDataUrlToFal } from '@/lib/thumbnail-generators'
import { createOpenAIService } from '@/services/openai'
import { LAUNCH_PLATFORMS, type LaunchPlatform } from '@/lib/social-launch-kit'
import type { Tier } from '@/lib/tier'

export const maxDuration = 180

type ImgRef = { data: Buffer; filename: string; mime: string }

function dataUrlToRef(dataUrl: string): ImgRef | null {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec((dataUrl || '').trim())
  if (!m) return null
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > 12 * 1024 * 1024) return null
  return { data: buf, filename: 'reference.png', mime: m[1] || 'image/png' }
}

async function urlToRef(url: string): Promise<ImgRef | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const mime = r.headers.get('content-type') || 'image/png'
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > 12 * 1024 * 1024) return null
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
    return { data: buf, filename: `logo.${ext}`, mime }
  } catch { return null }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    platform?: string; kind?: string; referenceImage?: string
    headline?: string; features?: string[]; brandName?: string
  }
  const platform = body.platform as LaunchPlatform
  const spec = platform ? LAUNCH_PLATFORMS[platform] : undefined
  if (!spec) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 })
  const kind: 'banner' | 'avatar' = body.kind === 'avatar' ? 'avatar' : 'banner'
  if (kind === 'banner' && !spec.banner) return NextResponse.json({ error: 'This platform has no cover image.' }, { status: 400 })

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (intRow?.tier as Tier) ?? 'trial'
  // Labs — Pro-only until it graduates public (same gate as MVP x LTK).
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'The Social Launch Kit is a Pro Labs feature.' }, { status: 403 })
  }
  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any).from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
  const b = (brand ?? {}) as Record<string, unknown>
  const primary = String(b.primary_color || '').trim() || '#111111'
  const secondary = String(b.secondary_color || '').trim() || '#F5B301'
  const niches = (Array.isArray(b.niches) ? b.niches : []).filter(Boolean).join(', ') || 'lifestyle products'
  const logoUrl = String(b.logo_url || '').trim()
  const bannerUrl = String(b.header_banner_url || '').trim()
  const brandName = String(body.brandName || b.name || '').trim() || 'this brand'
  // "honest" is a banned word — never let it into a baked-text image prompt.
  const strip = (s: string) => s.replace(/\bhonest(?:ly)?\b/gi, 'real').replace(/\s{2,}/g, ' ').trim()
  const headline = strip(String(body.headline || b.tagline || `Real reviews for ${niches}`))
  const features = (Array.isArray(body.features) ? body.features : []).map(f => strip(String(f))).filter(Boolean).slice(0, 3)

  const target = kind === 'banner' ? spec.banner! : spec.avatar
  const customRef = (body.referenceImage || '').trim()

  let sourceB64 = ''   // gpt-image-1 (base64)
  let sourceUrl = ''   // fal (hosted URL)
  let usedModel: 'gpt-image-1' | 'fal-nano-banana-pro' | 'fal-ideogram-v3' = 'gpt-image-1'

  if (kind === 'banner') {
    // ── Rich designed cover via gpt-image-1 ────────────────────────────────
    const featureLine = features.length
      ? `A tidy checklist of these value props, each with a bold ${secondary} check icon: ${features.join(' · ')}.`
      : `A tidy checklist with bold ${secondary} check icons: "Tested in real life" · "No sponsor bias" · "Just the truth".`
    const prompt = [
      `Design a bold, modern, high-energy "viral" Facebook cover banner (wide landscape) for "${brandName}", a ${niches} brand.`,
      logoUrl || customRef ? `Place the attached brand LOGO prominently on the left as a glowing badge, reproduced faithfully.` : '',
      `A huge punchy headline in a heavy condensed sans-serif reading "${headline}", with the key words highlighted in the brand's ${secondary}.`,
      featureLine,
      `On the right, a dynamic hero shot of real everyday products bursting out of an open cardboard shipping box, with energetic paint-splash and halftone accents.`,
      `Small trust badges like "Tested & Trusted" and "Trusted by thousands".`,
      `Premium near-black background with bold ${secondary} and white. Crisp, perfectly-spelled legible text, sticker / paint-stroke accents, professional marketing graphic.`,
      `Compose all key elements within a wide central horizontal band (the top and bottom edges may be cropped) so nothing important is lost. Never render the word "honest".`,
    ].filter(Boolean).join(' ')

    try {
      const openai = createOpenAIService()
      const refs: ImgRef[] = []
      const cr = customRef ? dataUrlToRef(customRef) : null
      if (cr) refs.push(cr)
      if (logoUrl) { const lr = await urlToRef(logoUrl); if (lr) refs.push(lr) }
      sourceB64 = refs.length
        ? await openai.generateWithReferences({ prompt, images: refs, size: '1536x1024', quality: 'high' })
        : await openai.generateHeroImage(prompt)
      usedModel = 'gpt-image-1'
    } catch {
      // gpt-image-1 unavailable → Nano Banana Pro with the same rich prompt (needs a fal ref).
      const falRefs = [customRef ? await uploadDataUrlToFal(customRef) : null, ...(logoUrl ? await rehostAll([logoUrl]) : [])]
        .filter((u): u is string => !!u)
      if (falRefs.length) {
        const out = await composeWithNanoBananaPro({ prompt, referenceImageUrls: falRefs, aspectRatio: '16:9', numImages: 1 })
        sourceUrl = out?.[0] || ''
        usedModel = 'fal-nano-banana-pro'
      }
    }
  } else {
    // ── Avatar → the real logo/mark, grounded via Nano Banana Pro ──────────
    const refs = [
      customRef ? await uploadDataUrlToFal(customRef) : null,
      ...(logoUrl ? await rehostAll([logoUrl]) : []),
    ].filter((u): u is string => !!u).slice(0, 3)
    if (refs.length) {
      const lead = customRef ? 'Use the FIRST attached image as the primary inspiration. ' : ''
      const prompt = `${lead}Using the attached brand logo as the reference, create a clean circular profile picture / app icon for this ${niches} creator, the real mark centered on a solid on-brand background using ${primary}. Reproduce the mark faithfully. Never invent any text, words, letters or gibberish. Crisp, modern, perfectly centered, 1:1.`
      const out = await composeWithNanoBananaPro({ prompt, referenceImageUrls: refs, aspectRatio: '1:1', numImages: 1 })
      sourceUrl = out?.[0] || ''
      usedModel = 'fal-nano-banana-pro'
    } else {
      const out = await generateWithIdeogram({
        prompt: `A minimalist circular brand emblem / app icon for a ${niches} creator. A bold geometric mark on a solid ${primary} background with a ${secondary} accent. Flat vector. ABSOLUTELY NO text, no words, no letters. Clean, centered.`,
        numImages: 1,
      })
      sourceUrl = out?.[0] || ''
      usedModel = 'fal-ideogram-v3'
    }
  }

  if (!sourceB64 && !sourceUrl) {
    return NextResponse.json({
      error: (logoUrl || bannerUrl || customRef)
        ? 'Image generation failed — try again in a moment.'
        : 'Add your logo in Brand Profile, or upload a reference image, so MVP has something to build on.',
    }, { status: 502 })
  }

  recordUsage({ userId: user.id, tier, feature: 'social-launch-kit-image', model: usedModel, images: 1 })

  // Crop to the platform's exact dimensions.
  try {
    const buf = sourceB64
      ? Buffer.from(sourceB64, 'base64')
      : Buffer.from(await (await fetch(sourceUrl)).arrayBuffer())
    const png = await sharp(buf).resize(target.w, target.h, { fit: 'cover', position: 'attention' }).png().toBuffer()
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image: `data:image/png;base64,${png.toString('base64')}` })
  } catch {
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, ...(sourceUrl ? { imageUrl: sourceUrl } : { image: `data:image/png;base64,${sourceB64}` }) })
  }
}
