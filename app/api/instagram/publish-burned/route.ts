/**
 * POST /api/instagram/publish-burned
 *
 * Publishes an ALREADY-burned Reel to the user's connected Instagram account.
 * This is a separate, explicit step from /api/instagram/burn: the user burns
 * the caption, reviews the preview + composed caption, and only then clicks
 * "Publish to Instagram". Publishing is never automatic — Meta's content
 * publishing policy requires an explicit user action, not auto-posting.
 *
 * Body: { videoUrl: string (the burned video URL), caption?: string }
 * Pro-only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { recordReachSample } from '@/lib/reach-pulse'
import { maybeDecrypt } from '@/lib/secrets'
import { normalizeTier, tierAllowsSocial, type Tier } from '@/lib/tier'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { publishMedia } from '@/services/instagram'
import { autoDmPlan, captionForPlan, finishAutoDm, autoDmWords } from '@/lib/ig-auto-dm'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { toUserMessage } from '@/lib/friendly-error'
import { addProductUrlToBio } from '@/lib/link-bio-import'
import { hasVideoTools } from '@/lib/amazon-plan'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    // A Virtual Assistant publishes through the owner's accounts (lib/agency-publish).
    const pub = await getPublishContext(await createServerClient())
    if ('error' in pub) return pub.error
    const { supabase, user } = pub
    if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Instagram publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,instagram_user_id,instagram_access_token,instagram_username')
      .eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!hasVideoTools(tier)) {
      return NextResponse.json({
        error: 'Publishing clips to Instagram is part of the Pro plan.',
        limitReached: true, cap: 'instagram_burner', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json({ error: 'Instagram publishing requires Pro.' }, { status: 403 })
    }

    const body = await request.json() as {
      videoUrl?: string; caption?: string
      // Optional: the Reel COVER frame, ms into the burned render. Passed straight
      // to publishMedia as thumb_offset so the Reel goes out with the chosen still
      // (the burned URL IS what's published, so the offset can't point at a wrong
      // render). Omitted = Instagram's default first frame.
      thumbOffsetMs?: number
      // The Reel's own Auto-DM (lib/ig-auto-dm): the window's choice, false
      // when unticked, or left out for the automatic one.
      autoDm?: { link?: string; keyword?: string; productName?: string; kind?: string; videoId?: string } | false
      // Clip Factory Enhance-step product: the link (and optional name) the
      // creator typed. When their Link in Bio has auto-import on, we add it as a
      // shop tile. Falls back to the auto-DM link when a dedicated one isn't sent.
      product?: string
      productTitle?: string
      sourceYoutubeVideoId?: string
    }
    const videoUrl = (body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) {
      return NextResponse.json({ error: 'No burned video to publish — burn the caption first.' }, { status: 400 })
    }
    const rawCaption = (body.caption || 'LINK IN BIO').toString().slice(0, 2200)
    const thumbOffsetMs = Number.isFinite(body.thumbOffsetMs) && (body.thumbOffsetMs as number) >= 0
      ? Math.round(body.thumbOffsetMs as number) : undefined

    const igAccount = await resolveSocialAccount(supabase, user.id, 'instagram', {
      allowSelection: true,
      legacy: { externalId: intRow?.instagram_user_id, accessToken: maybeDecrypt(intRow?.instagram_access_token), displayName: intRow?.instagram_username },
    })
    if (!igAccount) {
      return NextResponse.json({ error: 'Instagram not connected — connect it under Setup → Integrations to publish.' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    // AUTO-DM ON EVERY REEL (lib/ig-auto-dm): the window's choice, or this
    // clip's own link with the creator's keyword.
    const dm = body.autoDm
    const dmPlan = await autoDmPlan(sb, {
      userId: user.id, tier, choice: dm,
      find: { videoId: (dm && dm.videoId) || null, product: body.product || null },
      igUserId: igAccount.externalId, accessToken: igAccount.accessToken,
    })
    const caption = captionForPlan(rawCaption, dmPlan)

    try {
      const mediaId = await publishMedia({
        userId: igAccount.externalId,
        accessToken: igAccount.accessToken,
        mediaType: 'REELS',
        videoUrl,
        caption,
        shareToFeed: true,
        thumbOffsetMs,
      })

      // The Reel's own Auto-DM, reported as it went (never assumed).
      const dmOut = await finishAutoDm(sb, dmPlan, {
        userId: user.id, mediaId, caption, videoUrl, productName: (dm && dm.productName) || body.productTitle || null,
        igUserId: igAccount.externalId, accessToken: igAccount.accessToken,
      })
      const autoDm = !!dmOut?.ok
      const autoDmError = dmOut && !dmOut.ok ? dmOut.error : null
      const autoDmKeyword = dmOut?.ok ? dmOut.keyword : null

      // Pulse: record this Reel + its hashtags so the insights job can learn
      // which tags actually earn reach. Best-effort, never blocks the response.
      void recordReachSample({
        userId: user.id,
        mediaId,
        caption,
        productText: ((dm && dm.productName) || '').trim() || null,
      })

      // Feature this product on the Link in Bio page: when the creator opted in,
      // or always when the caption says "link in bio". Never fails a live Reel.
      let bio: Awaited<ReturnType<typeof addProductUrlToBio>> | null = null
      try {
        // Only a product link becomes a shop tile: a DM link that is the blog
        // post or the shop page itself is not a product.
        const dmIsProduct = !(dm && dm.kind) || (dm && dm.kind) === 'amazon'
        const bioUrl = (body.product || '').trim() || (dmIsProduct && dm ? (dm.link || '').trim() : '')
        const bioTitle = (body.productTitle || '').trim() || ((dm && dm.productName) || '').trim()
        bio = await addProductUrlToBio(supabase, user.id, { url: bioUrl, title: bioTitle }, { caption, sourceYoutubeVideoId: body.sourceYoutubeVideoId })
      } catch { /* non-fatal */ }

      return NextResponse.json({ ok: true, published: true, mediaId, autoDm, autoDmError, autoDmKeyword, autoDmLink: dmOut?.ok ? dmOut.link : null, autoDmWords: autoDmWords(dmOut), caption, bio })
    } catch (e) {
      console.error('[instagram/publish-burned] publish failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ ok: false, published: false, error: toUserMessage(e, 'Instagram couldn’t accept the post — please try again in a moment.') }, { status: 502 })
    }
  } catch (err) {
    console.error('[instagram/publish-burned] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Something went wrong publishing to Instagram. Please try again in a moment.') }, { status: 500 })
  }
}
