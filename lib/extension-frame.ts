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

/** The load-unpacked (sideloaded) build's id — the baked-key build. Kept as a
 *  reachable fallback so a user can TEST a newer sideloaded SCOUT (e.g. a build
 *  that's newer than the Web Store copy, before Google approves it): with the
 *  store build disabled, feature messages fall through to this id. Also revives
 *  any pre-store unpacked installs that never had NEXT_PUBLIC_SCOUT_EXTENSION_ID
 *  set. Declared here (before SCOUT_EXTENSION_IDS) and re-exported below. */
export const KNOWN_SIDELOAD_EXTENSION_ID = 'inpklaogoifhgaimbnlgmijnnjkopnlc'

/** Every id MVP will try, in order: env (explicit override) first, then the
 *  Web Store build (canonical, auto-updating), then the sideload build as a
 *  fallback. sendToExtension returns the FIRST id that answers — so the store
 *  build wins for normal users, and a sideloaded test build is only reached when
 *  the store one isn't installed/enabled. Deduped, no empties. */
const SCOUT_EXTENSION_IDS = Array.from(
  new Set([SCOUT_EXTENSION_ID, SCOUT_STORE_EXTENSION_ID, KNOWN_SIDELOAD_EXTENSION_ID].filter(Boolean)),
)

// ── Auto-discovered SCOUT id ────────────────────────────────────────────────
// SCOUT's bridge content script (mvp-bridge.js, v1.11.53+) runs on this page and
// postMessages its own chrome.runtime.id. We capture it so the app can reach
// WHATEVER build is installed — Web Store, keyed sideload, or an unpacked dev
// build with a RANDOM id the app couldn't know in advance. This kills the
// "SCOUT is installed but the app says not-installed" id-mismatch class.
//
// Safety: additive only (the hardcoded ids are always kept) + strict id-shape
// validation, so a page script can't spoof us into dropping a real id — at worst
// it makes us also try a dead id, which just no-ops.
let discoveredScoutId: string | null = null
const SCOUT_ID_RE = /^[a-p]{32}$/ // Chrome extension ids are 32 chars, a–p
if (typeof window !== 'undefined') {
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return
    const d = ev.data
    if (d && d.source === 'MVP_SCOUT' && d.type === 'SCOUT_HELLO' && typeof d.extensionId === 'string' && SCOUT_ID_RE.test(d.extensionId)) {
      discoveredScoutId = d.extensionId
    }
  })
  // Prompt an announcement in case the bridge shouted before this listener
  // attached (it also announces proactively for a few seconds after load).
  try { window.postMessage({ source: 'MVP_APP', type: 'SCOUT_WHO' }, window.location.origin) } catch { /* ignore */ }
}

/** Ids to try, discovered-first (it's the build actually installed), then the
 *  hardcoded env/store/sideload ids. Deduped. */
function effectiveScoutIds(): string[] {
  return discoveredScoutId
    ? Array.from(new Set([discoveredScoutId, ...SCOUT_EXTENSION_IDS]))
    : SCOUT_EXTENSION_IDS
}

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
    const ids = effectiveScoutIds()
    if (!chromeRuntime()?.sendMessage || ids.length === 0) return null
    for (const id of ids) {
      const { reached, value } = await sendToOneId<T>(id, message, timeoutMs)
      if (reached) return value
    }
    return null
  })()
}

export interface MessageBrandResult { ok: boolean; error?: string; reason?: string; steps?: Record<string, boolean>; diag?: Record<string, unknown>; groups?: number; leftOpen?: boolean }

/**
 * Compose-and-send from the MVP modal: the user reviewed the exact message and
 * clicked Send, so SCOUT opens the campaign in a BACKGROUND tab, fills the
 * Message Brand box and SUBMITS it — entirely inside the user's Amazon session,
 * no visible tab. Only sends when the full text is verified in the box.
 * Best-effort: resolves, never throws.
 */
export async function requestSendBrand(detailsUrl: string, message: string): Promise<MessageBrandResult> {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  if (!message.trim()) return { ok: false, error: 'no-message' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; error?: string; reason?: string; steps?: Record<string, boolean>; diag?: Record<string, unknown>; groups?: number }>(
    { type: 'MVP_SEND_BRAND', detailsUrl, message },
    // Headroom: N messages sent one-by-one, each may pause on Amazon's "sharing
    // personal information" confirm (address messages) + a possible store-id
    // switch up front. 120s was too tight and surfaced as a false "timeout".
    180000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, error: resp.error, reason: resp.reason, steps: resp.steps, diag: resp.diag, groups: resp.groups }
}

/**
 * ONE-tab "accept-if-needed, then send" for Send on Creator Connections. SCOUT
 * opens the campaign in a single background tab, accepts it when it's an
 * un-accepted opportunity (Amazon only opens the brand chat after acceptance),
 * then sends the message on the SAME tab — no cross-tab teardown race (which was
 * the "Frame with ID 0 was removed" failure). Best-effort: resolves, never throws.
 */
/**
 * DIRECT send by catalog campaign id(s) — skips SCOUT's grid search entirely.
 * The app resolves the product's ASIN to campaign_id(s) in the shared catalog
 * and hands them here; SCOUT deep-links straight to the campaign and runs the
 * same accept-if-needed + send, verifying the ASIN on the page first. This is
 * the reliable path (no grid scroll, no wrong-brand, no find timeout).
 */
