// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/ig-dm-queue — every minute, the auto-DMs that waited their
// turn (lib/ig-pace, lib/ig-dm sendQueuedDms): a busy post's DMs go out spaced
// and capped an hour per account, so Instagram does not read them as a bot
// (Seb, 2026-10-26).
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { sendQueuedDms } from '@/lib/ig-dm'

export const runtime = 'nodejs'
export const maxDuration = 60

/** DMs one account sends a run: two a minute keeps the gap and the hourly cap. */
const PER_ACCOUNT = 2
/** Stop starting a DM this close to the time limit. */
const BUDGET_MS = 45_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await sendQueuedDms(PER_ACCOUNT, BUDGET_MS)) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'the run stopped' }, { status: 500 })
  }
}
