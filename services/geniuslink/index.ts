const GENIUSLINK_API = 'https://api.geni.us'

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
      },
      body: JSON.stringify({ destination, label: label.slice(0, 100) }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Geniuslink API error ${res.status}: ${body.slice(0, 200)}`)
    }

    const data = await res.json() as { shortUrl?: string; url?: string; shortlink?: string }
    const shortUrl = data.shortUrl || data.url || data.shortlink
    if (!shortUrl) throw new Error('Geniuslink returned no short URL')
    return shortUrl
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
