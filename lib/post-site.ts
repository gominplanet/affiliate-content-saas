// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WRITE TO THE POST YOU MEAN.
//
// A post is written to by site + post number. The site came from the post's
// saved site id, and a missing one meant the default site, so on a creator
// with several blogs a title fix for one post landed on another post with the
// same number on a different blog: a Beard Club trimmer review ended up titled
// for a Beatbot pool robot. Migration 385 files every post under the site its
// own address is on; this is the same rule in code, plus a check made right
// before a write that the number still names the post MVP has on file.

import { getWordPressCredentials, listSites } from '@/lib/wordpress-sites'
import type { WordPressService } from '@/services/wordpress'

export const hostOf = (u: string | null | undefined): string | null => {
  try { return u ? new URL(u).host.replace(/^www\./, '').toLowerCase() : null } catch { return null }
}

/** The last path segment of a post URL, which WordPress calls its slug. Null
 *  for ?p=123 addresses, which a draft has before it is published. */
export function slugOfUrl(u: string | null | undefined): string | null {
  try {
    const url = new URL(String(u))
    if (url.searchParams.get('p')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    return parts.length ? decodeURIComponent(parts[parts.length - 1]).toLowerCase() : null
  } catch { return null }
}

type Creds = NonNullable<Awaited<ReturnType<typeof getWordPressCredentials>>>

/** The credentials of the site this post's own address is on, else of its
 *  saved site id (else the default). Null when neither resolves, or when the
 *  address is on a site that is not connected: guessing is what went wrong. */
export async function credsForPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, ownerId: string, post: { wordpress_url?: string | null; wordpress_site_id?: string | null },
): Promise<Creds | null> {
  const host = hostOf(post.wordpress_url)
  if (host) {
    const site = (await listSites(sb, ownerId)).find((x) => hostOf(x.url) === host)
    if (site) {
      return {
        wordpress_url: site.url, wordpress_username: site.username, wordpress_app_password: site.appPassword,
        wordpress_api_token: site.apiToken, site_id: site.id, site_label: site.label,
        content_only: site.contentOnly, cta_style: site.ctaStyle,
      }
    }
  }
  const creds = await getWordPressCredentials(sb, ownerId, post.wordpress_site_id ?? null)
  if (creds && host && hostOf(creds.wordpress_url) !== host) return null
  return creds
}

/** Pure: does what WordPress says about this number match the address MVP
 *  has for the post? */
export function samePost(expectedUrl: string | null | undefined, wp: { slug: string; link: string }): boolean {
  if (!expectedUrl) return true
  const want = slugOfUrl(expectedUrl)
  if (!want) return true // a ?p= address names the number itself
  if (wp.slug && wp.slug.toLowerCase() === want) return true
  return slugOfUrl(wp.link) === want
}

/** Right before a write: is post #id on this site the post at expectedUrl? */
export async function checkSamePost(wp: WordPressService, id: number, expectedUrl: string | null | undefined):
  Promise<{ ok: true; renamedTo?: string | null } | { ok: false; error: string }> {
  const who = await wp.getPostIdentity(id)
  if (!who.ok) {
    return { ok: false, error: who.status === 404 ? `Post #${id} is not on that site any more, so nothing was changed.` : `WordPress would not say which post #${id} is (${who.reason}), so nothing was changed.` }
  }
  if (!samePost(expectedUrl, who)) {
    // A RENAMED ADDRESS IS STILL THE SAME POST. WordPress keeps the old slug
    // and redirects it to the new one, so the address on file is followed
    // before the post is called a different one: a creator who fixes a slug
    // in WordPress must not be locked out of their own post.
    if (expectedUrl && await redirectsTo(expectedUrl, who)) return { ok: true, renamedTo: who.link || null }
    return { ok: false, error: `Post #${id} on that site is ${who.link || who.slug}, not ${expectedUrl}. MVP had this post filed under the wrong site, so nothing was changed.` }
  }
  return { ok: true }
}

const WORDS_STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'why', 'how', 'what', 'you', 'your', 'review', 'best', 'worth', 'its', 'our', 'after', 'test', 'tested'])
const words = (s: string) => new Set(String(s || '').toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !WORDS_STOP.has(w)))

/** How much of a title the post's own address carries. The address is made
 *  from the title the post was first published with and never changes, so a
 *  title that shares nothing with it is a title from somewhere else. */
export function titleFitsSlug(title: string, slug: string): number {
  const s = words(slug.replace(/-\d+$/, '').replace(/-/g, ' '))
  const t = [...words(title)]
  if (!s.size || !t.length) return 0
  return t.filter((w) => s.has(w)).length / Math.min(t.length, s.size)
}

/** Titles compared as a reader sees them. */
export function sameTitle(a: string, b: string): boolean {
  const n = (x: string) => String(x || '')
    .replace(/&#8217;|&rsquo;|’/g, "'").replace(/&#8216;|&lsquo;|‘/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|[“”]/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;|[–—]/g, '-').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase()
  return n(a) === n(b)
}

/** Does the address on file now land on this post (WordPress's old-slug
 *  redirect)? A failed fetch is a no. */
async function redirectsTo(url: string, wp: { slug: string; link: string }): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0)' } })
    return samePost(res.url, wp)
  } catch { return false }
}
