/**
 * One-shot migration: encrypt all existing plaintext secrets in the DB.
 *
 * Usage:
 *   MVP_CRYPTO_KEY=<hex>  \
 *   NEXT_PUBLIC_SUPABASE_URL=...  \
 *   SUPABASE_SERVICE_ROLE_KEY=...  \
 *   npx tsx scripts/encrypt-existing-secrets.ts [--dry-run] [--table=integrations|wordpress_sites]
 *
 * Behaviour:
 *   - Walks each target table, reads every row.
 *   - For each secret column on that row: skips if already encrypted
 *     (the maybeEncrypt() helper is idempotent — but we double-check
 *     with isEncrypted() before writing to avoid useless updates).
 *   - In dry-run mode: prints what WOULD change without writing.
 *   - In normal mode: writes encrypted values back. Idempotent —
 *     re-running is safe.
 *
 * Why this is a separate script, not auto-run:
 *   - Encryption is irreversible without MVP_CRYPTO_KEY. If the env
 *     var is wrong/missing/typo'd, you've corrupted production. A
 *     manual run forces the operator to set the env, dry-run first,
 *     then commit.
 *   - The script can be paused mid-run and resumed (it skips rows
 *     that are already encrypted) — important on large tables.
 *
 * Recovery: if a row's secret somehow ends up with the wrong key
 * applied, decryption will throw at use-time rather than return
 * garbage (AES-GCM auth tag fails). The user reconnects the
 * integration via the normal OAuth/setup flow.
 */

import { createClient } from '@supabase/supabase-js'
import { encryptSecret, isEncrypted } from '../lib/secrets'

const DRY_RUN = process.argv.includes('--dry-run')
const TABLE_ARG = process.argv.find(a => a.startsWith('--table='))?.slice('--table='.length)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Per-table secret column manifests. Add new tables / columns as the
 *  encryption scope grows. */
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
      'instagram_user_access_token',
      'instagram_long_lived_token',
      'telegram_bot_token',
      'youtube_oauth_access_token',
      'youtube_oauth_refresh_token',
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

async function migrateTable(table: string, plan: { idColumn: string; secretColumns: string[] }) {
  console.log(`\n=== ${table} ===`)
  const selectCols = [plan.idColumn, ...plan.secretColumns].join(',')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table).select(selectCols) as any)
  if (error) {
    console.error(`  read failed: ${error.message}`)
    return { table, rows: 0, encrypted: 0, skipped: 0, errors: 0 }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as Record<string, any>[]
  let encrypted = 0, skipped = 0, errors = 0

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
        console.error(`  encrypt fail on ${row[plan.idColumn]}.${col}: ${e}`)
        errors++
      }
    }
    if (touched === 0) {
      skipped++
      continue
    }
    if (DRY_RUN) {
      console.log(`  [DRY] would encrypt ${touched} col(s) on row ${row[plan.idColumn]}`)
      encrypted++
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (admin.from(table).update(updates).eq(plan.idColumn, row[plan.idColumn]) as any)
    if (upErr) {
      console.error(`  update fail on ${row[plan.idColumn]}: ${upErr.message}`)
      errors++
    } else {
      encrypted++
      if (encrypted % 25 === 0) console.log(`  ...${encrypted}/${rows.length} done`)
    }
  }
  console.log(`  ${table}: ${encrypted} encrypted · ${skipped} already-encrypted · ${errors} errors · ${rows.length} total`)
  return { table, rows: rows.length, encrypted, skipped, errors }
}

async function main() {
  console.log(`Encrypting existing secrets${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`)
  const tables = TABLE_ARG ? [TABLE_ARG] : Object.keys(PLAN)
  const results = []
  for (const t of tables) {
    if (!PLAN[t]) {
      console.error(`unknown table: ${t}`)
      continue
    }
    results.push(await migrateTable(t, PLAN[t]))
  }
  console.log('\n=== Summary ===')
  for (const r of results) {
    console.log(`  ${r.table}: ${r.encrypted} encrypted / ${r.skipped} skipped / ${r.errors} errors / ${r.rows} total`)
  }
  const totalErr = results.reduce((a, r) => a + r.errors, 0)
  process.exit(totalErr === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('fatal:', e)
  process.exit(1)
})
