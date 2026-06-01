/**
 * GET /api/newsletter/blog-posts        latest 10 published posts (default)
 * GET /api/newsletter/blog-posts?q=foo  search title + excerpt across all
 *                                       published posts (top 30)
 *
 * Returns rich rows for the compose page's picker — id + title + summary +
 * URL + the video's thumbnail (joined in from youtube_videos) + a
 * product link if we can derive one from the source video's description
 * (matches the Geniuslink / Amazon URL the creator put in the YouTube
 * description). The picker renders each row with a checkbox.
 *
 * thumbnail_url lives on youtube_videos (NOT blog_posts) so the original
 * v1 of this route silently 400'd at PostgREST and the picker rendered
 * "No published posts yet" even when the creator had a full catalogue.
 * The join below is the fix.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { firstProductUrl } from '@/lib/product-link'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

interface RawRow {
  id: string
  title: string | null
  excerpt: string | null
  wordpress_url: string | null
  published_at: string | null
  youtube_videos: {
    thumbnail_url: string | null
    description: string | null
    youtube_video_id: string | null
  } | null
}

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const limit = q ? 30 : 10

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = supabase
    .from('blog_posts')
    .select('id,title,excerpt,wordpress_url,published_at,youtube_videos(thumbnail_url,description,youtube_video_id)')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (q) {
    // ilike across title + excerpt. PostgREST's `or()` filter is the
    // standard way — escape any % in the user's query so they can't break out.
    const safe = q.replace(/[%_]/g, '').slice(0, 80)
    query = query.or(`title.ilike.%${safe}%,excerpt.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Need the user's WP base URL too, so that firstProductUrl can ignore
  // links that point back to the creator's own site (they're not products).
  // Multi-site: defaults to the user's default site. Edge case: in
  // multi-site setups the firstProductUrl filter still treats only the
  // default site as "own" — links pointing to OTHER connected sites will
  // be treated as external products. That's a minor side effect; for
  // tightening, we'd thread all of the user's site URLs through here.
  const defaultSite = await getWordPressCredentials(supabase, user.id)
  const wpBase = defaultSite?.wordpress_url ?? null

  const rows = (data as RawRow[] | null) || []
  const posts = rows
    .filter(p => !!p.wordpress_url)
    .map(p => {
      // Pull the first product-like URL out of the source video's
      // description — that's where the Geniuslink / Amazon / brand-site
      // link lives. Falls back to null when nothing useful is in there.
      const description = p.youtube_videos?.description || ''
      const productUrl = description ? firstProductUrl(description, wpBase) : null
      // Excerpt cap at ~100 words for the picker preview — same as the
      // user explicitly asked for ("a short resume of the article (under
      // 100 words)").
      const summary = ((p.excerpt || '').match(/\S+/g) || []).slice(0, 100).join(' ')
      return {
        id: p.id,
        title: p.title || 'Untitled',
        summary,
        url: p.wordpress_url,
        thumbnail: p.youtube_videos?.thumbnail_url || null,
        productUrl,
        publishedAt: p.published_at,
        youtubeVideoId: p.youtube_videos?.youtube_video_id || null,
      }
    })

  return NextResponse.json({ posts, query: q || null })
}
