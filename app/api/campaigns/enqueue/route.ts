// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/enqueue — async producer for EPC campaign generation.
//
// Campaign generation (Amazon scrape → web research → Opus write → fact-check →
// publish) can brush Vercel's 300s function ceiling on long listings and 504.
// This enqueues a 'campaign' job and returns instantly; the once-a-minute cron
// worker (/api/cron/process-generation-jobs) runs it off the request path with
// no user-facing timeout. The client polls /api/campaigns/job/[id].
//
// Body is the SAME shape /api/campaigns/generate accepts:
//   { asin, campaignName?, epc?, endsAt?, campaignId? }
//
// Falls back to the synchronous route (client-side) when async is disabled.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueueGenerationJob } from '@/lib/generation-jobs'
import { tierAllowsCampaigns, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { extractAsin } from '@/services/amazon'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (process.env.ENABLE_ASYNC_GENERATION !== 'true') {
    return NextResponse.json(
      { error: 'Async generation is not available — use the standard Generate flow.' },
      { status: 503 },
    )
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    asin?: string; campaignName?: string; epc?: string; endsAt?: string; campaignId?: string
  }
  const asin = extractAsin((body.asin ?? '').toUpperCase()) || (body.asin ?? '').trim()
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ error: 'A valid 10-character ASIN is required' }, { status: 400 })
  }

  // Pro gate + monthly spend ceiling (mirrors the sync route, before queueing).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsCampaigns(tier)) {
    return NextResponse.json({ error: 'Creator Campaigns is a Pro feature.' }, { status: 403 })
  }
  const spendBlocked = await spendGate(user.id, tier)
  if (spendBlocked) return spendBlocked

  const admin = createAdminClient()

  // Queue-depth cap — a loop can't pile up unbounded paid generations.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any)
      .from('generation_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['queued', 'running'])
    if ((count ?? 0) >= 5) {
      return NextResponse.json({
        error: 'You already have several generations queued — wait for those to finish.',
        limitReached: true, cap: 'queue_depth',
      }, { status: 429 })
    }
  } catch { /* pre-migration 119 — enqueue 503s below if the table is missing */ }

  const jobId = await enqueueGenerationJob(admin, {
    userId: user.id,
    ownerId: user.id,
    kind: 'campaign',
    input: {
      asin,
      campaignName: body.campaignName ?? null,
      epc: body.epc ?? null,
      endsAt: body.endsAt ?? null,
      campaignId: body.campaignId ?? null,
    },
  })
  if (!jobId) {
    return NextResponse.json(
      { error: 'Could not queue the job. Run migration 119 — or use the standard Generate button.' },
      { status: 503 },
    )
  }

  // Flip the row to a pending state so the EPC list shows it as in-progress
  // (not a stale "failed"/Retry) until the worker picks it up. Best-effort.
  if (body.campaignId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('campaigns')
        .update({ status: 'queued', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', body.campaignId).eq('user_id', user.id)
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ jobId, status: 'queued' })
}
