// © 2026 Gominplanet / MVP Affiliate. Proprietary & confidential.
//
// Is this a link to a Facebook Group, or a post in one? Used to keep the
// "share your Group post on your Page" flow to links that stay on Facebook.

const HOSTS = /^(www\.|web\.|m\.)?facebook\.com$/i

export function isFacebookGroupLink(raw: string): boolean {
  try {
    const u = new URL(String(raw || '').trim())
    return u.protocol === 'https:' && HOSTS.test(u.hostname) && /^\/groups\/[^/]+/.test(u.pathname)
  } catch {
    return false
  }
}

/** True when the link is one exact post in a Group, not just the Group. */
export function isFacebookGroupPostLink(raw: string): boolean {
  if (!isFacebookGroupLink(raw)) return false
  return /^\/groups\/[^/]+\/(posts|permalink)\/\d+/.test(new URL(raw.trim()).pathname)
}
