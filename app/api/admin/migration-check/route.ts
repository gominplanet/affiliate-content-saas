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

  for (const c of CHECKS) {
    // Probe via information_schema. Limit 1 + matches by exact column +
    // table name; postgres returns 0 rows if the column doesn't exist.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).rpc('column_exists', {
      p_table: c.table,
      p_column: c.column,
    }).single().then((r: { data: boolean | null; error: unknown }) => r).catch(() => ({ data: null, error: 'rpc-missing' }))

    let exists: boolean
    if (error || data == null) {
      // Fallback — direct query to information_schema. Service-role
      // bypasses RLS so this works without exposing the public.* model.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (admin as any)
        .from('information_schema.columns' as never)
        .select('column_name')
        .eq('table_schema', 'public')
        .eq('table_name', c.table)
        .eq('column_name', c.column)
        .limit(1)
        .maybeSingle()
        .catch(() => ({ data: null }))
      exists = !!row
    } else {
      exists = !!data
    }

    if (exists) applied.push(c.id)
    else missing.push({ id: c.id, what: c.what, sql: c.sql })
  }

  return NextResponse.json({ applied, missing })
}
