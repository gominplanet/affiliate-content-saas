// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for the pinned first comment Co-Pilot posts (migration 377), and
// Encore adding its sale to that comment instead of a second one.

import { readFileSync } from 'node:fs'
import { firstCommentDue } from '../lib/first-comments'
import { productLinkIn, withLinkDisclosure, fallbackFirstComment } from '../lib/first-comment-text'
import { canUsePreview } from '../lib/labs-preview'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrder = (src: string, a: string, b: string) => { const i = src.indexOf(a), j = src.indexOf(b); return i > -1 && j > -1 && i < j }

// ── the quota: a waiting video is only asked about when there is a reason ──
{
  const now = Date.parse('2026-09-25T12:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  const H = 3_600_000
  check('never checked: checked now', firstCommentDue({ publish_at: null, last_checked_at: null }, now))
  check('scheduled for later: not asked about until its time',
    !firstCommentDue({ publish_at: iso(now + 5 * H), last_checked_at: iso(now - 10 * H) }, now))
  check('its time has come: asked every run for a day',
    firstCommentDue({ publish_at: iso(now - 0.2 * H), last_checked_at: iso(now - 0.1 * H) }, now))
  check('no schedule: at most every six hours',
    !firstCommentDue({ publish_at: null, last_checked_at: iso(now - 2 * H) }, now)
    && firstCommentDue({ publish_at: null, last_checked_at: iso(now - 7 * H) }, now))
  const CRON = read('app/api/cron/first-comments/route.ts')
  check('the job only checks the due ones, and is scheduled',
    /\.filter\(\(r\) => firstCommentDue\(r, now\)\)/.test(CRON) && /"\/api\/cron\/first-comments"/.test(read('vercel.json')))
}

// ── posting ─────────────────────────────────────────────────────────────────
{
  const L = read('lib/first-comments.ts')
  check('only a public video gets the comment, from its own channel',
    inOrder(L, "if (status.privacy !== 'public')", 'yt.postComment(') && inOrder(L, 'me.id !== status.channelId', 'yt.postComment('))
  check('what happened is saved: posted with the id, or failed with why, and a used-up quota waits',
    /state: 'posted', comment_id: id/.test(L) && /state: 'failed', last_error: error/.test(L) && /if \(\/quota\/i\.test\(msg\)\)/.test(L))
  const R = read('app/api/youtube/first-comment/route.ts')
  check('a video never gets a second first comment', inOrder(R, "existing?.state === 'posted' && existing.comment_id", 'postFirstCommentIfPublic('))
  check('it is Pro (out of Labs, September), behind the same switch', /canUsePreview\('first_comment'/.test(R) && canUsePreview('first_comment', 'admin') && canUsePreview('first_comment', 'pro') && !canUsePreview('first_comment', 'trial'))
  const M = read('supabase/migrations/377_video_first_comments.sql')
  check('migration 377 is twice-runnable, one row per video', /create table if not exists public\.video_first_comments/.test(M) && /create unique index if not exists video_first_comments_video_idx/.test(M))
}

// ── the page ────────────────────────────────────────────────────────────────
{
  const P = read('app/(dashboard)/co-pilot/page.tsx')
  check('pushing queues it (both push paths), and the creator can switch it off first',
    (P.match(/setApplied\(true\)\s*\n\s*void queueFirstComment\(\)/g) ?? []).length === 2 && /Post and pin it for me/.test(P))
  check('pinned is said only when SCOUT saw it, and the result is saved',
    /res\.ok && res\.pinned \? \{ pinned: true \}/.test(read('lib/first-comment-pins.ts')) && /action: 'pin_result'/.test(read('lib/first-comment-pins.ts'))
    && /import \{ pinFirstComment \} from '@\/lib\/first-comment-pins'/.test(P))
  check('posted comments not yet pinned can be pinned in one press', /<FirstCommentsToPin \/>/.test(P) && /Pin them with SCOUT/.test(P))
}

// ── Encore adds to it, and puts it back ─────────────────────────────────────
{
  const C = read('app/api/on-sale/comment/route.ts')
  check('Encore edits the pinned first comment instead of posting a second one',
    inOrder(C, "from('video_first_comments')", 'const id = await yt.postComment(videoId, text)')
    && /yt\.updateComment\(first\.comment_id, combined\)/.test(C))
  check('and the sale ending restores the original comment exactly', /lasting_text: first\.text/.test(C))
  check('a deleted first comment falls back to a new comment, and says so on its row', /The first comment is no longer on the video\./.test(C))
  check('the Encore page does not re-pin a comment that already holds the pin', /if \(j\.pinned\) \{ setPin\(\{ pinned: true \}\); return \}/.test(read('components/labs/OnSale.tsx')))
}

// ── Every Co-Pilot and Liftoff upload gets one, and it says it is a paid link ──
{
  check('the product link is the description\'s own, not a social link',
    productLinkIn('Subscribe https://youtube.com/@me\nGet it: https://mvpl.ink/Ab12Cd. Follow https://instagram.com/me') === 'https://mvpl.ink/Ab12Cd')
  check('no link, no link', productLinkIn('just words') === null)
  check('a bare affiliate link gets "(paid link)" beside it', withLinkDisclosure('Grab it here https://amzn.to/x !', 'https://amzn.to/x') === 'Grab it here https://amzn.to/x (paid link) !')
  check('an already disclosed comment is left alone', withLinkDisclosure('https://amzn.to/x #ad', 'https://amzn.to/x') === 'https://amzn.to/x #ad')
  check('the plain comment discloses its link', /https:\/\/amzn\.to\/x \(paid link\)/.test(fallbackFirstComment('T', 'https://amzn.to/x')))
  const DRAIN = read('app/api/cron/launch-drain/route.ts')
  check('Liftoff queues a first comment for every video it uploads, behind the Labs gate, never failing the upload',
    /if \(canUsePreview\('first_comment', tier\)\) \{\s*const q = await queueFirstComment\(sb, \{/.test(DRAIN) && /\[launch-drain\] first comment not queued/.test(DRAIN)
    && DRAIN.indexOf('await queueFirstComment(sb, {') < DRAIN.indexOf('const handed = await handOverToAmazon(sb, it, videoId, channelId, goNow'))
  check('videos Liftoff uploaded before this, or whose queueing failed, are caught up',
    /async function firstCommentCatchUp\(/.test(DRAIN) && /await firstCommentCatchUp\(sb, left\)/.test(DRAIN))
  const Q = read('lib/first-comment-queue.ts')
  check('one per video, whoever asks first', /if \(existing\) return \{ queued: false, why: 'already'/.test(Q) && /error\?\.code === '23505'/.test(Q))
  const ROUTE = read('app/api/youtube/first-comment/route.ts')
  check('a push with no generated comment still gets one, written from the video', /if \(!text\) \{\s*const w = await writeFirstComment\(/.test(ROUTE))
  const CP = read('app/(dashboard)/co-pilot/page.tsx')
  check('Co-Pilot queues on every push, not only when a comment was generated', /if \(!canFirstComment \|\| !firstCommentOn\) return/.test(CP) && !/!firstCommentOn \|\| !text\) return/.test(CP))
  const RUN = read('components/launch/LiftoffRunner.tsx')
  check('the Liftoff page pins what was posted since, and the hidden background tab never does (a pin brings YouTube to the front)',
    /void pinUntriedFirstComments\(\)\.then/.test(read('components/launch/LaunchBoard.tsx')) && !/pinUntriedFirstComments|requestPinComment/.test(RUN))
  const PINS = read('lib/first-comment-pins.ts')
  check('the background only pins what was never tried', /x\.pinned === null/.test(PINS))
  const REP = read('components/launch/LaunchReport.tsx')
  check('the launch report shows each video\'s first comment, pinned being the only yes',
    /<Check label="First comment"/.test(REP) && /fc\.pinned === true/.test(REP))
}

// ── Older videos: tick, and each is written, posted and pinned one at a time ──
{
  const LIST = read('app/api/youtube/first-comment/videos/route.ts')
  check('the older videos list is behind the Labs gate and can show only the ones without one',
    /canUsePreview\('first_comment', intg\?\.tier\)/.test(LIST) && /missing \? withFc\.filter\(\(x\) => !x\.fc \|\| x\.fc\.state === 'failed'/.test(LIST))
  const UI = read('components/first-comments/OlderVideos.tsx')
  check('one video at a time: post, then pin, each row saying what happened',
    /for \(let i = 0; i < list\.length; i\+\+\)/.test(UI) && /await pinFirstComment\(j\.id, v\.youtubeVideoId, j\.commentId\)/.test(UI)
    && /Posted and pinned\. SCOUT saw the pinned badge\./.test(UI) && /Posted, not pinned: /.test(UI))
  check('YouTube\'s daily limit stops the run and says so, nothing after it marked failed',
    /if \(j\.reason === 'quota'\) \{/.test(UI) && /Not started: the daily limit is used up/.test(UI))
  check('a video not public yet is held, not failed', /j\.reason === 'not_public'/.test(UI) && /step: 'held'/.test(UI))
  check('the run can be stopped between videos', /if \(stop\.current\) \{/.test(UI) && /Stop after this one/.test(UI))
  check('the waiting reason comes back from the post step', /reason: 'quota'/.test(read('lib/first-comments.ts')) && /reason: 'not_public'/.test(read('lib/first-comments.ts')))
  check('it is in the Labs menu', /href: '\/first-comments'/.test(read('components/layout/DashboardShellV2.tsx')))
}

// ── A video one login cannot see is not deleted; a deleted one is forgotten ──
{
  const L = read('lib/first-comments.ts')
  check('every connected channel is asked before a video is called missing',
    /const others = \(await listYouTubeChannels\(sb, row\.user_id\)/.test(L) && /if \(seen\) \{ yt = other; status = seen;/.test(L))
  check('a video its own connected channel cannot see is forgotten, and only once its login is confirmed to be that channel',
    /if \(connected && ownerConfirmed\) \{\s*await sb\.from\('video_first_comments'\)\.delete\(\)/.test(L) && /ownerConfirmed = !!mine && mine\.id === owner/.test(L) && /from\('youtube_videos'\)\.delete\(\)/.test(L) && /return \{ state: 'gone' \}/.test(L))
  check('comments written off by the old single-login check get one more look',
    /\.like\('last_error', 'The saved login cannot see this video%'\)/.test(read('app/api/cron/first-comments/route.ts')))
  const CP = read('app/(dashboard)/co-pilot/page.tsx')
  check('every first comment problem can be tried again or dismissed',
    /onClick=\{\(\) => void retry\(r\)\}/.test(CP) && /onClick=\{\(\) => void dismiss\(r\.id\)\}/.test(CP)
    && /body\.action === 'dismiss'/.test(read('app/api/youtube/first-comment/[id]/route.ts')))
}

// 2026-10-07: forgetting a deleted video deleted its row, and the row's blog
// posts, drafts, scheduled posts and clips went with it (on delete cascade).
check('a deleted video keeps its row when anything was made from it',
  /if \(vid\?\.id && !\(await holdsMadeContent\(sb, vid\.id\)\)\) await sb\.from\('youtube_videos'\)\.delete\(\)/.test(read('lib/first-comments.ts'))
  && /for \(const table of \['blog_posts', 'social_drafts', 'scheduled_posts', 'youtube_shorts'\]\)/.test(read('lib/first-comments.ts')))

if (failures.length) {
  console.error(`\n❌ first-comments: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ first-comments: posted when public, pinned by SCOUT, one per video, and Encore adds to it and puts it back')
