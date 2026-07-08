// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/social-launch-kit/image  { platform, kind: 'banner' | 'avatar' }
//
// Generates an on-brand cover banner or profile avatar, GROUNDED in the user's
// real uploaded brand assets (logo + header banner) — those are the reference
// images, so the result reflects their actual logo, colors and style instead of
// a random abstract picture. Cropped to the platform's exact pixel dimensions
// and returned as a base64 data URL for instant preview + download.
//
// Uses Nano Banana Pro (Gemini 3 Pro) with the assets as image references — it
// reproduces the real logo faithfully and, unlike Ideogram, does NOT invent
// gibberish text. Falls back to a text-free Ideogram background only when the
// user has no logo/banner on file.

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createServerClient } from '@/lib/supabase/server'
import { spendGate } from '@/lib/ai-spend'
import { recordUsage } from '@/lib/ai-usage'
import { composeWithNanoBananaPro, generateWithIdeogram, rehostAll } from '@/lib/thumbnail-generators'
import { LAUNCH_PLATFORMS, type LaunchPlatform } from '@/lib/social-launch-kit'
import type { Tier } from '@/lib/tier'

export const maxDuration = 180

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { platform?: string; kind?: string }
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
  const primary = String(b.primary_color || '').trim() || '#7C3AED'
  const secondary = String(b.secondary_color || '').trim() || '#22D3EE'
  const niches = (Array.isArray(b.niches) ? b.niches : []).filter(Boolean).join(', ') || 'lifestyle products'
  const logoUrl = String(b.logo_url || '').trim()
  const bannerUrl = String(b.header_banner_url || '').trim()

  const target = kind === 'banner' ? spec.banner! : spec.avatar

  // Reference assets = the user's real brand. Banner leans on the header banner
  // then the logo; avatar leans on the logo. Rehost to fal so the model can read
  // them (WordPress / Supabase URLs aren't always fal-reachable directly).
  const refCandidates = kind === 'banner'
    ? [bannerUrl, logoUrl].filter(Boolean)
    : [logoUrl].filter(Boolean)
  const refs = refCandidates.length ? await rehostAll(refCandidates) : []

  let sourceUrl = ''
  let usedModel: 'fal-nano-banana-pro' | 'fal-ideogram-v3' = 'fal-nano-banana-pro'

  if (refs.length) {
    // GROUNDED path — build ON the user's real assets.
    const prompt = kind === 'banner'
      ? `Using the attached brand assets (the creator's real logo and/or banner) as the visual reference, design a clean, modern ${spec.label} cover banner in THIS brand's exact colors (${primary}, ${secondary}) and style. Extend the brand look into a wide banner: tasteful shapes, plenty of empty space, a clear horizontal center safe zone. You MAY place the brand's real logo/mark tastefully. Do NOT invent any text, words, letters, slogans or gibberish — only the real mark and color. Premium, uncluttered, wide landscape.`
      : `Using the attached brand logo as the reference, create a clean circular profile picture / app icon for this ${niches} creator. Center the brand's real mark on a solid on-brand background using ${primary}. Do NOT invent any text, words, letters or gibberish — reproduce the real mark faithfully, nothing else. Crisp, modern, perfectly centered, 1:1.`
    const out = await composeWithNanoBananaPro({ prompt, referenceImageUrls: refs, aspectRatio: kind === 'banner' ? '16:9' : '1:1', numImages: 1 })
    sourceUrl = out?.[0] || ''
  }

  if (!sourceUrl) {
    // FALLBACK — no brand assets on file (or the grounded call failed). Text-free
    // branded background so it never renders the gibberish Ideogram is prone to.
    usedModel = 'fal-ideogram-v3'
    const prompt = kind === 'banner'
      ? `A clean, modern ${spec.label} cover banner background for a ${niches} creator. Tasteful gradient and soft geometric shapes in ${primary} and ${secondary}. Generous empty space. ABSOLUTELY NO text, no words, no letters, no typography, no logos, no people. Flat, premium, wide landscape.`
      : `A minimalist circular brand emblem / app icon for a ${niches} creator. A simple bold geometric mark on a solid ${primary} background with a ${secondary} accent. Flat vector. ABSOLUTELY NO text, no words, no letters, no photographs. Clean, centered.`
    const out = await generateWithIdeogram({ prompt, numImages: 1 })
    sourceUrl = out?.[0] || ''
  }

  if (!sourceUrl) {
    return NextResponse.json({
      error: logoUrl || bannerUrl
        ? 'Image generation failed — try again in a moment.'
        : 'Add your logo (and/or a banner) in Brand Profile so MVP can build on-brand images, then try again.',
    }, { status: 502 })
  }

  recordUsage({ userId: user.id, tier, feature: 'social-launch-kit-image', model: usedModel, images: 1 })

  // Crop to the platform's exact dimensions.
  try {
    const res = await fetch(sourceUrl)
    const buf = Buffer.from(await res.arrayBuffer())
    const png = await sharp(buf)
      .resize(target.w, target.h, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
    const image = `data:image/png;base64,${png.toString('base64')}`
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image, grounded: usedModel === 'fal-nano-banana-pro' })
  } catch {
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, imageUrl: sourceUrl, grounded: usedModel === 'fal-nano-banana-pro' })
  }
}
