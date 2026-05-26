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
import { normalizeTier, tierAllowsSocial, type Tier } from '@/lib/tier'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { publishMedia } from '@/services/instagram'
import { metaEnabled } from '@/lib/feature-flags'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!metaEnabled({ email: user.email })) return NextResponse.json({ error: 'Instagram publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier,instagram_user_id,instagram_access_token,instagram_username')
      .eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Instagram publishing is a Pro feature.',
        limitReached: true, cap: 'instagram_burner', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json({ error: 'Instagram publishing requires Pro.' }, { status: 403 })
    }

    const body = await request.json() as { videoUrl?: string; caption?: string }
    const videoUrl = (body.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) {
      return NextResponse.json({ error: 'No burned video to publish — burn the caption first.' }, { status: 400 })
    }
    const caption = (body.caption || 'LINK IN BIO').toString().slice(0, 2200)

    const igAccount = await resolveSocialAccount(supabase, user.id, 'instagram', {
      allowSelection: true,
      legacy: { externalId: intRow?.instagram_user_id, accessToken: intRow?.instagram_access_token, displayName: intRow?.instagram_username },
    })
    if (!igAccount) {
      return NextResponse.json({ error: 'Instagram not connected — connect it under Setup → Integrations to publish.' }, { status: 400 })
    }

    try {
      await publishMedia({
        userId: igAccount.externalId,
        accessToken: igAccount.accessToken,
        mediaType: 'REELS',
        videoUrl,
        caption,
        shareToFeed: true,
      })
      return NextResponse.json({ ok: true, published: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[instagram/publish-burned] publish failed:', msg)
      return NextResponse.json({ ok: false, published: false, error: msg }, { status: 502 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instagram/publish-burned] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
