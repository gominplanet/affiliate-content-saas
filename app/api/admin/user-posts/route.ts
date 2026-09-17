// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET    /api/admin/user-posts?userId=…   list a creator's recent posts
// DELETE /api/admin/user-posts            remove specific ones for them
//
// WHY THIS EXISTS.
//
// A campaign retry published four duplicate posts for a creator. MVP's own
// delete is scoped to the caller, so the only person who could clean up our bug
// was the person it happened to, and he had to do it in the right place or it
// would cost him his monthly allowance:
//
//   the allowance is COUNT(blog_posts) in the billing window, not a counter
//
// so deleting in WP admin takes the post off his site and leaves the row, and
// the slot stays spent. Deleting inside MVP removes both and returns it. That
// is not something a customer should have to know.
//
// FOUR OUTCOMES, KEPT APART. The tempting shortcut is to delete our row
// whatever WordPress says, which is what the creator-facing route does. For an
// admin cleaning up our own mess that is the wrong trade: a row deleted while
// the post is still live leaves an article on their site that MVP no longer
// knows about, and reports a freed slot for a post their readers can still see.
//
//   removed        gone from the site and from MVP. Slot returned.
//   already gone   WordPress says the post does not exist, so the row was a
//                  stale record. Cleared, slot returned.
//   never live     no WordPress id on record. Cleared, slot returned.
//   refused        WordPress would not delete it, so NOTHING was changed here
//                  either and our record still matches what is published.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { isStalePostError } from '@/lib/wp-errors'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_DELETE_PER_CALL = 25

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(): Promise<{ admin: any } | { error: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((caller as any)?.tier !== 'admin') {
    return { error: NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 }) }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: createAdminClient() as any }
}

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { admin } = gate

  const userId = new URL(request.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 })

  try {
    const { data, error } = await admin
      .from('blog_posts')
      .select('id,title,wordpress_post_id,wordpress_url,created_at,published_at,status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) throw error

    return NextResponse.json({ ok: true, posts: data ?? [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'lookup failed' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { admin } = gate

  const body = await request.json().catch(() => ({})) as { userId?: string; postIds?: string[] }
  const userId = body.userId
  const postIds = Array.isArray(body.postIds) ? body.postIds.slice(0, MAX_DELETE_PER_CALL) : []
  if (!userId || postIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'userId and postIds required' }, { status: 400 })
  }

  // Scoped to the named creator as well as the ids. An id from one account must
  // never reach another's post because a request said so.
  const { data: rows, error } = await admin
    .from('blog_posts')
    .select('id,title,wordpress_post_id,wordpress_site_id')
    .eq('user_id', userId)
    .in('id', postIds)
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  type Row = { id: string; title: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null }
  const posts = (rows ?? []) as Row[]

  const results: Array<{ id: string; title: string; outcome: string; detail: string; freedSlot: boolean }> = []

  for (const post of posts) {
    const title = post.title ?? 'Untitled'

    // No WordPress id: nothing was ever published, so the row is all there is.
    if (!post.wordpress_post_id) {
      await clearRow(admin, userId, post.id)
      results.push({ id: post.id, title, outcome: 'never live', detail: 'It was never published, so only the MVP record needed clearing.', freedSlot: true })
      continue
    }

    // Route the delete to the site this post actually lives on. A post id only
    // means something inside one blog, and a creator can have several.
    let site: Awaited<ReturnType<typeof getWordPressCredentials>> = null
    try {
      site = await getWordPressCredentials(admin, userId, post.wordpress_site_id ?? undefined, { skipCapGuard: true })
    } catch { /* handled below */ }

    if (!site?.wordpress_url) {
      results.push({
        id: post.id, title, outcome: 'refused',
        detail: 'That blog is not connected, so the post cannot be removed from the site. Nothing was changed in MVP either.',
        freedSlot: false,
      })
      continue
    }

    const wp = createWordPressService(
      site.wordpress_url,
      site.wordpress_username,
      site.wordpress_app_password,
      site.wordpress_api_token || undefined,
    )

    try {
      await wp.deletePost(post.wordpress_post_id)
      await clearRow(admin, userId, post.id)
      results.push({ id: post.id, title, outcome: 'removed', detail: `Deleted from ${site.wordpress_url} and from MVP.`, freedSlot: true })
    } catch (e) {
      // Already gone on their side. The row was a stale record and clearing it
      // is the whole job.
      if (isStalePostError(e)) {
        await clearRow(admin, userId, post.id)
        results.push({ id: post.id, title, outcome: 'already gone', detail: 'It had already been deleted on WordPress, so the stale MVP record was cleared.', freedSlot: true })
        continue
      }
      // Anything else: leave OUR row alone. Deleting it would report a freed
      // slot for a post their readers can still see, and leave an article on
      // their site MVP no longer knows about.
      results.push({
        id: post.id, title, outcome: 'refused',
        detail: `WordPress would not delete it: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}. Nothing was changed in MVP either, so the record still matches what is published.`,
        freedSlot: false,
      })
    }
  }

  const freed = results.filter(r => r.freedSlot).length
  const refused = results.filter(r => r.outcome === 'refused').length

  return NextResponse.json({
    ok: true,
    results,
    freed,
    refused,
    // Says what happened including when that is nothing, and never rounds a
    // refusal up into a success.
    summary: freed === 0
      ? `Nothing was deleted. ${refused} could not be removed from the site, so their MVP records were left alone too.`
      : `${freed} post${freed === 1 ? '' : 's'} removed, so ${freed === 1 ? 'that slot is' : 'those slots are'} back on their monthly allowance${refused > 0 ? `. ${refused} could not be removed and ${refused === 1 ? 'was' : 'were'} left untouched` : ''}.`,
  })
}

/** Cancel anything still queued for this post, then drop the row. The queue
 *  first: a social push that fires after the post is gone shows up in the
 *  creator's Recent activity as a failure they did not cause. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearRow(admin: any, userId: string, postId: string): Promise<void> {
  try {
    await admin.from('scheduled_posts').delete()
      .eq('blog_post_id', postId).eq('user_id', userId).eq('status', 'pending')
  } catch { /* the row delete below is the part that matters */ }
  await admin.from('blog_posts').delete().eq('id', postId).eq('user_id', userId)
}
