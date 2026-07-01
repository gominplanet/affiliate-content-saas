/**
 * POST /api/admin/repair-blocks — admin-only.
 *
 * Repairs Gutenberg block comments corrupted by the old em-dash scrub
 * (see lib/repair-blocks.ts). Surgical: only rewrites spans that look like
 * corrupted block delimiters, so it preserves the post's content + edits and
 * is safe on already-clean posts.
 *
 * Body:
 *   { userId, slugs?: string[], postIds?: number[], siteId?, dryRun? }
 *   - userId  (required): the creator whose WP site holds the post(s).
 *   - slugs / postIds: which posts to repair (give at least one).
 *   - siteId  (optional): a specific connected site; defaults to their default.
 *   - dryRun  (optional): count corruption + report, but DON'T write.
 *
 * Returns per-post { postId, before, after, changed }.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { tryWpProxy } from '@/lib/wp-proxy'
import { repairCorruptedBlocks, countCorruptedMarkers } from '@/lib/repair-blocks'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin gate (same pattern as the other admin routes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    userId?: string; slugs?: string[]; postIds?: number[]; siteId?: string | null; dryRun?: boolean
  }
  const userId = (body.userId || '').trim()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // Per-request results (function-local — never share across requests).
  const results: Array<{ postId: number; slug?: string; before: number; after: number; changed: boolean; error?: string }> = []

  // Service-role client for the cross-user site lookup — the caller's session
  // client is RLS-scoped to the ADMIN's own rows, so it can't see Lisa's site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const site = await getWordPressCredentials(admin, userId, body.siteId ?? null)
  if (!site) return NextResponse.json({ error: 'No WordPress site found for that user' }, { status: 404 })

  const wp = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  // Resolve the target post ids (from explicit ids and/or slugs).
  const ids = new Set<number>()
  for (const id of body.postIds ?? []) if (Number.isFinite(id)) ids.add(Number(id))
  for (const slug of body.slugs ?? []) {
    const s = String(slug || '').trim().replace(/^\/+|\/+$/g, '')
    if (!s) continue
    try {
      const id = await wp.getPostIdBySlug(s)
      if (id) ids.add(id)
      else results.push({ postId: 0, slug: s, before: 0, after: 0, changed: false, error: 'slug not found on site' })
    } catch {
      results.push({ postId: 0, slug: s, before: 0, after: 0, changed: false, error: 'slug lookup failed' })
    }
  }
  if (ids.size === 0 && results.length === 0) {
    return NextResponse.json({ error: 'Provide slugs[] or postIds[] to repair' }, { status: 400 })
  }

  // Read RAW post content. Prefer the plugin's body-auth proxy — it dispatches
  // the REST call server-side with admin context, so it's WAF-proof AND returns
  // content.raw (the stored HTML with the literal `<!,` markers). The service
  // reader falls back to an UNauthenticated view on hosts that strip auth
  // headers, which returns RENDERED content (markers escaped as `&lt;!,`) — we
  // must never repair + write that back, so we detect it and refuse.
  const siteUrl = site.wordpress_url
  const proxySecret = site.wordpress_api_token
  async function readRawContent(postId: number): Promise<{ content: string; viaProxy: boolean } | null> {
    const px = await tryWpProxy({
      siteUrl,
      proxySecret,
      innerPath: `/wp/v2/posts/${postId}`,
      method: 'GET',
      query: { context: 'edit', _fields: 'content' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFromProxy = px?.ok ? (px.data as any)?.content?.raw : undefined
    if (typeof rawFromProxy === 'string' && rawFromProxy) return { content: rawFromProxy, viaProxy: true }
    const got = await wp.getPostContent(postId)
    return got ? { content: got.content, viaProxy: false } : null
  }

  let anyRepaired = false
  for (const postId of ids) {
    try {
      const got = await readRawContent(postId)
      if (!got) { results.push({ postId, before: 0, after: 0, changed: false, error: 'could not read post' }); continue }
      const before = countCorruptedMarkers(got.content)
      // We only got RENDERED content (escaped markers) — raw is unavailable, so
      // we can't safely repair this post here. Use Rebuild for it instead.
      if (before === 0 && /&lt;!,/.test(got.content)) {
        results.push({ postId, before: 0, after: 0, changed: false, error: 'raw content unavailable (only rendered) — repair blocked; use Rebuild for this post' })
        continue
      }
      if (before === 0) { results.push({ postId, before: 0, after: 0, changed: false }); continue }
      const repaired = repairCorruptedBlocks(got.content)
      const after = countCorruptedMarkers(repaired)
      if (!body.dryRun) {
        await wp.updatePost(postId, { content: repaired })
        anyRepaired = true
      }
      results.push({ postId, before, after, changed: !body.dryRun })
    } catch (err) {
      results.push({ postId, before: 0, after: 0, changed: false, error: err instanceof Error ? err.message : 'repair failed' })
    }
  }

  // Bust page cache so the fixed post shows immediately (best-effort).
  if (anyRepaired) { try { await wp.purgeCache() } catch { /* non-fatal */ } }

  return NextResponse.json({ ok: true, dryRun: !!body.dryRun, results })
}
