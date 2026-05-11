const GRAPH = 'https://graph.facebook.com/v19.0'

export interface FacebookPage {
  id: string
  name: string
  access_token: string
}

export class FacebookService {
  constructor(private pageAccessToken: string, private pageId: string) {}

  async postLink(opts: {
    message: string
    link: string
  }): Promise<{ id: string }> {
    const res = await fetch(`${GRAPH}/${this.pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: opts.message,
        link: opts.link,
        access_token: this.pageAccessToken,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Facebook post failed ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json()
  }

  // Posts a photo with caption — better reach than link posts
  async postPhoto(opts: {
    imageUrl: string
    caption: string
  }): Promise<{ id: string; post_id?: string }> {
    const res = await fetch(`${GRAPH}/${this.pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: opts.imageUrl,
        caption: opts.caption,
        access_token: this.pageAccessToken,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Facebook photo post failed ${res.status}: ${body.slice(0, 300)}`)
    }
    return res.json()
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`)
  url.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!)
  url.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET!)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code', code)

  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed: ${body.slice(0, 300)}`)
  }
  const data = await res.json() as { access_token: string }
  return data.access_token
}

export async function getLongLivedToken(shortToken: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!)
  url.searchParams.set('client_secret', process.env.FACEBOOK_APP_SECRET!)
  url.searchParams.set('fb_exchange_token', shortToken)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error('Long-lived token exchange failed')
  const data = await res.json() as { access_token: string }
  return data.access_token
}

export async function getPages(userToken: string): Promise<FacebookPage[]> {
  const url = new URL(`${GRAPH}/me/accounts`)
  url.searchParams.set('access_token', userToken)
  url.searchParams.set('fields', 'id,name,access_token')

  const res = await fetch(url.toString())
  const body = await res.json()
  if (!res.ok) throw new Error(`Failed to fetch Facebook pages: ${JSON.stringify(body)}`)
  return (body.data ?? []) as FacebookPage[]
}

export function createFacebookService(pageAccessToken: string, pageId: string) {
  return new FacebookService(pageAccessToken, pageId)
}
