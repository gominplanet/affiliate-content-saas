// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/social-launch-kit/image  { platform, kind: 'banner' | 'avatar' }
//
// Generates an on-brand cover banner or profile avatar in the user's colors,
// cropped to the platform's exact pixel dimensions, and returns it as a base64
// data URL for instant preview + download. Text-free by design (no third-party
// logos/trademarks). The copy comes from /api/social-launch-kit/generate.

import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createServerClient } from '@/lib/supabase/server'
import { spendGate } from '@/lib/ai-spend'
import { recordUsage } from '@/lib/ai-usage'
import { generateWithIdeogram } from '@/lib/thumbnail-generators'
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

  const target = kind === 'banner' ? spec.banner! : spec.avatar
  const prompt = kind === 'banner'
    ? `A clean, modern, professional social media cover banner background for a ${niches} content creator. Tasteful gradient and soft geometric shapes using the brand colors ${primary} and ${secondary}. Generous empty space. Absolutely no text, no words, no letters, no logos, no brand names, no people. Flat, premium, uncluttered, wide landscape composition.`
    : `A minimalist circular brand emblem / app icon for a ${niches} content creator. A simple bold geometric mark centered on a solid ${primary} background with a subtle ${secondary} accent. Flat vector style. Absolutely no text, no words, no letters, no photographs, no third-party logos. Clean, modern, centered composition.`

  // Generate (Ideogram returns a landscape URL). Crop to the exact target size.
  let sourceUrl = ''
  try {
    const out = await generateWithIdeogram({ prompt, numImages: 1 })
    if (!out?.length) throw new Error('no image returned')
    sourceUrl = out[0]
    recordUsage({ userId: user.id, tier, feature: 'social-launch-kit-image', model: 'fal-ideogram-v3', images: 1 })
  } catch (e) {
    return NextResponse.json({ error: `Image generation failed (${e instanceof Error ? e.message : 'unknown'}). Try again in a moment.` }, { status: 502 })
  }

  try {
    const res = await fetch(sourceUrl)
    const buf = Buffer.from(await res.arrayBuffer())
    const png = await sharp(buf)
      .resize(target.w, target.h, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
    const image = `data:image/png;base64,${png.toString('base64')}`
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image })
  } catch {
    // Cropping failed — hand back the raw generated image so the user still gets one.
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, imageUrl: sourceUrl })
  }
}
