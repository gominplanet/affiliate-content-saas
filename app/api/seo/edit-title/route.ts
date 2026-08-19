// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/seo/edit-title  { postId, title }
//
// Manual companion to the AI title fix: set a title by hand right from the SEO
// panel. Updates blog_posts.title + the live WordPress post title, re-scores,
// and persists the new score. No AI, no regeneration.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { scrubAiHtml } from '@/lib/html-scrub'
import { scorePostSeo } from '@/lib/seo-score'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { postId, title } = (await request.json().catch(() => ({}))) as { postId?: string; title?: string }
  const clean = scrubAiHtml((title || '').trim()).replace(/<[^>]+>/g, '').trim().slice(0, 200)
  if (!postId || !clean) return NextResponse.json({ error: 'postId and a title are required' }, { status: 400 })
  if (clean.length < 5) return NextResponse.json({ error: 'That title is too short.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: post } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,content,seo_keyword,post_type,wordpress_post_id,wordpress_site_id')
    .eq('user_id', ownerId).eq('id', postId).maybeSingle()
  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
  if (!post.wordpress_post_id) return NextResponse.json({ error: 'This post isn’t published to WordPress yet.' }, { status: 404 })

  const site = await getWordPressCredentials(supabase, ownerId, (post.wordpress_site_id as string | null) ?? null)
  if (!site) return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)

  // Update the live WP post title, then mirror to blog_posts.
  try {
    await wpService.updatePost(post.wordpress_post_id as number, { title: clean })
  } catch (e) {
    return NextResponse.json({ error: `Couldn’t update the title on WordPress: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 502 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').update({ title: clean }).eq('id', post.id)

  // Re-score with the new title and persist so the panel updates.
  const { score, checks } = scorePostSeo({
    title: clean, contentHtml: (post.content as string) || '', siteHost: wpBase,
    postType: (post.post_type as string) || 'review', seoKeyword: post.seo_keyword as string | null,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await (supabase as any).from('post_seo').update({ seo_score: score, score_detail: checks, checked_at: new Date().toISOString() }).eq('post_id', post.id) } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, title: clean, score })
}
