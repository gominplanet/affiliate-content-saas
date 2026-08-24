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
import { composeWithNanoBanana, generateWithIdeogram, rehostAll, uploadDataUrlToFal, expandBannerToWidth, generateWideBanner } from '@/lib/thumbnail-generators'
import { createOpenAIService } from '@/services/openai'
import { LAUNCH_PLATFORMS, type LaunchPlatform } from '@/lib/social-launch-kit'
import { buildCoverPrompt, buildAvatarPrompt, buildWideBannerPrompt } from '@/lib/social-launch-kit-prompt'
import { composeWideBanner } from '@/lib/social-launch-kit-banner'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

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
  // Graduated out of Labs 2026-07-08 → available on any PAID plan (not Trial).
  if (!tierAllowsFinders(tier)) {
    return NextResponse.json({ error: 'The Social Launch Kit is available on any paid plan — upgrade to unlock it.' }, { status: 403 })
  }
  // ONE generation per slot (banner / avatar) for everyone except admins. Once a
  // slot is saved, regenerating is admin-only — keeps image costs predictable and
  // the user's saved asset stable. A failed first attempt saves no URL, so retry
  // still works.
  const isAdmin = tier === 'admin'
  if (!isAdmin) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingKit } = await (supabase as any).from('social_launch_kits')
      .select('banner_url, avatar_url').eq('user_id', user.id).eq('platform', platform).maybeSingle()
    const already = kind === 'banner' ? existingKit?.banner_url : existingKit?.avatar_url
    if (already) {
      return NextResponse.json({
        error: `You've already generated your ${kind === 'banner' ? 'cover image' : 'profile image'}. It's saved on the page to use anytime — regenerating is available to admins only.`,
        locked: true,
        imageUrl: already,
      }, { status: 403 })
    }
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
  // Headline: the brand's own tagline; falls back to the brand name (never a
  // review-flavoured default) so any niche gets an accurate headline.
  const headline = strip(body.headline || b.tagline || brandName)
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

  // gpt-image-1 paints 1.5:1; cover-cropping (centre) to a wider banner slices
  // the top+bottom. cropFrac is how much each of top/bottom a cover-crop removes.
  const GEN_ASPECT = 1536 / 1024
  const cropFrac = kind === 'banner' ? Math.max(0, (1 - GEN_ASPECT / (target.w / target.h)) / 2) : 0
  // A cover-crop over ~20% is too much to trust the model with (X/Bluesky 3:1,
  // LinkedIn 4:1). Those banners are placed WHOLE on a blurred fill below —
  // never cropped — so the prompt uses only a small even margin, not a big
  // reserved strip. Milder banners (FB 2.28:1) keep the full-bleed centre crop.
  const useContain = kind === 'banner' && cropFrac > 0.20
  const reservePct = useContain ? 0.06 : Math.min(0.34, Math.max(0.10, cropFrac))

  // Modular prompt engine (lib/social-launch-kit-prompt) — premium cover spec.
  const prompt = kind === 'banner'
    ? buildCoverPrompt({ platformLabel: `${spec.label} cover`, style: bannerStyle, brandName, headline: coverHeadline, industry: niches, sellingPoints, colorLine, hasLogo, context, categories, reservePct, containFill: useContain })
    : buildAvatarPrompt({ brandName, industry: niches, colorLine, hasLogo, context })

  // Visual references: uploaded inspiration first, then the real logo (and the
  // header banner too, for covers) so gpt-image-1 stays faithful to the brand.
  const imgRefs: ImgRef[] = []
  const cr = customRef ? dataUrlToRef(customRef) : null
  if (cr) imgRefs.push(cr)
  const logoRef = logoUrl ? await urlToRef(logoUrl, 'logo') : null
  if (logoRef) imgRefs.push(logoRef)
  if (kind === 'banner' && bannerUrl) { const br = await urlToRef(bannerUrl, 'banner'); if (br) imgRefs.push(br) }
  const refs = imgRefs.slice(0, 4)
  // The logo to drop into the reserved left zone of a native-wide banner: the
  // real brand logo if set, otherwise the uploaded reference image.
  const compositeLogo: ImgRef | null = logoRef || cr

  let sourceB64 = ''
  let sourceUrl = ''
  let usedModel: 'gpt-image-1' | 'fal-nano-banana' | 'fal-ideogram-v3' = 'gpt-image-1'

  // ── HAND-COMPOSITED WIDE PATH ─────────────────────────────────────────────
  // Extreme-wide banners (X/Bluesky 3:1, LinkedIn 4:1): no model renders both an
  // extreme width AND clean text, so Ideogram makes ONLY a text-free dark
  // backdrop + product hero, then composeWideBanner() bakes the headline
  // (opentype vector paths — cannot garble) and composites the creator's real
  // logo. Edge-to-edge, nothing clipped. Falls through to the 1.5:1 path on any
  // failure.
  let nativeWide: Buffer | null = null
  if (useContain) {
    const widePrompt = buildWideBannerPrompt({
      platformLabel: `${spec.label} cover`, style: bannerStyle, brandName,
      headline: coverHeadline, industry: niches, sellingPoints, colorLine,
      hasLogo: !!compositeLogo, context, categories,
    })
    const wideUrl = await generateWideBanner(widePrompt)
    if (wideUrl) {
      try {
        const bg = Buffer.from(await (await fetch(wideUrl)).arrayBuffer())
        nativeWide = await composeWideBanner({
          background: bg,
          logo: compositeLogo?.data ?? null,
          headline: coverHeadline,
          accentColor: hasColors ? secondary : undefined,   // their accent, else all-white (no imposed gold)
          targetW: target.w,
          targetH: target.h,
        })
        usedModel = 'fal-ideogram-v3'
      } catch (e) { console.warn('[launch-kit] hand-composite failed:', e); nativeWide = null }
    }
  }

  if (!nativeWide) try {
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
      // Fallback: regular Nano Banana ($0.039), not the $0.13 Pro tier (dropped 2026-08).
      const out = await composeWithNanoBanana({ prompt, referenceImageUrls: falRefs, aspectRatio: kind === 'banner' ? '16:9' : '1:1', numImages: 1 })
      sourceUrl = out?.[0] || ''
      usedModel = 'fal-nano-banana'
    } else if (kind === 'avatar') {
      const out = await generateWithIdeogram({
        prompt: `A minimalist circular brand emblem / app icon for ${brandName}, a ${niches} brand. A bold geometric mark on a solid ${primary} background with a ${secondary} accent. Flat vector. ABSOLUTELY NO text, words or letters. Clean, centered.`,
        numImages: 1,
      })
      sourceUrl = out?.[0] || ''
      usedModel = 'fal-ideogram-v3'
    }
  }

  if (!nativeWide && !sourceB64 && !sourceUrl) {
    return NextResponse.json({
      error: (logoUrl || bannerUrl || customRef)
        ? 'Image generation failed — try again in a moment.'
        : 'Add your logo in Brand Profile, or upload a reference image, so MVP has something to build on.',
    }, { status: 502 })
  }

  recordUsage({ userId: user.id, tier, feature: 'social-launch-kit-image', model: usedModel, images: 1 })

  try {
    let png: Buffer
    let mode: 'crop' | 'expand' | 'contain-fallback' | 'native-wide' = 'crop'
    if (nativeWide) {
      // Best path: banner was generated natively wide (3:1) + logo composited +
      // cropped to exact dims — already the final image, fills edge-to-edge.
      png = nativeWide
      mode = 'native-wide'
    } else {
    const buf = sourceB64 ? Buffer.from(sourceB64, 'base64') : Buffer.from(await (await fetch(sourceUrl)).arrayBuffer())
    if (useContain) {
      // Extreme-wide banner: EXPAND-TO-FIT. Outpaint the design out to the full
      // banner width so it fills edge-to-edge — nothing cropped, no bars, native
      // look. Falls back to a contain + blurred-fill compose if the outpaint is
      // unavailable (still guaranteed no clip).
      let expanded: Buffer | null = null
      const expandedUrl = await expandBannerToWidth(`data:image/png;base64,${buf.toString('base64')}`, target.w, target.h)
      if (expandedUrl) {
        try {
          const eb = Buffer.from(await (await fetch(expandedUrl)).arrayBuffer())
          expanded = await sharp(eb).resize(target.w, target.h, { fit: 'cover', position: 'centre' }).png().toBuffer()
          recordUsage({ userId: user.id, tier, feature: 'social-launch-kit-image', model: 'fal-ideogram-v3', images: 1 })
        } catch (e) { console.warn('[launch-kit] expand post-process failed:', e); expanded = null }
      }
      if (expanded) {
        png = expanded
        mode = 'expand'
      } else {
        // Deterministic full-bleed fallback (no AI, no bars): scale the design to
        // the banner HEIGHT, then EXTEND its own left/right edge pixels outward to
        // fill the width. Because the design keeps a background margin at its
        // edges, the extension is seamless dark background — never black bars,
        // never clipped content.
        const design = await sharp(buf).resize({ height: target.h }).png().toBuffer()
        const dw = (await sharp(design).metadata()).width ?? target.w
        if (dw >= target.w) {
          png = await sharp(design).resize(target.w, target.h, { fit: 'cover', position: 'centre' }).png().toBuffer()
        } else {
          const gapL = Math.floor((target.w - dw) / 2)
          const gapR = target.w - dw - gapL
          png = await sharp(design)
            .extend({ left: gapL, right: gapR, extendWith: 'copy' })
            .resize(target.w, target.h, { fit: 'cover', position: 'centre' })
            .png().toBuffer()
        }
        mode = 'contain-fallback'
      }
    } else {
      // Milder banners + avatars: deterministic centre cover-crop (the prompt
      // reserves a matching top/bottom safe band, so nothing important is cut).
      png = await sharp(buf).resize(target.w, target.h, { fit: 'cover', position: 'centre' }).png().toBuffer()
    }
    }
    // One clear log line so we can tell exactly which framing path ran (and
    // whether fal creds are present) without guessing from screenshots.
    console.log('[launch-kit] banner', JSON.stringify({ platform, kind, w: target.w, h: target.h, cropFrac: Number(cropFrac.toFixed(2)), useContain, mode, usedModel, hasFalKey: !!process.env.FAL_KEY }))
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    // Persist to durable storage + save the URL so this image stays on the page
    // across sessions (one saved slot per user+platform+kind). Best-effort — we
    // still return the base64 for instant display even if the save fails.
    let savedUrl: string | null = null
    try {
      savedUrl = await uploadDataUrlToFal(dataUrl)
      if (savedUrl) {
        const col = kind === 'banner' ? 'banner_url' : 'avatar_url'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('social_launch_kits')
          .upsert({ user_id: user.id, platform, [col]: savedUrl, updated_at: new Date().toISOString() }, { onConflict: 'user_id,platform' })
      }
    } catch { /* persistence is best-effort */ }
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image: dataUrl, imageUrl: savedUrl || undefined })
  } catch {
    if (nativeWide) return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, image: `data:image/png;base64,${nativeWide.toString('base64')}` })
    return NextResponse.json({ ok: true, platform, kind, width: target.w, height: target.h, ...(sourceUrl ? { imageUrl: sourceUrl } : { image: `data:image/png;base64,${sourceB64}` }) })
  }
}
