/**
 * POST /api/admin/run-encryption-migration?dryRun=1
 *
 * Runs the encryption migration server-side from a deployed Vercel
 * function. Uses the MVP_CRYPTO_KEY + SUPABASE_SERVICE_ROLE_KEY env
 * vars that are already set in production — no terminal env-var
 * juggling required.
 *
 * Walks integrations, wordpress_sites, social_accounts. For each
 * secret column on each row: if it's plaintext (not already
 * encrypted), encrypts it in place. Idempotent — safe to re-run.
 *
 * Query params:
 *   - ?dryRun=1 (recommended first): inspects rows + counts what would
 *     change. NO writes. Returns a per-table summary.
 *   - ?dryRun=0 (or omit): actually writes encrypted values back.
 *
 * Auth: admin-only (matches /api/admin/user-lookup pattern).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     dryRun: boolean,
 *     summary: [
 *       { table, rows, encrypted, skipped, errors }
 *     ]
 *   }
 *
 * Why this exists alongside scripts/encrypt-existing-secrets.ts:
 * the script needs local env vars and a tsx shell, which trip up
 * non-CLI users. This route runs in the same process as the rest
 * of the app, with the same env, with the same crypto helpers —
 * the user just hits a URL while logged in as admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptSecret, isEncrypted } from '@/lib/secrets'

export const maxDuration = 60

/** Per-table secret column manifest. MUST match scripts/encrypt-existing-secrets.ts
 *  — keep both in sync so a future user can run either path interchangeably. */
const PLAN: Record<string, { idColumn: string; secretColumns: string[] }> = {
  integrations: {
    idColumn: 'user_id',
    secretColumns: [
      'wordpress_app_password',
      'wordpress_api_token',
      'facebook_page_access_token',
      'pinterest_access_token',
      'threads_access_token',
      'twitter_access_token',
      'linkedin_access_token',
      'bluesky_app_password',
      'tiktok_access_token',
      'tiktok_refresh_token',
      // NOTE: instagram_user_access_token + instagram_long_lived_token
      // were originally in this list but those columns don't exist in
      // the live schema (Instagram tokens live on social_accounts
      // instead). Including them caused the entire SELECT to fail
      // wholesale. Removed 2026-06-02 after the first dry-run errored
      // on integrations.
      'telegram_bot_token',
      'youtube_oauth_access_token',
      'youtube_oauth_refresh_token',
      'pinterest_refresh_token',
      'twitter_refresh_token',
      'gsc_oauth_access_token',
      'gsc_oauth_refresh_token',
    ],
  },
  wordpress_sites: {
    idColumn: 'id',
    secretColumns: ['app_password', 'api_token'],
  },
  social_accounts: {
    idColumn: 'id',
    secretColumns: ['access_token'],
  },
}

export async function POST(req: NextRequest) {
  // ── Auth: admin only ──────────────────────────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // ── Verify MVP_CRYPTO_KEY is loaded before doing any work ─────────────────
  // (encryptSecret throws if missing; better to fail explicitly here than
  // leave a half-encrypted DB.)
  try {
    encryptSecret('test')
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: 'MVP_CRYPTO_KEY missing or invalid in this runtime. Hit /api/admin/check-crypto-key first to diagnose.',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get('dryRun') === '1'

  // ── Migrate each table ────────────────────────────────────────────────────
  const admin = createAdminClient()
  const summary: Array<{ table: string; rows: number; encrypted: number; skipped: number; errors: number }> = []

  for (const [table, plan] of Object.entries(PLAN)) {
    const result = await migrateTable(admin, table, plan, dryRun)
    summary.push(result)
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    summary,
    note: dryRun
      ? 'DRY RUN — no writes. Drop ?dryRun=1 (or set ?dryRun=0) to run for real.'
      : 'Encryption complete. Existing rows are now at rest as enc:v1:<base64>.',
  })
}

async function migrateTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  plan: { idColumn: string; secretColumns: string[] },
  dryRun: boolean,
): Promise<{ table: string; rows: number; encrypted: number; skipped: number; errors: number; errorMessage?: string }> {
  const selectCols = [plan.idColumn, ...plan.secretColumns].join(',')
  const { data, error } = await admin.from(table).select(selectCols)
  if (error || !data) {
    // Surface the actual Postgres error so the operator can see WHICH
    // column / policy / index is at fault. Common modes: a column in
    // the PLAN that doesn't exist in this database (whole SELECT
    // rejected), or an RLS policy that filters out the service-role
    // read (should not happen, but defensive logging if it does).
    const msg = error?.message ?? 'no data returned'
    console.error(`[migrate-encryption] ${table}: read failed — ${msg}`)
    return { table, rows: 0, encrypted: 0, skipped: 0, errors: 1, errorMessage: msg }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as Record<string, any>[]
  let encrypted = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {}
    let touched = 0

    for (const col of plan.secretColumns) {
      const val = row[col]
      if (val == null || val === '' || typeof val !== 'string') continue
      if (isEncrypted(val)) continue // already encrypted — skip
      try {
        updates[col] = encryptSecret(val)
        touched++
      } catch (e) {
        console.error(`[migrate-encryption] ${table}.${col} on ${row[plan.idColumn]}: ${e}`)
        errors++
      }
    }

    if (touched === 0) {
      skipped++
      continue
    }

    if (dryRun) {
      encrypted++ // count what WOULD have been written
      continue
    }

    const { error: upErr } = await admin
      .from(table).update(updates).eq(plan.idColumn, row[plan.idColumn])
    if (upErr) {
      console.error(`[migrate-encryption] ${table} update on ${row[plan.idColumn]}: ${upErr.message}`)
      errors++
    } else {
      encrypted++
    }
  }

  return { table, rows: rows.length, encrypted, skipped, errors }
}
