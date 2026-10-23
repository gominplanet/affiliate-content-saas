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
// that screen. Every member who can use Auto-DM sees it (2026-10-23).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt } from '@/lib/secrets'
import { normalizeTier } from '@/lib/tier'
import { canUseIgDm } from '@/lib/ig-dm-access'
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
  // Out of Labs (2026-10-23, Meta approved): every plan that posts to Instagram.
  if (!canUseIgDm(integ?.tier)) return { error: NextResponse.json({ error: 'Instagram Auto-DM is not on your plan.' }, { status: 403 }) }
  const token = maybeDecrypt(integ?.instagram_access_token as string | null | undefined) || null
  return { userId: user.id, admin, integ, token, igUserId: (integ?.instagram_user_id as string | null) ?? null, team: normalizeTier(integ?.tier) === 'admin' }
}

/** What Auto-DM needs from the Instagram connection. */
const DM_PERMISSIONS = ['instagram_business_manage_comments', 'instagram_business_manage_messages']

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
  const { admin, userId, integ, token, igUserId, team } = g

  const connected = !!(token && igUserId)
  const scopesRequested = process.env.IG_DM_SCOPES !== 'false'
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

  // The permissions granted when Instagram was last connected (recorded since
  // 2026-10-23). null: connected before that, so not known; the comment alert
  // check below still catches an account without them.
  let permissions: string[] | null = null
  if (connected) {
    try {
      const { data: acct } = await admin.from('social_accounts').select('extra')
        .eq('user_id', userId).eq('platform', 'instagram').eq('external_id', igUserId).maybeSingle()
      const p = (acct?.extra as { permissions?: unknown } | null)?.permissions
      if (Array.isArray(p)) permissions = p.map(String)
    } catch { /* not known */ }
  }
  const missing = permissions ? DM_PERMISSIONS.filter((p) => !permissions!.includes(p)) : []

  const { data: settings } = await admin.from('ig_dm_settings').select('*').eq('user_id', userId).maybeSingle()
  const { data: last } = await admin.from('ig_dm_sends').select('status,error,created_at')
    .eq('user_id', userId).eq('platform', 'instagram').order('created_at', { ascending: false }).limit(1).maybeSingle()

  // The first broken link in the chain, or null when comments can be answered.
  // A Reel posted with its own Auto-DM needs only this: its keyword and link
  // work even with the account-wide switch below turned off.
  let blocker: string | null = null
  if (!connected) blocker = 'Instagram is not connected in MVP. Connect it under Setup, Socials.'
  else if (tokenExpired) blocker = 'The Instagram connection has expired. Reconnect Instagram under Setup, Socials.'
  else if (!appSecretSet) blocker = 'INSTAGRAM_APP_SECRET is not set in Vercel, so MVP refuses every comment Meta sends. Set it and redeploy.'
  else if (!scopesRequested) blocker = 'IG_DM_SCOPES is "false" in Vercel, so connecting Instagram never asks for the two messaging permissions. Remove it, redeploy, then reconnect Instagram.'
  else if (missing.length) blocker = `Instagram was connected without permission to ${missing.includes('instagram_business_manage_messages') ? 'send messages' : 'read comments'}. Reconnect Instagram under Setup, Socials and allow MVP to manage your messages and comments.`
  else if (commentsOn === false) blocker = 'This account is not sending comments to MVP. Press "Turn on comment alerts". If Instagram refuses, reconnect Instagram and accept the messaging permissions.'
  else if (commentsOn === null) blocker = `MVP could not read the comment alert setting from Instagram${subError ? `: ${subError}` : '.'} Reconnecting Instagram usually fixes this.`
  // A member is never told about Vercel settings: those are MVP's to fix.
  if (blocker && !team && (!appSecretSet || !scopesRequested)) blocker = 'Auto-DM is not ready on MVP\u2019s side yet, so comments cannot be answered. Let MVP support know.'

  // Posts MVP makes carry their own Auto-DM unless "posts MVP makes" is off
  // (lib/ig-auto-dm, migration 454); the account-wide switch covers the rest.
  const mvpPostsOn = settings?.mvp_posts !== false
  const anyOn = mvpPostsOn || !!settings?.enabled
  let verdict: string
  let ok = false
  if (blocker) verdict = blocker
  else if (!anyOn) verdict = 'Everything is connected, but Auto-DM is turned off for every post. Turn it on below and save.'
  else {
    ok = true
    verdict = mvpPostsOn
      ? 'Connected and listening. Every post MVP makes answers your keyword. Comment it from a second account and a row appears under Recent comments within a minute.'
      : 'Connected and listening. Comment your keyword from a second account and a row appears under Recent comments within a minute.'
  }
  return NextResponse.json({
    ok,
    verdict,
    // For the posting window: can a Reel's own Auto-DM answer comments, and if
    // not, why.
    reel: { ok: !blocker, why: blocker },
    // The setup rows (Vercel settings) and Meta's App Review page are the MVP
    // team's to read.
    team,
    appReviewUrl: team ? appReviewUrl() : null,
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
      // null: connected before MVP recorded them.
      permissionsKnown: permissions !== null,
      permissionsMissing: missing,
      autoDmEnabled: anyOn,
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
