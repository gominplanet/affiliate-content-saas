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

/** The published Chrome Web Store extension ID (assigned by Google). SCOUT is
 *  migrating from load-unpacked (the per-env NEXT_PUBLIC_SCOUT_EXTENSION_ID,
 *  which is the baked-key id `inpklaogoifhgaimbnlgmijnnjkopnlc`) to the Web
 *  Store, which mints its OWN id. We message BOTH so there's no flag-day: the
 *  unpacked id keeps existing installs working, and this store id starts
 *  working the moment Google approves — no env change required. Once everyone's
 *  on the store build, the env id can be dropped. See extension/CHROME-WEB-STORE.md. */
export const SCOUT_STORE_EXTENSION_ID = 'blpmlneliggaekangckpgknphpacapkg'

/** Every id MVP will try, in order: env (unpacked) first so current users are
 *  unaffected, then the Web Store build. Deduped, no empties — so SCOUT is
 *  reachable from the store build even if NEXT_PUBLIC_SCOUT_EXTENSION_ID is unset. */
const SCOUT_EXTENSION_IDS = Array.from(
  new Set([SCOUT_EXTENSION_ID, SCOUT_STORE_EXTENSION_ID].filter(Boolean)),
)

// chrome.runtime is injected into mvpaffiliate.io pages only when the
// extension declares us in externally_connectable. Narrow, any-cast access.
function chromeRuntime(): { sendMessage?: (id: string, msg: unknown, cb: (resp: unknown) => void) => void } | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (window as any).chrome
  return c && c.runtime ? c.runtime : null
}

// Send to ONE extension id. `reached` is false when that id isn't installed /
// not connectable (chrome sets lastError almost immediately), so the caller can
// fall through to the next id; `reached` true means it answered (value may
// still be null). Reading lastError also "checks" it, suppressing Chrome's
// noisy "Unchecked runtime.lastError" console warning for the not-installed id.
function sendToOneId<T>(id: string, message: unknown, timeoutMs: number): Promise<{ reached: boolean; value: T | null }> {
  return new Promise((resolve) => {
    const rt = chromeRuntime()
    if (!rt?.sendMessage) { resolve({ reached: false, value: null }); return }
    let settled = false
    const done = (reached: boolean, value: T | null) => { if (!settled) { settled = true; resolve({ reached, value }) } }
    const timer = setTimeout(() => done(false, null), timeoutMs)
    try {
      rt.sendMessage(id, message, (resp: unknown) => {
        clearTimeout(timer)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = (window as any).chrome?.runtime?.lastError
        if (err) { done(false, null); return } // not installed / not connectable → try next id
        done(true, (resp as T) ?? null)
      })
    } catch {
      clearTimeout(timer)
      done(false, null)
    }
  })
}

// Try each known id in turn; return the first one that actually answers. A
// not-installed id fails fast (lastError), so the fall-through is cheap.
function sendToExtension<T>(message: unknown, timeoutMs: number): Promise<T | null> {
  return (async () => {
    if (!chromeRuntime()?.sendMessage || SCOUT_EXTENSION_IDS.length === 0) return null
    for (const id of SCOUT_EXTENSION_IDS) {
      const { reached, value } = await sendToOneId<T>(id, message, timeoutMs)
      if (reached) return value
    }
    return null
  })()
}

/** True if the helper extension is installed and responds to a ping. */
export async function isExtensionAvailable(): Promise<boolean> {
  const resp = await sendToExtension<{ ok?: boolean }>({ type: 'MVP_PING' }, 1500)
  return !!resp?.ok
}

/** Installed state + version (the ping returns the manifest version). Lets the
 *  EPC page show an "update SCOUT" banner when it's behind SCOUT_LATEST_VERSION.
 *  version is null when the extension isn't installed / didn't respond. */
export async function getScoutStatus(): Promise<{ installed: boolean; version: string | null }> {
  const resp = await sendToExtension<{ ok?: boolean; version?: string }>({ type: 'MVP_PING' }, 1500)
  return { installed: !!resp?.ok, version: (resp && typeof resp.version === 'string') ? resp.version : null }
}

/**
 * Ask the extension to grab SEVERAL real frames from the user's video (one per
 * fraction of the runtime). Returns an array of JPEG data URLs, or [] on any
 * failure (extension missing, ad blocked, blank frames, timeout) — callers fall
 * back to the maxres frame. MVP then vision-picks the best one (face + product).
 */
