// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/clip-factory/facebook-reel — publish a Clip Factory clip as a
// Reel on the creator's Facebook Page (lib/facebook-reels).
//   body: { videoUrl, description, socialAccountId?, dryRun?, sourceVideoId?,
//           product?, productName? }
//
// dryRun builds the description (lib/reel-caption: product link in the
// creator's link style, the full review, the disclosure) and returns it with
// what was found, so the page shows it before anything posts. The real post
// then sends exactly the text the creator saw, edits included.
//
// LABS, admin only while it is tested (lib/labs-preview facebook_reels).

import { trackPost } from '@/lib/reach-pulse'
import { cleanNicheGroup } from '@/lib/facebook-niche'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { normalizeTier, socialAccountCap } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolveSocialAccounts } from '@/lib/social-accounts'
import { publishPageReel, publishPageVideo, reelState, REEL_MAX_SEC } from '@/lib/facebook-reels'
import { buildReelCaption } from '@/lib/reel-caption'
import { facebookReelOrder } from '@/lib/reel-group-caption'
import { fitHashtags } from '@/lib/hashtag-engine'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'

export const runtime = 'nodejs'
export const maxDuration = 300

// GET: where a Reel can go. The Pages this account can post to (the one used
// when none is picked comes first, marked default), and the Facebook Groups
// saved in Brand Profile, which a Reel can be shared into with SCOUT after it
// is up on the Page (Meta lets no app post into a Group).
export async function GET() {
  // A Virtual Assistant sees the owner's (lib/agency-publish).
  const pub = await getPublishContext(await createServerClient(), 'view')
  if ('error' in pub) return pub.error
  const { supabase, user } = pub
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: intRow }, { data: rows }, { data: brand }] = await Promise.all([
    sb.from('integrations').select('facebook_page_id,facebook_page_access_token,facebook_page_name,tier').eq('user_id', user.id).maybeSingle(),
    sb.from('social_accounts').select('id,display_name,is_default').eq('user_id', user.id).eq('platform', 'facebook').order('is_default', { ascending: false }),
    sb.from('brand_profiles').select('facebook_groups').eq('user_id', user.id).maybeSingle(),
  ])
  const integration = decryptIntegrationRow(intRow)
  const [def] = await resolveSocialAccounts(supabase, user.id, 'facebook', {
    socialAccountIds: [], allowSelection: false, limit: socialAccountCap(normalizeTier(integration?.tier)),
    legacy: { externalId: integration?.facebook_page_id, accessToken: integration?.facebook_page_access_token, displayName: integration?.facebook_page_name },
  })
  const pages = ((rows ?? []) as Array<{ id: string; display_name: string | null; is_default: boolean }>).map((r) => ({ id: r.id, name: r.display_name || 'Facebook Page', isDefault: !!r.is_default }))
  if (!pages.length && def) pages.push({ id: '', name: def.displayName || 'your Facebook Page', isDefault: true })
  const groups = (Array.isArray(brand?.facebook_groups) ? brand.facebook_groups : [])
    .filter((g: { url?: string }) => typeof g?.url === 'string' && /facebook\.com\/groups\//i.test(g.url))
    .map((g: unknown) => cleanNicheGroup(g)).filter(Boolean)
  return NextResponse.json({ pages, groups, defaultPage: def?.displayName ?? null })
}

