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
import { videoIdOfFile } from '../lib/thumbnail-duplicates'
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

// ── a post that already exists still gets its image ────────────────────────
//
// Autopilot published a post with no featured image and no flag: an attempt
// that published and then ran out of time is retried with the saved post id,
// and a post adopted by its slug also has one, and both used to skip the
// upload outright. The heal only visited creators with a flagged post, so
// nothing ever fixed it.
{
  const GEN = readFileSync('app/api/blog/generate/route.ts', 'utf8')
  check('an existing post with no featured image gets one',
    /const current = await wpService\.getFeaturedMedia\(wpPost\.id\)/.test(GEN) && /attemptThumb = current === 0/.test(GEN) && /if \(attemptThumb\) \{/.test(GEN),
    'a retried or adopted post skips the upload and publishes with no image')
  check('and its outcome is recorded whenever the upload was attempted',
    /\.\.\.\(attemptThumb \? \{ thumbnail_blocked: thumbnailBlocked \} : \{\}\)/.test(GEN))
  check('"could not read it" is never taken as "it has no image"',
    /return typeof p\?\.featured_media === 'number' \? p\.featured_media : null/.test(readFileSync('services/wordpress/index.ts', 'utf8')))
  const CRON = readFileSync('app/api/cron/heal-thumbnails/route.ts', 'utf8')
  check('the heal also checks everyone who published lately, flagged or not',
    /\.gte\('created_at', since\)/.test(CRON) && /reattachThumbnailsForOwner\(admin, ownerId, \{ limit: 10, onlyKnownMissing: true \}\)/.test(CRON))
  check('every mode uploads only where WordPress said the image is missing',
    /if \(existingMedia === undefined\) \{ checked--; continue \}/.test(heal) && !/opts\.onlyKnownMissing &&/.test(heal))

  // THE FLOOD. The probe was a logged-out fetch with status=any, which
  // WordPress refuses; every post read as unknown and was re-uploaded every
  // six hours. One thumbnail reached 65 copies on one site.
  check('the heal asks WordPress logged in, through the service',
    /wpService\.getFeaturedMediaMany\(wpIds\)/.test(heal) && !/status=any/.test(heal) && !/fetch\(/.test(heal))
  const WPS = readFileSync('services/wordpress/index.ts', 'utf8')
  const many = WPS.slice(WPS.indexOf('async getFeaturedMediaMany'), WPS.indexOf('async postExists'))
  check('the batch read uses status=any only when logged in, and a public read without it',
    /this\.request<unknown>\(`\/posts\?include=\$\{want\.join\(','\)\}&_fields=id,featured_media&per_page=100&status=any&context=edit`/.test(many)
    && /fetch\(`\$\{this\.baseUrl\}\/posts\?include=\$\{left\.join\(','\)\}&_fields=id,featured_media&per_page=100`/.test(many))
  check('a generation reads the image back at the end and sets it when missing',
    /const finalMedia = await wpService\.getFeaturedMedia\(wpPost\.id\)/.test(GEN) && /if \(finalMedia === 0\)/.test(GEN)
    && /await wpService\.updatePost\(wpPost\.id, \{ featured_media: media\.id \}\)/.test(GEN))

  // A VIDEO THAT IS NOT PUBLIC YET has no YouTube thumbnail (404 on both
  // sizes), which is how autopilot posts went live with no image.
  const AB = readFileSync('app/api/cron/auto-blog/route.ts', 'utf8')
  check('autopilot writes only about a video the public can watch',
    /new Date\(v\.published_at\)\.getTime\(\) <= nowMs/.test(AB) && /videoVisibility\(process\.env\.YOUTUBE_API_KEY/.test(AB)
    && /return vis === undefined \|\| vis === 'public'/.test(AB))
  check('and a video not public yet waits, it is not written off',
    /status: candidates\.length \? 'waiting_for_public_video' : 'no_videos_left'/.test(AB))
  const VT = readFileSync('lib/video-thumbnail-upload.ts', 'utf8')
  check('the thumbnail falls back to MVP\'s own copy after both YouTube sizes',
    VT.indexOf('maxresdefault') < VT.indexOf('hqdefault') && /tries\.push\(stored\)/.test(VT))
  check('the writer and the heal upload through the same order',
    /uploadVideoThumbnail\(wpService, \{ youtubeVideoId, customUrl: customBlogThumb, storedUrl: storedThumb \}\)/.test(GEN)
    && /uploadVideoThumbnail\(wpService, \{ youtubeVideoId: ytId/.test(readFileSync('lib/reattach-thumbnails.ts', 'utf8')))

  // THE CLEANUP of what the flood left.
  const DUP = readFileSync('lib/thumbnail-duplicates.ts', 'utf8')
  check('a duplicate is only a file named after one of the creator\'s videos, unattached, and nobody\'s featured image',
    /!m\.post && !used\.has\(m\.id\)/.test(DUP) && /videoIdOfFile\(m\.source_url, videoIds\)/.test(DUP))
  check('the last copy of a thumbnail always stays', /keepNewest \? sorted\.slice\(1\)/.test(DUP))
  check('each is checked again just before it is removed',
    /if \(!m \|\| m\.post \|\| used\.has\(id\) \|\| !videoIdOfFile\(m\.source_url, videoIds\)\) \{ skipped\+\+; continue \}/.test(DUP))
  const vids = new Set(['blllyaLxnWc', 'abc-12'])
  check('file names are matched the way WordPress numbers repeats',
    videoIdOfFile('https://x/wp-content/uploads/2026/09/blllyaLxnWc-64.jpg', vids) === 'blllyaLxnWc'
    && videoIdOfFile('https://x/blllyaLxnWc.jpg', vids) === 'blllyaLxnWc'
    && videoIdOfFile('https://x/blllyaLxnWc-blogthumb-3.jpg', vids) === 'blllyaLxnWc'
    && videoIdOfFile('https://x/abc-12.jpg', vids) === 'abc-12'
    && videoIdOfFile('https://x/header-banner.jpg', vids) === null
    && videoIdOfFile('https://x/blllyaLxnWc-product.png', vids) === null)
}

if (failures.length) {
  console.error(`\n❌ thumbnail-heal: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ thumbnail-heal: a post published without a featured image is recorded whichever path wrote it, and the heal can both see it and fix it')
