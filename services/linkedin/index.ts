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

  /**
   * Native IMAGE post — uploads the image to LinkedIn and shares it with the
   * caption (the article link goes in the caption text, since an IMAGE share
   * can't also render a link card). Three steps: registerUpload → PUT the
   * bytes → create the UGC post referencing the asset. Throws on any failure
   * so the caller can fall back to the ARTICLE (link-card) share.
   */
  async createImagePost(opts: {
    text: string
    imageUrl: string
    title?: string
    description?: string
  }): Promise<{ id: string }> {
    // 1. Register the upload — LinkedIn hands back an asset URN + an upload URL.
    const reg = await fetch(`${LINKEDIN_API}/assets?action=registerUpload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: `urn:li:person:${this.personId}`,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      }),
    })
    if (!reg.ok) throw new Error(`LinkedIn registerUpload failed ${reg.status}: ${(await reg.text()).slice(0, 200)}`)
    const regData = await reg.json() as {
      value?: { asset?: string; uploadMechanism?: Record<string, { uploadUrl?: string }> }
    }
    const asset = regData.value?.asset
    const uploadUrl = regData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
    if (!asset || !uploadUrl) throw new Error('LinkedIn registerUpload returned no asset/uploadUrl')

    // 2. Fetch the image bytes and PUT them to the upload URL.
    const imgRes = await fetch(opts.imageUrl)
    if (!imgRes.ok) throw new Error(`Could not fetch image for LinkedIn (${imgRes.status})`)
    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    const up = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
      body: bytes,
    })
    if (!up.ok) throw new Error(`LinkedIn image upload failed ${up.status}`)

    // 3. Create the post referencing the uploaded asset.
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
            shareMediaCategory: 'IMAGE',
            media: [{
              status: 'READY',
              media: asset,
              ...(opts.title ? { title: { text: opts.title.slice(0, 200) } } : {}),
              ...(opts.description ? { description: { text: opts.description.slice(0, 256) } } : {}),
            }],
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })
    if (!res.ok) throw new Error(`LinkedIn image post failed ${res.status}: ${(await res.text()).slice(0, 300)}`)
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
