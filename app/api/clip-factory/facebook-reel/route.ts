// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/clip-factory/facebook-reel — publish a Clip Factory clip as a
// Reel on the creator's Facebook Page (lib/facebook-reels).
//   body: { videoUrl, description, socialAccountId? }
//
// LABS, admin only while it is tested (lib/labs-preview facebook_reels).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, socialAccountCap } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolveSocialAccounts } from '@/lib/social-accounts'
import { publishPageReel } from '@/lib/facebook-reels'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Facebook publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

  const body = await req.json().catch(() => ({})) as { videoUrl?: string; description?: string; socialAccountId?: string }
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

  const r = await publishPageReel({ pageId: page.externalId, token: page.accessToken, videoUrl, description: String(body.description || '') })
  if (!r.ok) {
    // A permission Meta has not granted this connection reads as one.
    const perm = /permission|\(#200\)|\(#10\)|not authorized/i.test(r.error)
    return NextResponse.json({
      ok: false, step: r.step,
      error: perm ? `Facebook refused: ${r.error} Reconnect Facebook under Social Accounts so the Page grants Reels publishing, then try again.` : `Facebook did not post the Reel: ${r.error}`,
    }, { status: 502 })
  }
  return NextResponse.json({ ok: true, page: page.displayName, state: r.state, url: r.url, videoId: r.videoId })
}