export async function POST(req: Request) {
  // A Virtual Assistant publishes through the owner's accounts (lib/agency-publish).
  const pub = await getPublishContext(await createServerClient())
  if ('error' in pub) return pub.error
  const { supabase, user } = pub
  if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Facebook publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

  const body = await req.json().catch(() => ({})) as {
    videoUrl?: string; description?: string; socialAccountId?: string
    dryRun?: boolean; sourceVideoId?: string; product?: string; productName?: string
    /** false: answer once Meta accepts it; the page then reads its state. */
    wait?: boolean
    /** The clip's length: over REEL_MAX_SEC it posts as a Page video. */
    clipSeconds?: number
    /** Read where an earlier post stands, by its video id. */
    checkVideoId?: string
  }
  const videoUrl = String(body.videoUrl || '').trim()
  const checkId = String(body.checkVideoId || '').trim()
  if (!checkId && !/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'The clip has no web address to hand Facebook.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any).from('integrations')
    .select('facebook_page_id,facebook_page_access_token,facebook_page_name,tier').eq('user_id', user.id).maybeSingle()
  const integration = decryptIntegrationRow(intRow)
  const tier = normalizeTier(integration?.tier)
  if (!canUsePreview('facebook_reels', tier)) return NextResponse.json({ error: 'Facebook Reels is in Labs.' }, { status: 403 })

  const [page] = await resolveSocialAccounts(supabase, user.id, 'facebook', {
    socialAccountIds: body.socialAccountId ? [body.socialAccountId] : [],
    allowSelection: true,
    limit: socialAccountCap(tier),
    legacy: {
      externalId: integration?.facebook_page_id,
      accessToken: integration?.facebook_page_access_token,
      displayName: integration?.facebook_page_name,
    },
  })
  if (!page) return NextResponse.json({ error: 'No Facebook Page is connected. Connect one under Social Accounts.' }, { status: 400 })

  // WHERE IT STANDS NOW: one read of Meta's status, for the page's watch.
  if (checkId) {
    if (!/^\d{5,30}$/.test(checkId)) return NextResponse.json({ error: 'Which video?' }, { status: 400 })
    const st = await reelState(checkId, page.accessToken)
    return NextResponse.json({ ok: true, ...st })
  }

  if (body.dryRun === true) {
    const built = await buildReelCaption(supabase, user.id, {
      writeUp: String(body.description || ''), sourceVideoId: body.sourceVideoId,
      product: body.product, productName: body.productName,
    })
    return NextResponse.json({ ok: true, page: page.displayName, ...built })
  }

  // A Reel with no words at all is the post this route exists to stop.
  const raw = String(body.description || '').trim()
  if (!raw) return NextResponse.json({ error: 'The Reel has no description. Add one before posting.' }, { status: 400 })
  // THE ORDER (Seb, 2026-10-15): the link first, the disclaimer, #ad
  // #sponsored, the description, then the other hashtags. The creator's own
  // disclaimer from Brand Profile when they set one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any).from('brand_profiles').select('affiliate_disclaimer').eq('user_id', user.id).maybeSingle()
  // Through the hashtag safety net (lib/hashtag-engine): no years or spam,
  // each tag once, Facebook's three.
  const description = fitHashtags(facebookReelOrder(raw, (brand?.affiliate_disclaimer as string | null)?.trim() || AFFILIATE_DISCLAIMER_DEFAULT), 'facebook')

  // Longer than a Reel can be: an ordinary Page video, said as one.
  const secs = Number(body.clipSeconds)
  const asVideo = Number.isFinite(secs) && secs > REEL_MAX_SEC
  const r = asVideo
    ? await publishPageVideo({ pageId: page.externalId, token: page.accessToken, videoUrl, description })
    : await publishPageReel({ pageId: page.externalId, token: page.accessToken, videoUrl, description, wait: body.wait !== false })
  if (!r.ok) {
    // A permission Meta has not granted this connection reads as one.
    const perm = /permission|\(#200\)|\(#10\)|not authorized/i.test(r.error)
    return NextResponse.json({
      ok: false, step: r.step,
      error: perm ? `Facebook refused: ${r.error} Reconnect Facebook under Social Accounts so the Page grants Reels publishing, then try again.` : `Facebook did not post the Reel: ${r.error}`,
    }, { status: 502 })
  }
  // PULSE ON EVERY PLATFORM (lib/reach-pulse trackPost).
  await trackPost({ userId: user.id, platform: 'facebook', postId: r.videoId || null, caption: description, postUrl: r.url || null })
  return NextResponse.json({ ok: true, page: page.displayName, state: r.state, url: r.url, videoId: r.videoId, description, kind: asVideo ? 'video' : 'reel' })
}
