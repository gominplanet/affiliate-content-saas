// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The column that lets a published post answer for itself.
//
// A post turned up on geni.us while the account believed Passport was on.
// Answering it took reading four generator routes, checking the branch ordering
// in each, querying the integrations row, and finally noticing the post predated
// the setting by a day. The post knew the whole time; nothing was written down.
//
// Migration 317 derives blog_posts.link_style from the post's own content, in
// SQL, so it covers every one of the hundred-plus writers rather than the nine
// that happen to resolve a link style today.
//
// That puts real logic in a migration, where none of the usual tests reach it.
// This is not a substitute for a database: it cannot execute the SQL. What it
// CAN do is fail the build if a case is dropped, if the precedence stops
// matching lib/link-style.ts, or if someone changes the Passport domain here
// without changing it there. Those are the ways this column would start lying,
// and a column that lies is worse than the blank we had before.
import { readFileSync } from 'node:fs'
import { pickLinkStyle } from '../lib/link-style'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const sql = readFileSync(new URL('../supabase/migrations/317_blog_post_link_style.sql', import.meta.url), 'utf8')
// The header comment names these domains too, in prose, so precedence has to be
// read from the CASE expression itself rather than from the file.
const caseBlock = sql.slice(sql.indexOf('select case'), sql.indexOf('end\n$$'))

// ── every style MVP can build is recognised ─────────────────────────────────
// A missing case is not a crash. It is a post that silently reports null, which
// reads exactly like "no affiliate link" and sends the next investigation down
// the same road this column was built to close.
{
  for (const style of ['passport', 'geniuslink', 'bitly', 'direct'] as const) {
    check(`${style} is a possible answer`, new RegExp(`'${style}'`).test(sql))
  }
  for (const [style, host] of [
    ['passport', 'mvpl\\.ink'],
    ['geniuslink', 'geni\\.us'],
    ['bitly', 'bit\\.ly'],
    ['direct', 'amazon\\.'],
  ] as const) {
    check(`${style} matches on its real domain`, sql.includes(host), `expected ${host} in the SQL`)
  }
}

// ── the precedence matches the code that CHOOSES the style ──────────────────
// pickLinkStyle resolves Passport first. If the migration read the content in a
// different order, a post carrying a Passport CTA and a bare Amazon mention
// would be labelled 'direct' while every other surface called it 'passport',
// and the column would be actively misleading.
{
  const order = ['mvpl', 'geni', 'bit', 'amazon']
    .map(h => ({ h, at: caseBlock.indexOf(h) }))
  check('all four domains are present', order.every(o => o.at >= 0), JSON.stringify(order))
  for (let i = 1; i < order.length; i++) {
    check(`${order[i - 1].h} is checked before ${order[i].h}`,
      order[i - 1].at < order[i].at,
      'precedence must match pickLinkStyle, where Passport wins outright')
  }
  // The claim above, stated against the real function rather than a comment.
  check('pickLinkStyle really does put Passport first',
    pickLinkStyle({ passportEligible: true, mode: 'geniuslink', hasBitly: true, hasGeniuslink: true }) === 'passport')
  check('and really does fall to direct when a style has no credentials',
    pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: false }) === 'direct',
    'which is why a post can read "direct" while the settings say Geniuslink, exactly as one account did')
}

// ── it reads the artifact, not the intent ───────────────────────────────────
// A route that meant to mint a Passport link but whose mint failed publishes a
// plain tagged Amazon link. Recording the intent would label that post
// 'passport' while containing no Passport link, which is the invisible failure
// this column exists to end.
{
  check('the value is derived from the post content', /new\.content/.test(sql))
  check('and by a trigger, so every writer is covered',
    /create trigger trg_blog_posts_link_style/.test(sql))
  check('on insert AND on a content change, so a regenerated post is not stale',
    /before insert or update of content/.test(sql))
}

// ── the archive is answered too ─────────────────────────────────────────────
// Without the backfill this answers for posts made from today, and the post
// that prompted it stays unexplained.
{
  check('existing posts are backfilled', /update public\.blog_posts/.test(sql))
  check('and the backfill uses the same function as the trigger',
    (sql.match(/public\.blog_post_link_style\(/g) || []).length >= 3,
    'two copies of this rule would drift the moment one was corrected')
}

// ── the column is queryable at the scale it will be used ────────────────────
{
  check('there is an index for "show me every post on X"',
    /create index if not exists blog_posts_link_style_idx/.test(sql))
  check('and it is scoped per user, which is how it will be filtered',
    /\(user_id, link_style\)/.test(sql))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
