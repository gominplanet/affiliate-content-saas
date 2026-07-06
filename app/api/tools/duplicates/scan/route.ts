/**
 * POST /api/tools/duplicates/scan
 *
 * Finds DUPLICATE / near-duplicate published posts — the "same product reviewed
 * twice" problem that shows up in Search Console as "Crawled – currently not
 * indexed" + self-cannibalization + a pile of 404s once the extras get deleted.
 * (WordPress appends `-2`/`-3` to a colliding slug.)
 *
 * Reads from WORDPRESS directly (the source of truth for what Google sees) — NOT
 * just the ~200 posts MVP tracks in blog_posts. That matters: a site can have far
 * more live posts than MVP's DB knows about, and their DB records may be missing
 * or unpaired, so a DB-only scan misses most dupes. We enrich each live post with
 * MVP's DB (indexed state, in-article image count, source video) where available,
 * and fall back to a DB-only scan if the WordPress REST API can't be read.
 *
 * Two high-confidence signals (no fuzzy title matching → no false positives):
 *   1. duplicate-slug — 2+ posts sharing a base slug after stripping a trailing
 *                       `-<number>` (WP's collision suffix).
 *   2. same-video     — 2+ posts MVP generated from the same youtube_videos row.
 *
 * Read-only. Suggests a keeper (indexed > original slug > oldest > most images);
 * the one-click merge (301 the extras → keeper, trash them) is a separate action.
 *
 * Access: Creator+ (trial has ≤5 lifetime posts). Owner-scoped.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 60

interface NPost {
  id: string                 // stable React key: 'wp-<id>' or the blog_posts id
  wordpressPostId: number | null
  wordpressSiteId: string | null
  blogPostId: string | null
  videoId: string | null
  title: string
  url: string
  slug: string
  createdAt: string | null
  bodyImages: number
  indexed: boolean
  hasSuffix: boolean
  isKeeperSuggested: boolean
}
interface DupGroup {
  key: string
  reason: 'same-video' | 'duplicate-slug'
  keeperId: string
  posts: NPost[]
}

function slugOf(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return (parts[parts.length - 1] || '').toLowerCase()
  } catch { return '' }
}
function baseSlug(slug: string): { base: string; hasSuffix: boolean } {
  const m = slug.match(/^(.+)-(\d+)$/)
  return m ? { base: m[1], hasSuffix: true } : { base: slug, hasSuffix: false }
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
    const tier = normalizeTier((tierRow?.tier as Tier) ?? 'trial')
    if (tier === 'trial') {
      return NextResponse.json({ error: 'Upgrade to Creator or higher to scan for duplicate posts.' }, { status: 403 })
    }

    // ── MVP's own records — used to ENRICH the live WP posts (indexed state,
    //    image count, source video) and for the DB-only fallback. ────────────
    type Row = { id: string; video_id: string | null; wordpress_url: string | null; title: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null; created_at: string | null; body_images_count: number | null }
    const rows: Row[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('blog_posts') as any)
        .select('id,video_id,wordpress_url,title,wordpress_post_id,wordpress_site_id,created_at,body_images_count')
        .eq('user_id', ownerId)
        .eq('status', 'published')
        .range(from, from + PAGE - 1)
      if (error) break
      const chunk = (data as Row[]) ?? []
      rows.push(...chunk)
      if (chunk.length < PAGE || rows.length >= 5000) break
    }
    const byWpId = new Map<number, Row>()
    for (const r of rows) if (typeof r.wordpress_post_id === 'number') byWpId.set(r.wordpress_post_id, r)

    // Which blog_posts Google has indexed (post_seo) → prefer the indexed keeper.
    const indexedBlogIds = new Set<string>()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: seo } = await (supabase.from('post_seo') as any)
        .select('post_id,indexed_state').eq('user_id', ownerId)
      for (const s of (seo as { post_id: string; indexed_state: string | null }[]) || []) {
        if (s.indexed_state && /index/i.test(s.indexed_state) && !/not/i.test(s.indexed_state)) indexedBlogIds.add(s.post_id)
      }
    } catch { /* no seo cache → keeper falls back to slug/date heuristics */ }

    // ── Read the LIVE posts from WordPress (source of truth). ────────────────
    let live: Array<{ id: number; slug: string; link: string; title: string; date: string | null }> = []
    let source: 'wordpress' | 'database' = 'database'
    try {
      const creds = await getWordPressCredentials(supabase, ownerId)
      if (creds) {
        const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
        live = await wp.getPublishedPostsBrief()
        if (live.length > 0) source = 'wordpress'
      }
    } catch { /* fall back to DB-only below */ }

    // Build the normalized post list. WordPress-authoritative when we could read
    // it; otherwise MVP's blog_posts (so the tool still works for content-only /
    // BYO-theme users, or a transient WP read failure).
    const posts: NPost[] = source === 'wordpress'
      ? live.map(p => {
          const b = byWpId.get(p.id)
          const slug = p.slug || slugOf(p.link)
          return {
            id: `wp-${p.id}`,
            wordpressPostId: p.id,
            wordpressSiteId: b?.wordpress_site_id ?? null,
            blogPostId: b?.id ?? null,
            videoId: b?.video_id ?? null,
            title: p.title || b?.title || slug || '(untitled)',
            url: p.link || (b?.wordpress_url ?? ''),
            slug,
            createdAt: p.date || b?.created_at || null,
            bodyImages: b?.body_images_count ?? 0,
            indexed: b?.id ? indexedBlogIds.has(b.id) : false,
            hasSuffix: baseSlug(slug).hasSuffix,
            isKeeperSuggested: false,
          }
        })
      : rows.filter(r => r.wordpress_url).map(r => {
          const slug = slugOf(r.wordpress_url as string)
          return {
            id: r.id,
            wordpressPostId: r.wordpress_post_id ?? null,
            wordpressSiteId: r.wordpress_site_id ?? null,
            blogPostId: r.id,
            videoId: r.video_id,
            title: r.title || slug || '(untitled)',
            url: r.wordpress_url as string,
            slug,
            createdAt: r.created_at,
            bodyImages: r.body_images_count ?? 0,
            indexed: indexedBlogIds.has(r.id),
            hasSuffix: baseSlug(slug).hasSuffix,
            isKeeperSuggested: false,
          }
        })

    if (posts.length === 0) return NextResponse.json({ ok: true, groups: [], scanned: 0, source })

    // ── Group by both signals, union overlapping ones ────────────────────────
    const bySlugBase = new Map<string, NPost[]>()
    const byVideo = new Map<string, NPost[]>()
    for (const p of posts) {
      const { base } = baseSlug(p.slug)
      if (base) { const a = bySlugBase.get(base) || []; a.push(p); bySlugBase.set(base, a) }
      if (p.videoId) { const a = byVideo.get(p.videoId) || []; a.push(p); byVideo.set(p.videoId, a) }
    }
    const parent = new Map<string, string>()
    const find = (x: string): string => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p) } return p }
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
    for (const p of posts) parent.set(p.id, p.id)
    const groupReason = new Map<string, 'same-video' | 'duplicate-slug'>()
    const link = (members: NPost[], reason: 'same-video' | 'duplicate-slug') => {
      if (members.length < 2) return
      for (let i = 1; i < members.length; i++) union(members[0].id, members[i].id)
      const root = find(members[0].id)
      if (reason === 'duplicate-slug' || !groupReason.has(root)) groupReason.set(root, reason)
    }
    for (const m of bySlugBase.values()) link(m, 'duplicate-slug')
    for (const m of byVideo.values()) link(m, 'same-video')

    const buckets = new Map<string, NPost[]>()
    for (const p of posts) { const root = find(p.id); const a = buckets.get(root) || []; a.push(p); buckets.set(root, a) }

    const groups: DupGroup[] = []
    for (const [root, members] of buckets) {
      if (members.length < 2) continue
      const keeper = [...members].sort((a, b) =>
        (Number(b.indexed) - Number(a.indexed))
        || (Number(a.hasSuffix) - Number(b.hasSuffix))
        || ((a.createdAt || '').localeCompare(b.createdAt || ''))
        || (b.bodyImages - a.bodyImages)
      )[0]
      keeper.isKeeperSuggested = true
      members.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      groups.push({ key: root, reason: groupReason.get(root) || 'duplicate-slug', keeperId: keeper.id, posts: members })
    }
    groups.sort((a, b) =>
      (a.reason === b.reason ? 0 : a.reason === 'duplicate-slug' ? -1 : 1)
      || (b.posts.length - a.posts.length)
    )

    const extraCount = groups.reduce((n, g) => n + (g.posts.length - 1), 0)
    return NextResponse.json({ ok: true, groups, scanned: posts.length, groupCount: groups.length, extraCount, source })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Scan failed' }, { status: 500 })
  }
}
