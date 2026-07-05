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

export interface MessageBrandResult { ok: boolean; error?: string; reason?: string; steps?: Record<string, boolean>; diag?: Record<string, unknown>; groups?: number }

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
    120000, // sends N messages one-by-one with ~1.4s between each
  )
  if (!resp) return { ok: false, error: 'timeout' }
  return { ok: !!resp.ok, error: resp.error, reason: resp.reason, steps: resp.steps, diag: resp.diag, groups: resp.groups }
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
  monthlySales: number | null
  carouselPos: 'top' | 'bottom' | 'none' | null
  hasVideo?: boolean
}

export interface ProductSearchResult {
  ok: boolean
  products?: FinderProduct[]
  scanned?: number    // how many products were deep-checked
  totalFound?: number // how many appeared in Amazon's search
  blocked?: boolean   // Amazon rate-limited us mid-scan — results are partial
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
  rules: { minSales?: number; mustVideo?: boolean; maxResults?: number; priceMin?: number; priceMax?: number },
): Promise<ProductSearchResult> {
  if (!query.trim()) return { ok: false, error: 'no-query' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{ ok?: boolean; products?: FinderProduct[]; scanned?: number; totalFound?: number; blocked?: boolean; error?: string }>(
    { type: 'MVP_PRODUCT_SEARCH', query, opts: rules },
    430000,
  )
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) return { ok: true, products: resp.products ?? [], scanned: resp.scanned, totalFound: resp.totalFound, blocked: resp.blocked }
  return { ok: false, error: resp.error || 'search-failed', products: resp.products ?? [], blocked: resp.blocked }
}

export interface FindCampaignResult {
  ok: boolean
  found?: boolean
  detailsUrl?: string | null
  campaignName?: string | null
  brand?: string | null
  commissionPct?: number | null
  endsAt?: string | null
  scanned?: number    // how many result cards we resolved before giving up
  total?: number      // how many campaigns Amazon's search returned
  error?: string
}

/**
 * Live "is this product a Creator Connections campaign?" lookup. Given the
 * product's brand/keyword and its ASIN, SCOUT drives Amazon's CC search in a
 * background tab and resolves each result card's real ASIN (hidden on the card)
 * until one matches — returning the campaign's details URL so the caller can
 * auto-send a brand message. Used by the Product Finder's Message flow when the
 * user has NOT already imported this campaign. Slow (a search + up to ~15
 * background ASIN resolves), so a long timeout. Best-effort: resolves, never
 * throws.
 */
export async function requestFindCampaign(query: string, asin: string): Promise<FindCampaignResult> {
  if (!/^[A-Za-z0-9]{10}$/.test(asin || '')) return { ok: false, error: 'no-asin' }
  if (!(await isExtensionAvailable())) return { ok: false, error: 'not-installed' }
  const resp = await sendToExtension<{
    ok?: boolean; found?: boolean; detailsUrl?: string | null; campaignName?: string | null
    brand?: string | null; commissionPct?: number | null; endsAt?: string | null
    scanned?: number; total?: number; error?: string
  }>({ type: 'MVP_CC_FIND', query: query || '', asin }, 185000)
  if (!resp) return { ok: false, error: 'timeout' }
  if (resp.ok) {
    return {
      ok: true, found: !!resp.found,
      detailsUrl: resp.detailsUrl ?? null,
      campaignName: resp.campaignName ?? null,
      brand: resp.brand ?? null,
      commissionPct: resp.commissionPct ?? null,
      endsAt: resp.endsAt ?? null,
      scanned: resp.scanned, total: resp.total,
    }
  }
  return { ok: false, error: resp.error || 'find-failed' }
}

export interface CampaignMatch {
  asin: string
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
 * "Check all CC" — batch version of requestFindCampaign. Given the Product
 * Finder's keyword and a list of result ASINs, SCOUT runs ONE Creator
 * Connections search for the keyword, resolves each result card's ASIN once, and
 * returns which target ASINs are campaigns (with their details URLs). Far cheaper
 * than one CC search per product. Slow (a search + up to ~40 background ASIN
 * resolves, plus a possible foreground grid pass), so a long timeout.
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
