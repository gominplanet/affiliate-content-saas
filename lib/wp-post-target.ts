// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which WordPress post is this action about, and which site does it live on?
//
// "Post not found" was the answer to three different questions, and none of the
// three were the one the creator asked. Change thumbnail, Manual edit and the
// social actions all start by looking up a blog_posts row, and all of them treat
// a missing row as a missing POST. It isn't. The post is live on WordPress and
// visible in the Posts tab: what is missing is MVP's record OF it.
//
// Rows go missing for ordinary reasons. Buying guides and comparisons insert
// their row after the WordPress publish, and every one of those inserts was
// written as `const { data } = await …insert(…)` with no error branch, so a
// constraint violation published the post and returned ok. A rebuild can mint a
// new WP id and strand the old one. Older link posts predate the NOT NULL slug
// fix. In every case the creator sees their post on the page, clicks a button on
// it, and is told it does not exist.
//
// So resolution here has three steps, in order of confidence:
//   1. the blog_posts row, by UUID or by WordPress id
//   2. the same row, by permalink — survives a rebuilt WP id
//   3. no row at all: act on the WordPress post directly, by its numeric id
//
// Step 3 is the one that needs a guard. A bare numeric id means nothing without
// a site: post 1234 exists on every WordPress install in the world. So an
// untracked target is only usable when the permalink's host matches the host of
// the credentials we are about to write with. Get that wrong and the creator
// replaces the hero image on an unrelated post on a different blog.

import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PostRefKind = 'uuid' | 'wp-id' | 'unknown'

/** What kind of identifier the client sent. The Posts tab sends a WordPress
 *  numeric id for every row (it is built from WP REST); video cards send the
 *  blog_posts UUID. Both arrive as strings on the same parameter. */
export function classifyPostRef(postId: string | null | undefined): { kind: PostRefKind; wpPostId: number | null } {
  const s = String(postId ?? '').trim()
  if (UUID_RE.test(s)) return { kind: 'uuid', wpPostId: null }
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    // A WP post id is a positive integer. Anything else (0, an overflow) is not
    // one, and treating it as one would send a nonsense id to WordPress.
    if (Number.isSafeInteger(n) && n > 0) return { kind: 'wp-id', wpPostId: n }
  }
  return { kind: 'unknown', wpPostId: null }
}

/** Host of a URL, lowercased and www-stripped, for comparing two spellings of
 *  the same site. Empty string when there is nothing parseable, which never
 *  compares equal to anything — a failed parse must not read as a match. */
export function hostOfUrl(u: string | null | undefined): string {
  const s = String(u ?? '').trim()
  if (!s) return ''
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** True when two URLs are on the same WordPress site. Protocol and www differ
 *  freely between a stored site URL and a live permalink; the host does not. */
export function sameWpHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const ha = hostOfUrl(a)
  const hb = hostOfUrl(b)
  return !!ha && ha === hb
}

/** The connected site a permalink belongs to, or null when none matches.
 *  Multi-site creators publish to up to ten blogs, so "the default site" is a
 *  guess and a wrong guess writes to the wrong blog. */
export function siteIdForPermalink(
  sites: Array<{ id: string; url: string }>,
  permalink: string | null | undefined,
): string | null {
  const host = hostOfUrl(permalink)
  if (!host) return null
  const hit = sites.find(s => hostOfUrl(s.url) === host)
  return hit?.id ?? null
}

export interface WpPostTarget {
  /** The blog_posts UUID when MVP has a record of this post, else null. */
  mvpId: string | null
  /** The WordPress post id to act on, when we have one. */
  wpPostId: number | null
  /** Site to pull credentials from. Null means "let the caller take the
   *  default", which is only safe once the host check below passes. */
  siteId: string | null
  /** How the target was reached. Carried so a message can say what actually
   *  happened instead of "not found". */
  via: 'uuid' | 'wp-id' | 'permalink' | 'untracked' | 'none'
  /** True when there is no blog_posts row. The action can still run against
   *  WordPress, but only after the permalink host is confirmed. */
  untracked: boolean
}

/** What to tell the creator when nothing resolved. Says which of the two things
 *  is missing, because they need different fixes: a post MVP never recorded is
 *  reopened from the Posts tab, a stale reference needs a reload. */
export function describeUnresolvedTarget(kind: PostRefKind, hasPermalink: boolean): string {
  if (kind === 'unknown') {
    return 'That post reference isn’t one MVP recognises. Reload the Posts tab and try again.'
  }
  if (!hasPermalink) {
    return 'MVP has no record of this post and the page didn’t send its address, so there’s no way to tell which blog it’s on. Reload the Posts tab and try again.'
  }
  return 'MVP has no record of this post, and its address doesn’t match any WordPress site connected here. Connect that site in Setup, then try again.'
}

