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
import { describeRehost } from '@/lib/rehost-images'
import { rehostPosts, describeRun, defaultSourceAlive, makeOgImageFollower } from '@/lib/rehost-run'

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

  // The repair loop itself lives in lib/rehost-run, shared with the
  // /api/cron/rehost-hotlinked sweep. Two callers doing this job from two
  // copies of the logic is exactly how /api/blog/refresh-images came to
  // disagree with /api/blog/generate about what "ready" means.
  const run = await rehostPosts(posts, site.wordpress_url, {
    uploadFromUrl: async (url, filename) => (await wp.uploadImageFromUrl(url, filename))?.source_url ?? null,
    updatePost: async (id, content) => { await wp.updatePost(id, { content }) },
    saveContent: async (postId, content, hostedCount, status) => {
      try {
        await client.from('blog_posts').update({ content, images_hosted_count: hostedCount, images_status: status }).eq('id', postId)
      } catch {
        // images_hosted_count needs migration 339. Keep the content write,
        // which is the part that matters, rather than losing the whole update.
        await client.from('blog_posts').update({ content }).eq('id', postId)
      }
    },
    sourceAlive: defaultSourceAlive,
    afterMoved: makeOgImageFollower(wp),
  })

  const moved = run.moved
  const attempted = run.attempted
  const failed = run.failures
  const perPost = run.posts

  const report = describeRehost(moved, failed, attempted)

  return NextResponse.json({
    ok: true,
    ...report,
    // The runner's own words, which say the three things the old shape could
    // not: nothing moved because the site refused everything, some originals
    // are gone and need remaking, or it genuinely worked.
    summary: describeRun(run, posts.length),
    refused: run.refused,
    gone: run.gone,
    siteRefusedEverything: run.siteRefusedEverything,
    site: site.wordpress_url,
    postsExamined: posts.length,
    posts: perPost,
    // Named so a second run is an obvious next step rather than a guess.
    moreLikely: posts.length === limit,
  })
}
