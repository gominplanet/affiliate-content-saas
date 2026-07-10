const BASE = 'https://graph.threads.net/v1.0'

// A media container is not publishable the instant it's created — Meta has to
// process it (for IMAGE posts, that means downloading the image_url). Publishing
// an unfinished container fails with an opaque "The requested resource does not
// exist", because the container node isn't resolvable yet. Meta puts processing
// at ~30s on average, so we poll. The scheduled-post cron runs on a 60s budget
// and publishes its batch concurrently, so a 35s ceiling costs nothing on the
// common path (TEXT containers come back FINISHED on the first poll).
const CONTAINER_TIMEOUT_MS = 35_000

export class ThreadsService {
  constructor(private accessToken: string, private userId: string) {}

  /** Block until Threads reports the container is FINISHED (ready to publish).
   *  Throws with Meta's own reason on ERROR/EXPIRED, so a failed image download
   *  is reported as a failed image download rather than a missing resource. */
  private async waitForContainer(containerId: string): Promise<void> {
    const deadline = Date.now() + CONTAINER_TIMEOUT_MS
    let detail = 'no status returned'
    let delay = 500

    for (;;) {
      const res = await fetch(
        `${BASE}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(this.accessToken)}`,
      )
      if (res.ok) {
        const d = await res.json().catch(() => ({})) as { status?: string; error_message?: string }
        // PUBLISHED shouldn't happen pre-publish, but treat it as ready rather
        // than spinning until the deadline.
        if (d.status === 'FINISHED' || d.status === 'PUBLISHED') return
        if (d.status === 'ERROR' || d.status === 'EXPIRED') {
          throw new Error(`Threads container ${d.status}: ${d.error_message || 'no detail given'}`)
        }
        detail = d.status ?? detail
      } else {
        detail = `status check HTTP ${res.status}`
      }

      if (Date.now() + delay >= deadline) {
        throw new Error(
          `Threads container not ready after ${Math.round(CONTAINER_TIMEOUT_MS / 1000)}s (${detail})`,
        )
      }
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 2, 4_000)
    }
  }

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
      // Name the step. Both fetches used to rethrow Meta's bare message, which
      // made an identical error unattributable between the two calls.
      throw new Error(`Threads container create failed: ${err.error?.message || `HTTP ${containerRes.status}`}`)
    }
    const { id: creationId } = await containerRes.json() as { id: string }

    // Step 2: wait for Meta to finish processing it (see CONTAINER_TIMEOUT_MS).
    await this.waitForContainer(creationId)

    // Step 3: publish the container
    const publishRes = await fetch(`${BASE}/me/threads_publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ creation_id: creationId }),
    })
    if (!publishRes.ok) {
      const err = await publishRes.json()
      throw new Error(`Threads publish failed: ${err.error?.message || `HTTP ${publishRes.status}`}`)
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

/**
 * Refresh a long-lived Threads token to extend it another ~60 days. The
 * long-lived token refreshes ITSELF (no separate refresh token) via the
 * th_refresh_token grant. Requirements: the token must be valid and at least
 * 24h old; refreshing a brand-new (<24h) token errors — callers should treat
 * that as a no-op and keep the current token. Returns the new token + its
 * absolute expiry (ms epoch). Used by the daily token-refresh cron so creators
 * never have to reconnect Threads.
 */
export async function refreshThreadsToken(currentToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(currentToken)}`,
  )
  const data = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } }
  if (!res.ok || !data.access_token) {
    throw new Error(`Threads token refresh failed: ${data.error?.message || `HTTP ${res.status}`}`)
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 60 * 24 * 60 * 60) * 1000,
  }
}
