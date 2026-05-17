/**
 * GET /api/analytics/clicks
 *
 * Returns click + per-post analytics for the /analytics page. Source of truth
 * is Geniuslink — we list the user's shortlinks via their API, then join
 * back to blog_posts.geniuslink_code.
 *
 * Auto-backfill: for blog posts that don't yet have geniuslink_code stored
 * (created before migration 022) we match by Note → blog_posts.title. We
 * set Note to the post title when creating the link upstream, so this
 * matches with good fidelity. Match is saved so subsequent hits skip the
 * backfill cost.
 *
 * Response shape:
 *   {
 *     connected: boolean        // false if user hasn't set up Geniuslink
 *     totals: {
 *       clicks: number          // sum across all matched links
 *       posts: number           // # of blog posts that have ≥1 click
 *       topClicks: number       // clicks on the top-performing post
 *     }
 *     posts: Array<{ postId, title, url, clicks, code }>  // sorted desc
 *   }
 *
 * Note: Geniuslink's standard tier doesn't return time-series data. To get
 * a daily-clicks series we'd need their Insights add-on. For now we return
 * cumulative-per-link, no daily series. The UI handles its absence.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'

interface ShortlinkRow {
  // Geniuslink returns inconsistent casing across versions — handle both.
  Code?: string
  code?: string
  Note?: string
  note?: string
  Clicks?: number
  clicks?: number
  ClickCount?: number
  clickCount?: number
  Url?: string
  url?: string
}

interface BlogPostRow {
  id: string
  title: string | null
  wordpress_url: string | null
  geniuslink_code: string | null
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Geniuslink credentials
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .single()

    if (!intRow?.geniuslink_api_key || !intRow?.geniuslink_api_secret) {
      return NextResponse.json({
        connected: false,
        totals: { clicks: 0, posts: 0, topClicks: 0 },
        posts: [],
      })
    }

    // 1. Pull every shortlink on the account.
    let shortlinks: ShortlinkRow[] = []
    try {
      const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
      shortlinks = await genius.listShortlinks()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Geniuslink list failed: ${msg}` }, { status: 502 })
    }

    // Normalize each row to consistent { code, note, clicks }
    const normalized = shortlinks.map(s => ({
      code: (s.Code ?? s.code ?? '').toString(),
      note: ((s.Note ?? s.note ?? '') as string).trim(),
      clicks: Number(s.Clicks ?? s.clicks ?? s.ClickCount ?? s.clickCount ?? 0),
    })).filter(s => !!s.code)

    // 2. Pull all this user's blog posts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postsRaw } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,wordpress_url,geniuslink_code')
      .eq('user_id', user.id)
      .eq('status', 'published')
    const posts: BlogPostRow[] = postsRaw ?? []

    // 3. Backfill: for posts without a code, match by Note → title.
    const byCode = new Map(normalized.map(s => [s.code, s]))
    const byNote = new Map(normalized.map(s => [s.note.toLowerCase(), s]))
    const backfills: Array<{ id: string; code: string }> = []
    for (const p of posts) {
      if (p.geniuslink_code && byCode.has(p.geniuslink_code)) continue
      const noteMatch = (p.title ?? '').toLowerCase().trim()
      const matched = noteMatch ? byNote.get(noteMatch) : undefined
      if (matched) backfills.push({ id: p.id, code: matched.code })
    }
    // Persist the backfilled codes so future hits skip the matching step.
    if (backfills.length > 0) {
      await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        backfills.map(b => (supabase as any)
          .from('blog_posts')
          .update({ geniuslink_code: b.code })
          .eq('id', b.id)
        ),
      )
      // Reflect the backfill into the local `posts` array so the response
      // includes it without a second SELECT.
      const bMap = new Map(backfills.map(b => [b.id, b.code]))
      for (const p of posts) {
        if (!p.geniuslink_code && bMap.has(p.id)) p.geniuslink_code = bMap.get(p.id)!
      }
    }

    // 4. Build per-post rows joined with click counts.
    const postRows = posts
      .map(p => {
        const link = p.geniuslink_code ? byCode.get(p.geniuslink_code) : undefined
        return {
          postId: p.id,
          title: p.title ?? '',
          url: p.wordpress_url ?? '',
          code: p.geniuslink_code ?? null,
          clicks: link?.clicks ?? 0,
        }
      })
      .sort((a, b) => b.clicks - a.clicks)

    const withClicks = postRows.filter(p => p.clicks > 0)
    const totals = {
      clicks: withClicks.reduce((sum, p) => sum + p.clicks, 0),
      posts: withClicks.length,
      topClicks: withClicks[0]?.clicks ?? 0,
    }

    return NextResponse.json({
      connected: true,
      totals,
      posts: postRows.slice(0, 25), // top 25
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
