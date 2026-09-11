// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Post not found" was never true.
//
// A creator published a buying guide, saw it in the Posts tab, clicked Change
// thumbnail on it, and was told the post did not exist. It did. It was live on
// their blog and on their screen. What did not exist was MVP's blog_posts ROW
// for it, because that insert runs AFTER the WordPress publish and was written
// with no error branch: a constraint violation published the post and returned
// ok. Every later action on that post then looked the row up, missed, and
// reported the wrong noun as missing.
//
// Changing a featured image needs two things, and a blog_posts row is neither of
// them: the WordPress post id, and the credentials for the site it is on. So an
// untracked post is now handled. The whole risk of handling it lives in one
// place — post 1234 exists on every WordPress install in the world, so acting on
// a bare numeric id without knowing the blog means replacing a stranger's hero
// image. That guard is the bulk of what is asserted here.
import {
  classifyPostRef, hostOfUrl, sameWpHost, siteIdForPermalink,
  describeUnresolvedTarget, confirmUntrackedSite, type WpPostTarget,
} from '../lib/wp-post-target'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── telling the two id forms apart ──────────────────────────────────────────
//
// Video cards send the blog_posts UUID; the Posts tab is built from WP REST and
// sends the WordPress numeric id for every row, tracked or not. Both arrive as
// strings on one parameter.
{
  const uuid = '6cfb8690-1f0c-4b1a-9f3e-2b7a1d4c8e55'
  check('a UUID is recognised', classifyPostRef(uuid).kind === 'uuid')
  check('and carries no WP id', classifyPostRef(uuid).wpPostId === null)

  check('a numeric id is a WordPress id', classifyPostRef('4821').kind === 'wp-id')
  check('and is parsed as a number', classifyPostRef('4821').wpPostId === 4821,
    'the lookup compares against an integer column')

  // Zero, negatives and overflow are not post ids. Passing one through would
  // send WordPress a request that cannot match anything, and the 404 that came
  // back would be blamed on the post rather than on the id.
  check('zero is not a post id', classifyPostRef('0').kind === 'unknown')
  check('an oversized number is not a post id',
    classifyPostRef('99999999999999999999').kind === 'unknown')
  check('an empty reference is unknown', classifyPostRef('').kind === 'unknown')
  check('a null reference is unknown', classifyPostRef(null).kind === 'unknown')
  check('a slug is unknown', classifyPostRef('best-luggage-guide').kind === 'unknown')
}

// ── two spellings of the same site ──────────────────────────────────────────
//
// The stored site URL and the live permalink disagree constantly: http vs
// https, www vs bare, a trailing slash. None of those mean a different blog.
{
  check('protocol is ignored', sameWpHost('http://gominreviews.com/x', 'https://gominreviews.com'))
  check('www is ignored', sameWpHost('https://www.gominreviews.com/x/', 'https://gominreviews.com'))
  check('case is ignored', sameWpHost('https://GominReviews.com/x', 'https://gominreviews.com'))
  check('a bare host with no scheme still parses',
    hostOfUrl('gominreviews.com/best-luggage') === 'gominreviews.com')

  // The important half. Two different blogs must never compare equal, and a
  // subdomain is a different site.
  check('a different domain is a different site',
    !sameWpHost('https://reviewcentralhub.com/x', 'https://gominreviews.com'))
  check('a subdomain is a different site',
    !sameWpHost('https://shop.gominreviews.com/x', 'https://gominreviews.com'))

  // An unparseable URL must not match ANYTHING, including another unparseable
  // one. Comparing '' === '' would make two unknowns look like the same site,
  // which is exactly the case where an unguarded write does the damage.
  check('an unparseable url matches nothing', !sameWpHost('not a url', 'https://gominreviews.com'))
  check('two unparseable urls do not match each other', !sameWpHost('', ''),
    'empty === empty would read as "same site" and wave the write through')
}

// ── picking the site a permalink belongs to ─────────────────────────────────
//
// A Pro creator has up to ten blogs. "The default site" is a guess, and a wrong
// guess writes to the wrong blog.
{
  const sites = [
    { id: 'site-main', url: 'https://gominreviews.com' },
    { id: 'site-wine', url: 'https://www.winepicks.example' },
  ]
  check('a permalink finds its own site',
    siteIdForPermalink(sites, 'https://gominreviews.com/best-luggage/') === 'site-main')
  check('www differences do not hide a match',
    siteIdForPermalink(sites, 'http://winepicks.example/a-post') === 'site-wine')
  check('a permalink on no connected site resolves to nothing',
    siteIdForPermalink(sites, 'https://someoneelse.com/post') === null,
    'returning the default site here is how a post lands on the wrong blog')
  check('no permalink resolves to nothing', siteIdForPermalink(sites, null) === null)
  check('no connected sites resolves to nothing', siteIdForPermalink([], 'https://gominreviews.com/x') === null)
}

