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
