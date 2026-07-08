// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/social-launch-kit/image  { platform, kind, referenceImage?, headline?, about?, category?, keywords?, brandName? }
//
// Both the cover BANNER and the profile LOGO/avatar are designed by gpt-image-1
// (OpenAI) from a full BRAND BRIEF — the generated copy (name, bio, about,
// category, keywords) fused with everything MVP knows about the creator (niche,
// audience, tone, brand colors, their real logo/banner) — so every asset is
// unique and accurate to THIS brand, not generic. The creator's real logo (and
// any uploaded inspiration image) are passed as visual references so the mark is
// reproduced faithfully. Falls back to Nano Banana Pro / Ideogram if OpenAI is
// unavailable. Output cropped to exact platform dims. Never renders "honest".

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

async function urlToRef(url: string, name: string): Promise<ImgRef | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const mime = r.headers.get('content-type') || 'image/png'
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > 12 * 1024 * 1024) return null
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
    return { data: buf, filename: `${name}.${ext}`, mime }
  } catch { return null }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    platform?: string; kind?: string; referenceImage?: string
    headline?: string; about?: string; category?: string; keywords?: string[]; brandName?: string
  }
  const platform = body.platform as LaunchPlatform
  const spec = platform ? LAUNCH_PLATFORMS[platform] : undefined
  if (!spec) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 })
  const kind: 'banner' | 'avatar' = body.kind === 'avatar' ? 'avatar' : 'banner'
  if (kind === 'banner' && !spec.banner) return NextResponse.json({ error: 'This platform has no cover image.' }, { status: 400 })

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (intRow?.tier as Tier) ?? 'trial'
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

  // "honest" is a banned word — never let it into a baked-text image prompt.
  const strip = (s: unknown) => String(s ?? '').replace(/\bhonest(?:ly)?\b/gi, 'real').replace(/\s{2,}/g, ' ').trim()
  const brandName = strip(body.brandName || b.name) || 'this brand'
  const headline = strip(body.headline || b.tagline || `Real reviews for ${niches}`)
  const about = strip(body.about)
  const category = strip(body.category)
  const keywords = (Array.isArray(body.keywords) ? body.keywords : []).map(strip).filter(Boolean).slice(0, 10)
  const audience = strip(b.target_audience)
  const tone = (Array.isArray(b.tone) ? b.tone : []).filter(Boolean).map(String).join(', ')

  // The full brand brief every image is designed from — copy + profile fused.
  const brief = [
    `BRAND BRIEF (design something unique and accurate to THIS specific brand, not generic):`,
    `Name: ${brandName}${category ? ` — category: ${category}` : ''}.`,
    `Niche: ${niches}.`,
    headline ? `Tagline: "${headline}".` : '',
    about ? `About: ${about}` : '',
    audience ? `Audience: ${audience}.` : '',
    tone ? `Voice / tone: ${tone}.` : '',
    keywords.length ? `Key topics: ${keywords.join(', ')}.` : '',
    `Brand colors: ${primary} (primary) and ${secondary} (accent).`,
  ].filter(Boolean).join(' ')

  const customRef = (body.referenceImage || '').trim()
  const target = kind === 'banner' ? spec.banner! : spec.avatar

  const prompt = kind === 'banner'
    ? [
        brief,
        `Now design a bold, modern, high-energy "viral" ${spec.label} cover banner (wide landscape) for this brand.`,
        (logoUrl || customRef) ? `Place the attached brand LOGO prominently on the left as a glowing badge, reproduced faithfully.` : '',
        `A huge punchy headline in a heavy condensed sans-serif reading "${headline}", with the key words highlighted in ${secondary}.`,
        `A tidy checklist with bold ${secondary} check icons of value props: ${(keywords.slice(0, 3).join(' · ')) || 'Tested in real life · No sponsor bias · Just the truth'}.`,
        `On the right, a dynamic hero shot of real everyday ${niches} products bursting out of an open cardboard shipping box, with energetic paint-splash and halftone accents.`,
        `Small trust badges. Premium near-black background with bold ${secondary} and white. Crisp, perfectly-spelled legible text, professional marketing graphic.`,
        `Compose key elements within a wide central band (top/bottom edges may be cropped). Never render the word "honest".`,
      ].filter(Boolean).join(' ')
    : [
        brief,
        `Now create a polished, professional circular profile picture / logo mark for this brand — a clean, iconic app-badge.`,
        (logoUrl || customRef)
          ? `Reproduce the attached brand mark faithfully, refined and crisp, centered on a solid on-brand background using ${primary} with a ${secondary} accent.`
          : `A bold, simple geometric emblem that represents the brand, centered on a solid ${primary} background with a ${secondary} accent.`,
        `Only include text that appears in the real logo — do not invent new words, letters or gibberish. Perfectly centered, 1:1, high fidelity. Never render the word "honest".`,
      ].filter(Boolean).join(' ')

  // Visual references: uploaded inspiration first, then the real logo (and the
  // header banner too, for covers) so gpt-image-1 stays faithful to the brand.
  const imgRefs: ImgRef[] = []
  const cr = customRef ? dataUrlToRef(customRef) : null
  if (cr) imgRefs.push(cr)
  if (logoUrl) { const lr = await urlToRef(logoUrl, 'logo'); if (lr) imgRefs.push(lr) }
  if (kind === 'banner' && bannerUrl) { const br = await urlToRef(bannerUrl, 'banner'); if (br) imgRefs.push(br) }
  const refs = imgRefs.slice(0, 4)

  let sourceB64 = ''
  let sourceUrl = ''
  let usedModel: 'gpt-image-1' | 'fal-nano-banana-pro' | 'fal-ideogram-v3' = 'gpt-image-1'

  try {
    const openai = createOpenAIService()
    sourceB64 = refs.length
      ? await openai.generateWithReferences({ prompt, images: refs, size: kind === 'banner' ? '1536x1024' : '1024x1024', quality: 'high' })
      : await openai.generateHeroImage(prompt)
    usedModel = 'gpt-image-1'
  } catch {
    // OpenAI unavailable → Nano Banana Pro with the same brief-driven prompt (needs a fal ref).
    const falRefs = [customRef ? await uploadDataUrlToFal(customRef) : null, ...(logoUrl ? await rehostAll([logoUrl]) : [])]
      .filter((u): u is string => !!u)
    if (falRefs.length) {
      const out = await composeWithNanoBananaPro({ prompt, referenceImageUrls: falRefs, aspectRatio: kind === 'banner' ? '16:9' : '1:1', numImages: 1 })
      sourceUrl = out?.[0] || ''
      usedModel = 'fal-nano-banana-pro'
    } else if (kind === 'avatar') {
      const out = await generateWithIdeogram({
        prompt: `A minimalist circular brand emblem / app icon for ${brandName}, a ${niches} brand. A bold geometric mark on a solid ${primary} background with a ${secondary} accent. Flat vector. ABSOLUTELY NO text, words or letters. Clean, centered.`,
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

  try {
    const buf = sourceB64 ? Buffer.from(sourceB64, 'base64') : Buffer.from(await (await fetch(sourceUrl)).arrayBuffer())
    const png = await sharp(buf).resize(target.w, target.h, { fit: 'cover', position: 'attention' }).png().toBuffer()
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image: `data:image/png;base64,${png.toString('base64')}` })
  } catch {
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, ...(sourceUrl ? { imageUrl: sourceUrl } : { image: `data:image/png;base64,${sourceB64}` }) })
  }
}
