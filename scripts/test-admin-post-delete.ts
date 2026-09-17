// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DELETING SOMEBODY ELSE'S PUBLISHED POSTS, FROM AN ADMIN SCREEN.
//
// A campaign retry published four duplicate posts for a creator. MVP's own
// delete is scoped to the caller, so the only person who could clean up a bug
// WE caused was the person it happened to, and he had to do it in exactly the
// right place or it cost him his monthly allowance:
//
//   the allowance is COUNT(blog_posts) in the billing window, not a counter
//
// so deleting in WP admin takes the post off his site and leaves the row, and
// the slot stays spent. That is not something a customer should have to know,
// and it is why this exists.
//
// It is also the most destructive thing in the admin area: it removes articles
// from a paying customer's live site and cannot be undone. Three ways it can do
// harm, all pinned below.
//
//   THE WRONG ACCOUNT   an id from one creator reaching another's post because
//                       a request said so. Scoped to both.
//   A SILENT HALF       our row deleted while the post is still live. The slot
//                       reads as returned, their readers can still see the
//                       article, and MVP no longer knows it exists. This is the
//                       trade the creator-facing route makes deliberately, and
//                       it is the wrong one for an admin cleaning up our mess.
//   NO CONFIRMATION     one click between a stray checkbox and a customer's
//                       published articles.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const strip = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const RAW = readFileSync('app/api/admin/user-posts/route.ts', 'utf8')
const API = strip(RAW)
const PAGE = strip(readFileSync('app/(dashboard)/admin/users/page.tsx', 'utf8'))

// ── it is admin only, both ways in ────────────────────────────────────────
{
  check('there is an admin gate', /tier !== 'admin'/.test(API) && /Admin only/.test(API))
  check('and it guards the LIST as well as the delete',
    (API.match(/requireAdmin\(\)/g) ?? []).length >= 2,
    'a list of another customer\'s posts is not public either')
}

// ── never the wrong account ───────────────────────────────────────────────
{
  check('the delete is scoped to the named creator AND the ids',
    /\.eq\('user_id', userId\)\s*\n\s*\.in\('id', postIds\)/.test(API),
    'ids alone would let a request reach a post on another account')
  check('and every row write is scoped to them too',
    /\.delete\(\)\.eq\('id', postId\)\.eq\('user_id', userId\)/.test(API))
  check('the number of posts per call is bounded', /MAX_DELETE_PER_CALL/.test(API),
    'an unbounded list of ids against a live site is not a thing to accept from a form')
}

// ── THE HALF-STATE: a refused WordPress delete must change NOTHING ────────
//
// The creator-facing route deletes our row whatever WordPress says, and for
// them that is a defensible trade. Here it is not: it would report a freed slot
// for a post their readers can still see, and leave an article on their site
// that MVP no longer knows about.
{
  // Counted, not pattern-matched. The first version of this clause looked for
  // a clearRow AFTER the refused push, so a mutation that put one BEFORE it
  // sailed through. There are exactly three places a row may be cleared, and a
  // fourth is the bug.
  const clearCalls = (API.match(/await clearRow\(/g) ?? []).length
  check('a row is cleared in exactly the three cases that earn it',
    clearCalls === 3,
    `found ${clearCalls}: never live, removed, and already gone. A fourth means a refusal is clearing it too, which reports a returned slot for an article that is still published`)
  check('and it says plainly that nothing changed',
    /Nothing was changed in MVP either/.test(RAW),
    'silence here reads as a completed delete')
  check('and it does not count as a freed slot',
    /outcome: 'refused',\s*\n\s*detail: `WordPress would not delete it[\s\S]{0,300}?freedSlot: false/.test(RAW),
    'the slot is only back when the post is actually gone')
}

// ── a post already gone on their side is a stale record, not a failure ────
{
  check('an invalid post id clears the row', /isStalePostError\(e\)/.test(API) && /already gone/.test(RAW))
  check('and is reported as a cleared record rather than a deletion',
    /had already been deleted on WordPress/.test(RAW))
  check('a post that was never published is handled too', /never live/.test(RAW))
}

// ── the queue is emptied before the row goes ──────────────────────────────
{
  const clear = API.slice(API.indexOf('async function clearRow'))
  check('pending social pushes are cancelled first',
    clear.indexOf("from('scheduled_posts')") < clear.indexOf("from('blog_posts')"),
    'a push that fires after the post is gone shows up as a failure the creator did not cause')
  check('and only pending ones', /\.eq\('status', 'pending'\)/.test(clear),
    'a completed push is history and deleting it rewrites what happened')
}

// ── the right site, for a creator with several blogs ──────────────────────
{
  check('the delete is routed to the site the post lives on',
    /getWordPressCredentials\(admin, userId, post\.wordpress_site_id \?\? undefined/.test(API),
    'a WordPress post id only means something inside one blog')
}

// ── the screen ────────────────────────────────────────────────────────────
{
  check('it is reachable from the user card', /\/api\/admin\/user-posts/.test(PAGE))
  check('deleting takes a confirmation', /deleteConfirm/.test(PAGE),
    'one click between a stray checkbox and a customer\'s published articles')
  check('and the confirmation names the cost',
    /from \{user\.email\}&apos;s live site\. It cannot be undone\./.test(PAGE),
    '"are you sure" tells somebody nothing about what they are about to do')
  check('a selection is never carried to a different creator',
    /setPicked\(new Set\(\)\)/.test(PAGE) && /setPostsOpen\(false\)/.test(PAGE),
    'that is how the wrong person loses posts')
  check('a delete that could not run is not shown as one that deleted nothing',
    /could not run, so nothing was changed/.test(PAGE))
  check('and each post says what actually happened to it', /r\.outcome/.test(PAGE) && /r\.detail/.test(PAGE),
    'a summary alone hides a refusal inside a mostly-successful run')
}

// ── house style ───────────────────────────────────────────────────────────
{
  const sentences = (RAW.match(/detail: [`'][^`']+[`']/g) ?? [])
  check('there are messages to check', sentences.length >= 4, String(sentences.length))
  for (const s of sentences) {
    check(`no dash punctuation in ${s.slice(8, 48)}`, !/[—–]|\s-\s/.test(s))
    check(`no year in ${s.slice(8, 48)}`, !/\b20\d{2}\b/.test(s))
  }
}

if (failures.length) {
  console.error(`\n❌ admin-post-delete: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ admin-post-delete: a refused WordPress delete changes nothing here either, and the slot is only back when the post is gone')
