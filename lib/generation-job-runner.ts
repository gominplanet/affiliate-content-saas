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
import { isWpConnectionError } from '@/lib/wp-connection-health'
import { normalizeTier, tierAllowsSocial } from '@/lib/tier'
import { getConnectedPlatforms } from '@/lib/channel-health'
import { DEFAULT_SOCIAL_OFFSETS_MIN, type SchedulableSocial } from '@/lib/schedule-types'

const AUTOPILOT_SOCIALS: SchedulableSocial[] = ['facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram', 'pinterest']

/**
 * After an AUTO-PILOT blog job publishes, queue the social cascade the creator
 * opted into (job.input.autoSocials). The post is already live by the time the
 * job returns, so we schedule each connected/allowed channel a couple minutes
 * out with a default caption (title + link); the process-scheduled cron fires
 * them. Best-effort — a cascade failure never fails the blog job.
 */
async function cascadeAutopilotSocials(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: GenerationJob,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any>,
): Promise<void> {
  const socials = Array.isArray(job.input?.autoSocials) ? (job.input.autoSocials as string[]) : []
  if (!socials.length) return
  const postId = result?.postId as string | undefined
  if (!postId) return
  const title = (result?.title as string) || 'New post'
  const wpUrl = (result?.wordpressUrl as string) || ''

  const { data: integ } = await admin.from('integrations').select('tier').eq('user_id', job.user_id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  const connected = await getConnectedPlatforms(admin, job.user_id)

  const caption = `${title}${wpUrl ? `\n\n${wpUrl}` : ''}`.slice(0, 900)
  const now = Date.now()
  const rows = socials
    .filter((p): p is SchedulableSocial => AUTOPILOT_SOCIALS.includes(p as SchedulableSocial))
    .filter(p => tierAllowsSocial(tier, p) && connected.has(p))
    .map(p => ({
      user_id: job.user_id,
      blog_post_id: postId,
      platform: p,
      // At least 2 min out so it fires after the blog is fully live; keep the
      // per-platform spacing so channels don't all post at once.
      scheduled_at: new Date(now + Math.max(2, DEFAULT_SOCIAL_OFFSETS_MIN[p] ?? 2) * 60_000).toISOString(),
      body_text: caption,
      status: 'pending' as const,
      kind: 'social' as const,
      parent_id: null,
    }))
  if (!rows.length) return

  let { error } = await admin.from('scheduled_posts').insert(rows)
  if (error && /column .* does not exist|does not exist|unknown column/i.test(error.message || '')) {
    const legacy = rows.map(({ kind, parent_id, ...r }) => r)
    error = (await admin.from('scheduled_posts').insert(legacy)).error
  }
  if (error) console.warn('[auto-blog] social cascade insert failed:', error.message)
}

// How long the worker awaits the internal generate self-call before aborting.
// Default 290s stays just under the legacy 300s function cap. When the operator
// enables Vercel Fluid Compute (which unlocks the route's 600s maxDuration) and
// sets GENERATION_LONG_RUN=true, this rises to 560s so a ~250-290s generation
// finishes in ONE attempt — no timeout, no checkpoint-resume retry, no 10-min-
// class stale wait. These two switches are meant to be flipped together: the
// flag alone (without Fluid) just aborts later than the clamped 300s cap allows,
// which is harmless. The stale-reclaim window (720s, see lib/generation-jobs.ts)
// sits safely above the 600s route cap in every combination, so raising this
// can never cause a job to be reclaimed into a concurrent double-Opus-bill.
const LONG_RUN = process.env.GENERATION_LONG_RUN === 'true'
const RUNNER_ABORT_MS = LONG_RUN ? 560_000 : 290_000

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
    case 'blog': {
      const result = await runServiceRouteJob(job, '/api/blog/generate', 'blog generation')
      // Auto-pilot opt-in: cascade the published post to the creator's chosen
      // socials. Best-effort — never fail the blog job over a social hiccup.
      try { await cascadeAutopilotSocials(_admin, job, result) } catch (e) {
        console.warn('[auto-blog] social cascade skipped:', e instanceof Error ? e.message : String(e))
      }
      return result
    }
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
      // Job id so the route can checkpoint its generator output (migration 149)
      // and, on a retry, reuse it instead of re-billing a fresh Opus generation.
      'x-mvp-service-job': job.id,
    },
    body: JSON.stringify(job.input ?? {}),
    // Abort budget for the internal generate call. 290s under the legacy 300s
    // cap; 560s when GENERATION_LONG_RUN + Fluid Compute give the route a 600s
    // budget so attempt #1 finishes in one pass (see RUNNER_ABORT_MS above).
    signal: AbortSignal.timeout(RUNNER_ABORT_MS),
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
    //
    // A WordPress connection block (firewall/WAF, deactivated plugin, bad app
    // password) is ALSO deterministic even though it surfaces as a 5xx — the
    // site refuses every write until the user fixes it, so 3 retries just burn
    // time. Tag it PERMANENT too so it fails fast with the doctor message.
    if ((res.status >= 400 && res.status < 500) || isWpConnectionError(msg)) {
      throw new Error('PERMANENT: ' + msg)
    }
    throw new Error(msg)
  }
  return data && typeof data === 'object' ? data : { ok: true }
}
