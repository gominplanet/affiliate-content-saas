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

  async createAsinLink(asin: string, label: string): Promise<string> {
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
      if (code) return `https://${domain}/${code}`
    }

    // Fallback: shortUrl might be a plain string in some API versions
    if (typeof data.shortUrl === 'string' && data.shortUrl.startsWith('http')) {
      return data.shortUrl
    }

    // Legacy fallback: ShortUrlCode + Domain at top level
    const shortCode = (data.ShortUrlCode ?? data.shortUrlCode) as string | undefined
    const domain = ((data.Domain ?? data.domain ?? 'geni.us') as string).replace(/^https?:\/\//, '')
    if (shortCode) return `https://${domain}/${shortCode}`

    throw new Error(
      `Geniuslink: could not parse URL from response. Keys: ${Object.keys(data).join(', ')} | ${text.slice(0, 300)}`
    )
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