// ── the guard on acting without a row ───────────────────────────────────────
{
  const untracked = (wpPostId: number | null): WpPostTarget =>
    ({ mvpId: null, wpPostId, siteId: null, via: 'untracked', untracked: true })
  const tracked: WpPostTarget =
    { mvpId: 'a1b2c3d4-0000-4000-8000-000000000000', wpPostId: 4821, siteId: 'site-main', via: 'wp-id', untracked: false }

  // A tracked post carries its own site on its row. Nothing to prove.
  check('a tracked post is not blocked',
    confirmUntrackedSite(tracked, null, 'https://gominreviews.com') === null)

  // The case this whole file exists for: no row, but the permalink and the
  // credentials agree on the blog, so the thumbnail can be replaced.
  check('an untracked post on a matching site proceeds',
    confirmUntrackedSite(untracked(4821), 'https://gominreviews.com/best-luggage/', 'https://www.gominreviews.com') === null,
    'this is the buying-guide case — refusing it is the bug being fixed')

  // And the case that must never proceed.
  const mismatch = confirmUntrackedSite(untracked(4821), 'https://reviewcentralhub.com/post', 'https://gominreviews.com')
  check('an untracked post on a different site is refused', mismatch !== null)
  check('and the refusal names both hosts',
    /reviewcentralhub\.com/.test(mismatch ?? '') && /gominreviews\.com/.test(mismatch ?? ''),
    String(mismatch))

  const noUrl = confirmUntrackedSite(untracked(4821), null, 'https://gominreviews.com')
  check('an untracked post with no permalink is refused', noUrl !== null,
    'a bare post id names no blog, and post 4821 exists on every WordPress install')
  check('an untracked target with no WP id is refused',
    confirmUntrackedSite(untracked(null), 'https://gominreviews.com/x', 'https://gominreviews.com') !== null)
}

// ── the message says which thing is missing ─────────────────────────────────
//
// "Post not found" sent people looking for a deleted post. The two real causes
// need different actions, so they get different sentences, and neither claims
// the post is gone.
{
  const unknown = describeUnresolvedTarget('unknown', false)
  const noUrl = describeUnresolvedTarget('wp-id', false)
  const noMatch = describeUnresolvedTarget('wp-id', true)

  for (const [label, msg] of [['unknown ref', unknown], ['no permalink', noUrl], ['no matching site', noMatch]] as const) {
    check(`the ${label} message does not claim the post is gone`,
      !/not found|doesn’t exist|does not exist/i.test(msg), msg)
    check(`the ${label} message tells the creator what to do`,
      /try again|Setup/i.test(msg), msg)
  }
  check('the three causes read differently',
    new Set([unknown, noUrl, noMatch]).size === 3,
    'one message for three causes is what made this take a week to find')
}

// ── the callers still send what the guard needs ─────────────────────────────
//
// The guard is only reachable if the page passes the permalink through. Both
// callers dropped it before this change, which is why an untracked post could
// not be placed at all. A source assertion, because the alternative is mounting
// the Content page in a test to discover a prop went missing.
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const PAGE = readFileSync('app/(dashboard)/content/page.tsx', 'utf8')
  const BTN = readFileSync('components/content/ChangeThumbnailButton.tsx', 'utf8')
  const ROUTE = readFileSync('app/api/blog/thumbnail/route.ts', 'utf8')

  check('the Posts tab sends the permalink to Change thumbnail',
    /<ChangeThumbnailButton[^>]*postUrl=\{post\.link\}/.test(PAGE),
    'without it every untracked post is refused, which is the old behaviour')
  check('the Posts tab prefers the blog_posts UUID when it has one',
    /<ChangeThumbnailButton[^>]*postId=\{post\.mvpId \|\| String\(post\.id\)\}/.test(PAGE))
  check('the button forwards the permalink to the route',
    /postUrl:\s*postUrl \|\| null/.test(BTN))
  check('the route reads it', /postUrl/.test(ROUTE))
  check('the route runs the host guard before writing',
    ROUTE.indexOf('confirmUntrackedSite') < ROUTE.indexOf('uploadImageFromBase64'),
    'a guard after the upload is not a guard')
  check('an untracked success is reported as untracked',
    /tracked:\s*!target\.untracked/.test(ROUTE),
    'the image changes either way; the creator has to know the post is still invisible to MVP')
}

// ── the orphan is not created in the first place ────────────────────────────
//
// The root cause: buying-guides published to WordPress, then inserted its
// blog_posts row with no error branch and returned ok regardless.
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const GUIDES = readFileSync('app/api/buying-guides/route.ts', 'utf8')

  check('the guide insert reads its error', /error:\s*saveErr/.test(GUIDES),
    'this single missing check is where the orphaned posts came from')
  check('a failed insert is logged with the WP id',
    /console\.error\('\[buying-guides\] blog_posts insert failed'/.test(GUIDES),
    'the live post has to be findable afterwards')
  check('the response says whether the post was recorded',
    /tracked:\s*!!saved\?\.id/.test(GUIDES))
  check('the legacy site sentinel is never written to the uuid column',
    /site\.site_id !== 'legacy'/.test(GUIDES),
    "'legacy' means no wordpress_sites row; writing it into a uuid column fails the whole insert")
  check('the guide UI surfaces an untracked publish',
    /tracked === false/.test(readFileSync('app/(dashboard)/buying-guides/page.tsx', 'utf8')),
    'a plain success toast is how the creator finds out a week later, from a broken button')
}

if (failures.length) {
  console.error(`\n❌ wp-post-target: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ wp-post-target: a missing row is not a missing post, and a bare post id never lands on the wrong blog')
