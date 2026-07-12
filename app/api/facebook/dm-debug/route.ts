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

  // ── Verdict — first broken link in the chain ─────────────────────────────
  let verdict: string
  if (!pageId || !pageToken) {
    verdict = '❌ No Facebook Page connected (or token missing). Connect a Page under Setup → Integrations.'
  } else if (hasMessagingScopes === false) {
    verdict = `❌ Token is MISSING scopes: ${missingScopes.join(', ')}. Set FB_DM_SCOPES=true in Vercel, redeploy, then RECONNECT Facebook (this is what grabs the scopes). You can set it back to false after.`
  } else if (feedSubscribed === false) {
    verdict = '❌ This Page is NOT subscribed to the `feed` webhook, so comment events never reach us. Reconnecting Facebook (with the messaging scopes) auto-subscribes it — or subscribe `feed` on the Page in the Meta dashboard.'
  } else if (!settings?.enabled) {
    verdict = '❌ Auto-DM is turned OFF. Flip "Enable comment → auto-DM" on the Instagram Auto-DM page and Save.'
  } else if (hasMessagingScopes === null || feedSubscribed === null) {
    verdict = `⚠️ Couldn't complete the live Facebook checks${Object.keys(graphErrors).length ? ' (see graphErrors)' : ''}. The stored config looks OK; comment the keyword and re-open this to read the send log.`
  } else {
    verdict = '✅ Everything checks out: Page connected, token has messaging scopes, feed subscribed, Auto-DM on. Comment your keyword and it should send — watch the sends log below.'
  }

  return NextResponse.json({
    verdict,
    checks: {
      pageConnected: !!(pageId && pageToken),
      pageName: pageName ?? null,
      tokenHasMessagingScopes: hasMessagingScopes,
      missingScopes,
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
