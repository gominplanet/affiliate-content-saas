const GENIUSLINK_API = 'https://api.geni.us'

export class GeniuslinkService {
  private auth: string

  constructor(apiKey: string, apiSecret: string) {
    this.auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  }

  async createAsinLink(asin: string, label: string): Promise<string> {
    const destination = `https://www.amazon.com/dp/${asin}`

    // Try the standard endpoint — Geniuslink uses 'url' as the body key
    const res = await fetch(`${GENIUSLINK_API}/links`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        url: destination,          // primary field name
        destination,               // fallback field name some versions use
        label: label.slice(0, 100),
      }),
    })

    const body = await res.text()

    if (!res.ok) {
      // Include full body so we can see exactly what Geniuslink returned
      throw new Error(`Geniuslink API error ${res.status}: ${body.slice(0, 300)}`)
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(body)
    } catch {
      throw new Error(`Geniuslink non-JSON response (${res.status}): ${body.slice(0, 200)}`)
    }

    // Try all known field names
    const shortUrl = (
      data.shortUrl ?? data.short_url ?? data.shortlink ?? data.url ??
      (data.data as Record<string, unknown>)?.shortUrl
    ) as string | undefined

    if (!shortUrl) {
      throw new Error(`Geniuslink: no short URL in response. Fields: ${Object.keys(data).join(', ')} | ${body.slice(0, 200)}`)
    }
    return shortUrl
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
