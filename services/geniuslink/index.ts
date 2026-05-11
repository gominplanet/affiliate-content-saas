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

  // Fetch the best group ID for YouTube links — required for creating links
  private async getDefaultGroupId(): Promise<number> {
    const res = await fetch(`${GENIUSLINK_API}/v1/groups/list`, {
      headers: this.authHeaders,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Geniuslink groups error ${res.status}: ${text.slice(0, 200)}`)

    const data = JSON.parse(text) as { Groups?: Array<{ Id: number; Name: string }> }
    const groups = data.Groups ?? []
    if (!groups.length) throw new Error('Geniuslink: no groups found on this account')

    // Prefer a YouTube-specific group if one exists, otherwise use the first group
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

    // Geniuslink returns PascalCase: ShortUrlCode + Domain → https://{Domain}/{ShortUrlCode}
    const shortCode = (data.ShortUrlCode ?? data.shortUrlCode ?? data.shortCode ?? data.short_code) as string | undefined
    const domain = ((data.Domain ?? data.domain ?? 'geni.us') as string).replace(/^https?:\/\//, '')

    if (shortCode) return `https://${domain}/${shortCode}`

    // Fallback: any field that looks like a full URL
    const shortUrl = (
      data.shortUrl ?? data.short_url ?? data.shortlink ??
      data.url ?? data.link ?? data.href ??
      (data.data as Record<string, unknown>)?.shortUrl ??
      (data.data as Record<string, unknown>)?.url
    ) as string | undefined

    if (!shortUrl) {
      throw new Error(
        `Geniuslink: no URL in response. Keys: ${Object.keys(data).join(', ')} | ${text.slice(0, 300)}`
      )
    }

    return shortUrl
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
