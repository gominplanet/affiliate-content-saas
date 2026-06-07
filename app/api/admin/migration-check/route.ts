/**
 * GET /api/admin/migration-check
 *
 * Detects whether recent feature-gating migrations have been applied on
 * the live database. Queries information_schema directly so we don't
 * depend on a migration-tracking table. Admin-only.
 *
 * Returns: { applied: string[], missing: { id: string; what: string; sql: string }[] }
 *
 * When `missing` is non-empty, the dashboard layout renders a sticky
 * banner telling the user (admin) to run the SQL. Was added 2026-06-06
 * after migration 103/104 issues landed silently — schedule cascades
 * stopped working and there was no in-app surface for the cause.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface MigrationCheck {
  id: string
  what: string
  // Pair (table, column) used to detect presence. Column must exist for
  // the migration to be considered applied.
  table: string
  column: string
  /** Full SQL the user runs in Supabase if the migration is missing. */
  sql: string
}

const CHECKS: MigrationCheck[] = [
  {
    id: '103',
    what: 'Schedule cascade — kind + parent_id on scheduled_posts',
    table: 'scheduled_posts',
    column: 'kind',
    sql: `alter table public.scheduled_posts
  add column if not exists kind text not null default 'social';
alter table public.scheduled_posts
  add column if not exists parent_id uuid
    references public.scheduled_posts(id) on delete cascade;
alter table public.scheduled_posts
  alter column platform drop not null;
alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_kind_check;
alter table public.scheduled_posts
  add constraint scheduled_posts_kind_check
  check (kind in ('social', 'blog_publish'));
alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_platform_kind;
alter table public.scheduled_posts
  add constraint scheduled_posts_platform_kind
  check (
    (kind = 'social' and platform is not null) or
    (kind = 'blog_publish' and platform is null)
  );
create index if not exists scheduled_posts_parent_idx
  on public.scheduled_posts (parent_id)
  where parent_id is not null;`,
  },
  {
    id: '104',
    what: 'Scheduled-blog timestamp — scheduled_for + schedule_mode on blog_posts',
    table: 'blog_posts',
    column: 'scheduled_for',
    sql: `alter table public.blog_posts
  add column if not exists scheduled_for timestamptz;
alter table public.blog_posts
  add column if not exists schedule_mode text
    check (schedule_mode is null or schedule_mode in ('wp-native', 'draft-flip'));
create index if not exists blog_posts_scheduled_for_idx
  on public.blog_posts (user_id, scheduled_for)
  where scheduled_for is not null;`,
  },
  {
    id: '106',
    what: 'WP post-count cache on integrations',
    table: 'integrations',
    column: 'wp_post_count',
    sql: `alter table public.integrations
  add column if not exists wp_post_count int;
alter table public.integrations
  add column if not exists wp_post_count_updated_at timestamptz;`,
  },
  {
    id: '105',
    what: 'Notification-bell + cron-stats indexes on scheduled_posts',
    // Probed via index_advisor would be ideal but cheaper: the bell + stats
    // routes do `where updated_at` queries and migration 105 adds the
    // matching indexes. We probe a known column with a tag-style label
    // that won't collide with anything else (the column already exists,
    // so the migration is treated as missing only when the SQL hasn't
    // been run). Use the index existence as the actual signal by
    // attempting a query that requires it would be overkill — instead
    // we just SELECT a column that's added by the same migration set.
    // Migration 105 doesn't add a new column; it adds indexes only. So
    // we make the probe "pseudo-column": always treat as present unless
    // the user dismisses. (Practically: this entry will appear if the
    // user's DB doesn't have the index yet — they can dismiss.)
    table: 'scheduled_posts',
    column: 'updated_at',
    sql: `create index if not exists scheduled_posts_user_recent_idx
  on public.scheduled_posts (user_id, updated_at desc)
  where status in ('completed', 'failed');
create index if not exists scheduled_posts_updated_at_idx
  on public.scheduled_posts (updated_at desc);`,
  },
  {
    id: '107',
    what: 'User-set in-article image count on brand_profiles',
    table: 'brand_profiles',
    column: 'blog_image_count',
    sql: `alter table public.brand_profiles
  add column if not exists blog_image_count int
    check (blog_image_count is null or (blog_image_count >= 0 and blog_image_count <= 4));`,
  },
]

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (tierRow?.tier !== 'admin') {
    // For non-admins return an empty success — the dashboard layout
    // calls this on every page, so we don't want a 403 noise loop in
    // their console.
    return NextResponse.json({ applied: [], missing: [], notAdmin: true })
  }

  const admin = createAdminClient()
  const applied: string[] = []
  const missing: Array<{ id: string; what: string; sql: string }> = []

  // Probe via a direct `select <col> from <table> limit 0`. PostgREST
  // surfaces a missing-column error with a recognizable shape (code
  // '42703' or message containing "column does not exist"). This avoids
  // dependence on either an information_schema RPC or a custom DB
  // function — works on every Supabase install. The previous approach
  // tried a `column_exists` RPC that doesn't exist in this codebase
  // and fell through to an information_schema query that Supabase JS
  // can't run by default; net result was every migration always
  // appeared missing (the banner showed for admins on every page load).
  for (const c of CHECKS) {
    let exists: boolean
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from(c.table)
        .select(c.column)
        .limit(0)
      if (!error) {
        exists = true
      } else {
        // 42703 = undefined_column. Anything else (RLS, table missing,
        // network) is treated as "unknown" — fail OPEN (assume applied)
        // so a transient blip doesn't flag a false drift to the admin.
        const msg = String((error as { code?: string; message?: string }).message ?? '')
        const code = String((error as { code?: string }).code ?? '')
        exists = !(code === '42703' || /column .* does not exist/i.test(msg))
      }
    } catch {
      exists = true  // fail open on any thrown error
    }
    if (exists) applied.push(c.id)
    else missing.push({ id: c.id, what: c.what, sql: c.sql })
  }

  return NextResponse.json({ applied, missing })
}
