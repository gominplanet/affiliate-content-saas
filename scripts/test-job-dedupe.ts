// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE IN-FLIGHT JOB PER VIDEO.
//
// A creator found three near-identical posts about the same product on his
// site, on two days running, published a minute apart. A minute is the job
// worker's tick, so three jobs for one video had been queued and each wrote its
// own post, billed its own Opus call, and published its own page.
//
// enqueueGenerationJob was a bare insert. The same video could be queued any
// number of times: a double-click, a retry after a slow response, a bulk action
// that included it twice. Nothing anywhere checked.
//
// The fix blocks only QUEUED OR RUNNING. A finished job is not a duplicate, it
// is an earlier post, and deliberately re-generating one is a real thing
// creators do. And it returns the EXISTING job id rather than null, so a
// double-submit polls the job that is really running instead of being told the
// queue is broken.
//
// Tested against a stub rather than by reading the source, because the shape of
// the query is the whole behaviour: filtering on the wrong status set or the
// wrong owner column would read fine and dedupe nothing.
import { enqueueGenerationJob } from '../lib/generation-jobs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

interface Row { id: string; owner_id: string; kind: string; status: string; input: Record<string, unknown> }

/** A Supabase stub that records what was asked and answers from `rows`. */
function stub(rows: Row[]) {
  const inserted: Record<string, unknown>[] = []
  const filters: Record<string, unknown> = {}
  let statuses: string[] = []
  const api = {
    from() { return api },
    select() { return api },
    eq(col: string, val: unknown) { filters[col] = val; return api },
    in(col: string, vals: string[]) { if (col === 'status') statuses = vals; return api },
    contains(_col: string, val: Record<string, unknown>) { filters.__contains = val; return api },
    limit() { return api },
    async maybeSingle() {
      const want = (filters.__contains as { videoId?: string } | undefined)?.videoId
      const hit = rows.find(r =>
        r.owner_id === filters.owner_id
        && r.kind === filters.kind
        && statuses.includes(r.status)
        && (want == null || r.input.videoId === want))
      return { data: hit ? { id: hit.id } : null }
    },
    insert(v: Record<string, unknown>) { inserted.push(v); return api },
    async single() { return { data: { id: 'new-job' }, error: null } },
  }
  return { api, inserted, seen: () => ({ filters, statuses }) }
}

const OWNER = 'owner-1'
const base = { userId: 'u1', ownerId: OWNER, kind: 'blog' as const }

async function main() {
  // ── a video already in flight is not queued twice ─────────────────────────
  {
    const s = stub([{ id: 'live-1', owner_id: OWNER, kind: 'blog', status: 'queued', input: { videoId: 'v9' } }])
    const id = await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
    check('a queued job for the same video is reused', id === 'live-1', String(id))
    check('and nothing new is inserted', s.inserted.length === 0,
      `${s.inserted.length} insert(s) — each one is another post and another Opus bill`)
  }
  {
    const s = stub([{ id: 'live-2', owner_id: OWNER, kind: 'blog', status: 'running', input: { videoId: 'v9' } }])
    const id = await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
    check('a RUNNING job counts too', id === 'live-2', String(id))
  }

  // ── but a finished one is an earlier post, not a duplicate ────────────────
  {
    for (const status of ['done', 'failed', 'cancelled']) {
      const s = stub([{ id: 'old', owner_id: OWNER, kind: 'blog', status, input: { videoId: 'v9' } }])
      const id = await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
      check(`a ${status} job does not block a new one`, id === 'new-job',
        're-generating a finished post is deliberate and has to keep working')
    }
  }

  // ── and the match has to be the RIGHT job ─────────────────────────────────
  {
    const s = stub([{ id: 'other', owner_id: OWNER, kind: 'blog', status: 'queued', input: { videoId: 'DIFFERENT' } }])
    const id = await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
    check('a different video does not block this one', id === 'new-job', String(id))
  }
  {
    const s = stub([{ id: 'theirs', owner_id: 'someone-else', kind: 'blog', status: 'queued', input: { videoId: 'v9' } }])
    const id = await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
    check('another owner\'s job does not block this one', id === 'new-job',
      'deduping across accounts would let one creator stall another')
  }
  {
    const s = stub([{ id: 'camp', owner_id: OWNER, kind: 'campaign', status: 'queued', input: { videoId: 'v9' } }])
    const id = await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
    check('a job of another KIND does not block a blog', id === 'new-job', String(id))
  }

  // ── the query filters on what it claims to ────────────────────────────────
  {
    const s = stub([])
    await enqueueGenerationJob(s.api, { ...base, input: { videoId: 'v9' } })
    const { filters, statuses } = s.seen()
    check('it scopes by owner, not by the triggering user',
      filters.owner_id === OWNER,
      'a VA queuing for an owner must hit the owner\'s in-flight jobs, not their own')
    check('and only in-flight statuses', statuses.includes('queued') && statuses.includes('running')
      && statuses.length === 2, statuses.join(','))
  }

  // ── a job with no video is left alone ─────────────────────────────────────
  {
    const s = stub([{ id: 'live', owner_id: OWNER, kind: 'blog', status: 'queued', input: {} }])
    const id = await enqueueGenerationJob(s.api, { ...base, input: { asin: 'B000' } })
    check('a blog job with no videoId is not deduped', id === 'new-job',
      'there is nothing to compare, and guessing would block unrelated work')
  }

  if (failures.length) {
    console.error(`\n❌ job-dedupe: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ job-dedupe: one in-flight blog job per video, and a finished one never blocks a rewrite')
}

void main()
