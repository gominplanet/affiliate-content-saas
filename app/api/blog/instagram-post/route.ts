/**
 * POST /api/blog/instagram-post
 *
 * Publishes a review as a Reel and/or Story on the user's Instagram.
 *
 * Body:
 *   { postId: string, mode: 'reel' | 'story' | 'both' }
 *
 * Tier: Pro-only.
 *
 * Prerequisites checked:
 *   - User is logged in
 *   - Tier allows Instagram (Pro or admin)
 *   - Instagram integration connected (token + user_id stored)
 *   - The associated youtube_videos row has instagram_video_url set
 *     (i.e. user uploaded a vertical MP4 in Studio)
 *   - Token expiry > now (we proactively refresh if < 7 days)
 *
 * Behavior:
 *   - Reel mode: generates a SEO-heavy caption (hook + key points +
 *     hashtags) via Haiku matching brand voice, publishes via Graph API
 *   - Story mode: publishes the video as a Story (no caption visible to
 *     viewers). The Geniuslink affiliate URL is returned in the response
 *     so the frontend can prompt the user to add a link sticker manually
 *     in the IG app (API limitation — link stickers aren't exposed)
 *   - Both: does both sequentially. Returns separate ids.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { publishMedia, refreshLongLivedToken } from '@/services/instagram'
import { createGeniuslinkService } from '@/services/geniuslink'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

const ASIN_RE = /\b([A-Z0-9]{10})\b/

export const maxDuration = 60

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as {
      postId?: string
      mode?: 'reel' | 'story' | 'both'
      dryRun?: boolean      // generate caption + affiliate URL without publishing
      caption?: string      // user-edited caption to use instead of fresh-generating
    }
    const postId = body.postId
    const mode = body.mode ?? 'reel'
    const dryRun = body.dryRun === true
    const overrideCaption = body.caption
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    if (!['reel', 'story', 'both'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be reel | story | both' }, { status: 400 })
    }

    // ── Tier gate + fetch all integration fields we need ────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier,instagram_user_id,instagram_access_token,instagram_token_expiry,instagram_username,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
      .eq('user_id', user.id)
      .single()
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json(
        { error: 'Instagram auto-publish is a Pro plan feature. Upgrade to Pro to post Reels and Stories.' },
        { status: 403 },
      )
    }
    const igUserId = intRow?.instagram_user_id as string | null
    let igToken = intRow?.instagram_access_token as string | null
    const tokenExpiry = intRow?.instagram_token_expiry as number | null
    if (!igUserId || !igToken) {
      return NextResponse.json({ error: 'Instagram not connected. Visit Setup → Integrations to connect your Instagram account.' }, { status: 400 })
    }

    // Refresh token if it's < 7 days from expiry — keeps tokens fresh.
    // Skip on dryRun since we're not calling the IG API at all.
    if (!dryRun && tokenExpiry && tokenExpiry - Date.now() < SEVEN_DAYS_MS) {
      try {
        const refreshed = await refreshLongLivedToken(igToken)
        igToken = refreshed.accessToken
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('integrations')
          .update({ instagram_access_token: refreshed.accessToken, instagram_token_expiry: refreshed.expiresAt })
          .eq('user_id', user.id)
      } catch {
        // Refresh can fail for various reasons (token already expired, etc).
        // Push the existing token and let Instagram tell us if it's bad.
      }
    }

    // ── Fetch post + linked video + brand voice ─────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,video_id,youtube_videos(instagram_video_url,thumbnail_url,title)')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const videoUrl = post.youtube_videos?.instagram_video_url as string | null
    // Skip the video gate during dryRun — the preview step happens BEFORE
    // the user finishes uploading in some flows, and they should still be
    // able to see what caption + affiliate URL we'll generate.
    if (!videoUrl && !dryRun) {
      return NextResponse.json(
        { error: 'No vertical Instagram video uploaded for this review. Open the post in Studio and upload a 9:16 MP4 first.' },
        { status: 400 },
      )
    }

    // Compute the affiliate URL fresh — extract ASIN from the YouTube video
    // title, then wrap with Geniuslink if connected, else fall back to plain
    // Amazon URL (with associates tag if set). Same logic as the YT metadata
    // generation route. Only matters for Stories (Reel captions strip URLs).
    let affiliateUrl = (post.wordpress_url as string | null) || ''
    const ytTitle = post.youtube_videos?.title as string | undefined
    const asinMatch = ytTitle ? ytTitle.match(ASIN_RE) : null
    if (asinMatch) {
      const asin = asinMatch[1]
      if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
        try {
          const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
          affiliateUrl = await genius.createAsinLink(asin, post.title || asin)
        } catch {
          affiliateUrl = `https://www.amazon.com/dp/${asin}${intRow?.amazon_associates_tag ? `?tag=${intRow.amazon_associates_tag}` : ''}`
        }
      } else {
        affiliateUrl = `https://www.amazon.com/dp/${asin}${intRow?.amazon_associates_tag ? `?tag=${intRow.amazon_associates_tag}` : ''}`
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('name,voice_summary')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any
    const voiceNote = brand?.voice_summary ? `\n\nVoice guidance: ${brand.voice_summary}` : ''

    const results: { reelId?: string; storyId?: string; affiliateUrl?: string; reelCaption?: string; warnings: string[] } = { warnings: [] }

    // ── Build the Reel caption ──────────────────────────────────────────────
    // Either uses the user's edited caption (from preview-step) or fresh-generates
    // via Haiku. Caption only relevant for Reel mode (Stories don't show captions).
    let reelCaption: string | null = null
    if (mode === 'reel' || mode === 'both') {
      if (overrideCaption && overrideCaption.trim()) {
        // User-edited from the preview step — use as-is, just enforce hard caps
        reelCaption = overrideCaption.replace(/https?:\/\/\S+/g, '').trim()
        if (reelCaption.length > 2200) reelCaption = reelCaption.slice(0, 2199) + '…'
      } else {
        // Fresh generate
        const plainContent = (post.content as string ?? '').replace(/<[^>]+>/g, '').slice(0, 1500)
        const anthropic = createAnthropicClient()
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          messages: [{
            role: 'user',
            content: `Write an Instagram REEL caption for this product review article.

Style: a content creator's authentic, punchy take. Strong hook in line 1 (max 6 words). 2-3 short value lines below the hook. End with 15-25 hashtags optimized for Instagram SEO — mix of broad high-traffic + niche-specific + product/brand. Match the voice provided.${voiceNote}

Hard rules:
- TOTAL output (text + hashtags) must be under 2000 characters.
- Do NOT include any URL — URLs are not clickable in Reel captions and look unprofessional.
- Plain text only. NO markdown formatting (no **, no _, no [text](link)).
- One emoji at the start of the hook is welcome. Don't pile them on.
- Hashtags go on the last line(s), each prefixed with #, lowercase, no spaces inside the tag.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the caption text + hashtags.`,
          }],
        })

        reelCaption = ((msg.content[0] as { type: string; text: string }).text || '').trim()
        // Defensive: strip any URLs the model snuck in
        reelCaption = reelCaption.replace(/https?:\/\/\S+/g, '').trim()
        if (reelCaption.length > 2200) reelCaption = reelCaption.slice(0, 2199) + '…'
      }
    }

    // ── Dry-run: return preview without publishing ──────────────────────────
    // Caller will surface the caption in an editable textarea + show the
    // affiliate URL, then call this route again WITHOUT dryRun (and with
    // caption: <user-edited>) to actually publish.
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        reelCaption: reelCaption ?? null,
        affiliateUrl: (mode === 'story' || mode === 'both') ? affiliateUrl : null,
      })
    }

    // ── REEL publish ────────────────────────────────────────────────────────
    if (mode === 'reel' || mode === 'both') {
      try {
        const reelId = await publishMedia({
          userId: igUserId,
          accessToken: igToken,
          mediaType: 'REELS',
          videoUrl: videoUrl as string,
          caption: reelCaption ?? '',
          shareToFeed: true,
        })
        results.reelId = reelId
        results.reelCaption = reelCaption ?? undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('blog_posts').update({ instagram_reel_id: reelId }).eq('id', postId)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        results.warnings.push(`Reel publish failed: ${errMsg}`)
      }
    }

    // ── STORY publish ───────────────────────────────────────────────────────
    if (mode === 'story' || mode === 'both') {
      try {
        const storyId = await publishMedia({
          userId: igUserId,
          accessToken: igToken,
          mediaType: 'STORIES',
          videoUrl: videoUrl as string,
          // Stories don't show a caption to viewers; we skip it.
        })
        results.storyId = storyId
        // Return the affiliate URL so the frontend can prompt the user
        // to add a Link sticker manually (API doesn't support sticker
        // attachment for non-verified accounts — Instagram limitation).
        results.affiliateUrl = affiliateUrl
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('blog_posts').update({ instagram_story_id: storyId }).eq('id', postId)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        results.warnings.push(`Story publish failed: ${errMsg}`)
      }
    }

    // Treat as success if at least one of the requested publishes worked
    const anySuccess = results.reelId || results.storyId
    if (!anySuccess) {
      return NextResponse.json({ ok: false, ...results }, { status: 502 })
    }
    return NextResponse.json({ ok: true, ...results })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
