const GENIUSLINK_API = 'https://api.geni.us'

export class GeniuslinkService {
  constructor(private apiKey: string, private apiSecret: string) {}

  async createAsinLink(asin: string, label: string): Promise<string> {
    const destination = `https://www.amazon.com/dp/${asin}`

    const headers = {
      'X-Api-Key': this.apiKey,
      'X-Api-Secret': this.apiSecret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    const body = JSON.stringify({ url: destination, label: label.slice(0, 100) })

    const res = await fetch(`${GENIUSLINK_API}/links`, {
      method: 'POST',
      headers,
      body,
    })

    const text = await res.text()

    if (!res.ok) {
      throw new Error(`Geniuslink API error ${res.status}: ${text.slice(0, 300)}`)
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Geniuslink non-JSON response: ${text.slice(0, 200)}`)
    }

    const shortUrl = (
      data.shortUrl ?? data.short_url ?? data.shortlink ??
      data.url ?? data.link ?? data.href ??
      (data.data as Record<string, unknown>)?.shortUrl ??
      (data.data as Record<string, unknown>)?.url
    ) as string | undefined

    if (!shortUrl) {
      throw new Error(`Geniuslink: no URL in response. Keys: ${Object.keys(data).join(', ')} | ${text.slice(0, 300)}`)
    }
    return shortUrl
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
