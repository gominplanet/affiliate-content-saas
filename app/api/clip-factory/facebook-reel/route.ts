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

import { cleanNicheGroup } from '@/lib/facebook-niche'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, socialAccountCap } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolveSocialAccounts } from '@/lib/social-accounts'
import { publishPageReel } from '@/lib/facebook-reels'
import { buildReelCaption } from '@/lib/reel-caption'

export const runtime = 'nodejs'
export const maxDuration = 300

// GET: where a Reel can go. The Pages this account can post to (the one used
// when none is picked comes first, marked default), and the Facebook Groups
// saved in Brand Profile, which a Reel can be shared into with SCOUT after it
// is up on the Page (Meta lets no app post into a Group).
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Facebook publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

  const body = await req.json().catch(() => ({})) as {
    videoUrl?: string; description?: string; socialAccountId?: string
    dryRun?: boolean; sourceVideoId?: string; product?: string; productName?: string
  }
  const videoUrl = String(body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'The clip has no web address to hand Facebook.' }, { status: 400 })

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

  if (body.dryRun === true) {
    const built = await buildReelCaption(supabase, user.id, {
      writeUp: String(body.description || ''), sourceVideoId: body.sourceVideoId,
      product: body.product, productName: body.productName,
    })
    return NextResponse.json({ ok: true, page: page.displayName, ...built })
  }

  // A Reel with no words at all is the post this route exists to stop.
  const description = String(body.description || '').trim()
  if (!description) return NextResponse.json({ error: 'The Reel has no description. Add one before posting.' }, { status: 400 })

  const r = await publishPageReel({ pageId: page.externalId, token: page.accessToken, videoUrl, description })
  if (!r.ok) {
    // A permission Meta has not granted this connection reads as one.
    const perm = /permission|\(#200\)|\(#10\)|not authorized/i.test(r.error)
    return NextResponse.json({
      ok: false, step: r.step,
      error: perm ? `Facebook refused: ${r.error} Reconnect Facebook under Social Accounts so the Page grants Reels publishing, then try again.` : `Facebook did not post the Reel: ${r.error}`,
    }, { status: 502 })
  }
  return NextResponse.json({ ok: true, page: page.displayName, state: r.state, url: r.url, videoId: r.videoId, description })
}
