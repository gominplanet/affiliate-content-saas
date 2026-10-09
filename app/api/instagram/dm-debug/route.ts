// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/instagram/dm-debug — every link in the Instagram comment→DM chain,
//      checked live, with one verdict naming the first broken one.
// POST /api/instagram/dm-debug — turn comment alerts on for this account, and
//      say in Meta's words why not when it refuses.
//
// WHY (Seb, 2026-10-09). The send log showed two DMs sent in July, then nothing
// at all from Instagram after Aug 13: not a skip, not a failure. Every comment
// on the account would at least have left a "skipped" row, so Instagram had
// stopped sending comments to MVP, and nothing on any screen said so. This is
// that screen. Labs, admin only, like the page.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt } from '@/lib/secrets'
import { normalizeTier } from '@/lib/tier'
import { commentSubscription, subscribeToCommentsWhy, fetchIgProfessionalId } from '@/services/instagram'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as Db
  const { data: integ } = await admin.from('integrations')
    .select('tier,instagram_user_id,instagram_username,instagram_access_token,instagram_token_expiry')
    .eq('user_id', user.id).maybeSingle()
  if (normalizeTier(integ?.tier) !== 'admin') return { error: NextResponse.json({ error: 'Labs is not open on this account.' }, { status: 403 }) }
  const token = maybeDecrypt(integ?.instagram_access_token as string | null | undefined) || null
  return { userId: user.id, admin, integ, token, igUserId: (integ?.instagram_user_id as string | null) ?? null }
}

/** Meta's App Review page for MVP's app, where approval of the two messaging
 *  permissions shows. The app id is public: it is in every login link. */
function appReviewUrl(): string {
  const appId = process.env.FACEBOOK_APP_ID
  return appId
    ? `https://developers.facebook.com/apps/${appId}/app-review/permissions/`
    : 'https://developers.facebook.com/apps/'
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, userId, integ, token, igUserId } = g

  const connected = !!(token && igUserId)
  const scopesRequested = process.env.IG_DM_SCOPES === 'true'
  const appSecretSet = !!process.env.INSTAGRAM_APP_SECRET
  const verifyTokenSet = !!process.env.IG_WEBHOOK_VERIFY_TOKEN
  const expiry = Number(integ?.instagram_token_expiry || 0)
  const tokenExpired = !!expiry && expiry < Date.now()

  let fields: string[] | null = null
  let subError: string | null = null
  let professionalId: string | null = null
  if (connected) {
    const sub = await commentSubscription({ igUserId: igUserId as string, accessToken: token as string })
    fields = sub.fields
    subError = sub.error
    professionalId = await fetchIgProfessionalId(token as string)
    // Kept current here as well as on connect, so an account connected before
    // the id was saved can be traced from a comment on any post.
    if (professionalId) {
      try { await admin.from('integrations').update({ instagram_business_id: professionalId }).eq('user_id', userId) } catch { /* migration 170 not run */ }
    }
  }
  const commentsOn = fields ? fields.includes('comments') : null

  const { data: settings } = await admin.from('ig_dm_settings').select('*').eq('user_id', userId).maybeSingle()
  const { data: last } = await admin.from('ig_dm_sends').select('status,error,created_at')
    .eq('user_id', userId).eq('platform', 'instagram').order('created_at', { ascending: false }).limit(1).maybeSingle()

  let verdict: string
  let ok = false
  if (!connected) verdict = 'Instagram is not connected in MVP. Connect it under Setup, Socials.'
  else if (tokenExpired) verdict = 'The Instagram connection has expired. Reconnect Instagram under Setup, Socials.'
  else if (!appSecretSet) verdict = 'INSTAGRAM_APP_SECRET is not set in Vercel, so MVP refuses every comment Meta sends. Set it and redeploy.'
  else if (!scopesRequested) verdict = 'IG_DM_SCOPES is not "true" in Vercel, so connecting Instagram never asks for the two messaging permissions. Set it, redeploy, then reconnect Instagram.'
  else if (commentsOn === false) verdict = 'This account is not sending comments to MVP. Press "Turn on comment alerts". If Instagram refuses, reconnect Instagram and accept the messaging permissions.'
  else if (commentsOn === null) verdict = `MVP could not read the comment alert setting from Instagram${subError ? `: ${subError}` : '.'} Reconnecting Instagram usually fixes this.`
  else if (!settings?.enabled) verdict = 'Everything is connected, but Auto-DM is turned off. Turn it on below and save.'
  else {
    ok = true
    verdict = 'Connected and listening. Comment your keyword from a second account and a row appears under Recent comments within a minute. Until Meta approves the app, only comments from people listed on the app (you and testers) come through.'
  }

  return NextResponse.json({
    ok,
    verdict,
    appReviewUrl: appReviewUrl(),
    checks: {
      connected,
      username: integ?.instagram_username ?? null,
      tokenExpired,
      appSecretSet,
      verifyTokenSet,
      scopesRequested,
      commentsOn,
      subscribedFields: fields ?? [],
      subError,
      professionalIdSaved: !!professionalId,
      autoDmEnabled: !!settings?.enabled,
      lastInstagramEvent: last?.created_at ?? null,
    },
  })
}

export async function POST() {
  const g = await gate()
  if ('error' in g) return g.error
  const { token, igUserId } = g
  if (!token || !igUserId) return NextResponse.json({ ok: false, error: 'Instagram is not connected in MVP.' }, { status: 400 })
  const r = await subscribeToCommentsWhy({ igUserId, accessToken: token })
  return NextResponse.json(r.ok
    ? { ok: true }
    : { ok: false, error: `Instagram refused: ${r.error}. Reconnect Instagram and accept the messaging permissions, then try again.` })
}
