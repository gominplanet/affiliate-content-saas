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

/**
 * Manual connect escape hatch. When OAuth can't surface a Page (a Business
 * Manager Page needs `business_management`, which Facebook drops for customers
 * until App Review), the user pastes a token from their Business Manager instead.
 *
 * Accepts a USER, SYSTEM-USER, or PAGE access token (+ optional Page ID hint) and
 * resolves the specific Page and its posting token — no OAuth Page list involved,
 * so it works today for any Page the user administers, BM-owned or not.
 *
 * Throws `MULTIPLE:<json>` when the token can reach several Pages and no hint was
 * given, so the caller can show a chooser.
 */
export async function resolveManualPage(
  inputToken: string,
  pageIdHint?: string,
): Promise<{ pageId: string; pageName: string; pageAccessToken: string; allPages: FacebookPage[] }> {
  const hint = (pageIdHint || '').trim() || undefined
  // Prefer a long-lived exchange so a user token yields long-lived Page tokens.
  // System-user / Page tokens can't be exchanged — fall back to the raw token.
  let token = inputToken
  try { token = await getLongLivedToken(inputToken) } catch { token = inputToken }

  // Path A — the token can list Pages (user or system-user token).
  let pages: FacebookPage[] = []
  try { pages = await getPages(token) } catch { pages = [] }
  if (pages.length > 0) {
    const chosen = hint
      ? pages.find(p => p.id === hint)
      : (pages.length === 1 ? pages[0] : undefined)
    if (!chosen) {
      if (hint) throw new Error(`That token can reach ${pages.length} Page(s), but none match the Page ID you entered.`)
      throw new Error(`MULTIPLE:${JSON.stringify(pages.map(p => ({ id: p.id, name: p.name })))}`)
    }
    return { pageId: chosen.id, pageName: chosen.name, pageAccessToken: chosen.access_token, allPages: pages }
  }

  // Path B — a Page ID was given. Ask Facebook for THAT Page and its own posting
  // token directly. This is the reliable route for a System-User token: the token
  // itself can't post, but /{pageId}?fields=access_token mints the Page token when
  // the Page is assigned to that system user with a posting role.
  if (hint) {
    const pUrl = new URL(`${GRAPH}/${hint}`)
    pUrl.searchParams.set('fields', 'id,name,access_token')
    pUrl.searchParams.set('access_token', inputToken)
    const pRes = await fetch(pUrl.toString())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pBody: any = await pRes.json()
    if (pRes.ok && pBody?.id) {
      if (!pBody.access_token) {
        throw new Error(`Facebook accepted the token for "${pBody.name || hint}" but returned no posting token — the token needs the pages_manage_posts permission and a posting role on this Page.`)
      }
      const page: FacebookPage = { id: String(pBody.id), name: pBody.name || 'Facebook Page', access_token: pBody.access_token }
      return { pageId: page.id, pageName: page.name, pageAccessToken: page.access_token, allPages: [page] }
    }
    // fall through to the /me check for a clearer error
  }

  // Path C — the token IS a Page token; /me returns the Page itself. A Page has a
  // `category`; a User or System-User token does not — use that to reject the
  // wrong token type instead of storing a non-postable object.
  const meUrl = new URL(`${GRAPH}/me`)
  meUrl.searchParams.set('fields', 'id,name,category')
  meUrl.searchParams.set('access_token', inputToken)
  const res = await fetch(meUrl.toString())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await res.json()
  if (!res.ok || !body?.id) {
    throw new Error(body?.error?.message || 'Facebook did not accept that access token. Generate a fresh Page or System-User token and try again.')
  }
  if (!body.category) {
    // A User / System-User token with no Page surfaced. Almost always means the
    // Page isn't assigned to the token yet, or no Page ID was supplied.
    throw new Error('That looks like a User or System-User token with no Page attached. Assign your Page to the system user (Manage Page access) and enter your Page ID above, or paste the Page access token directly.')
  }
  if (hint && hint !== String(body.id)) {
    throw new Error(`That token is for "${body.name}" (${body.id}), not the Page ID you entered.`)
  }
  const page: FacebookPage = { id: String(body.id), name: body.name || 'Facebook Page', access_token: inputToken }
  return { pageId: page.id, pageName: page.name, pageAccessToken: inputToken, allPages: [page] }
}

/**
 * Live check that a stored Page access token STILL works. MVP otherwise shows
 * "Connected" purely because facebook_page_id is populated, so a token that Meta
 * silently invalidated (permissions revoked, password change, an Instagram
 * account restricted for "3rd-party" use) keeps showing a false green while
 * posting fails — the "connected on Facebook but no access on MVP" ticket.
 *
 * Returns { ok } when the Page responds to its own token, else a reason and
 * whether it's an auth/expiry failure (code 190 / OAuthException) vs. transient.
 */
export async function verifyPageToken(
  pageAccessToken: string,
  pageId: string,
): Promise<{ ok: boolean; pageName?: string; expired?: boolean; error?: string }> {
  if (!pageAccessToken || !pageId) return { ok: false, expired: false, error: 'missing token or page id' }
  try {
    const url = new URL(`${GRAPH}/${encodeURIComponent(pageId)}`)
    url.searchParams.set('fields', 'id,name')
    url.searchParams.set('access_token', pageAccessToken)
    const res = await fetch(url.toString())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json().catch(() => ({}))
    if (res.ok && body?.id) return { ok: true, pageName: body.name || undefined }
    const err = body?.error || {}
    // Meta's rate-limit / temporary errors ALSO carry type "OAuthException"
    // (code 4 app limit, 17 user limit, 32 page limit, 613 custom limit, 1/2
    // transient). Those must NOT be read as "reconnect" — they're "try again
    // later". A nightly batch probing thousands of tokens can trip the app-level
    // limit and flag a swath of still-connected users otherwise (false nudges).
    const RATE_LIMIT_OR_TRANSIENT = [1, 2, 4, 17, 32, 341, 368, 613]
    const transient = RATE_LIMIT_OR_TRANSIENT.includes(err.code)
    // 190 = token expired/invalidated; 10/200 = permission missing; 2500 = invalid
    // token — genuine "reconnect". OAuthException otherwise = reconnect, EXCEPT
    // the transient codes above.
    const expired = !transient && (err.code === 190 || err.type === 'OAuthException' || [10, 200, 2500].includes(err.code))
    return { ok: false, expired, error: (err.message as string) || `HTTP ${res.status}` }
  } catch (e) {
    // Network/transient — NOT an auth failure, so don't tell the user to reconnect.
    return { ok: false, expired: false, error: e instanceof Error ? e.message : 'network error' }
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
