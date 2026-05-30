/**
 * GET /api/wordpress/debug-state
 *
 * Self-service diagnostic for the one-click WordPress connect flow.
 * Returns everything needed to figure out why the connected card isn't
 * showing in /setup despite a "connected" wp_oauth callback URL:
 *
 *   - Browser-session user (the user the setup page sees)
 *   - Service-role lookup of that user's integrations row (the row the
 *     oauth-callback writes to — bypasses RLS so we can tell whether
 *     the row exists OR whether RLS is just hiding it from the user)
 *   - All "wordpress_*" columns on that row so we can see exactly what
 *     init() should be reading
 *
 * No PII beyond the user's own email + their saved WP URL — anyone
 * with a valid session can call it for their own account, no admin
 * flag required.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return NextResponse.json({
      ok: false,
      stage: 'auth',
      error: userErr?.message || 'No browser session — visit this URL while logged in to MVP.',
    }, { status: 401 })
  }

  // ── 1. Read with the user's RLS-scoped session (what init() sees) ────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rlsRow, error: rlsErr } = await (supabase as any)
    .from('integrations')
    .select('user_id, wordpress_url, wordpress_username, setup_status')
    .eq('user_id', user.id)
    .maybeSingle()

  // ── 2. Read the same row via admin client (bypasses RLS) so we know
  //      whether the row genuinely doesn't exist vs. RLS hiding it ─────────
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: adminRow, error: adminErr } = await (admin as any)
    .from('integrations')
    .select('user_id, wordpress_url, wordpress_username, setup_status, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  // ── 3. Cross-check: list ALL rows that have a wordpress_url set —
  //      catches the "callback wrote to a different user_id" case. We
  //      only return the user_ids (not the URLs), enough to prove it ─────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allConnected } = await (admin as any)
    .from('integrations')
    .select('user_id, wordpress_url')
    .not('wordpress_url', 'is', null)

  return NextResponse.json({
    ok: true,
    browserSessionUserId: user.id,
    browserSessionEmail: user.email,
    rlsScoped: {
      row: rlsRow,
      error: rlsErr?.message ?? null,
      hasWordpressUrl: !!rlsRow?.wordpress_url,
    },
    adminScoped: {
      row: adminRow,
      error: adminErr?.message ?? null,
      hasWordpressUrl: !!adminRow?.wordpress_url,
    },
    allConnectedUserIds: (allConnected || []).map((r: { user_id: string; wordpress_url: string }) => ({
      user_id: r.user_id,
      matches_session: r.user_id === user.id,
      wp_host: (() => { try { return new URL(r.wordpress_url).hostname } catch { return '?' } })(),
    })),
    interpretation: interpret(user.id, rlsRow, adminRow, allConnected),
  })
}

function interpret(
  sessionUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rlsRow: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminRow: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allConnected: any[] | null,
): string {
  if (adminRow?.wordpress_url && rlsRow?.wordpress_url) {
    return '✅ Connection is saved AND readable — setup page should be showing the green connected card. Hard-refresh /setup (Cmd+Shift+R) and try again.'
  }
  if (adminRow?.wordpress_url && !rlsRow?.wordpress_url) {
    return '🚨 RLS is hiding the row from your session even though it exists in the DB. Check that integrations table has a SELECT policy allowing `auth.uid() = user_id`.'
  }
  if (!adminRow) {
    const otherMatch = (allConnected || []).find((r: { user_id: string }) => r.user_id !== sessionUserId)
    if (otherMatch) {
      return `🚨 OAuth callback wrote to a DIFFERENT user_id (${otherMatch.user_id.slice(0, 8)}…). State.userId did not match your current session — likely you were logged in as a different account when you clicked Connect.`
    }
    return '🚨 No integrations row exists for your user. Either the oauth-callback never ran for your user_id, OR it failed silently. Check Vercel logs filtered by `wp-oauth-callback`.'
  }
  if (adminRow && !adminRow.wordpress_url) {
    return '🚨 Your integrations row exists but wordpress_url is NULL — the callback ran but the upsert did not persist the wordpress_url column. Possibly a column-level constraint failure.'
  }
  return 'Unknown state.'
}
