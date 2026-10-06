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

/** A video posted in a Group opens as a Reel: facebook.com/reel/<id>. It shows
 *  the video with the post's text and links, so it can stand in for the Group
 *  post's address (Clip Factory, Group first). A Facebook link, so never one
 *  of the outside links Meta rations. */
export function isFacebookReelLink(raw: string): boolean {
  try {
    const u = new URL(String(raw || '').trim())
    return u.protocol === 'https:' && HOSTS.test(u.hostname) && /^\/reel\/\d{6,}\/?$/.test(u.pathname)
  } catch {
    return false
  }
}
