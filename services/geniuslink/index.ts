const GENIUSLINK_API = 'https://api.geni.us'

/** Optional per-link overrides. When omitted, behavior matches the legacy
 *  single-group path (look up the default YouTube Links group every time). */
export interface CreateLinkOpts {
  /** Specific Geniuslink group ID to drop this link into. If provided,
   *  skips the list-groups round-trip — caller is expected to have already
   *  resolved + cached the ID (see lib/geniuslink-group.ts). */
  groupId?: number
  /** Override the note attached to the link. Defaults to `label` (the
   *  product/post title). Pass a richer string like
   *  "{post-slug} | {site-domain}" for filterable dashboard entries. */
  note?: string
}

export class GeniuslinkService {
  constructor(private apiKey: string, private apiSecret: string) {}

  private get authHeaders() {
    return {
      'X-Api-Key': this.apiKey,
      'X-Api-Secret': this.apiSecret,
      Accept: 'application/json',
    }
  }

  /** All enabled groups on the account. Used to find or auto-create a
   *  per-site group named after the blog domain. */
  async listGroups(): Promise<Array<{ Id: number; Name: string; Enabled: number }>> {
    const res = await fetch(`${GENIUSLINK_API}/v1/groups/list`, {
      headers: this.authHeaders,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Geniuslink groups error ${res.status}: ${text.slice(0, 200)}`)
    const data = JSON.parse(text) as { Groups?: Array<{ Id: number; Name: string; Enabled: number }> }
    return (data.Groups ?? []).filter(g => g.Enabled === 1)
  }

  // Fetch the YouTube Links group ID (or first enabled group as fallback)
  private async getDefaultGroupId(): Promise<number> {
    const groups = await this.listGroups()
    if (!groups.length) throw new Error('Geniuslink: no enabled groups found on this account')
    // Prefer the YouTube Links group, otherwise use the first enabled group
    const youtubeGroup = groups.find(g => /youtube/i.test(g.Name))
    return (youtubeGroup ?? groups[0]).Id
  }

  /** Find a group by exact (case-insensitive) name. Returns null if absent. */
  async findGroupIdByName(name: string): Promise<number | null> {
    const groups = await this.listGroups()
    const target = name.trim().toLowerCase()
    const match = groups.find(g => (g.Name ?? '').trim().toLowerCase() === target)
    return match ? match.Id : null
  }

  /** Create a new group on the account. Tries known endpoint variants in
   *  order because Geniuslink doesn't publish a stable create endpoint —
   *  some accounts respond on /v1/groups/add, others on /v3/groups. Returns
   *  null when both fail so callers can fall back to the default group
   *  + log a "please create the group manually" hint. */
  async createGroup(name: string): Promise<number | null> {
    const cleanName = name.trim().slice(0, 80)
    if (!cleanName) return null

    const attempts: Array<{ url: string; method: 'POST'; body?: string; query?: string }> = [
      // v1 add — body form-encoded
      { url: `${GENIUSLINK_API}/v1/groups/add`, method: 'POST', query: new URLSearchParams({ name: cleanName, enabled: '1' }).toString() },
      // v3 RESTful — JSON body
      { url: `${GENIUSLINK_API}/v3/groups`, method: 'POST', body: JSON.stringify({ Name: cleanName, Enabled: 1 }) },
    ]

    for (const attempt of attempts) {
      try {
        const url = attempt.query ? `${attempt.url}?${attempt.query}` : attempt.url
        const headers: Record<string, string> = { ...this.authHeaders }
        if (attempt.body) headers['Content-Type'] = 'application/json'
        const res = await fetch(url, { method: attempt.method, headers, body: attempt.body })
        if (!res.ok) continue
        const data = await res.json().catch(() => null) as Record<string, unknown> | null
        if (!data) continue
        // Different shapes: { Id }, { id }, { Group: { Id } }, { group: { id } }
        const id = (data.Id ?? data.id ?? (data.Group as { Id?: number })?.Id ?? (data.group as { id?: number })?.id) as number | undefined
        if (typeof id === 'number') return id
      } catch { /* try next */ }
    }
    return null
  }

  /** Find or create a group with this name. Returns null on hard failure so
   *  the caller falls back to the default group + can warn the user. */
  async getOrCreateGroupId(name: string): Promise<number | null> {
    const existing = await this.findGroupIdByName(name).catch(() => null)
    if (existing) return existing
    return this.createGroup(name)
  }

  /** Backwards-compat wrapper that returns just the URL. Prefer
   *  `createAsinLinkWithCode` so you can persist the code for analytics. */
  async createAsinLink(asin: string, label: string, opts: CreateLinkOpts = {}): Promise<string> {
    const { url } = await this.createAsinLinkWithCode(asin, label, opts)
    return url
  }

  async createAsinLinkWithCode(asin: string, label: string, opts: CreateLinkOpts = {}): Promise<{ url: string; code: string | null }> {
    return this.createLinkWithCode(`https://www.amazon.com/dp/${asin}`, label, opts)
  }

  /** Wrap ANY destination URL (store, brand site, Amazon, anything) into a
   *  Geniuslink. Geniuslink is NOT Amazon-only -- it redirects/tracks any
   *  destination. Returns just the short URL. */
  async createLink(destinationUrl: string, label: string, opts: CreateLinkOpts = {}): Promise<string> {
    const { url } = await this.createLinkWithCode(destinationUrl, label, opts)
    return url
  }

  /** Wrap any destination URL and return the short URL + code (for analytics). */
  async createLinkWithCode(destination: string, label: string, opts: CreateLinkOpts = {}): Promise<{ url: string; code: string | null }> {
    // Caller-resolved group wins; otherwise fall back to the default
    // (cached lookup of YouTube Links / first enabled group).
    const groupId = opts.groupId ?? (await this.getDefaultGroupId())

    // Sanitize the note. Geniuslink's API returns a generic 500 with an
    // ASP.NET HTML error page when the note contains characters their
    // parser doesn't handle (control chars, certain symbols, very long
    // strings). Strip control chars + non-ASCII, replace shell/URL
    // trouble chars with spaces, collapse whitespace, cap at 80.
    // 2026-06-07: this was the root cause of a user-visible 500.
    // 2026-06-09: now also accepts an opts.note override so callers can
    // pass a richer dashboard label (e.g. "post-slug | site.com").
    const rawNote = opts.note ?? label
    const safeNote = rawNote
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')          // strip ASCII control chars
      .replace(/[^\u0020-\u007E]/g, '')                // strip non-ASCII
      .replace(/["<>{}\\^`|]/g, ' ')                  // shell + URL trouble chars
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)

    const params = new URLSearchParams({
      url: destination,
      groupId: String(groupId),
      note: safeNote || 'mvp-link',
    })

    // Single retry with a 1.5s backoff on 5xx. Geniuslink occasionally
    // returns a 500 with their generic ASP.NET HTML error page when
    // their backend hiccups (transient -- succeeds on the very next
    // call). Without retry we fall through to the Amazon Associates
    // fallback and surface a "Geniuslink not used" warning to the user
    // for what's effectively a temporary blip. 2026-06-07.
    let res: Response
    let text: string
    let attempt = 0
    while (true) {
      res = await fetch(`${GENIUSLINK_API}/v3/shorturls?${params.toString()}`, {
        method: 'POST',
        headers: this.authHeaders,
      })
      text = await res.text()
      if (res.ok || res.status < 500 || attempt >= 1) break
      attempt++
      await new Promise(r => setTimeout(r, 1500))
    }
    if (!res.ok) {
      // 4xx -- auth or request shape problem, won't help to retry.
      // 5xx after retry -- Geniuslink server side; user can re-run later.
      // Strip HTML + cap at 200 chars so the toast shows a clean
      // message, not a full ASP.NET stack trace.
      const cleanBody = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      throw new Error(`Geniuslink create error ${res.status}${cleanBody ? `: ${cleanBody}` : ''}`)
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Geniuslink non-JSON response: ${text.slice(0, 200)}`)
    }

    // Response: { "shortUrl": { "code": "y2ClyW", "domain": "geni.us", ... } }
    if (data.shortUrl && typeof data.shortUrl === 'object') {
      const su = data.shortUrl as Record<string, unknown>
      const code = (su.code ?? su.baseCode) as string | undefined
      const domain = ((su.domain ?? su.baseDomain ?? 'geni.us') as string).replace(/^https?:\/\//, '')
      if (code) return { url: `https://${domain}/${code}`, code }
    }

    // Fallback: shortUrl might be a plain string in some API versions
    if (typeof data.shortUrl === 'string' && data.shortUrl.startsWith('http')) {
      // Extract code from the URL itself
      const m = (data.shortUrl as string).match(/\/([A-Za-z0-9]+)$/)
      return { url: data.shortUrl as string, code: m ? m[1] : null }
    }

    // Legacy fallback: ShortUrlCode + Domain at top level
    const shortCode = (data.ShortUrlCode ?? data.shortUrlCode) as string | undefined
    const domain = ((data.Domain ?? data.domain ?? 'geni.us') as string).replace(/^https?:\/\//, '')
    if (shortCode) return { url: `https://${domain}/${shortCode}`, code: shortCode }

    throw new Error(
      `Geniuslink: could not parse URL from response. Keys: ${Object.keys(data).join(', ')} | ${text.slice(0, 300)}`
    )
  }

  /**
   * List every shortlink on the user's Geniuslink account. Returns the
   * raw shape from the API (different versions return slightly different
   * keys, so we keep this loose). Used by /api/analytics/clicks to pull
   * cumulative clicks per link.
   */
  /**
   * Lifetime clicks for a single shortcode.
   *
   * Endpoint discovered via the official Geniuslink node SDK
   * (github.com/mishguruorg/geniuslink) -- they don't ship a "list all"
   * endpoint, so we look up per-link instead.
   *
   * Response shape: { ClicksByDate: [{ Value: { Clicks: number } }] }
   */
  async getLifetimeClicks(shortcode: string): Promise<number> {
    const params = new URLSearchParams({
      shortcode,
      advertiserid: '0',
      resolution: 'lifetime',
    })
    const res = await fetch(
      `${GENIUSLINK_API}/v1/reports/link-click-trend-by-resolution?${params.toString()}`,
      { headers: this.authHeaders },
    )
    if (!res.ok) return 0
    const data = await res.json().catch(() => null) as
      | { ClicksByDate?: Array<{ Value?: { Clicks?: number; ClicksMinusBot?: number } }> }
      | null
    // Geniuslink returns BOTH `Clicks` (raw incl. bots) and `ClicksMinusBot`
    // (bot-filtered, matches the dashboard default). Use ClicksMinusBot so
    // MVP's totals line up with what users see on geni.us. There's no
    // query-parameter bot filter on this endpoint -- proven by the probe at
    // /api/analytics/geniuslink-probe; the filter lives in the response.
    return data?.ClicksByDate?.[0]?.Value?.ClicksMinusBot
      ?? data?.ClicksByDate?.[0]?.Value?.Clicks
      ?? 0
  }

  /**
   * Daily click series for a single shortcode over the last `days` days.
   * Returns `[{ date: 'YYYY-MM-DD', clicks: N }, ...]` ordered oldest -> newest.
   * Caller sums for the period total + builds an all-posts daily series.
   *
   * Same endpoint as getLifetimeClicks, but resolution=daily + an explicit
   * date window so the response doesn't fall back to lifetime.
   */
  async getDailyClicks(shortcode: string, days = 30): Promise<Array<{ date: string; clicks: number }>> {
    const end = new Date()
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10) // YYYY-MM-DD
    const params = new URLSearchParams({
      shortcode,
      advertiserid: '0',
      resolution: 'daily',
      startdate: fmt(start),
      enddate: fmt(end),
    })
    const res = await fetch(
      `${GENIUSLINK_API}/v1/reports/link-click-trend-by-resolution?${params.toString()}`,
      { headers: this.authHeaders },
    )
    if (!res.ok) return []
    // Geniuslink's daily response has Key (the date) + Value.{Clicks,ClicksMinusBot}.
    // We use ClicksMinusBot to match the dashboard's bot-filtered default -- see
    // getLifetimeClicks for the reasoning. Key shape varies: ISO
    // "2026-05-16T00:00:00", epoch number, or .NET-style "/Date(1747353600000)/".
    // normaliseDate handles all three.
    const data = await res.json().catch(() => null) as
      | { ClicksByDate?: Array<{ Key?: unknown; Value?: { Clicks?: number; ClicksMinusBot?: number } }> }
      | null
    return (data?.ClicksByDate ?? []).map(b => ({
      date: normaliseDate(b.Key),
      clicks: b.Value?.ClicksMinusBot ?? b.Value?.Clicks ?? 0,
    }))
  }
}

/** Turn whatever Geniuslink hands back as a "Key" into a YYYY-MM-DD string. */
function normaliseDate(raw: unknown): string {
  if (raw == null) return ''
  // ASP.NET style "/Date(1747353600000)/"
  if (typeof raw === 'string') {
    const aspMatch = raw.match(/\/Date\((-?\d+)\)\//)
    if (aspMatch) {
      const d = new Date(Number(aspMatch[1]))
      return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
    }
    // Plain ISO string -- slice the date portion off
    return raw.slice(0, 10)
  }
  if (typeof raw === 'number') {
    // Geniuslink occasionally returns ms-since-epoch as a bare number
    const d = new Date(raw)
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  return ''
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