export async function requestVideoFrames(
  youtubeVideoId: string,
  // 8 frames spread across the video — gives the vision picker more face-shot
  // options, and 3 of them are sent as identity refs to gpt-image for better
  // likeness lock. Avoids the end-screen zone (>85%). ~200KB each = ~1.6 MB total.
  fractions: number[] = [0.08, 0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78],
): Promise<string[]> {
  const resp = await sendToExtension<{ ok?: boolean; frames?: string[]; dataUrl?: string; error?: string }>(
    { type: 'MVP_CAPTURE_FRAME', youtubeVideoId, fractions },
    120000,
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

/** One Amazon Influencer video harvested from the user's Manage Content page
 *  (their logged-in session). `asin` is the product the video is attached to,
 *  parsed from the vdp URL — lets MVP match a video to a post reliably. */
export interface AmazonVideo {
  vdpUrl: string
  asin: string | null
  title?: string
}

/** What the harvester saw — surfaced so a 0-result is debuggable (which page it
 *  landed on, signed-in state, how many /vdp/ references existed). */
export interface AmazonScanDiag {
  url?: string
  title?: string
  htmlLen?: number
  anchorCount?: number
  vdpAnchorCount?: number
  vdpHtmlHits?: number
  vdpHtmlMatched?: number
}

export type AmazonScanResult =
  | { ok: true; videos: AmazonVideo[]; signedOut?: boolean; diag?: AmazonScanDiag }
  | { ok: false; error: 'not-installed' | 'scan-failed' | 'timeout' | string; diag?: AmazonScanDiag }

/**
 * Ask the extension to read the user's Amazon Manage Content page and return
 * every uploaded video + the product ASIN it's attached to. Best-effort:
 * resolves, never throws. Used by the "Share with brand" modal to find the
 * creator's real Amazon video link for a post (matched by ASIN).
 */
export async function requestAmazonVideos(): Promise<AmazonScanResult> {
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; videos?: AmazonVideo[]; signedOut?: boolean; error?: string; diag?: AmazonScanDiag }>(
    { type: 'MVP_AMZ_SCAN' },
    120000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok && Array.isArray(resp.videos)) {
    const videos = resp.videos.filter(v => v && typeof v.vdpUrl === 'string')
    return { ok: true, videos, signedOut: resp.signedOut, diag: resp.diag }
  }
  return { ok: false, error: resp.error || 'scan-failed', diag: resp.diag }
}

/** Result of the OINK-piggyback scan: open the product page for an ASIN and
 *  read the creator's video link OINK injects there. `oinkDetected` lets the
 *  app recommend OINK when it isn't installed. */
export interface AmazonVideoForAsinResult {
  ok: boolean
  video?: AmazonVideo | null
  oinkDetected?: boolean
  /** Amazon's native "Content Made" label was on the page (true even without
   *  OINK). Lets the app say "video exists but link unreadable" vs "no video". */
  contentMadeSeen?: boolean
  signedOut?: boolean
  error?: string
}

/**
 * Find the creator's Amazon video for ONE product by ASIN, by piggybacking on
 * OINK: the extension opens the product page (their logged-in session), waits
 * for OINK to inject its "Content Made" /vdp/ link, and returns it. Best-effort.
 */
export async function requestAmazonVideoForAsin(asin: string): Promise<AmazonVideoForAsinResult> {
  if (!asin) return { ok: false, error: 'no-asin' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; video?: AmazonVideo | null; oinkDetected?: boolean; contentMadeSeen?: boolean; signedOut?: boolean; error?: string }>(
    { type: 'MVP_AMZ_SCAN', asin },
    60000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) {
    return { ok: true, video: resp.video ?? null, oinkDetected: !!resp.oinkDetected, contentMadeSeen: !!resp.contentMadeSeen, signedOut: resp.signedOut }
  }
  return { ok: false, error: resp.error || 'scan-failed' }
}

/** Product details SCOUT scraped off the Amazon product page (in the user's
 *  own browser / residential IP — the request Amazon doesn't block). Used as a
 *  fallback when the server-side scrape is blocked. */
export interface ScrapedAmazonProduct {
  asin: string
  title: string
  bullets: string[]
  description: string
  price: string | null
  rating: string | null
  imageUrl: string | null
  images: string[]
}

export interface AmazonProductResult {
  ok: boolean
  product?: ScrapedAmazonProduct | null
  signedOut?: boolean
  captcha?: boolean
  error?: string
}

/**
 * Fetch an Amazon product's details by ASIN through the extension — it opens
 * amazon.com/dp/<ASIN> in the user's logged-in browser and reads the title,
 * bullets, description, price, rating and images off the rendered page. This
 * succeeds where the server scrape fails because the request comes from a real
 * residential IP, not a datacenter. Best-effort: resolves, never throws.
 */
export async function requestAmazonProduct(asin: string): Promise<AmazonProductResult> {
  if (!asin) return { ok: false, error: 'no-asin' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; product?: ScrapedAmazonProduct | null; signedOut?: boolean; captcha?: boolean; error?: string }>(
    { type: 'MVP_AMZ_PRODUCT', asin },
    60000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) return { ok: true, product: resp.product ?? null, signedOut: resp.signedOut, captcha: resp.captcha }
  return { ok: false, error: resp.error || 'scan-failed' }
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

/** One scheduled video as SCOUT read it from YouTube Studio's Content list. */
export interface StudioScheduledVideo {
  videoId: string
  title: string
  publishAt: string // ISO
}

export interface StudioScheduleResult {
  ok: boolean
  videos: StudioScheduledVideo[]
  error?: string
  // Diagnostics from the Studio scrape (ytcfg presence, HTTP status, counts) —
  // surfaced so we can tune the unofficial-endpoint shape without guessing.
  debug?: Record<string, unknown>
}

/**
 * Ask SCOUT to read the user's YouTube Studio Content list and return EVERY
 * scheduled video with its publish date. This is the only complete source on
 * large channels — the public Data API truncates the uploads playlist (~2,575)
 * and caps search (~500), missing most scheduled videos. SCOUT opens a
 * background Studio tab and calls Studio's own internal list endpoint with the
 * user's session. Best-effort: resolves, never throws.
 */
export async function requestStudioSchedule(): Promise<StudioScheduleResult> {
  if (!(await isExtensionAvailable())) return { ok: false, videos: [], error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; videos?: StudioScheduledVideo[]; error?: string; debug?: Record<string, unknown> }>(
    { type: 'MVP_STUDIO_SCHEDULE' },
    120000, // opening Studio + paginating the internal API can take a while
  )
  if (!resp) return { ok: false, videos: [], error: 'timeout' }
  if (resp.ok && Array.isArray(resp.videos)) return { ok: true, videos: resp.videos, debug: resp.debug }
  return { ok: false, videos: [], error: resp.error || 'scan-failed', debug: resp.debug }
}

/** One step of the Studio "finish" pass (monetization / endscreen). `ok` means
 *  SCOUT completed the step; `partial` means it got the user most of the way
 *  (e.g. opened the end-screen import) but a manual click remains. `debug`
 *  carries the controls it saw so unofficial-UI selectors are easy to tune. */
export interface StudioFinishStep {
  step: string
  ok: boolean
  certOk?: boolean
  partial?: boolean
  /** Step didn't apply to this channel (e.g. monetization on a non-monetized
   *  channel) — render as a neutral note, not a failure. */
  skipped?: boolean
  detail?: string
  error?: string
  debug?: Record<string, unknown>
}

export interface StudioFinishResult {
  ok: boolean
  steps: StudioFinishStep[]
  error?: string
}

/** Which Studio-only actions the user opted into. */
export interface StudioFinishOpts {
  /** Details page: paid-promotion ✓, AI-use = No, embedding on, and force
   *  "Publish to subscriptions feed & notify subscribers" OFF. */
  details: boolean
  monetize: boolean
  selfCert: boolean
  endScreen: boolean
}

/**
 * Ask SCOUT to "finish" a video in YouTube Studio — the fields the public Data
 * API can't set. The user must explicitly opt in (a checkbox in Co-Pilot that
 * states each action). SCOUT opens Studio in the user's own logged-in session
 * and drives the real UI controls: turn Monetization on, submit the
 * ad-suitability self-certification, and copy the end screen from the last
 * video. Best-effort and non-destructive — a missing control safely no-ops.
 * Resolves, never throws.
 */
export async function requestStudioFinish(
  videoId: string,
  opts: StudioFinishOpts,
): Promise<StudioFinishResult> {
  if (!videoId) return { ok: false, steps: [], error: 'no-video-id' }
  if (!(await isExtensionAvailable())) return { ok: false, steps: [], error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; steps?: StudioFinishStep[]; error?: string }>(
    { type: 'MVP_STUDIO_FINISH', videoId, opts },
    185000, // up to 3 page loads + UI settle time in Studio
  )
  if (!resp) return { ok: false, steps: [], error: 'timeout' }
  return { ok: !!resp.ok, steps: Array.isArray(resp.steps) ? resp.steps : [], error: resp.error }
}
