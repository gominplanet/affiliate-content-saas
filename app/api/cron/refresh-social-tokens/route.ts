/**
 * GET /api/cron/refresh-social-tokens
 *
 * Daily worker that keeps long-lived social tokens alive so creators NEVER
 * have to reconnect (the "why did my scheduled post fail?" class of tickets).
 *
 * Covers the platforms whose tokens expire AND have a refresh path:
 *   - Threads   — long-lived token self-refreshes (th_refresh_token); ~60d.
 *   - Instagram — long-lived token self-refreshes (ig_refresh_token); ~60d.
 *   - Pinterest — access token (~30d) refreshed via the stored refresh token.
 *
 * NOT handled here (already self-heal at publish time): X/Twitter, TikTok,
 * YouTube, GSC. NO token: Bluesky (app password) + Telegram (bot token) never
 * expire. LinkedIn has no stored refresh token (LinkedIn only grants those to
 * approved apps) → it still needs a manual reconnect; nothing we can refresh.
 *
 * Safety: every refresh is wrapped per-row/per-platform and writes ONLY on
 * success, so a failed refresh (e.g. a token <24h old, or already revoked)
 * never wipes a working token and never breaks the batch. A platform that's
 * genuinely dead just stays as-is for the user to reconnect.
 *
 * Auth: Vercel cron sends Authorization: Bearer ${CRON_SECRET}.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt, maybeEncrypt } from '@/lib/secrets'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { refreshThreadsToken } from '@/services/threads'
import { refreshLongLivedToken as refreshInstagramToken } from '@/services/instagram'
import { refreshPinterestToken } from '@/services/pinterest'
import { probeAndStoreConnections } from '@/lib/connection-probe'

export const maxDuration = 300

// Refresh Instagram only when it's within this window of expiry (the token must
// be >24h old to refresh, and refreshing daily is wasteful). Threads/Pinterest
// have no expiry column, so we refresh them every run (cheap, extends validity).
const IG_REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000 // 10 days

interface Row {
  user_id: string
  threads_access_token: string | null
  instagram_access_token: string | null
  instagram_token_expiry: number | null
  pinterest_access_token: string | null
  pinterest_refresh_token: string | null
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('integrations')
    .select('user_id,threads_access_token,instagram_access_token,instagram_token_expiry,pinterest_access_token,pinterest_refresh_token')
    .or('threads_access_token.not.is.null,instagram_access_token.not.is.null,pinterest_refresh_token.not.is.null')
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Row[]

  // Bounded-concurrency fan-out (P1). The loops below were strictly sequential
  // (≤2000 integrations + ≤5000 social_accounts, up to a few awaited HTTP each),
  // which blew maxDuration=300 and left the tail unrefreshed → tokens aged out →
  // "why did my scheduled post fail?". Process in slices so the whole set drains
  // within budget. Each row's work is independent and only ++s its own tally.
  const REFRESH_CONCURRENCY = 12
  const mapPool = async <T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> => {
    for (let i = 0; i < items.length; i += size) {
      await Promise.all(items.slice(i, i + size).map(fn))
    }
  }

  const tally = {
    threads: { refreshed: 0, skipped: 0, failed: 0 },
    instagram: { refreshed: 0, skipped: 0, failed: 0 },
    pinterest: { refreshed: 0, skipped: 0, failed: 0 },
    social_accounts: { refreshed: 0, skipped: 0, failed: 0 },
  }

  const processRow = async (row: Row) => {
    // ── Threads ──────────────────────────────────────────────────────────
    const threadsTok = maybeDecrypt(row.threads_access_token)
    if (threadsTok) {
      try {
        const r = await refreshThreadsToken(threadsTok)
        await admin.from('integrations')
          .update(encryptIntegrationWrite({ threads_access_token: r.accessToken }))
          .eq('user_id', row.user_id)
        tally.threads.refreshed++
      } catch (e) {
        // <24h-old token is a benign no-op. A revoked one fails here every
        // night forever, and nothing else notices until a post dies — so log
        // it rather than swallowing it whole.
        console.error('[cron/refresh-social-tokens] threads refresh failed', {
          user_id: row.user_id,
          error: e instanceof Error ? e.message : String(e),
        })
        tally.threads.failed++
      }
    }

    // ── Instagram (only when nearing expiry) ─────────────────────────────
    const igTok = maybeDecrypt(row.instagram_access_token)
    if (igTok) {
      const exp = row.instagram_token_expiry ?? 0
      if (!exp || exp - Date.now() < IG_REFRESH_WINDOW_MS) {
        try {
          const r = await refreshInstagramToken(igTok)
          await admin.from('integrations')
            .update(encryptIntegrationWrite({ instagram_access_token: r.accessToken, instagram_token_expiry: r.expiresAt }))
            .eq('user_id', row.user_id)
          tally.instagram.refreshed++
        } catch {
          tally.instagram.failed++
        }
      } else {
        tally.instagram.skipped++
      }
    }

    // ── Pinterest ────────────────────────────────────────────────────────
    const pinRefresh = maybeDecrypt(row.pinterest_refresh_token)
    if (pinRefresh) {
      try {
        const r = await refreshPinterestToken(pinRefresh)
        await admin.from('integrations')
          .update(encryptIntegrationWrite({
            pinterest_access_token: r.access_token,
            // Pinterest keeps the same refresh token unless it returns a new one.
            pinterest_refresh_token: r.refresh_token ?? pinRefresh,
          }))
          .eq('user_id', row.user_id)
        tally.pinterest.refreshed++
      } catch {
        tally.pinterest.failed++
      }
    }
  }
  await mapPool(rows, REFRESH_CONCURRENCY, processRow)

  // ── social_accounts (the multi-account table) ──────────────────────────────
  // Instagram/Threads (and Facebook) connections live here, NOT in the legacy
  // integrations columns above — and nothing was refreshing them, so their 60-day
  // Meta tokens quietly aged out and forced creators to reconnect. Refresh the
  // Meta long-lived tokens here the same way (they self-refresh from the token
  // itself; no separate refresh_token needed). token_expiry lives in `extra`.
  const META_REFRESH_WINDOW_MS = 20 * 24 * 60 * 60 * 1000 // refresh once inside 20d of expiry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saData } = await (admin as any)
    .from('social_accounts')
    .select('id,platform,access_token,extra')
    .in('platform', ['instagram', 'threads'])
    .not('access_token', 'is', null)
    .limit(5000)

  // Soonest-expiry first (unknown expiry = 0 sorts first, so never-stamped rows
  // get healed early) so if the budget is tight the MOST urgent tokens drain
  // before the tail (P1).
  const accounts = ((saData ?? []) as Array<{ id: string; platform: string; access_token: string | null; extra: Record<string, unknown> | null }>)
    .slice()
    .sort((a, b) => {
      const ea = Number((a.extra as { token_expiry?: number } | null)?.token_expiry || 0)
      const eb = Number((b.extra as { token_expiry?: number } | null)?.token_expiry || 0)
      return ea - eb
    })

  const processAcc = async (acc: { id: string; platform: string; access_token: string | null; extra: Record<string, unknown> | null }) => {
    const tok = maybeDecrypt(acc.access_token)
    if (!tok) { tally.social_accounts.skipped++; return }
    const extra = (acc.extra && typeof acc.extra === 'object') ? acc.extra : {}
    const exp = Number((extra as { token_expiry?: number }).token_expiry || 0)
    // Only refresh when nearing expiry (a Meta token must be >24h old to refresh;
    // this window keeps us clear of that and avoids needless daily churn). Unknown
    // expiry → refresh, so pre-existing rows that never stored one get healed once.
    if (exp && exp - Date.now() > META_REFRESH_WINDOW_MS) { tally.social_accounts.skipped++; return }
    try {
      const r = acc.platform === 'threads' ? await refreshThreadsToken(tok) : await refreshInstagramToken(tok)
      await admin.from('social_accounts')
        .update({ access_token: maybeEncrypt(r.accessToken), extra: { ...extra, token_expiry: r.expiresAt } })
        .eq('id', acc.id)
      tally.social_accounts.refreshed++
    } catch (e) {
      // <24h-old or revoked token — leave the row untouched (never wipe a token
      // that might still work); log so a permanently-dead one is visible.
      console.error('[cron/refresh-social-tokens] social_accounts refresh failed', {
        id: acc.id, platform: acc.platform,
        error: e instanceof Error ? e.message : String(e),
      })
      tally.social_accounts.failed++
    }
  }
  await mapPool(accounts, REFRESH_CONCURRENCY, processAcc)

  // ── Proactive connection health: Facebook + YouTube ────────────────────────
  // These two die SILENTLY (Meta/Google invalidate the token; the UI keeps a
  // false green because it only checks "is a token stored"). The reactive
  // dead-channel alert only trips after N failed scheduled posts, so a creator
  // can sit disconnected for weeks and churn before it fires. Probe the REAL
  // tokens here nightly and stamp connection_health, so the dashboard banner can
  // flag a dead connection the day it dies — for every user, not just the ones
  // who happen to open the dashboard.
  const health = { facebook: { dead: 0, ok: 0 }, youtube: { dead: 0, ok: 0 } }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: connRows } = await (admin as any)
      .from('integrations')
      .select('user_id,facebook_page_id,facebook_page_access_token,youtube_oauth_refresh_token,youtube_oauth_access_token,connection_health')
      .or('facebook_page_access_token.not.is.null,youtube_oauth_refresh_token.not.is.null')
      .limit(5000)
    const probeRows = (connRows ?? []) as Array<{ user_id: string } & Record<string, unknown>>
    await mapPool(probeRows, REFRESH_CONCURRENCY, async (r) => {
      try {
        const result = await probeAndStoreConnections(admin, r.user_id, r as unknown as import('@/lib/connection-probe').ProbeRow)
        if (result.facebook) (result.facebook.dead ? health.facebook.dead++ : health.facebook.ok++)
        if (result.youtube) (result.youtube.dead ? health.youtube.dead++ : health.youtube.ok++)
      } catch { /* per-user probe never breaks the batch */ }
    })
  } catch (e) {
    console.error('[cron/refresh-social-tokens] connection health probe failed', e instanceof Error ? e.message : String(e))
  }

  return NextResponse.json({ ok: true, scanned: rows.length, tally, health })
}
