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
import { checkUsageLimit, checkGenerationLimit, normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Top-level guard: this route has many awaits (auth, several DB reads, the
  // spend gate, the enqueue RPC). An unhandled throw in any of them would let
  // Next.js return its own HTML 500 page — which the client then tries to
  // JSON.parse, producing the cryptic "Unexpected token '<'" error users see
  // instead of a real reason. Wrapping the whole handler guarantees a JSON
  // body on every path so the client always gets an actionable message.
  try {
    return await handleEnqueue(request)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[blog/enqueue]', msg)
    return NextResponse.json(
      { error: `Couldn't queue the post (${msg}). Try again, or use the standard Generate flow.` },
      { status: 500 },
    )
  }
}

async function handleEnqueue(request: Request) {
  // KILL-SWITCH. Increment C is COMPLETE (2026-06-11): the retry/completion
  // cluster (#255) and the enqueue caps (#256) are fixed, and every dashboard
  // generate call site now routes through generateBlogRequest() (lib/
  // blog-generate-client.ts), which tries this producer first and falls back
  // to the sync route on 503. Flipping ENABLE_ASYNC_GENERATION=true in the
  // Vercel env turns the whole app async — no further code change needed.
  // Leaving it unset keeps today's synchronous behavior everywhere.
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

  const admin = createAdminClient()

  // ── Queue-depth cap (anti-flood, task #256) ───────────────────────────────
  // Reject if this caller already has several jobs in flight so a loop can't
  // pile up unbounded generations. Capped by the actual caller (user.id) so one
  // VA can't flood the owner's queue. Tolerant of a missing table (enqueue 503s).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generation_jobs not in generated types until migration 119 + regen
    const { count } = await (admin as any)
      .from('generation_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['queued', 'running'])
    if ((count ?? 0) >= 5) {
      return NextResponse.json({
        error: 'You already have several generations queued — wait for those to finish before queuing more.',
        limitReached: true, cap: 'queue_depth',
      }, { status: 429 })
    }
  } catch { /* count failed (e.g. pre-migration 119) — don't block; enqueue 503s below if the table is missing */ }

  // ── Generation quota — consume ONCE here, per job (not per worker attempt) ──
  // The service-mode generate route trusts this and skips its own quota check
  // (task #255), so consuming here is what enforces the cap for async. Only a
  // FRESH post consumes a unit; a rewrite (existing post for this video) follows
  // the Pro rewrite rule instead — mirrors /api/blog/generate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from('blog_posts')
    .select('id, rewrite_count')
    .eq('user_id', ownerId)
    .eq('video_id', body.videoId)
    .limit(1)
    .maybeSingle()
  if (existing) {
    const { data: intRow } = await admin.from('integrations').select('tier').eq('user_id', ownerId).single()
    const tier = normalizeTier(intRow?.tier)
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({ error: 'Rewrite is a Pro feature. You can still edit the post manually in WordPress.', limitReached: true, cap: 'rewrites', currentTier: tier }, { status: 403 })
    }
    if (tier !== 'admin' && ((existing.rewrite_count as number) ?? 0) >= 3) {
      return NextResponse.json({ error: "You've rebuilt this post 3 times — that's the limit per post. Edit it directly in WordPress, or generate a fresh post.", limitReached: true, cap: 'rewrites', rebuildsUsed: (existing.rewrite_count as number) ?? 0, rebuildCap: 3, currentTier: tier }, { status: 403 })
    }
  } else {
    const trialUsage = await checkUsageLimit(supabase, user.id)
    if (!trialUsage.allowed) {
      return NextResponse.json({ error: trialUsage.reason, limitReached: true, cap: 'posts', currentTier: trialUsage.tier, upgrade: trialUsage.upgrade }, { status: 403 })
    }
    const usage = await checkGenerationLimit(supabase, user.id)
    if (!usage.allowed) {
      return NextResponse.json({ error: usage.reason, limitReached: true, cap: 'generations', currentTier: usage.tier, upgrade: usage.upgrade }, { status: 403 })
    }
  }

  // ── Monthly AI-spend circuit breaker ───────────────────────────────────────
  // Stop the job from even entering the queue once the account is over its
  // tier's monthly AI-cost ceiling. Mirrors the gate in /api/blog/generate so
  // the async producer can't bypass the dollar backstop. Fails open.
  {
    const { data: spendTierRow } = await admin
      .from('integrations')
      .select('tier')
      .eq('user_id', ownerId)
      .maybeSingle()
    const gate = await spendGate(ownerId, spendTierRow?.tier)
    if (gate) return gate
  }

  const jobId = await enqueueGenerationJob(admin, {
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