export async function requestSendByCampaign(campaignIds: string[], message: string, asin?: string | null, fallbackCampaignIds?: string[]): Promise<MessageBrandResult & { detailsUrl?: string | null }> {
  const ids = [...new Set((campaignIds || []).filter(Boolean))]
  const fbids = [...new Set((fallbackCampaignIds || []).filter(Boolean))]
  if (!ids.length && !fbids.length) return { ok: false, error: 'no-campaign' }
  if (!message.trim()) return { ok: false, error: 'no-message' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; error?: string; reason?: string; groups?: number; detailsUrl?: string | null; leftOpen?: boolean }>(
    { type: 'MVP_CC_SEND_BY_CAMPAIGN', campaignIds: ids, fallbackCampaignIds: fbids, message, asin: (asin || '').toUpperCase() || undefined },
    185000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, error: resp.error, reason: resp.reason, groups: resp.groups, detailsUrl: resp.detailsUrl, leftOpen: resp.leftOpen }
}

/**
 * FULLY BACKGROUND send by ASIN — the catalog-free path. SCOUT resolves the ASIN
 * to the creator's accepted campaign through Amazon's own API (collaboration/
 * search), looks up the brand chat token (chat/search) and posts the recap
 * (chat/message/send), all in a hidden tab in the user's session. campaignIds are
 * optional hints from our catalog. Needs SCOUT to have learned the send API from a
 * prior real send. Best-effort: resolves, never throws.
 */
export async function requestSendByAsin(asin: string, message: string, campaignIds?: string[]): Promise<MessageBrandResult & { campaignId?: string; brand?: string | null }> {
  const a = (asin || '').toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'no-asin' }
  if (!message.trim()) return { ok: false, error: 'no-message' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; error?: string; reason?: string; groups?: number; campaignId?: string; brand?: string | null }>(
    { type: 'MVP_CC_SEND_BY_ASIN', asin: a, message, campaignIds: [...new Set((campaignIds || []).filter(Boolean))] },
    125000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, error: resp.error, reason: resp.reason, groups: resp.groups, campaignId: resp.campaignId, brand: resp.brand }
}

export interface CcSendDebug {
  ok: boolean
  hasRecipe?: boolean
  recipe?: Record<string, unknown> | null
  searchRecipe?: Record<string, unknown> | null
  ringCount?: number
  ring?: Array<Record<string, unknown>>
  responses?: Array<Record<string, unknown>>
  creatorId?: string | null
  error?: string
}

/**
 * DIAGNOSTIC — ask SCOUT what its network hook has captured on Creator Connections
 * and whether it has learned a send "recipe". This is how we SEE Amazon's real
 * send request (the endpoint/headers/body) so replay can be tuned to it, instead
 * of debugging blind. Best-effort: resolves, never throws.
 */
export async function requestCcSendDebug(): Promise<CcSendDebug> {
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<CcSendDebug>({ type: 'MVP_CC_DEBUG' }, 8000)
  if (!resp) return { ok: false, error: 'timeout' }
  return resp
}

export async function requestAcceptAndSendBrand(detailsUrl: string, message: string, asin?: string | null): Promise<MessageBrandResult & { accepted?: boolean }> {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  if (!message.trim()) return { ok: false, error: 'no-message' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  // Pass the ASIN so SCOUT can VERIFY the campaign it opened really sells this
  // product before sending — the last line of defence against a stale cached URL
  // delivering the recap to the wrong brand.
  const resp = await sendToExtension<{ ok?: boolean; error?: string; reason?: string; groups?: number; accepted?: boolean }>(
    { type: 'MVP_CC_ACCEPT_AND_SEND', detailsUrl, message, asin: (asin || '').toUpperCase() || undefined },
    185000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, error: resp.error, reason: resp.reason, groups: resp.groups, accepted: resp.accepted }
}

export interface AcceptCampaignResult { ok: boolean; accepted?: boolean; already?: boolean; error?: string; reason?: string }

/**
 * "Accept on Amazon" from the /epc list: SCOUT opens the campaign's details page
 * in the user's session and clicks its Accept button — background-first, with a
 * brief foreground fallback if the page's React didn't render headless. Accepting
 * is a deliberate choice made in MVP (importing never accepts). Best-effort:
 * resolves, never throws.
 */
export async function requestAcceptCampaign(detailsUrl: string): Promise<AcceptCampaignResult> {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; accepted?: boolean; already?: boolean; error?: string; reason?: string }>(
    { type: 'MVP_CC_ACCEPT', detailsUrl },
    95000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, accepted: resp.accepted, already: resp.already, error: resp.error, reason: resp.reason }
}

/**
 * Ask SCOUT to open a campaign's Amazon page (the user's logged-in session),
 * open its "Message Brand" box and drop in a drafted message — leaving it for
 * the user to review and Send. Human-in-the-loop: SCOUT never clicks Send.
 * Best-effort: resolves, never throws.
 */
export interface MyCcCampaign {
  campaignId: string
  asin: string | null
  brand: string | null
  name: string | null
  asinCount?: number
  image?: string | null
  commissionPct?: number | null
  rating?: number | null
  reviewCount?: number | null
  status?: string | null
}

