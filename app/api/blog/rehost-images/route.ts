// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/rehost-images
//
// Move pictures that are sitting on MVP's generation CDN onto the creator's own
// site, and rewrite their posts to point at the copies.
//
// When a site refuses a media upload the generator embeds the URL it generated
// the picture from, so the article still reads properly. Six creators are
// carrying 186 posts in that state. fal's documentation is explicit that
// expired files are deleted and cannot be recovered, retention is listed as
// "Configurable" with no published default, and MVP does not send the lifecycle
// header, so nobody can say how long those posts have.
//
// This is a REPAIR, not a regeneration. It downloads the picture that already
// exists and uploads that same file, so there is no model call and no spend, and
// the article keeps the pictures the creator has already seen.
//
// Body: { siteId?: string|null, limit?: number, postIds?: string[] }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { findRehostable, replaceImageUrl, describeRehost } from '@/lib/rehost-images'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_LIMIT = 15
const MAX_LIMIT = 40

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const body = await request.json().catch(() => ({})) as {
    siteId?: string | null
    limit?: number
    postIds?: string[]
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))

  const site = await getWordPressCredentials(supabase, ownerId, body.siteId ?? undefined)
  if (!site?.wordpress_url) {
    return NextResponse.json({ ok: false, error: 'No WordPress site is connected.' }, { status: 400 })
  }

  const wp = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any

  // Posts whose stored content still points at our CDN. Matched on the stored
  // content rather than on images_status, because images_status only started
  // telling the truth with migration 339 and every post that needs this repair
  // predates it.
  let q = client
    .from('blog_posts')
    .select('id,title,content,wordpress_post_id,wordpress_url')
    .eq('user_id', ownerId)
    .ilike('content', '%fal.media%')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (Array.isArray(body.postIds) && body.postIds.length) q = q.in('id', body.postIds.slice(0, MAX_LIMIT))

  const { data: rows, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const posts = (rows ?? []) as Array<{
    id: string
    title: string | null
    content: string | null
    wordpress_post_id: number | null
    wordpress_url: string | null
  }>

  let moved = 0
  let attempted = 0
  const failed: { url: string; reason: string }[] = []
  const perPost: Array<{ id: string; title: string; moved: number; failed: number; skipped?: string }> = []

  for (const post of posts) {
    const html = post.content ?? ''
    const candidates = findRehostable(html, site.wordpress_url)
    if (candidates.length === 0) {
      perPost.push({ id: post.id, title: post.title ?? '', moved: 0, failed: 0, skipped: 'nothing to move' })
      continue
    }
    if (!post.wordpress_post_id) {
      // Without the WordPress id there is nothing to update, and rewriting only
      // our copy would leave the live post pointing at the old URL while our
      // records claimed it was repaired. Say so rather than half doing it.
      perPost.push({
        id: post.id, title: post.title ?? '', moved: 0, failed: 0,
        skipped: 'no WordPress post id on record, so the live post cannot be updated',
      })
      continue
    }

    let updated = html
    let postMoved = 0

    for (const c of candidates) {
      attempted++
      try {
        const media = await wp.uploadImageFromUrl(c.url, `rehost-${post.id.slice(0, 8)}-${postMoved + 1}.jpg`)
        const newUrl = media?.source_url
        if (!newUrl) {
          failed.push({ url: c.url, reason: 'the site accepted the upload but returned no URL' })
          continue
        }
        updated = replaceImageUrl(updated, c.url, newUrl)
        postMoved++
        moved++
      } catch (e) {
        failed.push({ url: c.url, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
      }
    }

    if (postMoved === 0) {
      perPost.push({ id: post.id, title: post.title ?? '', moved: 0, failed: candidates.length })
      continue
    }

    // Live post FIRST. If the site update fails, our copy is left alone, so the
    // row keeps describing what is actually published. The other order would
    // record a repair that the creator's readers never see, which is the same
    // class of lie that made this repair necessary.
    try {
      await wp.updatePost(post.wordpress_post_id, { content: updated })
    } catch (e) {
      failed.push({
        url: post.wordpress_url ?? post.id,
        reason: `pictures uploaded, but the post could not be updated: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
      })
      perPost.push({ id: post.id, title: post.title ?? '', moved: 0, failed: candidates.length })
      continue
    }

    try {
      await client.from('blog_posts').update({
        content: updated,
        images_hosted_count: postMoved,
        images_status: findRehostable(updated, site.wordpress_url).length === 0 ? 'ready' : 'hotlinked',
      }).eq('id', post.id)
    } catch {
      // images_hosted_count needs migration 339. Keep the content write, which
      // is the part that matters, rather than losing the whole update.
      try {
        await client.from('blog_posts').update({ content: updated }).eq('id', post.id)
      } catch { /* the live post is already correct; our copy catches up later */ }
    }

    perPost.push({ id: post.id, title: post.title ?? '', moved: postMoved, failed: candidates.length - postMoved })
  }

  const report = describeRehost(moved, failed, attempted)

  return NextResponse.json({
    ok: true,
    ...report,
    site: site.wordpress_url,
    postsExamined: posts.length,
    posts: perPost,
    // Named so a second run is an obvious next step rather than a guess.
    moreLikely: posts.length === limit,
  })
}
