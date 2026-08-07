/**
 * GET /api/blog/scheduled-list
 *
 * Returns the user's pending scheduled social posts (oldest-due first),
 * plus the 20 most recent completed/failed ones for history.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `kind` + `parent_id` were added in migration 103. We select them with
  // an `as any` cast to bypass the supabase-generated types until the
  // codegen step runs. The UI uses kind='blog_publish' to render those
  // rows as the "WP publish" entry above their child social rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // video_id + youtube_videos join (migration 138) give vertical Short-direct
  // rows a title. Try the richer select first; if the columns aren't there yet
  // (pre-138 DB), fall back to the original so the list keeps working.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data, error } = await (supabase as any)
    .from('scheduled_posts')
    .select('id,blog_post_id,video_id,kind,parent_id,platform,scheduled_at,body_text,status,attempts,error_message,external_id,created_at,blog_posts(title,wordpress_url),youtube_videos(title)')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: true })
    .limit(100)
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fb = await (supabase as any)
      .from('scheduled_posts')
      .select('id,blog_post_id,kind,parent_id,platform,scheduled_at,body_text,status,attempts,error_message,external_id,created_at,blog_posts(title,wordpress_url)')
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: true })
      .limit(100)
    data = fb.data; error = fb.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{ blog_post_id: string | null; kind: string | null; platform: string | null; status: string | null }>

  // Which socials will cascade after each blog post publishes — collected from
  // the pending kind='social' rows, keyed by blog_post_id. Used to summarize
  // "then posts to FB, IG, …" on the blog card so the creator can see the whole
  // plan (blog + socials) at a glance.
  const socialByBlog = new Map<string, string[]>()
  for (const r of rows) {
    if (r.kind === 'social' && r.status === 'pending' && r.blog_post_id && r.platform) {
      const arr = socialByBlog.get(r.blog_post_id) ?? []
      if (!arr.includes(r.platform)) arr.push(r.platform)
      socialByBlog.set(r.blog_post_id, arr)
    }
  }

  // ── Also surface SCHEDULED BLOG POSTS themselves ──────────────────────────
  // A blog post scheduled via /api/blog/schedule-publish in wp-native mode
  // (the default) writes NO scheduled_posts row — WordPress publishes it on its
  // own cron — so it never appeared in this list, only its social children did.
  // That's why a creator couldn't see their scheduled posts here. Synthesize a
  // 'blog_publish' entry from blog_posts.scheduled_for (future) so every waiting
  // post shows up. Skip any that already have a real blog_publish row
  // (draft-flip mode) to avoid double-listing.
  const haveBlogPublish = new Set(
    rows.filter((r) => r.kind === 'blog_publish' && r.blog_post_id).map((r) => r.blog_post_id as string),
  )
  const nowIso = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Try selecting the ticked-platforms column (migration 231) too; if the DB
  // doesn't have it yet, fall back to the select without it so the list keeps
  // working. The column holds the socials the creator chose regardless of
  // whether those channels were connected (so the card can name them even when
  // no scheduled_posts child row exists for them).
  let schedBlogs: Array<Record<string, unknown>> | null = null
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const primary = await (supabase as any)
      .from('blog_posts')
      .select('id, title, wordpress_url, video_id, scheduled_for, created_at, scheduled_social_platforms')
      .eq('user_id', user.id)
      .not('scheduled_for', 'is', null)
      .gt('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true })
      .limit(100)
    if (primary.error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fb = await (supabase as any)
        .from('blog_posts')
        .select('id, title, wordpress_url, video_id, scheduled_for, created_at')
        .eq('user_id', user.id)
        .not('scheduled_for', 'is', null)
        .gt('scheduled_for', nowIso)
        .order('scheduled_for', { ascending: true })
        .limit(100)
      schedBlogs = fb.data
    } else {
      schedBlogs = primary.data
    }
  }

  const synthetic = ((schedBlogs ?? []) as Array<{
    id: string; title: string | null; wordpress_url: string | null; video_id: string | null; scheduled_for: string; created_at: string | null; scheduled_social_platforms?: string[] | null
  }>)
    .filter((b) => !haveBlogPublish.has(b.id))
    .map((b) => ({
      id: `bp:${b.id}`,
      blog_post_id: b.id,
      video_id: b.video_id ?? null,
      kind: 'blog_publish' as const,
      parent_id: null,
      platform: null,
      scheduled_at: b.scheduled_for,
      body_text: 'Auto-publishes to your blog at the scheduled time, then any social posts cascade after.',
      status: 'pending' as const,
      attempts: 0,
      error_message: null,
      external_id: null,
      created_at: b.created_at ?? b.scheduled_for,
      blog_posts: { title: b.title, wordpress_url: b.wordpress_url },
      youtube_videos: null,
      // The socials queued to cascade after this post goes live. Union two
      // sources: the actual pending child rows (only exist for CONNECTED
      // platforms) AND the platforms the creator ticked at schedule time
      // (stored on blog_posts.scheduled_social_platforms — survives even for
      // channels that weren't connected). The ticked list is the reliable one
      // for showing "what did I schedule"; the child rows just confirm they're
      // actually queued. Dedupe so a connected+ticked platform shows once.
      cascade: [...new Set([
        ...(socialByBlog.get(b.id) ?? []),
        ...((b.scheduled_social_platforms ?? []).filter((p): p is string => typeof p === 'string' && !!p)),
      ])],
      // Managed from the Video-to-Blog tab (there's no scheduled_posts row to
      // cancel here) — the UI hides the Cancel action for these.
      synthetic: true,
    }))

  // Attach the same cascade summary to any REAL blog_publish rows (draft-flip).
  const withCascade = (data ?? []).map((d: { kind?: string | null; blog_post_id?: string | null }) =>
    d.kind === 'blog_publish' && d.blog_post_id
      ? { ...d, cascade: socialByBlog.get(d.blog_post_id) ?? [] }
      : d,
  )

  return NextResponse.json({ scheduled: [...withCascade, ...synthetic] })
}