/**
 * List the creator's accepted/active Creator Connections campaigns straight from
 * Amazon (their real CC dashboard), so MVP can show ALL joined campaigns under
 * "Joined only" — including ones joined directly on Amazon, not just via MVP.
 * Best-effort: resolves, never throws.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requestMyCcCampaigns(opts?: { keyword?: string; maxPages?: number }): Promise<{ ok: boolean; campaigns: MyCcCampaign[]; total?: number; hasMore?: boolean; error?: string; reason?: string; diag?: any }> {
  if (!(await isExtensionAvailable())) return { ok: false, campaigns: [], error: 'not-installed' }
  const resp = await sendToExtension<{
    ok?: boolean; campaigns?: MyCcCampaign[]; total?: number; hasMore?: boolean; error?: string; reason?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    diag?: any
  }>(
    { type: 'MVP_CC_MY_CAMPAIGNS', keyword: opts?.keyword || '', maxPages: opts?.maxPages },
    95000,
  )
  if (!resp) return { ok: false, campaigns: [], error: 'timeout' }
  return { ok: !!resp.ok, campaigns: Array.isArray(resp.campaigns) ? resp.campaigns : [], total: resp.total, hasMore: resp.hasMore, error: resp.error, reason: resp.reason, diag: resp.diag }
}

export async function requestMessageBrand(detailsUrl: string, message: string): Promise<MessageBrandResult> {
  if (!detailsUrl) return { ok: false, error: 'no-url' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; error?: string; reason?: string }>(
    { type: 'MVP_MESSAGE_BRAND', detailsUrl, message },
    60000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, error: resp.error, reason: resp.reason }
}

export interface IdeaScanResult { ok: boolean; count?: number; upserted?: number; error?: string; partial?: boolean }

/**
 * Read a single Amazon idea list in a BACKGROUND SCOUT tab and push its products
 * to MVP, then close the tab. The user never leaves MVP (no foreground tab, no
 * focus steal). Best-effort: resolves with { ok:false, error } when SCOUT isn't
 * installed so the caller can fall back to the old window.open flow.
 */
/**
 * Force a page URL to an absolute https:// URL before it's handed to the
 * extension. A scheme-less value (e.g. "www.amazon.com/shop/name") is resolved by
 * the extension RELATIVE TO ITS OWN chrome-extension:// origin, producing
 * "chrome-extension://<id>/www.amazon.com/shop/name" — which it can't open ("Cannot
 * access contents of url …"). Every scan that takes a URL runs its input through
 * this so a pasted bare host can never break the crawl.
 */
