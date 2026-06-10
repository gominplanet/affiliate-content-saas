// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Generation job dispatcher (Phase 4). Maps a claimed job to the code that
// runs it. Kept separate from the cron worker route so the worker stays a thin
// claim→run→record loop and the handler set can grow here.
//
// DESIGN — reuse, don't rewrite. The blog handler does NOT duplicate the ~2000
// lines of generation orchestration in app/api/blog/generate. Instead it
// invokes that route INTERNALLY with the shared secret + the job's identity in
// headers; the route's service-auth branch runs the exact same pipeline under
// the job's owner, off the user's request. So async generation is the same code
// as synchronous generation — only the trigger and the auth source differ.
//
// 'comparison' / 'campaign' will follow the same pattern once their routes get
// the matching service-auth branch (a later increment); they throw until then.

import type { GenerationJob } from '@/lib/generation-jobs'

/** This deployment's own absolute base URL (the worker calls back into it). */
function resolveSelfBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

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
      return runBlogJob(job)
    case 'comparison':
    case 'campaign':
      throw new Error(`generation job kind "${job.kind}" is not wired yet (needs its own service-auth branch)`)
    default:
      throw new Error(`unknown generation job kind: ${String(job.kind)}`)
  }
}

/** Run a blog-generation job by invoking the existing generate route internally
 *  in service mode. The route does the full pipeline (generate → post-process →
 *  publish → defer images) under the job's owner. */
async function runBlogJob(job: GenerationJob): Promise<Record<string, unknown>> {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET not set — cannot make the internal service call')

  const res = await fetch(`${resolveSelfBaseUrl()}/api/blog/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-mvp-service': secret,
      'x-mvp-service-user': job.user_id,
      'x-mvp-service-owner': job.owner_id,
    },
    body: JSON.stringify(job.input ?? {}),
    // Almost the worker's whole 300s budget; the route is tuned to finish under
    // it (Opus effort:'medium'). A timeout throws → the job retries next tick.
    signal: AbortSignal.timeout(290_000),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null
  try { data = await res.json() } catch { /* non-JSON body (e.g. a raw 504) */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `blog generation returned ${res.status}`)
  }
  return data && typeof data === 'object' ? data : { ok: true }
}
