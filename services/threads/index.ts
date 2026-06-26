const BASE = 'https://graph.threads.net/v1.0'

export class ThreadsService {
  constructor(private accessToken: string, private userId: string) {}

  async createPost(text: string, imageUrl?: string): Promise<{ id: string; permalink?: string }> {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
    }

    // Step 1: create media container
    const containerBody: Record<string, string> = { text }
    if (imageUrl) {
      containerBody.media_type = 'IMAGE'
      containerBody.image_url = imageUrl
    } else {
      containerBody.media_type = 'TEXT'
    }

    const containerRes = await fetch(`${BASE}/me/threads`, {
      method: 'POST',
      headers,
      body: JSON.stringify(containerBody),
    })
    if (!containerRes.ok) {
      const err = await containerRes.json()
      throw new Error(err.error?.message || `Threads container error: ${containerRes.status}`)
    }
    const { id: creationId } = await containerRes.json() as { id: string }

    // Step 2: publish the container
    const publishRes = await fetch(`${BASE}/me/threads_publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ creation_id: creationId }),
    })
    if (!publishRes.ok) {
      const err = await publishRes.json()
      throw new Error(err.error?.message || `Threads publish error: ${publishRes.status}`)
    }
    const { id } = await publishRes.json() as { id: string }

    // Best-effort: fetch the public permalink for this post so the brand-recap
    // can link to it. Threads gives no public URL from the opaque media id
    // alone, so we ask the Graph API for it. Never fails the publish — a missing
    // permalink just means the recap omits the Threads link (prior behaviour).
    let permalink: string | undefined
    try {
      const permRes = await fetch(`${BASE}/${id}?fields=permalink&access_token=${encodeURIComponent(this.accessToken)}`)
      if (permRes.ok) {
        const d = await permRes.json() as { permalink?: string }
        if (d.permalink) permalink = d.permalink
      }
    } catch { /* permalink is a nice-to-have, not required */ }

    return { id, permalink }
  }
}

/** Fetch the connected Threads profile (id + username). Best-effort —
 *  used to display "Connected as @username" after OAuth. */
export async function fetchThreadsProfile(accessToken: string): Promise<{ id: string; username: string | null }> {
  const res = await fetch(`${BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`)
  if (!res.ok) throw new Error(`Threads profile fetch failed: ${res.status}`)
  const data = await res.json() as { id?: string; username?: string }
  return { id: data.id ?? '', username: data.username ?? null }
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const res = await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.THREADS_APP_ID!,
      client_secret: process.env.THREADS_APP_SECRET!,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error_message || err.error?.message || 'Threads token exchange failed')
  }
  const { access_token, user_id } = await res.json() as { access_token: string; user_id: string }

  // Exchange for long-lived token (60-day expiry)
  const llRes = await fetch(
    `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${process.env.THREADS_APP_SECRET}&access_token=${access_token}`,
  )
  if (!llRes.ok) return { access_token, user_id }
  const { access_token: longLivedToken } = await llRes.json() as { access_token: string }
  return { access_token: longLivedToken, user_id }
}
