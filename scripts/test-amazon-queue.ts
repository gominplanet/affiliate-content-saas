// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A scheduled Amazon post had nowhere to be seen.
//
// Both composers on /amazon/social offer "Schedule post". The page walkthrough
// sells it in step 4: "Post now or schedule ... or queue it for later." The rows
// land in amazon_scheduled_posts and the cron publishes them.
//
// Nothing in the app has ever read that table. Not one page, not one route.
//
// So the feature was write-only. A creator scheduled a pin, got a green
// "Scheduled for Tuesday 3:00 PM", and that was the last they ever saw of it.
// No pending list. No history. No cancel. And when the cron failed at 3:00 PM it
// wrote the reason into a column with no reader, so the post simply never
// appeared and nothing anywhere said why. On the plan the ads point at.
//
// Migration 243 even created the index for the list — "A creator's own
// 'Scheduled' list, newest first" — and the list was never built.
//
// The fourth state is the one this file cares most about. A row can be
// 'completed' AND carry something the creator needs to read: the post went out,
// but the affiliate link was substituted. Green tick, wrong link. That has to
// look different from a clean success or it may as well not be recorded.
import { readFileSync } from 'node:fs'
import {
  queueOutcome, queueTone, queueCancellable, queueDetail, type QueueStatus,
} from '../lib/amazon-queue'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ALL: QueueStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled']

// ── published-with-a-caveat is its own outcome ──────────────────────────────
{
  check('a clean publish is sent', queueOutcome({ status: 'completed' }) === 'sent')
  check('a publish with a note is NOT the same outcome',
    queueOutcome({ status: 'completed', note: 'Passport could not mint.' }) === 'sent-note',
    'this is the whole point: same status, different thing to tell them')

  check('a clean publish reads as good', queueTone(queueOutcome({ status: 'completed' })) === 'good')
  check('a publish with a substituted link does NOT read as good',
    queueTone(queueOutcome({ status: 'completed', note: 'x' })) === 'warn',
    'a green tick over a wrong affiliate link is how this goes unnoticed forever')
  check('a failure reads as bad', queueTone(queueOutcome({ status: 'failed', error: 'x' })) === 'bad')

  // Every status resolves to something. A status added later that falls through
  // to 'waiting' would show a published post as still pending.
  for (const s of ALL) {
    const o = queueOutcome({ status: s })
    check(`${s} maps to an outcome`, typeof o === 'string' && o.length > 0)
  }
  check('pending is waiting', queueOutcome({ status: 'pending' }) === 'waiting')
  check('processing is not waiting', queueOutcome({ status: 'processing' }) === 'sending',
    'a row the cron has claimed is going out now; calling it "waiting" invites a cancel that cannot work')
}

// ── only a row that has not gone yet can be stopped ─────────────────────────
{
  check('a pending row can be cancelled', queueCancellable({ status: 'pending' }))
  for (const s of ['processing', 'completed', 'failed', 'cancelled'] as const) {
    check(`a ${s} row cannot be cancelled`, !queueCancellable({ status: s }),
      'offering Cancel on a post already being published promises something we cannot do')
  }
}

// ── the detail line comes from the right field ──────────────────────────────
{
  const failed = queueDetail({ status: 'failed', error: 'Pinterest not connected at post time.' })
  check('a failed row shows its error', failed?.kind === 'error' && /Pinterest/.test(failed.text))

  const noted = queueDetail({ status: 'completed', note: 'Went out with a plain Amazon link.' })
  check('a completed row shows its note', noted?.kind === 'note' && /plain Amazon/.test(noted.text))

  check('a clean row shows nothing', queueDetail({ status: 'completed' }) === null)
  check('a waiting row shows nothing', queueDetail({ status: 'pending' }) === null)

  // The two must never be conflated. Before migration 329 the cron wrote soft
  // notes into error_message, so this is the exact confusion being unpicked.
  check('an error on a completed row is not rendered as an error',
    queueDetail({ status: 'completed', error: 'stale soft note' })?.kind !== 'error',
    'that column held publish notes on successful rows; showing them red says the post failed')
}

