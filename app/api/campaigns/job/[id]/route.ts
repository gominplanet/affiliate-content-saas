// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/job/[id] — poll a queued campaign-generation job.
// The client enqueues via /api/campaigns/enqueue, then polls this until the
// job is done or failed. RLS-scoped: getGenerationJob runs on the user's own
// client, so a caller only ever sees their own (or their owner's) jobs.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getGenerationJob } from '@/lib/generation-jobs'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await getGenerationJob(supabase, id)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: job.id,
    status: job.status,                                  // queued | running | done | failed
    stage: job.stage,
    result: job.status === 'done' ? job.result : null,
    error: job.status === 'failed' ? job.error : null,
  })
}
