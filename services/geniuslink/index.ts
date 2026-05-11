const GENIUSLINK_API = 'https://api.geniuslink.com'

export class GeniuslinkService {
  private auth: string

  constructor(apiKey: string, apiSecret: string) {
    this.auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  }

  // Create a smart affiliate link for an Amazon ASIN
  async createAsinLink(asin: string, label: string): Promise<string> {
    const destination = `https://www.amazon.com/dp/${asin}`

    const res = await fetch(`${GENIUSLINK_API}/links`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ destination, label: label.slice(0, 100) }),
    })

    const body = await res.text()

    if (!res.ok) {
      throw new Error(`Geniuslink API error ${res.status}: ${body.slice(0, 300)}`)
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(body)
    } catch {
      throw new Error(`Geniuslink returned non-JSON response: ${body.slice(0, 200)}`)
    }

    // Try common field names for the short URL
    const shortUrl = (data.shortUrl || data.shortlink || data.url || data.short_url) as string | undefined
    if (!shortUrl) {
      throw new Error(`Geniuslink response missing short URL. Keys: ${Object.keys(data).join(', ')}`)
    }
    return shortUrl
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
