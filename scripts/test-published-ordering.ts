// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Most recent post" must mean the most recent post.
//
// blog_posts.published_at is nullable and has no database default. In Postgres
// `order by published_at desc` puts NULLs FIRST, so one published row without a
// date outranks every genuinely recent post, forever, in every query that asks
// for the newest.
//
// Two of those queries decide what the AI writes. The blog generator takes the
// 2 most recently published posts as its voice anchors and the 20 most recent as
// internal-link candidates. A single dateless row would therefore capture both
// lists and quietly become the model for everything that creator wrote
// afterwards, with nothing in the output to show for it.
//
// The row that would have created one was the LTK generator, inserting with
// status 'published' and no published_at. That insert is fixed. This test holds
// the other half: the reads must not be able to be captured by a dateless row
// arriving from anywhere else later.
//
// Checked in the database when this was written: 0 of 1,447 published posts had
// no date, so this never fired. It is guarded because the cost of it firing is
// invisible and permanent, and the cost of guarding is one option object.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (['node_modules', '.next', '.git'].includes(e)) continue
    const f = join(d, e)
    if (statSync(f).isDirectory()) walk(f)
    else if (/\.tsx?$/.test(e)) files.push(f)
  }
}
for (const d of ['app', 'lib']) walk(join(root, d))

/** The table a query is against, read from the nearest preceding .from(). */
function tableFor(src: string, at: number): string {
  const before = src.slice(Math.max(0, at - 700), at)
  const froms = [...before.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g)]
  return froms.length ? froms[froms.length - 1][1] : '?'
}

// ── every blog_posts "newest first" read is NULL-safe ───────────────────────
{
  let checked = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\.order\('published_at',\s*\{([^}]*)\}\s*\)/g)) {
      const opts = m[1]
      if (!/ascending:\s*false/.test(opts)) continue // ascending puts NULLs last already
      if (tableFor(src, m.index) !== 'blog_posts') continue
      checked++
      const line = src.slice(0, m.index).split('\n').length
      check(
        `${f.replace(root, '')}:${line} orders blog_posts newest-first NULL-safely`,
        /nullsFirst:\s*false/.test(opts),
        'without nullsFirst: false a dateless published row sorts above every real post and captures this list',
      )
    }
  }
  check('the scan actually found the queries it is guarding', checked >= 10,
    `only ${checked} matched, so this test may be checking nothing`)
}

// ── the insert that would have created such a row ───────────────────────────
{
  const ltk = readFileSync(join(root, 'app/api/ltk/generate/route.ts'), 'utf8')
  const stmt = ltk.slice(ltk.indexOf("from('blog_posts').insert("), ltk.indexOf("from('blog_posts').insert(") + 900)
  check('the LTK insert sets published_at', /published_at:/.test(stmt),
    'this is the route that would manufacture a dateless published row')
  check('and leaves it null for a draft', /isDraft \? null/.test(stmt),
    'a draft has not been published, so dating it would be a different lie')
}

// ── no new insert may publish without a date ────────────────────────────────
// The read-side guard above makes a dateless row harmless to the AI, but such a
// row is still wrong: it claims a post was published at no particular time.
{
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/from\(\s*'blog_posts'\s*\)\s*\.insert\(/g)) {
      let i = m.index + m[0].length - 1, depth = 0, end = i
      for (; i < src.length; i++) {
        const c = src[i]
        if (c === '(') depth++
        else if (c === ')') { depth--; if (depth === 0) { end = i; break } }
      }
      const stmt = src.slice(m.index, end + 1)
      if (!/status:\s*'published'|isDraft \?|status === 'draft' \?/.test(stmt)) continue
      const line = src.slice(0, m.index).split('\n').length
      check(
        `${f.replace(root, '')}:${line} sets published_at when inserting a published post`,
        /published_at/.test(stmt),
        'the column is nullable with no default, so omitting it stores a published post with no publication date',
      )
    }
  }
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
