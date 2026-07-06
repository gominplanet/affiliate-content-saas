// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/blog/job/[id] — Phase 4 poll endpoint.
//
// The client enqueues via /api/blog/enqueue, then polls this for status until
// the job is done or failed. RLS-scoped: getGenerationJob runs on the user's
// own client, so a caller only ever sees their own (or their owner's) jobs.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGenerationJob, completeJob, type GenerationJob } from '@/lib/generation-jobs'

export const dynamic = 'force-dynamic'

// The generate route's hard ceiling is 300s (maxDuration). Past claimed_at +
// this margin, the job's FIRST run is definitively over — anything still
// 'running' is either dead or already finished without reporting back.
const FIRST_RUN_OVER_MS = 330 * 1000

/**
 * Self-heal for the published-but-still-spinning race: the worker's internal
 * fetch to /api/blog/generate aborts client-side at ~290s while the route
 * keeps executing and often PUBLISHES anyway. The worker then deliberately
 * leaves the job 'running' for the 600s stale-claim to sort out (see
 * process-generation-jobs) — correct for money-safety, but the user stares at
 * a spinner for 10+ minutes while their post is already live on WordPress.
 *
 * So: once the first run is provably over, check whether the post actually
 * landed (published blog_posts row for this video, touched after the job was
 * created). If it did, mark the job done with the same result shape the sync
 * route returns and stop the spinner. completeJob's status='running' guard
 * makes this race-safe against a late worker/stale-reclaim completion — and
 * marking it done also prevents a pointless checkpoint re-run of a post
 * that's already out.
 */
async function selfHealPublishedJob(job: GenerationJob): Promise<GenerationJob> {
  if (job.kind !== 'blog' || job.status !== 'running') return job
  const videoId = job.input?.videoId as string | undefined
  if (!videoId || !job.claimed_at) return job
  if (Date.now() - new Date(job.claimed_at).getTime() < FIRST_RUN_OVER_MS) return job
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await (admin as any)
      .from('blog_posts')
      .select('id, title, wordpress_url, wordpress_post_id, updated_at')
      .eq('user_id', job.owner_id)
      .eq('video_id', videoId)
      .eq('status', 'published')
      .limit(1)
      .maybeSingle()
    if (!post?.wordpress_url) return job
    // Only count a post written/updated AFTER this job started — an old post
    // being present is just the rewrite case, not proof this run finished.
    if (new Date(post.updated_at as string).getTime() < new Date(job.created_at).getTime()) return job
    const result = {
      success: true,
      postId: post.id,
      wordpressPostId: post.wordpress_post_id ?? undefined,
      wordpressUrl: post.wordpress_url,
      title: post.title,
      // Marker for logs/debugging: this completion came from the poll's
      // self-heal, not the worker reporting back.
      selfHealed: true,
    }
    await completeJob(admin, job.id, result)
    return { ...job, status: 'done', result }
  } catch {
    return job // self-heal is best-effort; normal polling continues
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let job = await getGenerationJob(supabase, id)
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  job = await selfHealPublishedJob(job)

  return NextResponse.json({
    id: job.id,
    status: job.status,                                  // queued | running | done | failed
    stage: job.stage,
    result: job.status === 'done' ? job.result : null,
    error: job.status === 'failed' ? job.error : null,
  })
}
