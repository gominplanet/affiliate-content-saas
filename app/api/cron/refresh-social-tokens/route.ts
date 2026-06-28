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
import { maybeDecrypt } from '@/lib/secrets'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { refreshThreadsToken } from '@/services/threads'
import { refreshLongLivedToken as refreshInstagramToken } from '@/services/instagram'
import { refreshPinterestToken } from '@/services/pinterest'

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
  const tally = {
    threads: { refreshed: 0, skipped: 0, failed: 0 },
    instagram: { refreshed: 0, skipped: 0, failed: 0 },
    pinterest: { refreshed: 0, skipped: 0, failed: 0 },
  }

  for (const row of rows) {
    // ── Threads ──────────────────────────────────────────────────────────
    const threadsTok = maybeDecrypt(row.threads_access_token)
    if (threadsTok) {
      try {
        const r = await refreshThreadsToken(threadsTok)
        await admin.from('integrations')
          .update(encryptIntegrationWrite({ threads_access_token: r.accessToken }))
          .eq('user_id', row.user_id)
        tally.threads.refreshed++
      } catch {
        // <24h-old token or revoked — keep the current token; not fatal.
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

  return NextResponse.json({ ok: true, scanned: rows.length, tally })
}
