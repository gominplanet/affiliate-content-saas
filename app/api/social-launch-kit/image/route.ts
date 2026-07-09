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
import { buildCoverPrompt, buildAvatarPrompt } from '@/lib/social-launch-kit-prompt'
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
    platform?: string; kind?: string; referenceImage?: string; style?: string
    headline?: string; about?: string; category?: string; keywords?: string[]; brandName?: string
  }
  const bannerStyle: 'bold' | 'minimal' = body.style === 'minimal' ? 'minimal' : 'bold'
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
  // Adapt to EACH brand's colours. Fallbacks are neutral (NOT a Gomin-style
  // black+gold) so a brand that hasn't set colours doesn't inherit another
  // brand's look — the prompt tells the model to pull colours from their logo.
  const hasColors = !!(String(b.primary_color || '').trim() && String(b.secondary_color || '').trim())
  const primary = String(b.primary_color || '').trim() || '#1F2937'
  const secondary = String(b.secondary_color || '').trim() || '#6366F1'
  const colorLine = hasColors
    ? `Use this brand's own colours: ${primary} (primary) and ${secondary} (accent).`
    : `Use this brand's OWN colours, drawn from the attached logo — do NOT impose black-and-gold or any preset palette.`
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

  const customRef = (body.referenceImage || '').trim()
  const target = kind === 'banner' ? spec.banner! : spec.avatar
  const hasLogo = !!(logoUrl || customRef)

  // Compact brand context (for accuracy) + a short, punchy cover headline.
  const context = [
    `${brandName}${category ? ` (${category})` : ''}`,
    `a ${niches} brand`,
    audience ? `for ${audience}` : '',
    about ? `— ${about}` : '',
    tone ? `Voice: ${tone}.` : '',
  ].filter(Boolean).join(' ')
  const coverHeadline = ((headline.split(/[.!?•|]/)[0] || headline).trim().split(/\s+/).slice(0, 8).join(' ')) || headline
  const sellingPoints = keywords.length ? keywords.slice(0, 5) : ['Tested', 'No sponsor bias', 'Just the truth']

  // The brand's ACTUAL content mix: rank their declared categories by how often
  // they appear in the user's real published post titles (dominant first), so
  // the cover's product scene leans into what they truly publish most. Banner only.
  let categories: string[] = []
  if (kind === 'banner') {
    const declared = Array.from(new Set([
      ...(Array.isArray(b.niches) ? b.niches : []),
      ...(Array.isArray(b.custom_categories) ? b.custom_categories : []),
    ].map(c => String(c || '').trim()).filter(Boolean)))
    categories = declared.slice(0, 5)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: recent } = await (supabase as any).from('blog_posts')
        .select('title').eq('user_id', user.id).order('created_at', { ascending: false }).limit(80)
      const titles = ((recent ?? []) as { title?: string }[]).map(r => String(r.title || '').toLowerCase())
      if (titles.length && declared.length) {
        const score = (cat: string) => {
          const words = cat.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !['and', 'the', 'for'].includes(w))
          return titles.filter(t => words.some(w => t.includes(w))).length
        }
        const ranked = declared.map(c => ({ c, n: score(c) })).sort((x, y) => y.n - x.n)
        if ((ranked[0]?.n ?? 0) > 0) categories = ranked.map(r => r.c).slice(0, 5)
      }
    } catch { /* fall back to declared order */ }
  }

  // gpt-image-1 paints 1.5:1; cover-cropping (centre) to the wider banner slices
  // the top+bottom. Reserve exactly that fraction so the safe-band prompt lines
  // up with the crop — wider banners (X/Bluesky 3:1, LinkedIn 4:1) reserve more
  // than Facebook's 2.28:1, so text/products never land in the cropped strip.
  const GEN_ASPECT = 1536 / 1024
  const reservePct = Math.min(0.34, Math.max(0.10, (1 - GEN_ASPECT / (target.w / target.h)) / 2))

  // Modular prompt engine (lib/social-launch-kit-prompt) — premium cover spec.
  const prompt = kind === 'banner'
    ? buildCoverPrompt({ platformLabel: `${spec.label} cover`, style: bannerStyle, brandName, headline: coverHeadline, industry: niches, sellingPoints, colorLine, hasLogo, context, categories, reservePct })
    : buildAvatarPrompt({ brandName, industry: niches, colorLine, hasLogo, context })

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
    // Center crop (not 'attention'): the prompt reserves a central safe band and
    // pads the top/bottom, so a deterministic middle crop trims exactly those
    // margins — 'attention' could shift the crop and slice through the headline.
    const png = await sharp(buf).resize(target.w, target.h, { fit: 'cover', position: 'centre' }).png().toBuffer()
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image: `data:image/png;base64,${png.toString('base64')}` })
  } catch {
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, ...(sourceUrl ? { imageUrl: sourceUrl } : { image: `data:image/png;base64,${sourceB64}` }) })
  }
}