function absoluteUrl(url: string): string {
  const t = (url || '').trim()
  if (!t) return t
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t.replace(/^\/+/, '')}`
}

export async function requestIdeaListScan(url: string): Promise<IdeaScanResult> {
  if (!url) return { ok: false, error: 'no-url' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<IdeaScanResult>({ type: 'MVP_SCAN_IDEA_LIST', url: absoluteUrl(url) }, 120000)
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, count: resp.count, upserted: resp.upserted, error: resp.error }
}

/**
 * Enumerate the creator's storefront idea lists in a BACKGROUND SCOUT tab and
 * push the metadata to MVP, then close the tab. Same no-foreground contract as
 * requestIdeaListScan.
 */
export async function requestStorefrontScan(url: string): Promise<IdeaScanResult> {
  if (!url) return { ok: false, error: 'no-url' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<IdeaScanResult>({ type: 'MVP_SCAN_STOREFRONT', url: absoluteUrl(url) }, 120000)
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, count: resp.count, error: resp.error }
}

/**
 * Walk the creator's PUBLIC storefront (idea lists → product tiles) in a
 * BACKGROUND SCOUT tab and record EVERY product they feature — past the ~100
 * earnings cap — then push the catalog to MVP. Bigger crawl, so a longer wait.
 */
export async function requestStorefrontCatalogScan(url: string): Promise<IdeaScanResult> {
  if (!url) return { ok: false, error: 'no-url' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<IdeaScanResult>({ type: 'MVP_SCAN_STOREFRONT_CATALOG', url: absoluteUrl(url) }, 180000)
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, count: resp.count, error: resp.error }
}

/**
 * Read the creator's Creator Hub video table in a BACKGROUND SCOUT tab and
 * record which products (ASINs) they have a video for, then push to MVP.
 */
export async function requestCreatorHubVideosScan(): Promise<IdeaScanResult> {
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  // Longer wait than the storefront crawl: a creator can have thousands of
  // videos, so the in-page reader pages for up to ~4 min. Keep this above that.
  const resp = await sendToExtension<IdeaScanResult>({ type: 'MVP_SCAN_CREATORHUB_VIDEOS' }, 300000)
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, count: resp.count, partial: resp.partial, error: resp.error }
}

/**
 * One-click storefront sync: SCOUT opens the Amazon Associates earnings report
 * in a BACKGROUND tab, scrapes the current view + the quick-ranges (Last Week /
 * This Month / Last Month), pushes them to MVP, and closes the tab. The user
 * stays on /storefront. Best-effort: resolves { ok:false } when SCOUT isn't
 * installed so the caller can show the manual fallback.
 */
export async function requestEarningsScan(): Promise<IdeaScanResult> {
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<IdeaScanResult>({ type: 'MVP_SCAN_EARNINGS' }, 120000)
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, count: resp.count, upserted: resp.upserted, error: resp.error }
}

/** Compact per-export summary SCOUT returns for the CC catalog refresh — enough
 *  to verify the header mapping landed without shipping back 700k rows. */
export interface CcExportSummary {
  ok: boolean
  rows?: number
  files?: string[]
  headers?: string[]
  headerMap?: Record<string, string>
  sample?: Record<string, unknown>
  error?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diag?: any
}

export interface CcCatalogScanResult {
  ok: boolean
  staged?: number
  armed?: boolean
  armMessage?: string
  armError?: string
  needsConfirm?: boolean
  available?: CcExportSummary | null
  accepted?: CcExportSummary | null
  error?: string
}

/**
 * Admin-only: refresh the SHARED Creator Connections catalog with one click.
 * SCOUT opens the CC requests page in a BACKGROUND tab, clicks Amazon's two
 * native "Download all …" exports (available + accepted), waits out the
 * server-side build, captures + unzips + parses the CSV ZIPs, stages every row
 * into cc_campaign_catalog_import, and arms the server-side background drain
 * (merge → purge). Replaces the weekly manual download + Supabase upload.
 *
 * Long budget: Amazon can take minutes to build each export, so the channel is
 * held open up to ~13 minutes. Best-effort — resolves { ok:false } when SCOUT
 * isn't installed so the caller can show the manual fallback.
 */
export async function requestCcCatalogScan(): Promise<CcCatalogScanResult> {
  // This scan needs the MVP_SCAN_CC_CATALOG handler that shipped in 1.16.25. An
  // older SCOUT answers the ping but has no handler for this message, so the
  // channel closes with no reply and the bridge would report a bare "timeout".
  // Gate on the version so the button says "update SCOUT" instead.
  const status = await getScoutStatus()
  if (!status.installed) return { ok: false, error: 'not-installed' }
  if (_cmpVersion(status.version, CC_CATALOG_MIN_SCOUT) < 0) {
    return { ok: false, error: `outdated-scout:${status.version || 'unknown'}` }
  }
  const resp = await sendToExtension<CcCatalogScanResult>({ type: 'MVP_SCAN_CC_CATALOG' }, 780000)
  if (!resp) return { ok: false, error: 'timeout' }
  return resp
}

/** Minimum SCOUT version with the robust CC catalog scan (polls for the export
 *  button + returns diagnostics). 1.16.25 had a fragile first cut. */
export const CC_CATALOG_MIN_SCOUT = '1.16.28'

/** -1 / 0 / 1 dotted-version compare; a null/unknown left side sorts oldest. */
function _cmpVersion(a: string | null | undefined, b: string): number {
  if (!a) return -1
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Ping SCOUT, tolerant of a cold MV3 service worker.
 *
 *  Chrome unloads an extension's service worker after ~30s idle. A single short
 *  ping can miss the wake-up window and wrongly report SCOUT "not installed"
 *  while it's right there (the "Get SCOUT" / "Install / enable SCOUT" false
 *  negative). We give the worker a generous budget and retry once so a sleeping
 *  worker gets time to boot and answer. This adds latency ONLY when SCOUT is
 *  present-but-asleep: a genuinely-absent extension makes chrome.sendMessage set
 *  lastError almost immediately, so sendToExtension returns fast and the retry
 *  loop still bails in a few ms. */
async function pingScout(): Promise<{ ok?: boolean; version?: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await sendToExtension<{ ok?: boolean; version?: string }>({ type: 'MVP_PING' }, 4000)
    if (resp?.ok) return resp
  }
  return null
}

/** True if the helper extension is installed and responds to a ping. */
export async function isExtensionAvailable(): Promise<boolean> {
  return !!(await pingScout())?.ok
}

/** Installed state + version (the ping returns the manifest version). Lets the
 *  EPC page show an "update SCOUT" banner when it's behind SCOUT_LATEST_VERSION.
 *  version is null when the extension isn't installed / didn't respond. */
export async function getScoutStatus(): Promise<{ installed: boolean; version: string | null }> {
  const resp = await pingScout()
  return { installed: !!resp?.ok, version: (resp && typeof resp.version === 'string') ? resp.version : null }
}

/** Which SCOUT is installed: the auto-updating Web Store build, the old
 *  manually-loaded (sideloaded) build, or none. Powers the one-time "move to
 *  the Web Store" nudge so legacy sideloaders get Chrome's auto-updates. We
 *  ping the STORE id first (the destination); only if that's absent do we check
 *  the sideload id — so a user who already has the store build reads as 'store'
 *  even if the old copy is still lying around. */
export async function getScoutInstallKind(): Promise<{ kind: 'store' | 'sideload' | 'none'; version: string | null }> {
  if (!chromeRuntime()?.sendMessage) return { kind: 'none', version: null }
  const store = await sendToOneId<{ ok?: boolean; version?: string }>(SCOUT_STORE_EXTENSION_ID, { type: 'MVP_PING' }, 1500)
  if (store.reached && store.value?.ok) {
    return { kind: 'store', version: typeof store.value.version === 'string' ? store.value.version : null }
  }
  const side = await sendToOneId<{ ok?: boolean; version?: string }>(KNOWN_SIDELOAD_EXTENSION_ID, { type: 'MVP_PING' }, 1500)
  if (side.reached && side.value?.ok) {
    return { kind: 'sideload', version: typeof side.value.version === 'string' ? side.value.version : null }
  }
  return { kind: 'none', version: null }
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

/**
 * Ask SCOUT to pull the video's TRANSCRIPT from the user's own browser session.
 * The server can't reliably fetch captions (its IP is throttled, and the Data
 * API costs 200 quota units), and it can't reach the user's PRIVATE drafts at
 * all — but SCOUT can, because it opens the watch page inside the user's logged-
 * in YouTube session. The transcript then grounds the metadata generator so
 * titles reflect what the video actually says.
 *
 * Returns '' on any failure (extension missing, no captions yet on a still-
 * processing draft, timeout) — the caller simply omits `transcript` and the
 * server falls back to product-grounded, non-fabricated titles.
 */
export async function requestVideoTranscript(youtubeVideoId: string): Promise<string> {
  if (!youtubeVideoId) return ''
  const resp = await sendToExtension<{ ok?: boolean; transcript?: string; error?: string }>(
    { type: 'MVP_YT_TRANSCRIPT', youtubeVideoId },
    45000,
  )
  return resp?.ok && typeof resp.transcript === 'string' ? resp.transcript : ''
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

/** Product details SCOUT scraped off a NON-Amazon store page (Walmart, Target,
 *  Best Buy, …). Read from JSON-LD / Open Graph in the user's own browser, so
 *  it works where MVP's server scrape is IP-blocked. `sourceUrl` echoes the page
 *  actually read (after any redirect). */
export interface ScrapedProduct {
  title: string
  description: string
  bullets: string[]
  brand: string | null
  price: string | null
  rating: string | null
  imageUrl: string | null
  images: string[]
  sourceUrl?: string
}

export interface ScrapeUrlResult {
  ok: boolean
  product?: ScrapedProduct | null
  /** Structured reasons the UI maps to guidance: 'not-installed' (SCOUT absent),
   *  'store-not-supported' (host outside SCOUT's allowed retailer list),
   *  'permission-needed' (the retail hosts are optional — the user must flip
   *  "Read non-Amazon products" on in the SCOUT popup), 'no-result' (page read
   *  but no product data), 'timeout'. */
  error?: string
  diag?: Record<string, unknown>
}

/**
 * Ask SCOUT to open ANY supported store URL (Walmart, Target, etc.) in the
 * user's own browser and read its product data — the workaround for stores that
 * block MVP's datacenter-IP server scrape. Best-effort: resolves, never throws;
 * returns { ok:false, error:'not-installed' } when SCOUT isn't present so the
 * caller can fall back to URL-slug name + web-search research.
 */
export async function requestScrapeUrl(url: string): Promise<ScrapeUrlResult> {
  if (!url) return { ok: false, error: 'no-url' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; product?: ScrapedProduct | null; error?: string; diag?: Record<string, unknown> }>(
    { type: 'MVP_SCRAPE_URL', url },
    70000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) return { ok: true, product: resp.product ?? null, diag: resp.diag }
  return { ok: false, error: resp.error || 'scan-failed', diag: resp.diag }
}

/** One product SCOUT found + deep-checked from an Amazon search (Product Finder). */
export interface FinderProduct {
  asin: string
  title: string
  price: string | null
  image: string | null
  rating: string | null
  reviews?: number | null
  monthlySales: number | null
  carouselPos: 'top' | 'bottom' | 'none' | null
  hasVideo?: boolean
  marketplace?: string
}

export interface ProductSearchResult {
  ok: boolean
  products?: FinderProduct[]
  scanned?: number    // how many products were deep-checked
  totalFound?: number // how many appeared in Amazon's search
  blocked?: boolean   // Amazon rate-limited us mid-scan — results are partial
  /** Why deep-checked candidates dropped (card = failed price/rating/reviews
   *  before any deep check). */
  drops?: { card: number; sales: number; carousel: number; rating: number; unreadable: number }
  /** ASINs deep-checked this call (pass or fail) — pass back as excludeAsins
   *  on the next wave so it digs deeper into the pool. */
  checkedAsins?: string[]
  /** True when every gated candidate in the search pool has been checked —
   *  further waves won't find more. */
  poolExhausted?: boolean
  error?: string
}

/**
 * Product Finder: ask SCOUT to run an Amazon keyword search in the user's own
 * browser, deep-check each result (monthly sales + carousel-video position), and
 * return the ones that pass the rules — the live, in-MVP alternative to a
 * third-party product database. Slow (a /dp visit per product), so a long
 * timeout. Best-effort: resolves, never throws.
 */
export async function requestProductSearch(
  query: string,
  rules: {
    minSales?: number; mustVideo?: boolean; maxResults?: number; priceMin?: number; priceMax?: number
    minRating?: number; minReviews?: number
    /** us (default) | ca | uk | au — non-US needs the popup's International toggle. */
    marketplace?: string
    /** ASINs already deep-checked in earlier waves — skipped so this wave digs deeper. */
    excludeAsins?: string[]
  },
): Promise<ProductSearchResult> {
  if (!query.trim()) return { ok: false, error: 'no-query' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<ProductSearchResult>(
    { type: 'MVP_PRODUCT_SEARCH', query, opts: rules },
    430000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) return { ok: true, products: resp.products ?? [], scanned: resp.scanned, totalFound: resp.totalFound, blocked: resp.blocked, drops: resp.drops, checkedAsins: resp.checkedAsins, poolExhausted: resp.poolExhausted }
  return { ok: false, error: resp.error || 'search-failed', products: resp.products ?? [], blocked: resp.blocked }
}

export interface FindCampaignResult {
  ok: boolean
  found?: boolean
  status?: 'opportunity' | 'active' | 'completed' | null // which CC tab it was found in
  campaignId?: string | null   // the CC campaign id (amzn1.campaign.…) read off the card
  detailsUrl?: string | null
  campaignName?: string | null
  brand?: string | null
  commissionPct?: number | null
  endsAt?: string | null
  scanned?: number    // how many result cards the ASIN search rendered
  total?: number      // how many campaigns Amazon's search returned
  error?: string
  // What SCOUT saw per tab (cards seen, brands, whether it matched) — surfaced in
  // the UI so a miss is diagnosable instead of a silent "couldn't find it".
  diag?: FindCampaignDiag | null
}

export interface FindCampaignDiag {
  wantBrand?: string | null
  program?: string | null
  tabs?: Array<{ status: string; cards: number; searched?: boolean; brands?: string[]; matched?: boolean }>
}

/**
 * Live "is this product a Creator Connections campaign?" lookup. SCOUT SEARCHES
 * THE CC GRID BY THE ASIN (Amazon's CC search matches ASINs) — an exact query
 * returns that product's campaign card if one exists, so there's no keyword
 * guessing or per-card ASIN resolution. Returns the campaign id + details URL so
 * the caller can show it and auto-send a brand message. Used by the Product
 * Finder's "Check CC" / Message flow. Best-effort: resolves, never throws.
 * (The `query` param is unused now — kept for call-site compatibility.)
 */
export async function requestFindCampaign(query: string, asin: string, brand?: string | null, campaignIds?: string[] | null): Promise<FindCampaignResult> {
  if (!/^[A-Za-z0-9]{10}$/.test(asin || '')) return { ok: false, error: 'no-asin' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{
    ok?: boolean; found?: boolean; status?: 'opportunity' | 'active' | 'completed' | null
    campaignId?: string | null; detailsUrl?: string | null; campaignName?: string | null
    brand?: string | null; commissionPct?: number | null; endsAt?: string | null
    scanned?: number; total?: number; error?: string; diag?: FindCampaignDiag | null
    // brand + campaignIds from our catalog let SCOUT match the exact campaign
  }>({ type: 'MVP_CC_FIND', query: query || '', asin, brand: brand || null, campaignIds: campaignIds || null }, 240000)
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) {
    return {
      ok: true, found: !!resp.found,
      status: resp.status ?? null,
      campaignId: resp.campaignId ?? null,
      detailsUrl: resp.detailsUrl ?? null,
      campaignName: resp.campaignName ?? null,
      brand: resp.brand ?? null,
      commissionPct: resp.commissionPct ?? null,
      endsAt: resp.endsAt ?? null,
      scanned: resp.scanned, total: resp.total,
      diag: resp.diag ?? null,
    }
  }
  return { ok: false, error: resp.error || 'find-failed', diag: resp.diag ?? null }
}

export interface CampaignMatch {
  asin: string
  campaignId: string | null    // the CC campaign id (amzn1.campaign.…) read off the card
  detailsUrl: string | null
  campaignName: string | null
  brand: string | null
  commissionPct: number | null
}
export interface CcMatchResult {
  ok: boolean
  matches?: CampaignMatch[]
  scanned?: number
  total?: number
  error?: string
}

/**
 * "Check all CC" — batch version of requestFindCampaign. SCOUT searches the CC
 * grid by EACH ASIN in turn (same rule as the single check) and returns which
 * products have a campaign, each with its campaign id + details URL. Paced
 * between searches to stay under Amazon's rate limits, and capped, so a long
 * list can't run away. Slow (one CC search per product), so a long timeout.
 * (The `keyword` param is unused now — kept for call-site compatibility.)
 * Best-effort: resolves, never throws.
 */
export async function requestCcMatch(keyword: string, asins: string[]): Promise<CcMatchResult> {
  const clean = Array.from(new Set((asins || []).map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a))))
  if (clean.length === 0) return { ok: true, matches: [] }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; matches?: CampaignMatch[]; scanned?: number; total?: number; error?: string }>(
    { type: 'MVP_CC_MATCH', keyword: keyword || '', asins: clean },
    310000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) return { ok: true, matches: resp.matches ?? [], scanned: resp.scanned, total: resp.total }
  return { ok: false, error: resp.error || 'match-failed' }
}

/**
 * MVP Smart Scan — SCOUT sweeps the whole Affiliate+ opportunities grid and
 * applies the MVP rulebook (lib/cc-smart-rules.ts, sent along so the extension
 * never carries its own copy of the numbers), deep-checking the best candidates
 * for price / monthly units / rating / video-carousel placement. Returns raw
 * matches; the app re-gates + scores them. Slow by design (paced deep-checks),
 * so a very long timeout. Best-effort: resolves, never throws.
 */
export interface CcSmartScanResult {
  ok: boolean
  matches?: import('./cc-smart-rules').SmartScanMatch[]
  stats?: import('./cc-smart-rules').SmartScanStats & { truncated?: boolean }
  foreground?: boolean
  error?: string
}
/** One catalog campaign the app hands SCOUT to verify by ASIN. */
export interface CatalogCandidate {
  campaignId: string | null
  campaignName: string | null
  brand: string | null
  asin: string
  detailsUrl?: string | null
  commissionPct: number | null
  endsAt: string | null
  daysLeft: number | null
}
export interface CcVerifyResult {
  ok: boolean
  results?: import('./cc-smart-rules').SmartScanMatch[]
  deepChecked?: number
  blocked?: boolean
  drops?: { unreadable: number; price: number; sales: number; rating: number; carousel: number; category: number }
  error?: string
}
/**
 * Catalog-first "Campaigns ON": the app pre-filters the shared CC catalog
 * (commission / runway / avoid-list — instant SQL) and hands SCOUT this
 * shortlist to live-verify by ASIN (price / units / rating / carousel) straight
 * on each /dp — no Creator Connections grid. Returns the passers with live
 * signals so the app can score + rank. Best-effort: resolves, never throws.
 */
export async function requestCcVerify(
  candidates: CatalogCandidate[],
  rules: import('./cc-smart-rules').CcSmartRules & { wantPassers?: number },
): Promise<CcVerifyResult> {
  if (!candidates.length) return { ok: true, results: [] }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<CcVerifyResult>({ type: 'MVP_CC_VERIFY', candidates, rules }, 430000)
  if (!resp) return { ok: false, error: 'timeout' }
  return resp
}

export async function requestCcSmartScan(
  rules: import('./cc-smart-rules').CcSmartRules,
  /** Optional focus keyword — drives Amazon's own CC search first so the sweep
   *  covers the FULL catalog matching it and the deep-check budget concentrates
   *  on that niche. Empty = whole opportunities grid. */
  keyword?: string,
): Promise<CcSmartScanResult> {
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<CcSmartScanResult>(
    { type: 'MVP_CC_SMART', rules, keyword: (keyword || '').trim().slice(0, 80) },
    430000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return resp
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
  /** EPC scan extras (Sponsored Products path). */
  sponsored?: boolean
  asinNodes?: number
  parsed?: number
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
  const resp = await sendToExtension<{ ok?: boolean; campaigns?: ScoutedCampaign[]; error?: string; diag?: ScoutDiag | null }>(
    { type: 'MVP_CC_SCAN' },
    150000, // deep grid-scroll harvest on a huge list; in-page scroll self-limits to ~95s
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok && Array.isArray(resp.campaigns)) return { ok: true, campaigns: resp.campaigns, diag: resp.diag ?? null }
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

/** One video as SCOUT read it from YouTube Studio's Content list — the whole
 *  library, quota-free. status mirrors the app's privacyStatus (a scheduled
 *  video is 'private' with publishAt set). Feeds the Co-Pilot draft list. */
export interface StudioVideo {
  videoId: string
  title: string
  status: 'public' | 'unlisted' | 'private'
  publishedAt: string      // ISO, only meaningful for public
  publishAt: string | null // ISO when scheduled
  thumbnailUrl: string
}

export interface StudioVideosResult {
  ok: boolean
  videos: StudioVideo[]
  error?: string
  debug?: Record<string, unknown>
}

/**
 * Ask SCOUT to read the user's ENTIRE YouTube Studio video library (drafts,
 * private, scheduled, unlisted, public) via Studio's own internal endpoint —
 * completely free of the YouTube Data API daily quota (it runs in the user's
 * logged-in Studio session, not through our OAuth project). MVP uses this to
 * populate the Co-Pilot draft list without spending quota, falling back to the
 * Data API only when SCOUT isn't installed. Best-effort: resolves, never throws.
 */
export async function requestStudioVideos(): Promise<StudioVideosResult> {
  if (!(await isExtensionAvailable())) return { ok: false, videos: [], error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; videos?: StudioVideo[]; error?: string; debug?: Record<string, unknown> }>(
    { type: 'MVP_STUDIO_VIDEOS' },
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
  /** Details page: paid-promotion ✓, AI-use = No, embedding on, and set
   *  "Publish to subscriptions feed & notify subscribers" to `notifySubscribers`. */
  details: boolean
  monetize: boolean
  selfCert: boolean
  endScreen: boolean
  /** Whether SCOUT should leave the subscriber notification ON (true) or off
   *  (false/undefined). Mirrors the API publish path's Yes/No choice. */
  notifySubscribers?: boolean
  /** Tag the reviewed product on the video via YouTube Shopping's "Tag products"
   *  flow (only works for enrolled creators). Requires `productUrl`. */
  tagProduct?: boolean
  /** The product link SCOUT pastes into the Tag-products search box. */
  productUrl?: string
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

export interface YtSaveRecipe {
  via?: string
  url: string
  headerKeys?: string[]
  headers?: Record<string, string>
  body?: string
  ts?: number
}

/**
 * Read back the YouTube Studio "save" requests SCOUT captured (yt-hook), newest
 * first. Used to LEARN the real InnerTube metadata_update shape (endpoint +
 * disclosure field names) so the paid-promotion / AI-disclosure replay is exact
 * rather than guessed. Returns [] when the extension isn't installed or nothing
 * has been captured yet.
 */
export async function requestYtSaveRecipes(): Promise<YtSaveRecipe[]> {
  if (!(await isExtensionAvailable())) return []
  const resp = await sendToExtension<{ ok?: boolean; recipes?: YtSaveRecipe[]; error?: string }>(
    { type: 'MVP_YT_RECIPE' },
    8000,
  )
  return resp && resp.ok && Array.isArray(resp.recipes) ? resp.recipes : []
}

export interface YtDisclosureOpts {
  paidPromotion?: boolean
  aiDisclosure?: boolean
  hasAlteredContent?: boolean
  monetize?: boolean
  /** Publish to subscriptions feed & notify subscribers (drives it via Studio's
   *  own save, since the Data API path for this is unreliable). */
  notify?: boolean
}

/**
 * Replay YouTube Studio's own metadata_update to set the disclosure fields
 * (paid promotion, AI/altered content, monetization) via the internal API in the
 * user's logged-in session — no DOM clicking. Returns the raw result incl. the
 * HTTP status/response body so the request can be tuned against YouTube's answer.
 */
export async function requestYtApplyDisclosures(
  videoId: string,
  opts: YtDisclosureOpts,
): Promise<{ ok: boolean; detail?: string; error?: string; debug?: Record<string, unknown> }> {
  if (!videoId) return { ok: false, error: 'no-video-id' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; detail?: string; error?: string; debug?: Record<string, unknown> }>(
    { type: 'MVP_YT_APPLY_DISCLOSURES', videoId, opts },
    60000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, detail: resp.detail, error: resp.error, debug: resp.debug }
}

/**
 * Set the disclosure fields by INJECTING them into Studio's own signed
 * metadata_update (SCOUT opens the video's edit page, dirties it, hits Save; the
 * hook rewrites the outgoing request to carry paid-promotion / AI / monetization).
 * This carries YouTube's real BotGuard token, so the change actually sticks.
 */
export async function requestYtInjectDisclosures(
  videoId: string,
  opts: YtDisclosureOpts,
): Promise<{ ok: boolean; uncertain?: boolean; detail?: string; error?: string; debug?: Record<string, unknown> }> {
  if (!videoId) return { ok: false, error: 'no-video-id' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; uncertain?: boolean; detail?: string; error?: string; debug?: Record<string, unknown> }>(
    { type: 'MVP_YT_INJECT_DISCLOSURES', videoId, opts },
    60000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  // `uncertain` = Studio saved but SCOUT couldn't confirm the fields rode along.
  // Not a failure — the caller renders it as a soft "check Studio" note.
  return { ok: !!resp.ok, uncertain: !!resp.uncertain, detail: resp.detail, error: resp.error, debug: resp.debug }
}

export interface VideoDownloadResult {
  ok: boolean
  /** The Short's MP4 as a data URL (data:video/mp4;base64,…). */
  dataUrl?: string
  mimeType?: string
  sizeBytes?: number
  /** 'not-installed' | 'not-owner' | 'no-download' | 'signed-out' | 'timeout' | … */
  error?: string
}

/**
 * Ask SCOUT to download the creator's OWN Short straight from YouTube Studio —
 * so the user never has to open Studio and download it by hand for Shop Burner.
 *
 * SCOUT opens the video in a background Studio tab (the user's logged-in
 * session), triggers Studio's built-in owner Download, captures the resulting
 * signed googlevideo MP4 in the browser, and returns it as a data URL. The page
 * then uploads it to storage and persists it as the Short's vertical MP4. This
 * is the ToS-clean path: the user's own video, their own Studio Download, all in
 * their own browser — MVP never fetches the file server-side (Google throttles
 * datacenter IPs anyway). Best-effort: resolves, never throws.
 *
 * Long timeout: opening Studio + the owner-download handshake + reading bytes.
 * ▶ SCOUT contract (implement on the extension side): handle
 *   { type: 'MVP_VIDEO_DOWNLOAD', youtubeVideoId } → respond
 *   { ok: true, dataUrl: 'data:video/mp4;base64,…', mimeType, sizeBytes } or
 *   { ok: false, error }.
 */
export async function requestVideoDownload(youtubeVideoId: string): Promise<VideoDownloadResult> {
  if (!youtubeVideoId) return { ok: false, error: 'no-video-id' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; dataUrl?: string; mimeType?: string; sizeBytes?: number; error?: string }>(
    { type: 'MVP_VIDEO_DOWNLOAD', youtubeVideoId },
    180000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok && typeof resp.dataUrl === 'string' && resp.dataUrl.startsWith('data:')) {
    return { ok: true, dataUrl: resp.dataUrl, mimeType: resp.mimeType, sizeBytes: resp.sizeBytes }
  }
  return { ok: false, error: resp.error || 'download-failed' }
}
