/**
 * GET /api/facebook/dm-debug — self-serve diagnostic for the Facebook
 * comment→DM automation. The signed-in user opens this in the browser and it
 * checks, live against the Graph API, every link in the chain that we can't see
 * from the code alone:
 *   1. Is a Facebook Page connected + is the token stored?
 *   2. Does that token actually carry the messaging scopes (pages_messaging,
 *      pages_read_engagement, pages_manage_metadata)?  → the FB_DM_SCOPES gate.
 *   3. Is the Page subscribed to the `feed` webhook field?  → so comment
 *      events reach us at all.
 *   4. Is the Auto-DM toggle on + what's the keyword?
 *   5. The last few send-log rows (did a webhook fire? what happened?).
 *
 * Returns a plain checklist + a single `verdict` naming the first broken link.
 * No secrets are returned — only booleans + the (already user-owned) send log.
 * See project_ig_comment_to_dm.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v19.0'
const MESSAGING_SCOPES = ['pages_messaging', 'pages_read_engagement', 'pages_manage_metadata']

async function graphJson(url: string): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url)
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, body }
  } catch (e) {
    return { ok: false, body: { error: e instanceof Error ? e.message : String(e) } }
  }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── 1. Connected Page + token ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integRaw } = await (supabase as any)
    .from('integrations')
    .select('facebook_page_id,facebook_page_name,facebook_page_access_token')
    .eq('user_id', user.id)
    .maybeSingle()
  const integ = decryptIntegrationRow(integRaw)
  const pageId: string | undefined = integ?.facebook_page_id
  const pageName: string | undefined = integ?.facebook_page_name
  const pageToken: string | undefined = integ?.facebook_page_access_token

  // ── 4. Settings ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any)
    .from('ig_dm_settings')
    .select('enabled,keyword,message_template,reply_to_comment')
    .eq('user_id', user.id)
    .maybeSingle()

  // ── 5. Recent send log ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sends } = await (supabase as any)
    .from('ig_dm_sends')
    .select('platform,status,error,keyword,media_id,link_sent,created_at')
    .order('created_at', { ascending: false })
    .limit(6)

  // ── 2 + 3. Live Graph checks (need the page token) ───────────────────────
  const appId = process.env.FACEBOOK_APP_ID
  const appSecret = process.env.FACEBOOK_APP_SECRET
  let tokenScopes: string[] | null = null
  let hasMessagingScopes: boolean | null = null
  let missingScopes: string[] = []
  let feedSubscribed: boolean | null = null
  let subscribedFields: string[] = []
  const graphErrors: Record<string, unknown> = {}

  if (pageToken && appId && appSecret) {
    // Granted scopes on the token (debug_token via the app access token).
    const dbg = await graphJson(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${appId}|${appSecret}`,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopes = (dbg.body as any)?.data?.scopes
    if (Array.isArray(scopes)) {
      tokenScopes = scopes
      missingScopes = MESSAGING_SCOPES.filter(s => !scopes.includes(s))
      hasMessagingScopes = missingScopes.length === 0
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphErrors.debug_token = (dbg.body as any)?.error ?? dbg.body
    }
  }
  if (pageToken && pageId) {
    // Is our app subscribed to this Page's `feed` webhook?
    const subs = await graphJson(
      `${GRAPH}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (subs.body as any)?.data
    if (Array.isArray(list)) {
      // Any subscribed app entry that includes 'feed' in its fields.
      const fields = list.flatMap((a: { subscribed_fields?: string[] }) => a.subscribed_fields ?? [])
      subscribedFields = Array.from(new Set(fields))
      feedSubscribed = subscribedFields.includes('feed')
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphErrors.subscribed_apps = (subs.body as any)?.error ?? subs.body
    }
  }

  // App-level webhook subscription: is the APP itself subscribed to the `page`
  // object's `feed` field? This is SEPARATE from the per-Page subscribed_apps
  // check above — BOTH must be true for Meta to deliver comment events. (The
  // app subscription is configured once in the Meta dashboard → Webhooks; the
  // Page subscription is per-connected-Page and we auto-do it on connect.)
  let appSubscribedToFeed: boolean | null = null
  if (appId && appSecret) {
    const appSubs = await graphJson(`${GRAPH}/${appId}/subscriptions?access_token=${appId}|${appSecret}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (appSubs.body as any)?.data
    if (Array.isArray(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageObj = data.find((d: any) => d.object === 'page')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields = (pageObj?.fields ?? []).map((f: any) => (typeof f === 'string' ? f : f?.name)).filter(Boolean)
      appSubscribedToFeed = fields.includes('feed')
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphErrors.app_subscriptions = (appSubs.body as any)?.error ?? appSubs.body
    }
  }

  // Webhook auth env. A missing app secret means EVERY inbound event fails the
  // X-Hub-Signature-256 check (401) and is dropped before processing — no DM,
  // no send-log row. (It's almost certainly set, since OAuth/publishing also
  // use it, but we surface it so the checklist is complete.)
  const appSecretSet = !!appSecret
  const verifyTokenSet = !!(process.env.FB_WEBHOOK_VERIFY_TOKEN || process.env.IG_WEBHOOK_VERIFY_TOKEN)

  // ── Verdict — first broken link in the chain ─────────────────────────────
  let verdict: string
  if (!pageId || !pageToken) {
    verdict = '❌ No Facebook Page connected (or token missing). Connect a Page under Setup → Integrations.'
  } else if (!appSecretSet) {
    verdict = '❌ FACEBOOK_APP_SECRET is not set on the server, so inbound webhook events fail signature verification (401) and are dropped before any DM logic runs. Set it in Vercel and redeploy.'
  } else if (hasMessagingScopes === false) {
    verdict = `❌ Token is MISSING scopes: ${missingScopes.join(', ')}. Set FB_DM_SCOPES=true in Vercel, redeploy, then RECONNECT Facebook (this is what grabs the scopes). You can set it back to false after.`
  } else if (appSubscribedToFeed === false) {
    verdict = '❌ Your Meta APP is not subscribed to the Page `feed` webhook field, so Meta never sends comment events. In the Meta dashboard → your app → Webhooks → Page → Subscribe to the `feed` field (callback https://www.mvpaffiliate.io/api/facebook/webhook).'
  } else if (feedSubscribed === false) {
    verdict = '❌ This Page is NOT subscribed to the `feed` webhook, so comment events never reach us. Reconnecting Facebook (with the messaging scopes) auto-subscribes it — or subscribe `feed` on the Page in the Meta dashboard.'
  } else if (!settings?.enabled) {
    verdict = '❌ Auto-DM is turned OFF. Flip "Enable comment → auto-DM" on the Instagram Auto-DM page and Save.'
  } else if (hasMessagingScopes === null || feedSubscribed === null || appSubscribedToFeed === null) {
    verdict = `⚠️ Couldn't complete the live Facebook checks${Object.keys(graphErrors).length ? ' (see graphErrors)' : ''}. The stored config looks OK; comment the keyword and re-open this to read the send log.`
  } else {
    verdict = '✅ Everything checks out: Page connected, app secret set, token has messaging scopes, app + Page subscribed to feed, Auto-DM on. Comment your keyword and it should send — watch the sends log below. (If a comment still yields no DM, the commenter may not be an app admin/tester while the app is in Development mode — Private Replies only reach app-role users until Meta approves the messaging permission for public use.)'
  }

  return NextResponse.json({
    verdict,
    checks: {
      pageConnected: !!(pageId && pageToken),
      pageName: pageName ?? null,
      appSecretSet,
      verifyTokenSet,
      tokenHasMessagingScopes: hasMessagingScopes,
      missingScopes,
      appSubscribedToFeed,
      feedSubscribed,
      subscribedFields,
      autoDmEnabled: !!settings?.enabled,
      keyword: settings?.keyword ?? null,
    },
    tokenScopes,
    recentSends: sends ?? [],
    graphErrors: Object.keys(graphErrors).length ? graphErrors : undefined,
  })
}
