// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A Pinterest VIDEO pin from the page. Pinterest processes a video on its own
// clock, often minutes, which is past what one request may take. The route
// waits about 90 seconds and then answers "still processing" with what is
// needed to finish; this keeps asking until the pin is made, Pinterest says
// it failed, or 10 minutes pass. Each outcome reads differently on screen.

export type VideoPinResult =
  | { ok: true; pinId: string | null; board: string | null }
  | { ok: false; error: string }

export async function postVideoPin(body: Record<string, unknown>, onWait?: (seconds: number) => void): Promise<VideoPinResult> {
  const began = Date.now()
  const ask = async (b: Record<string, unknown>) => {
    const res = await fetch('/api/pinterest/video-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(310_000) })
    const j = await res.json().catch(() => ({ error: res.status === 504
      ? 'MVP ran out of time sending the video to Pinterest. Check your Pinterest board before trying again.'
      : `Pinterest did not answer properly (${res.status}).` }))
    return { res, j: j as Record<string, unknown> }
  }
  try {
    let { res, j } = await ask(body)
    while (res.status === 202 && j.pending && j.finish && Date.now() - began < 10 * 60_000) {
      onWait?.(Math.round((Date.now() - began) / 1000))
      await new Promise((r) => setTimeout(r, 10_000))
      ;({ res, j } = await ask({ finish: j.finish }))
    }
    if (res.ok && j.ok) return { ok: true, pinId: (j.pinId as string) || null, board: (j.board as string) || null }
    if (res.status === 202) return { ok: false, error: 'Pinterest was still processing the video after 10 minutes, so no pin was made. Try again later.' }
    return { ok: false, error: (j.error as string) || 'Pinterest pin failed.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pinterest pin failed.' }
  }
}
