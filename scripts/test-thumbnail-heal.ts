// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A POST WITH NO FEATURED IMAGE IS RECORDED, AND CAN BE HEALED.
//
// Found by investigating why one creator's X posts had link cards with a title
// and a description and no picture. X reads og:image off the destination, and
// a WordPress post with no featured image has no og:image, so the card is
// blank. The trail led somewhere worse than the original question.
//
// THE MEASUREMENTS, all against production data:
//
//   blog_posts flagged by site   jdtheot.com 47 of 67, latest TODAY, on a flag
//                                that exists BECAUSE of an incident at that
//                                same site in 2026-07. Two months, never healed.
//
//   jdtheot /wp/v2/media         GET 200 with real media, POST 401
//                                rest_cannot_create. A 401 is WordPress
//                                answering, so there is no firewall: the
//                                connected user's credentials or upload_files
//                                capability are what broke, around 2026-08-29,
//                                which is the date of its last upload.
//
//   the creator who reported it  123 posts, every one post_type 'review', zero
//                                flagged. Not because the images were fine:
//                                blog/from-link never set the flag at all, so
//                                the zero was a column that could not be
//                                written rather than an answer.
//
// THREE THINGS KEPT IT INVISIBLE, and all three are checked below.
//
//   1. from-link never wrote thumbnail_blocked, so its posts were absent from
//      the heal cron, from /api/admin/thumbnail-blocks, and from the SEO page's
//      "N posts published without a thumbnail" row.
//
//   2. the heal query said .not('video_id', 'is', null), which drops every
//      link-written post BEFORE the loop. So flagging them without fixing this
//      would have produced a number on the SEO page that can only go up.
//
//   3. the heal had two sources for a replacement image and both come from a
//      source VIDEO. A link-written post has neither, hence hero_source_url.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const FROMLINK = readFileSync('app/api/blog/from-link/route.ts', 'utf8')
const HEAL = readFileSync('lib/reattach-thumbnails.ts', 'utf8')
const GENERATE = readFileSync('app/api/blog/generate/route.ts', 'utf8')
const strip = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const fl = strip(FROMLINK)
const heal = strip(HEAL)

// ── the flag is written by BOTH paths that publish ─────────────────────────
{
  check('generate still records it', /thumbnail_blocked: thumbnailBlocked/.test(strip(GENERATE)),
    'this is the path the flag was built for; if it stops, the whole mechanism is gone')
  check('and from-link records it too', /thumbnail_blocked: !featuredMedia/.test(fl),
    'its posts were invisible to every surface that reports this, which is how 123 of them read as fine')
  check('it is derived from what actually landed', /!featuredMedia/.test(fl),
    'anything else is recording the intent; featuredMedia is set only when WordPress accepted the upload')
  check('a database without migration 177 still saves the post',
    /column .\*\(thumbnail_blocked\|hero_source_url\).\* does not exist/.test(fl)
      || /thumbnail_blocked\|hero_source_url/.test(fl),
    'losing the flag is acceptable; losing the post is not')
}

// ── the heal can SEE a link-written post ───────────────────────────────────
{
  check('the heal no longer excludes video-less posts', !/\.not\('video_id', 'is', null\)/.test(heal),
    'that filter dropped every from-link post before the loop, so flagging them would only ever add to a number that never falls')
  check('and it reads the post columns with select(*)', /\.select\('\*, youtube_videos\(/.test(heal),
    'a named list breaks the whole read on any database that has not run migration 336')
}

// ── and has an image to re-attach ──────────────────────────────────────────
{
  check('from-link stores the hero source', /hero_source_url: productImageUrl \|\| null/.test(fl),
    'the heal\'s other two sources both come from a video this post does not have')
  check('the heal reads it', /const heroSource = \(p\.hero_source_url/.test(heal))
  check('it counts as a usable source', /!ytId && !customThumb && !heroSource/.test(heal),
    'the skip has to know about all three or the new column changes nothing')
  check('and it is actually uploaded', /uploadImageFromUrl\(heroSource/.test(heal),
    'a source that is read and never used is not a source')
  check('the video sources still win where they exist', /} else if \(!ytId && heroSource\) \{/.test(heal),
    'a post WITH a video should keep using its own frame; this is the fallback, not a replacement')
}

// ── the circuit breaker stops poking, it does not report ───────────────────
//
// Not changed here, and worth stating plainly rather than silently leaving.
// `if (stillBlocked >= 3 && fixed === 0 && alreadyOk === 0) break` is correct
// for one run: a site rejecting uploads should be poked three times, not forty.
// What is missing is anything that notices the SAME site failing every run for
// two months. jdtheot has been in that state since August.
{
  check('the per-run circuit breaker is still there',
    /if \(stillBlocked >= 3 && fixed === 0 && alreadyOk === 0\) break/.test(heal),
    'removing it would hammer a site that is already refusing')
  check('and failures carry a reason', /reason: \(err instanceof Error \? err\.message/.test(heal),
    'without it, "still blocked" cannot be told apart from "credentials revoked"')
}

if (failures.length) {
  console.error(`\n❌ thumbnail-heal: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ thumbnail-heal: a post published without a featured image is recorded whichever path wrote it, and the heal can both see it and fix it')
