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
