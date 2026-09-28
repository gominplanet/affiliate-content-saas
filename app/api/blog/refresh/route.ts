// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/blog/refresh — review posts due a first-hand update (lib/post-refresh.ts).
//
// GET                                       posts due, and updates made in the last 30 days
// POST { action: 'update', postId, note }   add the creator's line to the post on WordPress
// POST { action: 'snooze', postId }         nothing new yet: ask again in 90 days
//
// LABS, admin only while it is tested (lib/labs-preview.ts post_refresh).
// Needs migration 384; without it GET says so rather than showing nothing due.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { isStalePostError } from '@/lib/wp-errors'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { pickRelatedPosts, renderRelatedLinksBlock, insertRelatedLinks, type LinkCandidate } from '@/lib/internal-links'
import { REFRESH_AFTER_DAYS, cleanRefreshNote, sinceLabel, refreshedBody, withFreshRelated } from '@/lib/post-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REFRESH_TYPES = ['review', 'comparison']
const DAY = 86_400_000
const missingColumn = (m?: string) => /refreshed_at|refresh_note|refresh_snoozed_until/.test(m || '') && /does not exist|could not find/i.test(m || '')

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('post_refresh', intg?.tier)) return { error: NextResponse.json({ error: 'Post updates are still being tested.' }, { status: 403 }) }
  return { ownerId }
}

