// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/enqueue — Phase 4 producer.
//
// Creates a QUEUED blog-generation job and returns instantly with its id. The
// worker (/api/cron/process-generation-jobs) runs it off the request path; the
// client polls /api/blog/job/[id]. The request body is the SAME shape
// /api/blog/generate accepts (videoId, includeImages, userImageUrls,
// capturedFrames, siteId, scheduledFor, rewriteFeedback, …) — we just hand it
// to the queue instead of running it inline.
//
// The synchronous /api/blog/generate is UNTOUCHED and remains the default; this
// is the opt-in async path. Reads owner-scoped (getAuthAndOwner); the row is
// inserted via the service-role client (no client INSERT RLS policy by design —
// same write guardrail as migration 116; user_id/owner_id set explicitly).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { enqueueGenerationJob } from '@/lib/generation-jobs'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // KILL-SWITCH (2026-06-09). Migration 119 is now live, which makes this
  // producer functional — but Phase 4 increment C (the Generate-UI flip + the
  // queue-correctness fixes in AUDIT-2026-06-09.md / tasks #255 + #256) is NOT
  // built yet. The retry/completion path has known bugs and there's no cap, so
  // we keep the producer OFF until C ships. The synchronous /api/blog/generate
  // remains the live path. Enable by setting ENABLE_ASYNC_GENERATION=true in
  // the Vercel env once increment C is done.
  if (process.env.ENABLE_ASYNC_GENERATION !== 'true') {
    return NextResponse.json(
      { error: 'Async generation is not available yet — use the standard Generate flow.' },
      { status: 503 },
    )
  }

  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { user, ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!body || typeof body.videoId !== 'string' || !body.videoId) {
    return NextResponse.json({ error: 'videoId is required' }, { status: 400 })
  }

  const jobId = await enqueueGenerationJob(createAdminClient(), {
    userId: user.id,
    ownerId,
    kind: 'blog',
    input: body,
  })
  if (!jobId) {
    return NextResponse.json(
      { error: 'Could not queue the job. If this persists, run migration 119 — or use the standard Generate button.' },
      { status: 503 },
    )
  }
  return NextResponse.json({ jobId, status: 'queued' })
}
