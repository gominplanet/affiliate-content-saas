const GENIUSLINK_API = 'https://api.geni.us'

export class GeniuslinkService {
  constructor(private apiKey: string, private apiSecret: string) {}

  private get authHeaders() {
    return {
      'X-Api-Key': this.apiKey,
      'X-Api-Secret': this.apiSecret,
      Accept: 'application/json',
    }
  }

  // Fetch the YouTube Links group ID (or first enabled group as fallback)
  private async getDefaultGroupId(): Promise<number> {
    const res = await fetch(`${GENIUSLINK_API}/v1/groups/list`, {
      headers: this.authHeaders,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Geniuslink groups error ${res.status}: ${text.slice(0, 200)}`)

    const data = JSON.parse(text) as { Groups?: Array<{ Id: number; Name: string; Enabled: number }> }
    const groups = (data.Groups ?? []).filter(g => g.Enabled === 1)
    if (!groups.length) throw new Error('Geniuslink: no enabled groups found on this account')

    // Prefer the YouTube Links group, otherwise use the first enabled group
    const youtubeGroup = groups.find(g => /youtube/i.test(g.Name))
    return (youtubeGroup ?? groups[0]).Id
  }

  /** Backwards-compat wrapper that returns just the URL. Prefer
   *  `createAsinLinkWithCode` so you can persist the code for analytics. */
  async createAsinLink(asin: string, label: string): Promise<string> {
    const { url } = await this.createAsinLinkWithCode(asin, label)
    return url
  }

  async createAsinLinkWithCode(asin: string, label: string): Promise<{ url: string; code: string | null }> {
    const destination = `https://www.amazon.com/dp/${asin}`
    const groupId = await this.getDefaultGroupId()

    const params = new URLSearchParams({
      url: destination,
      groupId: String(groupId),
      note: label.slice(0, 100),
    })

    const res = await fetch(`${GENIUSLINK_API}/v3/shorturls?${params.toString()}`, {
      method: 'POST',
      headers: this.authHeaders,
    })

    const text = await res.text()
    if (!res.ok) throw new Error(`Geniuslink create error ${res.status}: ${text.slice(0, 300)}`)

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
   * (github.com/mishguruorg/geniuslink) — they don't ship a "list all"
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
    if (!res.ok) {
      // Don't throw on individual failures — caller aggregates many.
      return 0
    }
    const data = await res.json().catch(() => null) as
      | { ClicksByDate?: Array<{ Value?: { Clicks?: number } }> }
      | null
    return data?.ClicksByDate?.[0]?.Value?.Clicks ?? 0
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
