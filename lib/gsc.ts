// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Google Search Console client. Powers the SEO hub: per-post indexing status
// (URL Inspection API), search performance + the real queries that find each
// post (Search Analytics API), and property resolution (Sites API). Read-only
// scope (webmasters.readonly). Reuses the same Google OAuth app as YouTube
// (GOOGLE_CLIENT_ID/SECRET); tokens live on integrations.gsc_oauth_*.

const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3'
const URL_INSPECTION = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

/**
 * Return a valid GSC access token for the user, refreshing it if expired.
 * Null when the user hasn't connected GSC (or the refresh failed).
 */
export async function getValidGscToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('integrations')
    .select('gsc_oauth_access_token,gsc_oauth_refresh_token,gsc_oauth_token_expiry')
    .eq('user_id', userId)
    .single()
  if (!data?.gsc_oauth_access_token) return null

  const expiry = Number(data.gsc_oauth_token_expiry || 0)
  if (Date.now() < expiry - 60_000) return data.gsc_oauth_access_token // 60s buffer
  if (!data.gsc_oauth_refresh_token) return data.gsc_oauth_access_token // can't refresh; try as-is

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: data.gsc_oauth_refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    })
    if (!res.ok) return null
    const t = await res.json() as { access_token: string; expires_in?: number }
    await supabase
      .from('integrations')
      .update({
        gsc_oauth_access_token: t.access_token,
        gsc_oauth_token_expiry: Date.now() + (t.expires_in ?? 3600) * 1000,
      })
      .eq('user_id', userId)
    return t.access_token
  } catch {
    return null
  }
}

export interface GscSite { siteUrl: string; permissionLevel: string }

/** List the verified Search Console properties this token can access. */
export async function listGscSites(token: string): Promise<GscSite[]> {
  const res = await fetch(`${WEBMASTERS}/sites`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return []
  const data = await res.json() as { siteEntry?: GscSite[] }
  return data.siteEntry ?? []
}

/**
 * Pick the GSC property that matches a site URL. Prefers a domain property
 * (sc-domain:host) since it covers http/https + www; falls back to a URL-prefix
 * property on the same host. Returns null if none match.
 */
export function resolveGscProperty(sites: GscSite[], siteUrl: string): string | null {
  let host = ''
  try { host = new URL(siteUrl).hostname.replace(/^www\./i, '').toLowerCase() } catch { return null }
  if (!host) return null
  // Only properties we can actually read.
  const usable = sites.filter(s => /Owner|Full|Restricted/i.test(s.permissionLevel || ''))
  const domainProp = usable.find(s => s.siteUrl.toLowerCase() === `sc-domain:${host}`)
  if (domainProp) return domainProp.siteUrl
  const urlProp = usable.find(s => {
    try { return new URL(s.siteUrl).hostname.replace(/^www\./i, '').toLowerCase() === host } catch { return false }
  })
  return urlProp?.siteUrl ?? null
}

export interface UrlIndexState {
  verdict: string | null        // PASS | NEUTRAL | FAIL
  coverageState: string | null  // e.g. "Submitted and indexed", "Crawled - currently not indexed"
  indexed: boolean
  lastCrawl: string | null
  robotsTxtState: string | null
  inspectionLink: string | null
}

/** URL Inspection — is this exact URL indexed by Google, and why/why not. */
export async function inspectUrl(token: string, property: string, inspectionUrl: string): Promise<UrlIndexState | null> {
  try {
    const res = await fetch(URL_INSPECTION, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl, siteUrl: property }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await res.json() as any)?.inspectionResult?.indexStatusResult
    if (!r) return null
    return {
      verdict: r.verdict ?? null,
      coverageState: r.coverageState ?? null,
      indexed: /indexed/i.test(r.coverageState || '') && !/not indexed/i.test(r.coverageState || ''),
      lastCrawl: r.lastCrawlTime ?? null,
      robotsTxtState: r.robotsTxtState ?? null,
      inspectionLink: r.googleCanonical ? null : null,
    }
  } catch {
    return null
  }
}

export interface SearchAnalyticsRow {
  keys?: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * Search Analytics query. `dimensions` e.g. ['query'] for top keywords, or
 * ['page'] for per-URL totals. Optional `page` filter restricts to one URL.
 */
export async function querySearchAnalytics(
  token: string,
  property: string,
  opts: { startDate: string; endDate: string; dimensions?: string[]; page?: string; rowLimit?: number },
): Promise<SearchAnalyticsRow[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: opts.dimensions ?? [],
      rowLimit: opts.rowLimit ?? 25,
    }
    if (opts.page) {
      body.dimensionFilterGroups = [{ filters: [{ dimension: 'page', operator: 'equals', expression: opts.page }] }]
    }
    const res = await fetch(`${WEBMASTERS}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { rows?: SearchAnalyticsRow[] }
    return data.rows ?? []
  } catch {
    return []
  }
}

// ── Indexing API ─────────────────────────────────────────────────────────────
// Submits a URL to Google for crawl/index via the official Indexing API.
//
// Reality-check the user should know about: this endpoint is technically
// scoped to JobPosting / Livestream structured data per Google's docs. In
// practice it accepts and crawls regular URLs the user owns in their GSC
// property — that's why every SEO tool on the market uses it the same way
// for normal pages. Google can change their stance at any time; we surface
// the response code either way so we never silently lie about success.

/** Outcomes we surface to the dashboard. submitted = accepted by Google
 *  (200 OK). quota = today's quota exhausted for our OAuth project (429).
 *  forbidden = the OAuth token doesn't own this URL in GSC (403 — usually
 *  means the indexing scope wasn't granted, or the user picked the wrong
 *  Google account at consent). unknown = anything else. */
export type IndexingSubmitOutcome = 'submitted' | 'quota' | 'forbidden' | 'unknown'
export interface IndexingSubmitResult {
  url: string
  outcome: IndexingSubmitOutcome
  message?: string
}

/** Submit ONE URL. We mark it URL_UPDATED — Google interprets that as a
 *  "please re-crawl" hint. URL_DELETED is the other type, used when a
 *  page is removed.
 *
 *  Errors are categorised, not thrown, so the bulk caller can iterate
 *  without aborting on the first 403. */
export async function submitUrlForIndexing(token: string, url: string): Promise<IndexingSubmitResult> {
  try {
    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return { url, outcome: 'submitted' }
    const text = await res.text().catch(() => '')
    if (res.status === 429) return { url, outcome: 'quota', message: 'Daily quota hit (Google caps at ~200/day per project). Try again in 24h.' }
    if (res.status === 403) return { url, outcome: 'forbidden', message: 'Google declined — reconnect Search Console so we have permission to submit. (Account → Settings → Disconnect, then reconnect.)' }
    return { url, outcome: 'unknown', message: `Google returned ${res.status}: ${text.slice(0, 160)}` }
  } catch (e) {
    return { url, outcome: 'unknown', message: e instanceof Error ? e.message : 'Submit failed' }
  }
}

/** Quick check: does the current token carry the indexing scope? Called
 *  before the dashboard's "Index" button so we can route GSC-connected-but-
 *  pre-indexing-scope users back through OAuth instead of silently 403'ing. */
export async function tokenHasIndexingScope(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return false
    const data = await res.json() as { scope?: string }
    const scopes = (data.scope || '').split(' ')
    return scopes.includes('https://www.googleapis.com/auth/indexing')
  } catch { return false }
}
