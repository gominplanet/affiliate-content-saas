/**
 * POST /api/instagram/burn
 *
 * Instagram Burner — takes a user-uploaded video (public URL), burns a styled
 * caption (e.g. "LINK IN BIO") into it via Cloudinary, optionally researches a
 * product (ASIN or URL) to compose a Reel caption (3 niche hashtags + FTC
 * disclaimer), and auto-publishes the Reel to the connected Instagram account.
 * Pro-only. Returns the burned video URL + the composed caption + publish status.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, tierAllowsSocial, type Tier } from '@/lib/tier'
import { cloudinaryConfigured, overlayCaptionOnVideo, type OverlayPosition, type CaptionStyle } from '@/services/cloudinary'
import { recordUsage, recordAnthropicUsage } from '@/lib/ai-usage'
import { createAnthropicClient } from '@/lib/anthropic'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { researchProductFromUrl } from '@/services/research'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { publishMedia } from '@/services/instagram'

export const maxDuration = 300

const POSITIONS: OverlayPosition[] = ['lower-third', 'center']
const STYLES: CaptionStyle[] = ['white-pill', 'black-pill', 'yellow-pill', 'white-shadow']

/** Compose a punchy IG Reel caption from product context: hook + value + 3
 *  niche hashtags + an #ad FTC disclaimer. Best-effort. */
async function composeReelCaption(productContext: string, ctx: { userId: string; tier: string }): Promise<string | null> {
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write an Instagram Reel caption promoting this product.

PRODUCT:
${productContext.slice(0, 1500)}

RULES:
- Strong hook on line 1 (max 7 words), then 1-2 short punchy value lines.
- Conversational creator voice, a couple of emojis max.
- Then EXACTLY 3 hashtags — SPECIFIC and niche to this product/topic (e.g. #coldbrewmaker), NOT generic spam (#amazonfinds, #musthave).
- Do NOT include any URL (not clickable on IG). You may say "link in bio".
- Never use the word "honest".
- Under 600 characters total.

Return ONLY the caption text + the 3 hashtags.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier, feature: 'ig_burn_caption', model: 'claude-haiku-4-5-20251001' })
    let text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    text = text.replace(/\bhonest(ly)?\b/gi, '').replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()
    // FTC disclosure for an affiliate/product reel.
    if (!/#ad\b/i.test(text)) text = `${text}\n\n#ad`
    return text || null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
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
      product?: string; autoPublish?: boolean
    }
    const videoUrl = (body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'Upload a video first.' }, { status: 400 })
    const overlayText = (body.caption || 'LINK IN BIO').trim().slice(0, 60) || 'LINK IN BIO'
    const position = (POSITIONS.includes(body.position as OverlayPosition) ? body.position : 'lower-third') as OverlayPosition
    const style = (STYLES.includes(body.style as CaptionStyle) ? body.style : 'white-pill') as CaptionStyle
    const productInput = (body.product || '').trim()
    const autoPublish = body.autoPublish !== false

    // ── 1. Burn the styled caption into the video (1080×1920) ─────────────────
    const burned = await overlayCaptionOnVideo(videoUrl, overlayText, { position, style })
    if (!burned?.url) {
      return NextResponse.json({ error: 'Could not burn the caption onto the video. Please try again.' }, { status: 500 })
    }
    recordUsage({ userId: user.id, tier, feature: 'instagram_burn', model: 'cloudinary', images: 1 })

    // ── 2. Research the product (if given) + compose the Reel caption ─────────
    let productContext = ''
    if (productInput) {
      const asin = extractAsin(productInput)
      if (asin) {
        try {
          const p = await fetchAmazonProduct(asin)
          productContext = [p.title, (p.bullets || []).slice(0, 4).join(' · '), (p.description || '').slice(0, 400)].filter(Boolean).join('\n')
        } catch { /* fall through */ }
      }
      if (!productContext && /^https?:\/\//i.test(productInput)) {
        try { productContext = await researchProductFromUrl(productInput, '', { userId: user.id, tier }) } catch { /* fall through */ }
      }
      if (!productContext) productContext = productInput // last resort: raw hint
    }
    const composedCaption = productContext ? await composeReelCaption(productContext, { userId: user.id, tier }) : null

    // ── 3. Auto-publish the Reel to the connected Instagram account ───────────
    let published = false
    let igError: string | null = null
    if (autoPublish) {
      if (!tierAllowsSocial(tier, 'instagram')) {
        igError = 'Instagram publishing requires Pro.'
      } else {
        const igAccount = await resolveSocialAccount(supabase, user.id, 'instagram', {
          allowSelection: true,
          legacy: { externalId: intRow?.instagram_user_id, accessToken: intRow?.instagram_access_token, displayName: intRow?.instagram_username },
        })
        if (!igAccount) {
          igError = 'Instagram not connected — connect it under Setup → Integrations to auto-publish.'
        } else {
          try {
            await publishMedia({
              userId: igAccount.externalId,
              accessToken: igAccount.accessToken,
              mediaType: 'REELS',
              videoUrl: burned.url,
              caption: composedCaption ?? `${overlayText}`,
              shareToFeed: true,
            })
            published = true
          } catch (e) {
            igError = e instanceof Error ? e.message : String(e)
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      url: burned.url,
      caption: composedCaption,
      published,
      igError,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instagram/burn] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
