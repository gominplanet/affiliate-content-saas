/**
 * GET /api/analytics/clicks
 *
 * Returns click + per-post analytics for the /analytics page. Source of
 * truth is Geniuslink — we look up lifetime clicks per shortcode via their
 * /v1/reports/link-click-trend-by-resolution endpoint.
 *
 * Backfill strategy: Geniuslink doesn't expose a "list-all-shortlinks"
 * endpoint, so we can't enumerate them server-side. Instead we extract
 * the geni.us/CODE shortcode from each blog post's stored content (Claude
 * embeds it in the body during generation). Any post that doesn't have a
 * geniuslink_code on the row gets one assigned from content scraping, and
 * we persist it so subsequent hits skip the scrape.
 *
 * Response shape:
 *   {
 *     connected: boolean
 *     totals: { clicks, posts, topClicks }
 *     posts: Array<{ postId, title, url, clicks, code }>
 *   }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'

interface BlogPostRow {
  id: string
  title: string | null
  wordpress_url: string | null
  geniuslink_code: string | null
  content: string | null
}

/** Pull geni.us/CODE out of arbitrary text. */
function extractCode(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/(?:www\.)?geni\.us\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Geniuslink creds
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

    // Pull every published post for this user with enough columns to do
    // the backfill in-process.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postsRaw } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,wordpress_url,geniuslink_code,content')
      .eq('user_id', user.id)
      .eq('status', 'published')
    const posts: BlogPostRow[] = postsRaw ?? []

    // Backfill: extract geni.us/CODE from content for any post missing
    // the column. Persist so we don't re-scrape next time.
    const backfills: Array<{ id: string; code: string }> = []
    for (const p of posts) {
      if (p.geniuslink_code) continue
      const code = extractCode(p.content)
      if (code) {
        p.geniuslink_code = code
        backfills.push({ id: p.id, code })
      }
    }
    if (backfills.length > 0) {
      await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        backfills.map(b => (supabase as any)
          .from('blog_posts')
          .update({ geniuslink_code: b.code })
          .eq('id', b.id)
        ),
      )
    }

    // Look up lifetime clicks for every post that has a code. We dedupe by
    // code first since multiple posts can share the same affiliate link
    // (e.g. re-generated versions of the same review).
    const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
    const uniqueCodes = Array.from(new Set(posts.map(p => p.geniuslink_code).filter((c): c is string => !!c)))
    // Fire in parallel but cap concurrency at 8 — Geniuslink isn't rate
    // limited aggressively but this protects us if a user has 100s of posts.
    const clicksByCode = new Map<string, number>()
    const CONCURRENCY = 8
    for (let i = 0; i < uniqueCodes.length; i += CONCURRENCY) {
      const batch = uniqueCodes.slice(i, i + CONCURRENCY)
      const counts = await Promise.all(batch.map(code => genius.getLifetimeClicks(code)))
      batch.forEach((code, idx) => clicksByCode.set(code, counts[idx]))
    }

    // Build per-post rows.
    const postRows = posts
      .map(p => ({
        postId: p.id,
        title: p.title ?? '',
        url: p.wordpress_url ?? '',
        code: p.geniuslink_code ?? null,
        clicks: p.geniuslink_code ? (clicksByCode.get(p.geniuslink_code) ?? 0) : 0,
      }))
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
      posts: postRows.slice(0, 25),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
