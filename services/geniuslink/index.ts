const GENIUSLINK_API = 'https://api.geni.us'

export class GeniuslinkService {
  constructor(private apiKey: string, private apiSecret: string) {}

  async createAsinLink(asin: string, label: string): Promise<string> {
    const destination = `https://www.amazon.com/dp/${asin}`

    // Geniuslink API v3: POST /v3/shorturls with query params (NOT a JSON body)
    const params = new URLSearchParams({
      url: destination,
      note: label.slice(0, 100),
    })

    const res = await fetch(`${GENIUSLINK_API}/v3/shorturls?${params.toString()}`, {
      method: 'POST',
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Api-Secret': this.apiSecret,
        Accept: 'application/json',
      },
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

    // Try all common field names for the short URL in the response
    const shortUrl = (
      data.shortUrl ?? data.short_url ?? data.shortlink ??
      data.url ?? data.link ?? data.href ??
      data.shortCode ?? data.short_code ??
      (data.data as Record<string, unknown>)?.shortUrl ??
      (data.data as Record<string, unknown>)?.url ??
      (data.data as Record<string, unknown>)?.link
    ) as string | undefined

    if (!shortUrl) {
      throw new Error(
        `Geniuslink: no URL in response. Keys: ${Object.keys(data).join(', ')} | Body: ${text.slice(0, 300)}`
      )
    }

    return shortUrl
  }
}

export function createGeniuslinkService(apiKey: string, apiSecret: string) {
  return new GeniuslinkService(apiKey, apiSecret)
}
