/**
 * Client-side bridge to the MVP Affiliate Co-Pilot Helper extension.
 *
 * The extension (an extended build of CC-Scout) can open the user's YouTube
 * video, grab a real frame off the player, and hand it back as a data URL —
 * the "videoStill" the thumbnail generator grounds on (the creator + product
 * exactly as they appear in the video). All best-effort: every function
 * resolves to a falsy/empty value when the extension isn't installed, so the
 * Co-Pilot flow silently falls back to the maxres frame.
 *
 * Only runs in the browser. The extension ID must match the published listing
 * (set NEXT_PUBLIC_SCOUT_EXTENSION_ID; for unpacked dev, set it to the id from
 * chrome://extensions).
 */

export const SCOUT_EXTENSION_ID = process.env.NEXT_PUBLIC_SCOUT_EXTENSION_ID || ''

// chrome.runtime is injected into mvpaffiliate.io pages only when the
// extension declares us in externally_connectable. Narrow, any-cast access.
function chromeRuntime(): { sendMessage?: (id: string, msg: unknown, cb: (resp: unknown) => void) => void } | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (window as any).chrome
  return c && c.runtime ? c.runtime : null
}

function sendToExtension<T>(message: unknown, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const rt = chromeRuntime()
    if (!rt?.sendMessage || !SCOUT_EXTENSION_ID) { resolve(null); return }
    let settled = false
    const done = (v: T | null) => { if (!settled) { settled = true; resolve(v) } }
    const timer = setTimeout(() => done(null), timeoutMs)
    try {
      rt.sendMessage(SCOUT_EXTENSION_ID, message, (resp: unknown) => {
        clearTimeout(timer)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = (window as any).chrome?.runtime?.lastError
        if (err) { done(null); return }
        done((resp as T) ?? null)
      })
    } catch {
      clearTimeout(timer)
      done(null)
    }
  })
}

/** True if the helper extension is installed and responds to a ping. */
export async function isExtensionAvailable(): Promise<boolean> {
  const resp = await sendToExtension<{ ok?: boolean }>({ type: 'MVP_PING' }, 1500)
  return !!resp?.ok
}

/**
 * Ask the extension to grab SEVERAL real frames from the user's video (one per
 * fraction of the runtime). Returns an array of JPEG data URLs, or [] on any
 * failure (extension missing, ad blocked, blank frames, timeout) — callers fall
 * back to the maxres frame. MVP then vision-picks the best one (face + product).
 */
export async function requestVideoFrames(
  youtubeVideoId: string,
  // Front/mid-weighted, never near the tail — 0.8 lands in the end-screen-card
  // zone (last ~5-20s) which injects stray UI boxes into the capture.
  fractions: number[] = [0.2, 0.35, 0.5, 0.65],
): Promise<string[]> {
  const resp = await sendToExtension<{ ok?: boolean; frames?: string[]; dataUrl?: string; error?: string }>(
    { type: 'MVP_CAPTURE_FRAME', youtubeVideoId, fractions },
    50000,
  )
  if (resp?.ok && Array.isArray(resp.frames)) {
    return resp.frames.filter((f) => typeof f === 'string' && f.startsWith('data:image/'))
  }
  // Back-compat with an older extension that returned a single dataUrl.
  if (resp?.ok && typeof resp.dataUrl === 'string' && resp.dataUrl.startsWith('data:image/')) {
    return [resp.dataUrl]
  }
  return []
}

/** Single-frame convenience wrapper (kept for back-compat). */
export async function requestVideoFrame(youtubeVideoId: string, seekFraction = 0.5): Promise<string | null> {
  const frames = await requestVideoFrames(youtubeVideoId, [seekFraction])
  return frames[0] ?? null
}

/** A raw Creator Connections campaign row as scraped by the extension. All
 *  filtering / ranking happens in the app — this is the unfiltered harvest. */
export interface ScoutedCampaign {
  asin: string
  campaignName?: string
  brand?: string
  epc?: string            // display string, e.g. "Up to $0.38"
  epcValue?: number | null
  endsAt?: string | null
  price?: string | null
  priceValue?: number | null
  rating?: string | null
  budget?: string | null  // "Low" | "Medium" | "High"
  image?: string | null
}

/** Why a scan returned what it did — surfaced so a 0 result explains itself. */
export interface ScoutDiag {
  url: string
  title: string
  gridFound: boolean
  ariaLabelCount: number
  asinCellCount: number
  signedOut: boolean
}

export type ScoutResult =
  | { ok: true; campaigns: ScoutedCampaign[]; diag?: ScoutDiag | null }
  | { ok: false; error: ScoutError; diag?: ScoutDiag | null }

/** Structured failure reasons the EPC page maps to guidance copy. */
export type ScoutError =
  | 'not-installed'            // extension absent / didn't ping
  | 'no-cc-tab'                // user isn't on a Creator Connections tab
  | 'content-script-unreachable' // CC tab open but needs a reload
  | 'scan-failed'              // grid not found / Amazon layout changed
  | 'timeout'

/**
 * Ask the extension to scrape the user's ALREADY-OPEN Creator Connections tab
 * (we never open one — they must be on the opportunities/EPC view). Returns the
 * raw campaign rows for in-app filtering, or a structured error. Best-effort:
 * resolves, never throws.
 */
export async function scoutCreatorConnections(): Promise<ScoutResult> {
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; campaigns?: ScoutedCampaign[]; error?: string }>(
    { type: 'MVP_CC_SCAN' },
    120000, // grid scroll + enrichment pass can be slow on a large list
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok && Array.isArray(resp.campaigns)) return { ok: true, campaigns: resp.campaigns }
  const e = (resp.error || 'scan-failed') as ScoutError
  return { ok: false, error: e }
}
