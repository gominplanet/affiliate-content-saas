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
  const { data: rlsRow, error: rlsErr } = await supabase
    .from('integrations')
    .select('user_id, wordpress_url, wordpress_username, setup_status')
    .eq('user_id', user.id)
    .maybeSingle()

  // ── 2. Read the same row via admin client (bypasses RLS) so we know
  //      whether the row genuinely doesn't exist vs. RLS hiding it ─────────
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: adminRow, error: adminErr } = await admin
    .from('integrations')
    .select('user_id, wordpress_url, wordpress_username, setup_status, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  // ── 3. Cross-check: list ALL rows that have a wordpress_url set —
  //      catches the "callback wrote to a different user_id" case. We
  //      only return the user_ids (not the URLs), enough to prove it ─────
  // SECURITY: this used to query EVERY integrations row across all
  // tenants ("all connected wordpress_urls anywhere in the DB") and
  // return each user_id + WP hostname. Any logged-in user could call
  // it and harvest the connected WP domain of every other customer,
  // plus their user_id prefix in the "different user" error path.
  // Found during 2026-06-02 audit; scope is now strictly the calling
  // user's own row.
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
    interpretation: interpret(rlsRow, adminRow),
  })
}

function interpret(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rlsRow: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminRow: any,
): string {
  if (adminRow?.wordpress_url && rlsRow?.wordpress_url) {
    return '✅ Connection is saved AND readable — setup page should be showing the green connected card. Hard-refresh /setup (Cmd+Shift+R) and try again.'
  }
  if (adminRow?.wordpress_url && !rlsRow?.wordpress_url) {
    return '🚨 RLS is hiding the row from your session even though it exists in the DB. Check that integrations table has a SELECT policy allowing `auth.uid() = user_id`.'
  }
  if (!adminRow) {
    return '🚨 No integrations row exists for your user. Either the oauth-callback never ran for your user_id, OR it failed silently. Check Vercel logs filtered by `wp-oauth-callback`. (Previously this branch reported on cross-tenant rows; that leak was closed during the 2026-06-02 audit.)'
  }
  if (adminRow && !adminRow.wordpress_url) {
    return '🚨 Your integrations row exists but wordpress_url is NULL — the callback ran but the upsert did not persist the wordpress_url column. Possibly a column-level constraint failure.'
  }
  return 'Unknown state.'
}