/**
 * Resolve a client-supplied post reference to something actionable.
 *
 * Never throws and never invents a site. A returned target with `untracked:
 * true` carries a `wpPostId` the caller may act on ONLY after confirming the
 * permalink host matches the credentials it resolved — see confirmUntrackedSite.
 */
export async function resolveWpPostTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  postId: string | null | undefined,
  permalink?: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listSitesFn?: (sb: any, uid: string) => Promise<Array<{ id: string; url: string }>>,
): Promise<WpPostTarget> {
  const ref = classifyPostRef(postId)
  const none: WpPostTarget = { mvpId: null, wpPostId: null, siteId: null, via: 'none', untracked: true }

  const SELECT = 'id,wordpress_post_id,wordpress_site_id,wordpress_url'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1 + 2. The blog_posts row, by whichever key we were handed.
  if (ref.kind === 'uuid' || ref.kind === 'wp-id') {
    const { data: row } = await sb
      .from('blog_posts')
      .select(SELECT)
      .eq(ref.kind === 'uuid' ? 'id' : 'wordpress_post_id', ref.kind === 'uuid' ? String(postId).trim() : ref.wpPostId)
      .eq('user_id', userId)
      .maybeSingle()
    if (row) {
      return {
        mvpId: row.id as string,
        // A row found BY WordPress id obviously has that id; a row found by
        // UUID may have none yet (drafted, never published).
        wpPostId: (row.wordpress_post_id as number | null) ?? ref.wpPostId,
        siteId: (row.wordpress_site_id as string | null) ?? null,
        via: ref.kind === 'uuid' ? 'uuid' : 'wp-id',
        untracked: false,
      }
    }
  }

  // 3. By permalink. Rescues a row whose wordpress_post_id drifted on a rebuild.
  const host = hostOfUrl(permalink)
  if (host) {
    const wanted = normalizePermalink(permalink)
    const { data: rows } = await sb
      .from('blog_posts')
      .select(SELECT)
      .eq('user_id', userId)
      .limit(2000)
    const list = (rows as Array<{ id: string; wordpress_post_id: number | null; wordpress_site_id: string | null; wordpress_url: string | null }> | null) ?? []
    const hit = list.find(r => normalizePermalink(r.wordpress_url) === wanted)
    if (hit) {
      return {
        mvpId: hit.id,
        wpPostId: hit.wordpress_post_id ?? ref.wpPostId,
        siteId: hit.wordpress_site_id ?? null,
        via: 'permalink',
        untracked: false,
      }
    }
  }

  // 4. No row anywhere. The post is still live on WordPress, so keep going with
  //    its numeric id and let the caller prove the site.
  if (ref.kind === 'wp-id') {
    let siteId: string | null = null
    if (listSitesFn) {
      try {
        const sites = await listSitesFn(supabase, userId)
        siteId = siteIdForPermalink(sites, permalink)
      } catch { /* site list unavailable: fall through to the default site */ }
    }
    return { mvpId: null, wpPostId: ref.wpPostId, siteId, via: 'untracked', untracked: true }
  }

  return none
}

/** Canonical form of a permalink for comparison: no protocol, no www, no
 *  trailing slash, lowercased. */
function normalizePermalink(u: string | null | undefined): string {
  return String(u ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * The guard on step 3. An untracked target is a bare number until we know the
 * blog it belongs to, so the permalink's host must match the site we are about
 * to authenticate against. A tracked post skips this: its row already names its
 * site.
 *
 * Returns null when the action may proceed, or the sentence to show when it may
 * not.
 */
export function confirmUntrackedSite(
  target: WpPostTarget,
  permalink: string | null | undefined,
  siteUrl: string | null | undefined,
): string | null {
  if (!target.untracked) return null
  if (!target.wpPostId) return describeUnresolvedTarget('unknown', !!permalink)
  if (!permalink) {
    return 'MVP has no record of this post and the page didn’t send its address, so there’s no safe way to tell which blog it’s on. Reload the Posts tab and try again.'
  }
  if (!sameWpHost(permalink, siteUrl)) {
    return `MVP has no record of this post, and it lives on ${hostOfUrl(permalink) || 'another site'} while the connected blog here is ${hostOfUrl(siteUrl) || 'a different one'}. Connect that site in Setup, then try again.`
  }
  return null
}
