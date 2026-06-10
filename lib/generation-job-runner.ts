// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Generation job dispatcher (Phase 4). Maps a claimed job to the code that
// runs it. Kept separate from the cron worker route so the worker stays a thin
// claim→run→record loop and the handler set can grow here.
//
// INCREMENT A (now): handlers are placeholders. Nothing enqueues jobs yet, so
// the worker never reaches them — this is the wired-but-dormant extension point.
//
// INCREMENT B: replace each placeholder with the real orchestration. The work
// already exists inside the synchronous request routes (app/api/blog/generate,
// /blog/comparison, /campaigns/generate); the job runner needs the same steps
// adapted to take an EXPLICIT (ownerId, userId) context + the job's `input`
// instead of deriving them from a request session, and to write progress via
// setJobStage. Throwing here (rather than silently succeeding) means a job
// enqueued before its handler exists fails loudly instead of vanishing.

import type { GenerationJob } from '@/lib/generation-jobs'

/**
 * Run one claimed job to completion and return its result payload (stored on
 * generation_jobs.result). Throws on failure — the worker catches, records the
 * error, and re-queues or fails the job per its retry budget.
 */
export async function runGenerationJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _admin: any,
  job: GenerationJob,
): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case 'blog':
    case 'comparison':
    case 'campaign':
      // Increment B wires these. Example shape:
      //   await setJobStage(_admin, job.id, 'generating')
      //   const out = await runBlogGeneration(_admin, job.owner_id, job.user_id, job.input)
      //   return { blogPostId: out.id, wordpressUrl: out.url }
      throw new Error(`generation job kind "${job.kind}" is not wired yet (Phase 4 increment B)`)
    default:
      throw new Error(`unknown generation job kind: ${String(job.kind)}`)
  }
}
