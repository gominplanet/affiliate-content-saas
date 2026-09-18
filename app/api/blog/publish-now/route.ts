/**
 * POST /api/blog/publish-now — publish a post WordPress was supposed to publish
 * and did not.
 *
 * WHY THIS EXISTS. Most MVP posts are scheduled "wp-native": created with
 * status=future and a date, left for WordPress's own cron to publish. WP-Cron
 * only runs when somebody loads the site, so a new blog with no traffic can sit
 * on a scheduled post indefinitely. WordPress calls this a missed schedule.
 *
 * MVP never checked. blog/generate states the assumption plainly — "the 'is it
 * live yet?' question is answered by scheduled_for being in the past" — and the
 * schedule list dropped a post the moment its time passed, so the creator saw an
 * empty schedule, a Library row that said published, and an unpublished post in
 * WP Admin. Reported 17 Sep by a creator who had gone looking in Hostinger to
 * find out what MVP would not tell him.
 *
 * The list now reports those posts. This is the button beside the report: one
 * PATCH to status=publish, the same call the draft-flip cron makes.
 *
 * Body: { blogPostId: string }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { isStalePostError } from '@/lib/wp-errors'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { blogPostId?: string }
    const blogPostId = String(body.blogPostId || '').trim()
    if (!blogPostId) return NextResponse.json({ error: 'blogPostId is required.' }, { status: 400 })

    // Read through the SESSION client, so RLS scopes this to the creator's own
    // posts. Publishing is a write to someone's live website; it is never done
    // on behalf of an id supplied by a caller without that check.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,wordpress_post_id,wordpress_site_id,wordpress_url,scheduled_for')
      .eq('user_id', user.id)
      .eq('id', blogPostId)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
    if (!post.wordpress_post_id) {
      return NextResponse.json({
        error: 'This post was never created on your WordPress site, so there is nothing to publish. Re-generate it from its video.',
      }, { status: 400 })
    }

    const creds = await getWordPressCredentials(supabase, user.id, post.wordpress_site_id ?? null)
    if (!creds) {
      return NextResponse.json({
        error: 'Your WordPress details could not be read, so nothing was published. Reconnect your site under Blog Set Up, then try again.',
      }, { status: 400 })
    }
    const wp = createWordPressService(
      creds.wordpress_url, creds.wordpress_username,
      creds.wordpress_app_password, creds.wordpress_api_token || undefined,
    )

    let updated
    try {
      // Clearing the date alongside the status matters. A post still carrying a
      // FUTURE date with status=publish is one WordPress can re-file as
      // scheduled, which would put the creator straight back where they started.
      updated = await wp.updatePost(post.wordpress_post_id, {
        status: 'publish',
        date: new Date().toISOString(),
      } as never)
    } catch (err) {
      if (isStalePostError(err)) {
        return NextResponse.json({
          error: 'That post no longer exists on your WordPress site, so it could not be published. Re-generate it from its video.',
        }, { status: 400 })
      }
      return NextResponse.json({
        error: `WordPress refused to publish it: ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 502 })
    }

    // VERIFY, rather than assume. Assuming is the entire bug this route exists
    // to clean up after, so a 200 from the PATCH is not the answer: the answer
    // is what WordPress says the post's status is now.
    const statuses = await wp.getPostStatuses([post.wordpress_post_id])
    const nowStatus = statuses?.get(post.wordpress_post_id) ?? null
    if (statuses && nowStatus !== 'publish') {
      return NextResponse.json({
        error: nowStatus
          ? `WordPress accepted the change but still reports this post as "${nowStatus}". A security plugin may be blocking the update. Run the connection doctor under Blog Set Up.`
          : 'WordPress accepted the change but will no longer return this post.',
      }, { status: 502 })
    }

    // Persist the clean permalink now that it is live: before publishing,
    // WordPress reports the ?p=123 form.
    const freshLink = (updated?.link || '').trim()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, unknown> = { scheduled_for: null }
    if (freshLink && freshLink !== post.wordpress_url) patch.wordpress_url = freshLink
    // scheduled_for is cleared so the post stops being reported as overdue.
    // Stripped and retried without it if migration 104 never ran, because a
    // missing column must not turn a successful publish into an error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any).from('blog_posts').update(patch).eq('id', post.id)
    if (upErr && /column .* does not exist/i.test(upErr.message || '')) {
      delete patch.scheduled_for
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (Object.keys(patch).length) await (supabase as any).from('blog_posts').update(patch).eq('id', post.id)
    }

    return NextResponse.json({
      ok: true,
      url: freshLink || post.wordpress_url || null,
      verified: statuses !== null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
