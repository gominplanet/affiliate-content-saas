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

// ── Comment→DM (Private Replies) ─────────────────────────────────────────────
// Facebook is where Private Replies originated (Instagram's is the newer copy).
// A Page can send ONE private message to the author of a public comment on its
// post, within 7 days — the only way to cold-DM on Facebook. Needs the token to
// carry pages_messaging (send) + pages_read_engagement (read comments); the
// webhook subscription below needs pages_manage_metadata. See project_ig_comment_to_dm.

/** DM the author of a Page comment. Returns the message id; throws on error. */
export async function sendPrivateReply(opts: { commentId: string; message: string; pageAccessToken: string }): Promise<string> {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(opts.commentId)}/private_replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: opts.message, access_token: opts.pageAccessToken }),
  })
  const body = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) throw new Error(`FB private reply ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return (body.id as string) || ''
}

/** Optional public "Sent you a DM!" reply under the comment — best-effort. */
export async function replyToCommentPublic(opts: { commentId: string; message: string; pageAccessToken: string }): Promise<void> {
  try {
    await fetch(`${GRAPH}/${encodeURIComponent(opts.commentId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: opts.message, access_token: opts.pageAccessToken }),
    })
  } catch { /* non-fatal */ }
}

/** Subscribe this Page to `feed` webhooks so comment events reach our endpoint.
 *  The #1 "no events" cause is a Page that was never subscribed. Idempotent. */
export async function subscribePageToFeed(opts: { pageId: string; pageAccessToken: string }): Promise<void> {
  const res = await fetch(`${GRAPH}/${opts.pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: 'feed', access_token: opts.pageAccessToken }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`FB subscribe ${res.status}: ${body.slice(0, 200)}`)
  }
}

export async function getPages(userToken: string): Promise<FacebookPage[]> {
  // UNION both sources rather than early-returning on the first non-empty one.
  // A creator can have some Pages on a direct role (/me/accounts) AND their real
  // target Page under a Business Manager. The old code returned ONLY the direct
  // Pages whenever /me/accounts had any, so a Business-Manager Page was invisible
  // and "opt in to all" didn't surface it — the modernday.tech ticket (opted in
  // all, still only one Page to pick). Fetch both, dedupe, return everything.
  // Direct must not throw (it's the primary), business is best-effort.
  const direct = await fetchMeAccounts(userToken)
  const viaBusiness = await fetchBusinessPages(userToken)   // best-effort → [] on any failure
  return dedupePages([...direct, ...viaBusiness])
}

// Follow Graph API cursor pagination (`paging.next`) so accounts with more Pages
// than one response holds don't get silently truncated to the first page. Bounded
// so a broken cursor can't loop forever. `throwOnError` distinguishes the primary
// /me/accounts call (surface a real failure) from the best-effort business edges.
async function fetchPagedPages(firstUrl: string, throwOnError: boolean): Promise<FacebookPage[]> {
  const out: FacebookPage[] = []
  let next: string | null = firstUrl
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetch(next)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json()
    if (!res.ok) {
      if (throwOnError) throw new Error(`Failed to fetch Facebook pages: ${JSON.stringify(body)}`)
      break
    }
    for (const p of (body.data ?? []) as FacebookPage[]) {
      if (p.id && p.access_token) out.push(p)
    }
    next = (body.paging?.next as string | undefined) || null
  }
  return out
}

async function fetchMeAccounts(userToken: string): Promise<FacebookPage[]> {
  const url = new URL(`${GRAPH}/me/accounts`)
  url.searchParams.set('access_token', userToken)
  url.searchParams.set('fields', 'id,name,access_token')
  url.searchParams.set('limit', '100')
  return fetchPagedPages(url.toString(), true)
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
          out.push(...await fetchPagedPages(pUrl.toString(), false))
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
