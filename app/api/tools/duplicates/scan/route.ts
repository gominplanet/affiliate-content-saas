/**
 * POST /api/tools/duplicates/scan
 *
 * Finds DUPLICATE / near-duplicate published posts — the "same product reviewed
 * twice" problem that shows up in Search Console as "Crawled – currently not
 * indexed" + self-cannibalization + a pile of 404s once the extras get deleted.
 * (MVP's Content page could publish a second post for a video that already had
 * one; WordPress then appends `-2`/`-3` to the colliding slug.)
 *
 * Two high-confidence signals (v1 — no fuzzy title matching yet, so no false
 * positives):
 *   1. same-video   — >1 published post pointing at the same youtube_videos row.
 *   2. duplicate-slug — 2+ posts whose slug shares a base after stripping a
 *                       trailing `-<number>` (WP's collision suffix).
 *
 * Read-only. Returns groups with a SUGGESTED keeper (indexed > original slug >
 * oldest > most images); the caller decides. The one-click merge (301 the extras
 * → keeper, trash them) is a separate, explicit action.
 *
 * Access: Creator+ (trial has ≤5 lifetime posts — nothing to dedupe). Scoped to
 * the owner's posts only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 30

interface DupPost {
  id: string
  title: string
  url: string
  slug: string
  wordpressPostId: number | null
  wordpressSiteId: string | null
  createdAt: string | null
  bodyImages: number
  indexed: boolean          // post_seo says Google has it
  hasSuffix: boolean        // slug ends in -<number>
  isKeeperSuggested: boolean
}
interface DupGroup {
  key: string
  reason: 'same-video' | 'duplicate-slug'
  keeperId: string
  posts: DupPost[]
}

// Last non-empty path segment of a WP URL → the post slug.
function slugOf(url: string): string {
  try {
    const path = new URL(url).pathname
    const parts = path.split('/').filter(Boolean)
    return (parts[parts.length - 1] || '').toLowerCase()
  } catch {
    return ''
  }
}
// Strip a SINGLE trailing "-<number>" (WordPress's slug-collision suffix).
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

    // Pull every published post (paginate past Supabase's 1000-row cap).
    type Row = { id: string; video_id: string | null; wordpress_url: string | null; title: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null; created_at: string | null; body_images_count: number | null }
    const rows: Row[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('blog_posts') as any)
        .select('id,video_id,wordpress_url,title,wordpress_post_id,wordpress_site_id,created_at,body_images_count')
        .eq('user_id', ownerId)
        .eq('status', 'published')
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const chunk = (data as Row[]) ?? []
      rows.push(...chunk)
      if (chunk.length < PAGE) break
      if (rows.length >= 5000) break // safety cap
    }
    const withUrl = rows.filter(r => r.wordpress_url)
    if (withUrl.length === 0) return NextResponse.json({ ok: true, groups: [], scanned: rows.length })

    // Which posts Google actually indexed — used to prefer the indexed keeper.
    const indexedSet = new Set<string>()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: seo } = await (supabase.from('post_seo') as any)
        .select('post_id,indexed_state').eq('user_id', ownerId)
      for (const s of (seo as { post_id: string; indexed_state: string | null }[]) || []) {
        if (s.indexed_state && /index/i.test(s.indexed_state) && !/not/i.test(s.indexed_state)) indexedSet.add(s.post_id)
      }
    } catch { /* no seo cache → keeper falls back to slug/date heuristics */ }

    const toPost = (r: Row): DupPost => {
      const slug = slugOf(r.wordpress_url as string)
      return {
        id: r.id,
        title: r.title || slug || '(untitled)',
        url: r.wordpress_url as string,
        slug,
        wordpressPostId: r.wordpress_post_id ?? null,
        wordpressSiteId: r.wordpress_site_id ?? null,
        createdAt: r.created_at,
        bodyImages: r.body_images_count ?? 0,
        indexed: indexedSet.has(r.id),
        hasSuffix: baseSlug(slug).hasSuffix,
        isKeeperSuggested: false,
      }
    }

    // ── Build groups by both signals, then union overlapping ones ────────────
    const byVideo = new Map<string, Row[]>()
    const bySlugBase = new Map<string, Row[]>()
    for (const r of withUrl) {
      if (r.video_id) { const a = byVideo.get(r.video_id) || []; a.push(r); byVideo.set(r.video_id, a) }
      const { base } = baseSlug(slugOf(r.wordpress_url as string))
      if (base) { const a = bySlugBase.get(base) || []; a.push(r); bySlugBase.set(base, a) }
    }

    // Union-find over post ids so a post caught by BOTH signals lands in one group.
    const parent = new Map<string, string>()
    const find = (x: string): string => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p) } return p }
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
    for (const r of withUrl) parent.set(r.id, r.id)
    const groupReason = new Map<string, 'same-video' | 'duplicate-slug'>()
    const linkGroup = (members: Row[], reason: 'same-video' | 'duplicate-slug') => {
      if (members.length < 2) return
      for (let i = 1; i < members.length; i++) union(members[0].id, members[i].id)
      // Slug duplicates are a stronger "same product" signal than same-video.
      const root = find(members[0].id)
      if (reason === 'duplicate-slug' || !groupReason.has(root)) groupReason.set(root, reason)
    }
    for (const members of byVideo.values()) linkGroup(members, 'same-video')
    for (const members of bySlugBase.values()) linkGroup(members, 'duplicate-slug')

    // Collect groups of size ≥ 2.
    const buckets = new Map<string, Row[]>()
    for (const r of withUrl) { const root = find(r.id); const a = buckets.get(root) || []; a.push(r); buckets.set(root, a) }

    const groups: DupGroup[] = []
    for (const [root, members] of buckets) {
      if (members.length < 2) continue
      const posts = members.map(toPost)
      // Keeper: indexed first, then the original (no -N suffix), then oldest,
      // then the one with the most in-article images.
      const keeper = [...posts].sort((a, b) =>
        (Number(b.indexed) - Number(a.indexed))
        || (Number(a.hasSuffix) - Number(b.hasSuffix))
        || ((a.createdAt || '').localeCompare(b.createdAt || ''))
        || (b.bodyImages - a.bodyImages)
      )[0]
      keeper.isKeeperSuggested = true
      // Newest first for display so the -2/-3 extras sit under the keeper.
      posts.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      groups.push({ key: root, reason: groupReason.get(root) || 'duplicate-slug', keeperId: keeper.id, posts })
    }
    // Slug-duplicate groups first (highest confidence), then by size.
    groups.sort((a, b) =>
      (a.reason === b.reason ? 0 : a.reason === 'duplicate-slug' ? -1 : 1)
      || (b.posts.length - a.posts.length)
    )

    const extraCount = groups.reduce((n, g) => n + (g.posts.length - 1), 0)
    return NextResponse.json({ ok: true, groups, scanned: rows.length, groupCount: groups.length, extraCount })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Scan failed' }, { status: 500 })
  }
}