// ── the read route exists and is honest ─────────────────────────────────────
{
  const ROUTE = readFileSync('app/api/amazon/scheduled/route.ts', 'utf8')
  const code = ROUTE.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  check('the queue is scoped to the caller', /\.eq\('user_id', user\.id\)/.test(code))
  check('and refuses an anonymous read', /status: 401/.test(code))

  // `note` ships in migration 329. Naming it in a select on a database that has
  // not run 329 makes PostgREST reject the WHOLE read, which turns "your note is
  // missing" into "your queue is empty" — the failure this route exists to end.
  check('the read uses select(*) rather than a named column list',
    /\.select\('\*'\)/.test(code),
    'the lesson from lib/link-cloak getLinkStyle, and it applies to every new column')

  check('cancel only touches a pending row', /\.eq\('status', 'pending'\)/.test(code))
  check('and says so when it could not', /cannot be cancelled/.test(code),
    'a cancel that silently does nothing is worse than no cancel button')
  check('a failed cancel is a 409, not a fake success', /status: 409/.test(code))
}

// ── the page renders it ─────────────────────────────────────────────────────
{
  const PAGE = readFileSync('app/(dashboard)/amazon/social/page.tsx', 'utf8')
  check('the queue is on the page that schedules', /<ScheduledQueue/.test(PAGE),
    'the composers on this page are the only thing that writes those rows')

  const UI = readFileSync('components/amazon/ScheduledQueue.tsx', 'utf8')
  check('the panel reports the shared outcome rather than its own ternaries',
    /queueOutcome\(/.test(UI) && /queueTone\(/.test(UI))
  check('and gates Cancel on the shared rule', /queueCancellable\(/.test(UI))
  check('a failed load says so instead of showing an empty list',
    /Could not load your queue/.test(UI),
    'an empty panel where the queue should be reads as "it never saved"')

  // Both composers have to poke it, or a post they just scheduled is missing
  // from the list directly below the button they pressed.
  for (const f of ['components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx']) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} refreshes the queue after scheduling`,
      /dispatchEvent\(new Event\(AMAZON_QUEUE_EVENT\)\)/.test(SRC))
  }
}

// ── the cron stores a note as a note ────────────────────────────────────────
{
  const CRON = readFileSync('app/api/cron/process-amazon-schedules/route.ts', 'utf8')
  const code = CRON.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  check('a completed row no longer carries the note in error_message',
    !/status: 'completed'[\s\S]{0,160}error_message: note/.test(code),
    'that made a published post with a substituted link indistinguishable from one that never went')
  check('and clears the error column on success', /status: 'completed'[\s\S]{0,160}error_message: null/.test(code))

  // Two writes on purpose: `note` ships in 329, and naming a missing column
  // would make PostgREST reject the STATUS update too, leaving a published row
  // stuck in 'processing' forever — the cron never claims it again.
  const statusAt = code.indexOf("status: 'completed'")
  const noteAt = code.indexOf('.update({ note })')
  check('the note is written separately from the status',
    statusAt > -1 && noteAt > statusAt,
    `status at ${statusAt}, note at ${noteAt}`)
  check('and a note that cannot be stored is logged, not swallowed',
    /migration 329/.test(CRON),
    'silently losing the note puts every substituted link back out of sight')
}

// ── the migration is safe to run twice ──────────────────────────────────────
{
  const SQL = readFileSync('supabase/migrations/329_amazon_scheduled_note.sql', 'utf8')
  check('the column add is idempotent', /add column if not exists note text/i.test(SQL))
  check('the backfill cannot run twice into the wrong state',
    /and note is null/i.test(SQL),
    'it clears error_message as it goes, so the second run matches nothing')
  check('and it only moves notes off rows that actually published',
    /where status = 'completed'/i.test(SQL),
    'a failed row\'s error_message is a real error and must stay put')
}

if (failures.length) {
  console.error(`\n❌ amazon-queue: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ amazon-queue: a scheduled post is visible, cancellable, and says out loud when it published with the wrong link')
