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
  // Primary: Pages the user has a direct role on. Covers Classic Pages and
  // most of the New Pages Experience.
  const direct = await fetchMeAccounts(userToken)
  if (direct.length > 0) return dedupePages(direct)

  // Fallback: Business-Manager-owned / client Pages. This is the case where a
  // real business's Pages live under a Business Manager and /me/accounts comes
  // back EMPTY even though the user picked Pages during consent. Needs the
  // `business_management` permission — granted immediately for the app's own
  // admins/developers/testers, and for customers once that scope clears App
  // Review. Best-effort: any failure (permission not granted, no businesses,
  // no page token returned) just yields [], so this can never regress an
  // account that already worked via /me/accounts.
  const viaBusiness = await fetchBusinessPages(userToken)
  return dedupePages(viaBusiness)
}

async function fetchMeAccounts(userToken: string): Promise<FacebookPage[]> {
  const url = new URL(`${GRAPH}/me/accounts`)
  url.searchParams.set('access_token', userToken)
  url.searchParams.set('fields', 'id,name,access_token')
  url.searchParams.set('limit', '100')
  const res = await fetch(url.toString())
  const body = await res.json()
  if (!res.ok) throw new Error(`Failed to fetch Facebook pages: ${JSON.stringify(body)}`)
  return ((body.data ?? []) as FacebookPage[]).filter((p) => p.id && p.access_token)
}

// New Pages Experience / Business-owned pages: enumerate the user's Business
// Managers, then each business's owned + client Pages (requesting the page
// access_token so we can post). Entirely best-effort.
async function fetchBusinessPages(userToken: string): Promise<FacebookPage[]> {
  try {
    const bizUrl = new URL(`${GRAPH}/me/businesses`)
    bizUrl.searchParams.set('access_token', userToken)
    bizUrl.searchParams.set('fields', 'id')
    bizUrl.searchParams.set('limit', '50')
    const bizRes = await fetch(bizUrl.toString())
    const bizBody = await bizRes.json()
    if (!bizRes.ok) return []
    const businessIds: string[] = ((bizBody.data ?? []) as Array<{ id: string }>).map((b) => b.id)
    const out: FacebookPage[] = []
    for (const bizId of businessIds) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try {
          const pUrl = new URL(`${GRAPH}/${bizId}/${edge}`)
          pUrl.searchParams.set('access_token', userToken)
          pUrl.searchParams.set('fields', 'id,name,access_token')
          pUrl.searchParams.set('limit', '100')
          const pRes = await fetch(pUrl.toString())
          const pBody = await pRes.json()
          if (pRes.ok) {
            for (const p of (pBody.data ?? []) as FacebookPage[]) {
              if (p.id && p.access_token) out.push(p)
            }
          }
        } catch { /* skip this edge — best-effort */ }
      }
    }
    return out
  } catch {
    return []
  }
}

function dedupePages(pages: FacebookPage[]): FacebookPage[] {
  const seen = new Set<string>()
  const out: FacebookPage[] = []
  for (const p of pages) {
    if (p.id && !seen.has(p.id)) { seen.add(p.id); out.push(p) }
  }
  return out
}

export function createFacebookService(pageAccessToken: string, pageId: string) {
  return new FacebookService(pageAccessToken, pageId)
}