interface Row {
  id: string; title: string | null; wordpress_url: string | null; wordpress_post_id: number | null
  wordpress_site_id: string | null; published_at: string | null; post_type: string | null
  seo_keyword: string | null; refreshed_at: string | null; refresh_note: string | null; refresh_snoozed_until: string | null
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const now = Date.now()
  const cutoff = new Date(now - REFRESH_AFTER_DAYS * DAY).toISOString()
  const { data, error } = await admin.from('blog_posts')
    .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id,published_at,post_type,seo_keyword,refreshed_at,refresh_note,refresh_snoozed_until')
    .eq('user_id', g.ownerId).eq('status', 'published').not('wordpress_post_id', 'is', null)
    .in('post_type', REFRESH_TYPES).lte('published_at', cutoff)
    .order('published_at', { ascending: true }).limit(500)
  if (error) {
    if (missingColumn(error.message)) return NextResponse.json({ needsMigration: 384, due: [], dueCount: 0, recent: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const rows = (data ?? []) as Row[]
  const due = rows.filter((r) =>
    (!r.refreshed_at || r.refreshed_at <= cutoff) &&
    (!r.refresh_snoozed_until || new Date(r.refresh_snoozed_until).getTime() < now))
  const recentCut = new Date(now - 30 * DAY).toISOString()
  const { data: recentRows } = await admin.from('blog_posts')
    .select('id,title,wordpress_url,refreshed_at,refresh_note')
    .eq('user_id', g.ownerId).gte('refreshed_at', recentCut)
    .order('refreshed_at', { ascending: false }).limit(10)
  return NextResponse.json({
    dueCount: due.length,
    due: due.slice(0, 8).map((r) => ({
      id: r.id, title: r.title, url: r.wordpress_url, publishedAt: r.published_at,
      since: sinceLabel(r.published_at as string), lastUpdatedAt: r.refreshed_at,
    })),
    recent: ((recentRows ?? []) as Row[]).map((r) => ({ id: r.id, title: r.title, url: r.wordpress_url, at: r.refreshed_at, note: r.refresh_note })),
  })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as { action?: string; postId?: string; note?: string }
  const postId = String(body.postId || '').trim()
  if (!postId) return NextResponse.json({ error: 'postId is required.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: post } = await admin.from('blog_posts')
    .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id,published_at,post_type,seo_keyword')
    .eq('user_id', g.ownerId).eq('id', postId).maybeSingle() as { data: Row | null }
  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  if (body.action === 'snooze') {
    const until = new Date(Date.now() + REFRESH_AFTER_DAYS * DAY).toISOString()
    const { error } = await admin.from('blog_posts').update({ refresh_snoozed_until: until }).eq('id', post.id)
    if (error) return NextResponse.json({ error: missingColumn(error.message) ? 'Run migration 384 first.' : error.message }, { status: 500 })
    return NextResponse.json({ ok: true, snoozedUntil: until })
  }

  if (body.action !== 'update') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  const note = cleanRefreshNote(body.note || '')
  if (note.length < 15) return NextResponse.json({ error: 'Write a sentence about how it has held up. That line is what makes the update worth having.' }, { status: 400 })
  if (!post.wordpress_post_id || !post.published_at) return NextResponse.json({ error: 'This post is not on your WordPress site.' }, { status: 400 })

  const creds = await getWordPressCredentials(admin, g.ownerId, post.wordpress_site_id ?? null)
  if (!creds) return NextResponse.json({ error: 'Your WordPress details could not be read, so nothing was changed. Reconnect your site under Blog Set Up.' }, { status: 400 })
  const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)

  // The body WordPress has NOW, not the copy MVP saved: the creator may have
  // edited it there since, and those edits must survive.
  const live = await wp.getPostContent(post.wordpress_post_id)
  if (!live) return NextResponse.json({ error: 'WordPress would not return this post, so nothing was changed.' }, { status: 502 })

  let content = refreshedBody(live.content, note, sinceLabel(post.published_at))

  // Related posts are picked again, so a review written before its neighbours
  // existed links to them now.
  try {
    const { data: others } = await admin.from('blog_posts')
      .select('title,wordpress_url,seo_keyword,post_type,content')
      .eq('user_id', g.ownerId).eq('status', 'published').neq('id', post.id)
      .not('wordpress_url', 'is', null).order('published_at', { ascending: false, nullsFirst: false }).limit(40)
    const candidates: LinkCandidate[] = ((others ?? []) as Array<{ title: string; wordpress_url: string; seo_keyword: string | null; post_type: string | null; content: string | null }>)
      .filter((r) => r.title && r.wordpress_url && !/[?&]p=\d+/.test(r.wordpress_url))
      .map((r) => ({ title: r.title, url: r.wordpress_url, keyword: r.seo_keyword, postType: r.post_type,
        contentSnippet: String(r.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800) }))
    const related = pickRelatedPosts({
      title: live.title || post.title || '', keyword: post.seo_keyword, postType: post.post_type,
      contentSnippet: live.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800),
    }, candidates, 3)
    content = withFreshRelated(content, renderRelatedLinksBlock(related), insertRelatedLinks)
  } catch { /* related posts are a bonus; the update still goes in */ }

  try {
    await wp.updatePost(post.wordpress_post_id, { content } as never)
  } catch (err) {
    if (isStalePostError(err)) return NextResponse.json({ error: 'That post no longer exists on your WordPress site.' }, { status: 400 })
    return NextResponse.json({ error: `WordPress refused the update: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }

  // VERIFY: the line is in the post WordPress now returns, not just sent.
  const after = await wp.getPostContent(post.wordpress_post_id)
  // Counted, not matched as text: a rendered read curls the apostrophes.
  const updates = (h: string) => h.split('class="mvp-update"').length - 1
  const landed = !!after && updates(after.content) > updates(live.content)
  if (!landed) {
    return NextResponse.json({ error: 'WordPress accepted the change but the update is not in the post it returns. A security or caching plugin may be rewriting saves. Run the connection doctor under Blog Set Up.' }, { status: 502 })
  }

  const at = new Date().toISOString()
  const { error: upErr } = await admin.from('blog_posts')
    .update({ refreshed_at: at, refresh_note: note, refresh_snoozed_until: null, content })
    .eq('id', post.id)
  const pinged = post.wordpress_url ? await pingIndexNowForUrl(admin, g.ownerId, post.wordpress_url, post.wordpress_site_id) : false
  return NextResponse.json({
    ok: true, at, pinged,
    // The post is updated either way; this says whether MVP could remember it.
    recorded: !upErr,
    ...(upErr ? { warning: missingColumn(upErr.message) ? 'Updated on your site, but migration 384 has not run, so MVP will ask about this post again.' : upErr.message } : {}),
  })
}
