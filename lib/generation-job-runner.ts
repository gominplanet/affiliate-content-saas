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
      return runServiceRouteJob(job, '/api/blog/generate', 'blog generation')
    case 'campaign':
      return runServiceRouteJob(job, '/api/campaigns/generate', 'campaign generation')
    case 'comparison':
      throw new Error(`generation job kind "${job.kind}" is not wired yet (needs its own service-auth branch)`)
    default:
      throw new Error(`unknown generation job kind: ${String(job.kind)}`)
  }
}

/** Run a generation job by invoking an existing generate route internally in
 *  service mode. The route does the full pipeline (generate → post-process →
 *  publish) under the job's owner, off the user's request. Shared by every
 *  job kind whose route has the x-mvp-service auth branch (blog, campaign). */
async function runServiceRouteJob(
  job: GenerationJob,
  routePath: string,
  label: string,
): Promise<Record<string, unknown>> {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET not set — cannot make the internal service call')

  const init = {
    method: 'POST' as const,
    headers: {
      'Content-Type': 'application/json',
      'x-mvp-service': secret,
      'x-mvp-service-user': job.user_id,
      'x-mvp-service-owner': job.owner_id,
    },
    body: JSON.stringify(job.input ?? {}),
    // Almost the worker's whole 300s budget; the route is tuned to finish
    // under it (Opus effort:'medium').
    signal: AbortSignal.timeout(290_000),
    // CRITICAL: never auto-follow. NEXT_PUBLIC_APP_URL is the non-www
    // canonical, but the domain layer 30x-redirects non-www → www — and
    // fetch's auto-follow DOWNGRADES POST to GET on 301/302, which hits the
    // route's missing GET handler as a 405 ("blog generation returned 405",
    // first observed on the queue's first production run 2026-06-11). We
    // follow one hop manually below, re-issuing the SAME POST.
    redirect: 'manual' as const,
  }

  let res: Response
  try {
    // Follow redirect CHAINS manually (up to 5 hops), re-issuing the same
    // POST each time. One hop wasn't enough in production: the canonical
    // redirect can stack with trailing-slash/host normalization (observed
    // 2026-06-11: 405 → fixed one hop → then "returned 307" = a second hop).
    // The hop log makes any remaining loop visible in Vercel logs.
    let url = `${resolveSelfBaseUrl()}${routePath}`
    const hops: string[] = []
    res = await fetch(url, init)
    while ([301, 302, 303, 307, 308].includes(res.status) && hops.length < 5) {
      const loc = res.headers.get('location')
      if (!loc) break
      url = new URL(loc, url).toString()
      hops.push(`${res.status}→${url}`)
      res = await fetch(url, init)
    }
    if (hops.length) console.log('[generation-job] self-call redirect chain:', hops.join(' | '), '→ final', res.status)
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      // Still redirecting after 5 hops = a redirect loop in the domain
      // config — deterministic, don't burn the retry budget on it.
      throw new Error(`PERMANENT: self-call stuck in a redirect loop (${hops.join(' | ')}) — check the domain redirect configuration for ${resolveSelfBaseUrl()}`)
    }
  } catch (e) {
    // AbortSignal.timeout throws a DOMException named 'TimeoutError' (also handle
    // 'AbortError'). TAG it so the worker leaves the job 'running' for stale
    // recovery instead of requeuing into a concurrent double-run — the route may
    // still be publishing on its side (it doesn't abort on our disconnect).
    const name = (e as { name?: string } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`TIMEOUT: ${label} exceeded the worker budget`)
    }
    throw e
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null
  try { data = await res.json() } catch { /* non-JSON body (e.g. a raw 504) */ }
  if (!res.ok) {
    const msg = (data && data.error) || `${label} returned ${res.status}`
    // 4xx responses are deterministic refusals (review-worthiness gate, caps,
    // validation) — retrying replays the exact same refusal three times. Tag
    // them so the worker terminally fails the job on the first attempt; 5xx /
    // network errors keep the normal retry budget.
    if (res.status >= 400 && res.status < 500) {
      throw new Error('PERMANENT: ' + msg)
    }
    throw new Error(msg)
  }
  return data && typeof data === 'object' ? data : { ok: true }
}
