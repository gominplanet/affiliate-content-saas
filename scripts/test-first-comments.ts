// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for the pinned first comment Co-Pilot posts (migration 377), and
// Encore adding its sale to that comment instead of a second one.

import { readFileSync } from 'node:fs'
import { firstCommentDue } from '../lib/first-comments'
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
  check('it is behind Labs', /canUsePreview\('first_comment'/.test(R) && canUsePreview('first_comment', 'admin') && !canUsePreview('first_comment', 'pro'))
  const M = read('supabase/migrations/377_video_first_comments.sql')
  check('migration 377 is twice-runnable, one row per video', /create table if not exists public\.video_first_comments/.test(M) && /create unique index if not exists video_first_comments_video_idx/.test(M))
}

// ── the page ────────────────────────────────────────────────────────────────
{
  const P = read('app/(dashboard)/co-pilot/page.tsx')
  check('pushing queues it (both push paths), and the creator can switch it off first',
    (P.match(/setApplied\(true\)\s*\n\s*void queueFirstComment\(\)/g) ?? []).length === 2 && /Post and pin it for me/.test(P))
  check('pinned is said only when SCOUT saw it, and the result is saved',
    /res\.ok && res\.pinned \? \{ pinned: true \}/.test(P) && /action: 'pin_result'/.test(P))
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

if (failures.length) {
  console.error(`\n❌ first-comments: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ first-comments: posted when public, pinned by SCOUT, one per video, and Encore adds to it and puts it back')
