// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Client helper for blog generation (Phase 4 increment C). Lets the UI use the
// ASYNC queue when it's enabled, with a transparent SYNC fallback when it's not
// — so call sites flip with a one-line swap and behave identically to today
// until ENABLE_ASYNC_GENERATION is turned on server-side.
//
// Returns a Response-COMPATIBLE object ({ ok, status, json() }) so existing
// handlers that do `const r = await fetch(...); const d = await r.json()` keep
// working: just replace the `fetch('/api/blog/generate', …)` call with
// `generateBlogRequest(body, signal)`.
//
// Flow:
//   POST /api/blog/enqueue
//     ├─ 503  → async disabled → fall back to the real sync POST /api/blog/generate
//     ├─ !ok  → enqueue gate (cap/quota/rewrite) → surface as a failed response
//     └─ ok   → poll GET /api/blog/job/:id until done|failed, returning the
//               job.result (same shape the sync route returns) on done.

interface GenResponseLike {
  ok: boolean
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>
}

const POLL_INTERVAL_MS = 3000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateBlogRequest(body: Record<string, any>, signal?: AbortSignal): Promise<GenResponseLike> {
  // 1. Try to enqueue (async path).
  let enq: Response
  try {
    enq = await fetch('/api/blog/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    // Network error reaching enqueue — fall back to the sync route, which has
    // its own error handling the caller already understands.
    return fetch('/api/blog/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }

  // 2. Async disabled (kill-switch) → transparent sync fallback (real Response).
  if (enq.status === 503) {
    return fetch('/api/blog/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }

  // 3. Enqueue rejected by a gate (cap / quota / rewrite). Surface as-is so the
  //    caller's existing limit-reached handling fires.
  if (!enq.ok) {
    const d = await enq.json().catch(() => ({ error: `Could not queue (${enq.status})` }))
    return { ok: false, status: enq.status, json: async () => d }
  }

  // 4. Queued — poll the job until it finishes.
  const { jobId } = (await enq.json().catch(() => ({}))) as { jobId?: string }
  if (!jobId) {
    return { ok: false, status: 502, json: async () => ({ error: 'Queued but no job id returned.' }) }
  }

  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    let s: { status?: string; result?: unknown; error?: string } = {}
    try {
      const sres = await fetch(`/api/blog/job/${jobId}`, { signal })
      s = await sres.json()
    } catch {
      // Transient poll error — keep polling (the abort check above is the exit).
      continue
    }
    if (s.status === 'done') {
      return { ok: true, status: 200, json: async () => s.result ?? {} }
    }
    if (s.status === 'failed') {
      return { ok: false, status: 500, json: async () => ({ error: s.error || 'Generation failed.' }) }
    }
    // queued | running → keep polling
  }
}
