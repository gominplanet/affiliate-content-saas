// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The page side of "MVP already made this": a drop-in for fetch on a paid
// generate call. When the server answers 409 alreadyMade, the creator is asked
// once, plainly. Yes sends it again with `again: true`; no keeps the earlier
// one and comes back as an error that SAYS it was kept, so the screen shows
// what happened rather than a generic failure.

'use client'

// A generate call writes and publishes a post, which can take a few minutes;
// past this the page stops waiting rather than hanging forever.
const GENERATE_DEADLINE_MS = 300_000

export async function fetchUnlessMade(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(GENERATE_DEADLINE_MS) })
  if (res.status !== 409) return res
  const data = await res.clone().json().catch(() => null) as { alreadyMade?: boolean; error?: string; url?: string; keptMessage?: string } | null
  if (!data?.alreadyMade) return res
  const yes = typeof window !== 'undefined' && window.confirm(
    `${data.error || 'You already have one of these.'}\n\nOK writes a new one anyway. Cancel keeps the one you have.`,
  )
  if (yes) {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(String(init.body || '{}')) } catch { /* sent as is */ }
    return fetch(url, { ...init, body: JSON.stringify({ ...body, again: true }), signal: AbortSignal.timeout(GENERATE_DEADLINE_MS) })
  }
  return new Response(JSON.stringify({
    ok: false, alreadyMade: true, url: data.url ?? null,
    error: data.keptMessage || `Kept the post you already have${data.url ? `: ${data.url}` : ''}. Nothing new was written.`,
  }), { status: 409, headers: { 'Content-Type': 'application/json' } })
}
