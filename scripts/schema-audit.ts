// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which migrations has the live database actually run?
//
// Migration 274 sat unapplied on production for months. It adds the column that
// stores a creator's link style, and the read that decides that style named the
// column, so PostgREST rejected the whole read and EVERY creator resolved to
// plain Amazon links no matter what they had chosen. It cost real commission on
// real published videos, and nothing in the product could show it: the settings
// screen read the same row a different way and displayed the right answer.
//
// The lesson is not "run your migrations". It is that a missing migration is
// invisible from inside the app, so the check has to come from outside it, and
// it has to be mechanical. The first version of this audit was typed by hand and
// had two mistakes in it: a column name that did not exist (a false alarm we
// chased) and a table called "if", scraped out of `alter table if exists`.
//
// So: run this, paste the SQL it prints into the Supabase SQL editor, and any
// row that comes back is a table or column some migration promised and the
// database does not have. It is read-only.
//
//   npx tsx scripts/schema-audit.ts > /tmp/audit.sql
//
// Known false positives are objects a later migration replaced rather than
// dropped (creator_connections_catalog, superseded by cc_campaign_catalog in
// 161). Renames and explicit drops are already excluded below.

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'supabase', 'migrations')

/** A table reference in DDL, allowing for `if exists` and `only`, either of
 *  which the naive pattern happily captures AS the table name. */
const TABLE_REF = String.raw`(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z0-9_]+)`
/** Words that are never a table name, only ever a mis-capture. */
const NOT_A_TABLE = new Set(['if', 'only', 'exists', 'table', 'public'])

/**
 * Tables a later migration REPLACED without dropping.
 *
 * The point of this audit is that an empty result means the database matches
 * the code. A result you have to mentally filter is not that: the last run
 * returned four rows, three of them noise about a table nothing has read since
 * migration 161, and the one row that mattered sat underneath them. An audit
 * that cries wolf gets skimmed, and then the real row gets skimmed too.
 *
 * These were superseded rather than dropped, so the old table genuinely is not
 * in the database and genuinely should not be. Anything listed here needs a
 * reason and a successor, so this never becomes a place to hide a real gap.
 */
const SUPERSEDED = new Set([
  // 084/098/099 built it; migration 161 replaced it with cc_campaign_catalog.
  // Nothing outside a stale generated type has referenced it since.
  'creator_connections_catalog',
])

type Obj = { migration: string; table: string; column: string | null }

function collect(): Obj[] {
  const files = readdirSync(DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))

  const found: Obj[] = []
  // An object a later migration removed is not a gap. Tracked across all files
  // so a drop in 300 retires a column added in 100.
  const gone = new Set<string>()
  const key = (t: string, c: string | null) => `${t}|${c ?? ''}`

  for (const f of files) {
    const migration = (/^\d+/.exec(f) || ['?'])[0]
    // Comments first: commented-out DDL is documentation, not schema.
    const sql = readFileSync(join(DIR, f), 'utf8').replace(/--[^\n]*/g, '')

    for (const m of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z0-9_]+)/gi)) {
      found.push({ migration, table: m[1], column: null })
    }
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+table\s+${TABLE_REF}([\s\S]*?);`, 'gi'))) {
      const table = m[1]
      for (const c of m[2].matchAll(/add\s+column\s+if\s+not\s+exists\s+([a-z0-9_]+)/gi)) {
        found.push({ migration, table, column: c[1] })
      }
      for (const c of m[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z0-9_]+)/gi)) {
        gone.add(key(table, c[1]))
      }
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) {
      gone.add(key(m[1], null))
    }
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+table\s+${TABLE_REF}\s+rename\s+to\s+`, 'gi'))) {
      gone.add(key(m[1], null))
    }
  }

  const seen = new Set<string>()
  return found.filter(o => {
    if (NOT_A_TABLE.has(o.table)) return false
    if (SUPERSEDED.has(o.table)) return false
    const k = key(o.table, o.column)
    if (seen.has(k) || gone.has(k) || gone.has(key(o.table, null))) return false
    seen.add(k)
    return true
  })
}

const objects = collect()
const specs = objects.map(o => `'${o.migration}|${o.table}|${o.column ?? ''}'`)
const lines: string[] = []
for (let i = 0; i < specs.length; i += 5) {
  lines.push('    ' + specs.slice(i, i + 5).join(', ') + (i + 5 < specs.length ? ',' : ''))
}

console.log(`-- Schema audit: ${objects.length} objects every migration in supabase/migrations
-- promises. Read-only. Any row it returns is missing from the database.
with expected(spec) as (
  select unnest(array[
${lines.join('\n')}
  ])
), parsed as (
  select split_part(spec,'|',1) as mig,
         split_part(spec,'|',2) as tbl,
         nullif(split_part(spec,'|',3),'') as col
  from expected
)
select p.mig as migration, p.tbl as table_name, coalesce(p.col,'(whole table)') as missing
from parsed p
where case
  when p.col is null then not exists (
    select 1 from information_schema.tables t
    where t.table_schema='public' and t.table_name=p.tbl)
  else not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=p.tbl and c.column_name=p.col)
end
order by p.mig::int, p.tbl, p.col;`)

// ── Indexes: what the database HAS, not what we asked for ───────────────────
//
// The audit above answers "is anything we promised missing". This second query
// answers the opposite question, and it exists because getting that backwards
// cost a duplicate index in production.
//
// An index was reported as missing on the strength of a grep over this folder.
// It was not missing. It had been created directly in Supabase, so no migration
// file mentioned it, and a second identical one got added on top. Every write to
// that table then maintained both for no gain.
//
// The migrations folder records what we asked for. Only the database knows what
// it has, and indexes are the part most likely to differ, because they get added
// by hand in the SQL editor during a slow-query hunt and never written back.
//
// So: print every index, and flag the pairs covering the same columns on the
// same table. Duplicates come back as a DUPLICATE row.
console.log(`

-- ── Indexes actually in the database ────────────────────────────────────────
-- Read-only. Run this BEFORE concluding an index is missing: a grep over
-- supabase/migrations only shows what was asked for through a migration, and an
-- index added by hand in the SQL editor appears in neither.
-- Any row marked DUPLICATE is two indexes doing one job; drop the redundant one.
with idx as (
  select
    i.tablename,
    i.indexname,
    i.indexdef,
    -- the column list, normalised, so two indexes over the same columns match
    -- even when their names follow different conventions
    regexp_replace(i.indexdef, '^.*USING [a-z]+ \\((.*)\\)$', '\\1') as cols
  from pg_indexes i
  where i.schemaname = 'public'
)
select
  tablename,
  indexname,
  cols as indexed_columns,
  case when count(*) over (partition by tablename, cols) > 1
       then 'DUPLICATE' else '' end as flag
from idx
order by (case when count(*) over (partition by tablename, cols) > 1 then 0 else 1 end),
         tablename, cols, indexname;`)
