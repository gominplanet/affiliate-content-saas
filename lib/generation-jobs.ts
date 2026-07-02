// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Generation job queue — typed helpers (Phase 4, increment A).
//
// Thin wrapper over the public.generation_jobs table (migration 119). The
// producer side (enqueue) is called from request routes; the consumer side
// (claim / complete / fail / stage) is called from the cron worker with the
// service-role admin client. The Supabase generated types don't know about
// generation_jobs until they're regenerated post-migration, so the client is
// typed `any` here (same pattern the codebase uses for fresh columns/tables);
// this module is the single typed boundary around the raw table.

export type GenerationJobKind = 'blog' | 'comparison' | 'campaign'
export type GenerationJobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationJob {
  id: string
  user_id: string
  owner_id: string
  kind: GenerationJobKind
  status: GenerationJobStatus
  stage: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any> | null
  // Cached generator output persisted mid-run (BEFORE the WP publish) so a retry
  // reuses it instead of re-billing a fresh Opus generation. See migration 149.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpoint: Record<string, any> | null
  error: string | null
  attempts: number
  max_attempts: number
  claimed_at: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

interface EnqueueArgs {
  userId: string
  ownerId: string
  kind: GenerationJobKind
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>
  maxAttempts?: number
}

/**
 * Enqueue a job. Returns the new job id, or null on failure (caller decides
 * whether to fall back to the synchronous path). Safe no-op-on-error so a
 * missing table (pre-migration 119) can't break the producer route.
 */
export async function enqueueGenerationJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: EnqueueArgs,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('generation_jobs')
      .insert({
        user_id: args.userId,
        owner_id: args.ownerId,
        kind: args.kind,
        input: args.input,
        max_attempts: args.maxAttempts ?? 3,
      })
      .select('id')
      .single()
    if (error) return null
    return (data?.id as string) ?? null
  } catch {
    return null
  }
}

/**
 * Atomically claim the next job (oldest queued, or a stale-running one) via the
 * claim_generation_job RPC. Returns the claimed job or null when the queue is
 * empty. Must be called with the service-role admin client.
 */
export async function claimNextJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  staleSeconds = 600,
): Promise<GenerationJob | null> {
  const { data, error } = await admin.rpc('claim_generation_job', { stale_seconds: staleSeconds })
  if (error) throw new Error(`claim_generation_job failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return (row as GenerationJob) ?? null
}

/** Mark a claimed job done with its result payload. */
export async function completeJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any>,
): Promise<void> {
  await admin
    .from('generation_jobs')
    .update({ status: 'done', result, error: null, finished_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'running') // guard: only complete a job we still own (not re-claimed / already terminal)
}

/**
 * Fail a job. If it still has retry budget the worker bumped attempts on claim,
 * so we re-queue it (it'll be picked up next tick); once attempts hit
 * max_attempts we mark it terminally failed. The error is recorded either way.
 */
export async function failJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: Pick<GenerationJob, 'id' | 'attempts' | 'max_attempts'>,
  errorMessage: string,
): Promise<void> {
  const exhausted = job.attempts >= job.max_attempts
  await admin
    .from('generation_jobs')
    .update(
      exhausted
        ? { status: 'failed', error: errorMessage, finished_at: new Date().toISOString() }
        : { status: 'queued', error: errorMessage, claimed_at: null },
    )
    .eq('id', job.id)
    .eq('status', 'running') // guard: don't clobber a job another tick already re-claimed / finished
}

/** Update the progress stage label on a running job (for staged handlers + UI). */
export async function setJobStage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  id: string,
  stage: string,
): Promise<void> {
  await admin.from('generation_jobs').update({ stage }).eq('id', id).eq('status', 'running')
}

/**
 * MONEY-SAFETY (migration 149). Persist the generator's output onto the job the
 * instant it's produced — BEFORE the slow WordPress publish — so a retry after a
 * publish timeout can reuse it instead of re-billing a fresh Opus generation.
 * Best-effort: a failed write just means the retry pays again (today's
 * behaviour), so it must never throw into the generation path. Service-role
 * client only (the generate route in service mode).
 */
export async function saveJobCheckpoint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpoint: Record<string, any>,
): Promise<void> {
  try {
    // Guard on status='running' so we only checkpoint the attempt we still own.
    await admin.from('generation_jobs').update({ checkpoint }).eq('id', id).eq('status', 'running')
  } catch { /* non-fatal: a missed checkpoint just means the retry re-generates */ }
}

/**
 * Load a job's cached generator output, or null if none (fresh job / pre-149 DB
 * / read error). When present, the generate route SKIPS the Opus call and reuses
 * this. Best-effort — any failure returns null and the route generates normally.
 */
export async function loadJobCheckpoint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await admin.from('generation_jobs').select('checkpoint').eq('id', id).maybeSingle()
    if (error || !data) return null
    const cp = (data as { checkpoint?: Record<string, unknown> | null }).checkpoint
    return cp && typeof cp === 'object' ? cp : null
  } catch {
    return null
  }
}

/** Fetch a single job (RLS-scoped when called with a user client). */
export async function getGenerationJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  id: string,
): Promise<GenerationJob | null> {
  const { data } = await supabase.from('generation_jobs').select('*').eq('id', id).maybeSingle()
  return (data as GenerationJob) ?? null
}
