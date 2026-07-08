// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/wordpress/repair-blocks — USER-scoped self-service fix.
//
// Repairs Gutenberg block comments corrupted by the old em-dash scrub
// (`<!-- wp:x -->` → `<!, wp:x, >`), which dumps raw block markup as visible
// text on the post. This is the SELF-SERVE twin of the admin sweep
// (/api/admin/repair-blocks): it acts only on the CALLER's own posts, so it
// needs no admin rights and no userId — a "Fix broken formatting" button.
//
// Efficient: the corruption is written at generation time to BOTH WordPress and
// blog_posts, so a stored `<!,` marker ⟺ a live one. We pre-filter the caller's
// own blog_posts rows for the marker to pinpoint exactly the broken posts,
// instead of reading every post on the site.
//
// Edit-safe: for each candidate we repair the LIVE raw content when we can read
// it (preserves any manual WordPress edits), falling back to MVP's stored block
// source only on WAF hosts that return rendered-only HTML. We also clean the
// stored copy so a future re-publish can't reintroduce the corruption.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { tryWpProxy } from '@/lib/wp-proxy'
import { repairCorruptedBlocks, countCorruptedMarkers } from '@/lib/repair-blocks'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { siteId?: string | null; dryRun?: boolean }
  const dryRun = !!body.dryRun

  const site = await getWordPressCredentials(supabase, user.id, body.siteId ?? null)
  if (!site) return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })

  const wp = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  // Candidate posts: the caller's OWN rows whose STORED content still carries the
  // literal `<!,` marker (covers published AND drafts — drafts corrupt on publish).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, content, wordpress_post_id, wordpress_url')
    .eq('user_id', user.id)
    .like('content', '%<!,%')
    .not('wordpress_post_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const candidates = (rows ?? []) as Array<{
    id: string; title: string | null; content: string | null
    wordpress_post_id: number | null; wordpress_url: string | null
  }>

  // Read LIVE raw content — proxy (context=edit) returns the literal markers even
  // on WAF hosts; the direct reader falls back to rendered on hosts that strip
  // auth, which we treat as "unreadable" (never repair rendered HTML in place).
  const siteUrl = site.wordpress_url
  const proxySecret = site.wordpress_api_token
  async function readLiveRaw(postId: number): Promise<string | null> {
    const px = await tryWpProxy({
      siteUrl, proxySecret,
      innerPath: `/wp/v2/posts/${postId}`, method: 'GET',
      query: { context: 'edit', _fields: 'content' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = px?.ok ? (px.data as any)?.content?.raw : undefined
    if (typeof raw === 'string' && raw && !/&lt;!,/.test(raw)) return raw
    const got = await wp.getPostContent(postId)
    // getPostContent may return rendered HTML on WAF hosts (markers escaped) —
    // reject that so we don't flatten blocks; the stored source repairs cleanly.
    if (got?.content && !/&lt;!,/.test(got.content)) return got.content
    return null
  }

  const results: Array<{ postId: number; link: string; before: number; updated: boolean }> = []
  let postsUpdated = 0
  let markersFound = 0

  for (const c of candidates) {
    const postId = c.wordpress_post_id as number
    const stored = c.content || ''
    const storedBefore = countCorruptedMarkers(stored)
    try {
      const live = await readLiveRaw(postId)
      const liveBefore = live ? countCorruptedMarkers(live) : 0

      let wpBefore = 0
      let wroteWp = false
      if (liveBefore > 0) {
        // Repair the LIVE content in place — preserves manual edits.
        wpBefore = liveBefore
        if (!dryRun) { await wp.updatePost(postId, { content: repairCorruptedBlocks(live as string) }); wroteWp = true }
      } else if (live === null && storedBefore > 0) {
        // Live content unreadable (WAF rendered-only) but the post is corrupt —
        // push the repaired stored block source.
        wpBefore = storedBefore
        if (!dryRun) { await wp.updatePost(postId, { content: repairCorruptedBlocks(stored) }); wroteWp = true }
      }
      // Clean the stored copy too, so a rebuild / re-publish can't reintroduce it.
      if (storedBefore > 0 && !dryRun) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('blog_posts').update({ content: repairCorruptedBlocks(stored) }).eq('id', c.id)
      }

      const before = Math.max(wpBefore, storedBefore)
      if (before > 0) {
        markersFound += before
        if (wroteWp) postsUpdated++
        results.push({ postId, link: c.wordpress_url || '', before, updated: wroteWp })
      }
    } catch {
      results.push({ postId, link: c.wordpress_url || '', before: storedBefore, updated: false })
    }
  }

  // Bust the page cache so the fixed posts show immediately (best-effort).
  if (postsUpdated > 0) { try { await wp.purgeCache() } catch { /* non-fatal */ } }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned: candidates.length,
    postsWithIssues: results.length,
    markersFound,
    postsUpdated,
    posts: results,
  })
}
