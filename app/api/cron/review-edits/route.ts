/**
 * GET /api/cron/review-edits — moves the review editor's queue (lib/review-
 * edit-server moveQueue): stuck work back in line, the next video sent to the
 * video server, the next one read, old raw uploads deleted. Every two
 * minutes, so a batch added at night is worked through by morning.
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server'
import { moveQueue, editDb } from '@/lib/review-edit-server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const done = await moveQueue(editDb(), { readBudget: 1 })
    return NextResponse.json({ ok: true, ...done })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Before the table exists, say so rather than failing every two minutes.
    if (/review_edits/.test(msg) && /does not exist|schema cache/i.test(msg)) return NextResponse.json({ ok: true, skipped: 'review_edits table not made yet (migration 459)' })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
