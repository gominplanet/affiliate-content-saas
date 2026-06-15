/**
 * Bluesky service module.
 *
 * Uses the AT Protocol over HTTP (no SDK dependency — keeps our bundle
 * small). Authentication is per-user **App Passwords**, generated in
 * Bluesky Settings → Privacy and Security → App Passwords. We never
 * see or store the user's main Bluesky password.
 *
 * Endpoints used:
 *   - com.atproto.server.createSession        (login w/ handle + app password)
 *   - com.atproto.repo.createRecord            (publish a post)
 *
 * All requests go to the user's PDS (Personal Data Server). For
 * bsky.social accounts that's https://bsky.social. Custom PDS handles
 * (e.g. self-hosted) require resolving via DNS — out of scope for v1.
 */

const PDS_BASE = 'https://bsky.social'

export type BlueskySession = {
  accessJwt: string
  refreshJwt: string
  did: string
  handle: string
}

/** Authenticate with handle + app password. Returns session tokens + DID. */
export async function createSession(handle: string, appPassword: string): Promise<BlueskySession> {
  const res = await fetch(`${PDS_BASE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bluesky login failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<BlueskySession>
}

/**
 * Create a post on the authenticated user's account.
 *
 * Bluesky posts are limited to 300 graphemes (≈ characters for ASCII).
 * If you supply `linkUrl`, we'll attach a "facets" entry so the URL
 * renders as a clickable link in the Bluesky client.
 */
export async function createPost(
  session: BlueskySession,
  args: { text: string; linkUrl?: string; linkText?: string; embed?: { url: string; title?: string; description?: string; imageUrl?: string } },
): Promise<{ uri: string; cid: string }> {
  const text = args.text
  const facets: Array<Record<string, unknown>> = []

  // If we have a linkUrl and the link appears verbatim in the text, add a
  // facet so it's clickable. Bluesky needs UTF-8 byte offsets.
  if (args.linkUrl && args.linkText) {
    const linkText = args.linkText
    const byteStart = utf8ByteOffset(text, text.indexOf(linkText))
    if (byteStart >= 0) {
      const byteEnd = byteStart + new TextEncoder().encode(linkText).length
      facets.push({
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: args.linkUrl }],
      })
    }
  }

  // External embed = a native link card (title + description + thumbnail). The
  // thumb is uploaded as a blob first; if that fails (too big / fetch error)
  // we still attach the card, just without the image.
  let embed: Record<string, unknown> | undefined
  if (args.embed?.url) {
    let thumb: unknown = null
    if (args.embed.imageUrl) thumb = await uploadBlob(session, args.embed.imageUrl)
    embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: args.embed.url,
        title: (args.embed.title || '').slice(0, 300),
        description: (args.embed.description || '').slice(0, 1000),
        ...(thumb ? { thumb } : {}),
      },
    }
  }

  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    ...(facets.length ? { facets } : {}),
    ...(embed ? { embed } : {}),
  }

  const res = await fetch(`${PDS_BASE}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bluesky post failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<{ uri: string; cid: string }>
}

/** Upload an image to the user's PDS as a blob (for an external-embed thumb).
 *  Returns the blob ref, or null on any failure. Bluesky caps blobs at ~1MB,
 *  so we skip oversized images rather than error the whole post. */
async function uploadBlob(session: BlueskySession, imageUrl: string): Promise<unknown | null> {
  try {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return null
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    if (bytes.byteLength > 976_000) return null // PDS blob limit ≈ 1MB
    const res = await fetch(`${PDS_BASE}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessJwt}`, 'Content-Type': contentType },
      body: bytes,
    })
    if (!res.ok) return null
    const data = await res.json() as { blob?: unknown }
    return data.blob ?? null
  } catch {
    return null
  }
}

/** Get UTF-8 byte offset of a character index in a JS string. */
function utf8ByteOffset(text: string, charIndex: number): number {
  if (charIndex < 0) return -1
  return new TextEncoder().encode(text.slice(0, charIndex)).length
}
