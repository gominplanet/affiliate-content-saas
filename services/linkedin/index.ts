const LINKEDIN_API = 'https://api.linkedin.com/v2'
const LINKEDIN_AUTH = 'https://www.linkedin.com/oauth/v2'

export interface LinkedInProfile {
  sub: string   // person ID (from OpenID Connect userinfo)
  name: string
  picture?: string
}

export class LinkedInService {
  constructor(private accessToken: string, private personId: string) {}

  async createPost(opts: {
    text: string
    articleUrl: string
    articleTitle: string
    articleDescription: string
  }): Promise<{ id: string }> {
    const res = await fetch(`${LINKEDIN_API}/ugcPosts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:person:${this.personId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: opts.text },
            shareMediaCategory: 'ARTICLE',
            media: [{
              status: 'READY',
              description: { text: opts.articleDescription.slice(0, 256) },
              originalUrl: opts.articleUrl,
              title: { text: opts.articleTitle.slice(0, 200) },
            }],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`LinkedIn post failed ${res.status}: ${body.slice(0, 300)}`)
    }

    const data = await res.json() as { id?: string }
    return { id: data.id ?? 'unknown' }
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const res = await fetch(`${LINKEDIN_AUTH}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LinkedIn token exchange failed: ${body.slice(0, 300)}`)
  }

  const data = await res.json() as { access_token: string }
  return data.access_token
}

export async function getProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetch(`${LINKEDIN_API}/userinfo`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LinkedIn profile fetch failed: ${body.slice(0, 300)}`)
  }

  return res.json() as Promise<LinkedInProfile>
}

export function createLinkedInService(accessToken: string, personId: string) {
  return new LinkedInService(accessToken, personId)
}
