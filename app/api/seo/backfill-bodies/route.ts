/**
 * POST /api/seo/backfill-bodies
 *
 * One-time repair for legacy/imported posts that are live on WordPress but have
 * an empty blog_posts.content. The SEO overview scores the STORED body, so these
 * rows show a misleading near-zero score (and the auto-fixer can't run on them).
 *
 * This pulls the live body straight from WordPress for every such post and
 * backfills blog_posts.content. The overview scores fresh from blog_posts.content
 * on the next load, so once a post is backfilled its score reads true — no
 * post_seo write needed here. Idempotent: posts that already have a body are
 * skipped, so the user can run it as many times as they like.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService, type WordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 120

// Bound per run so a creator with hundreds of legacy posts never blows the
// function budget — they just run it again to finish the rest. Concurrency is
// capped so we don't hammer the WordPress REST API.
const MAX_PER_RUN = 200
const CONCURRENCY = 6
const DEFAULT_SITE_KEY = '__default__'

type Candidate = {
  id: string
  title: string | null
  content: string | null
  wordpress_post_id: number | null
  wordpress_site_id: string | null
}

export async function POST() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // Every published post; we filter to the empty-body ones in JS (Supabase's
  // null-OR-empty filter is awkward and this list is already capped elsewhere).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await supabase
    .from('blog_posts')
    .select('id,title,content,wordpress_post_id,wordpress_site_id')
    .eq('user_id', ownerId)
    .not('wordpress_post_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(800)
  const all = (rows as Candidate[] | null) ?? []
  const empties = all.filter(p => p.wordpress_post_id != null && (!p.content || !String(p.content).trim()))
  const scanned = empties.length
  const batch = empties.slice(0, MAX_PER_RUN)
  if (batch.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, backfilled: 0, failed: 0, remaining: 0 })
  }

  // Resolve a WordPress service per distinct site once (most users have one).
  const serviceCache = new Map<string, WordPressService | null>()
  async function serviceFor(siteId: string | null): Promise<WordPressService | null> {
    const key = siteId ?? DEFAULT_SITE_KEY
    if (serviceCache.has(key)) return serviceCache.get(key) ?? null
    const creds = await getWordPressCredentials(supabase, ownerId, siteId)
    const svc = creds
      ? createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
      : null
    serviceCache.set(key, svc)
    return svc
  }

  let backfilled = 0
  let failed = 0

  // Simple concurrency-limited pass over the batch.
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(slice.map(async (p) => {
      const svc = await serviceFor(p.wordpress_site_id)
      if (!svc || p.wordpress_post_id == null) return false
      const live = await svc.getPostContent(p.wordpress_post_id)
      if (!live || !live.content.trim()) return false
      const update: { content: string; title?: string } = { content: live.content }
      if (!p.title || !p.title.trim()) update.title = live.title
      await supabase.from('blog_posts').update(update).eq('id', p.id)
      return true
    }))
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) backfilled++
      else failed++
    }
  }

  return NextResponse.json({
    ok: true,
    scanned,
    backfilled,
    failed,
    remaining: Math.max(0, scanned - batch.length),
  })
}
