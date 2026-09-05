/**
 * GET /api/seo/blog-health
 *
 * Is this blog working, and is it growing.
 *
 * The rest of the SEO page reads Search Console once, aggregated over 28 days.
 * That is why a site could break, lose all of its traffic, and have MVP report
 * a healthy-looking impression total for four days afterwards while the creator
 * discovered the outage from their host's bandwidth chart. A single total cannot
 * show a cliff. This asks for the same data BY DATE so it can.
 *
 * Fetching only. Every judgement is in lib/blog-health.ts as a pure function so
 * the wording, the thresholds and the refusals are tested rather than eyeballed.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken, querySearchAnalytics } from '@/lib/gsc'
import { analyseBlogHealth, type DailyPoint } from '@/lib/blog-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any)
    .from('integrations').select('gsc_property,wordpress_url').eq('user_id', ownerId).maybeSingle()
  const property: string | null = integ?.gsc_property || null
  let blogHost: string | null = null
  try { blogHost = integ?.wordpress_url ? new URL(integ.wordpress_url).host.replace(/^www\./, '') : null } catch { blogHost = null }

  // How much has been published, and when it started. The age is what decides
  // whether a quiet blog is failing or simply young.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: posts } = await (supabase as any)
    .from('blog_posts').select('id', { count: 'exact', head: true })
    .eq('user_id', ownerId).not('wordpress_post_id', 'is', null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: firstPost } = await (supabase as any)
    .from('blog_posts').select('published_at')
    .eq('user_id', ownerId).not('published_at', 'is', null)
    .order('published_at', { ascending: true }).limit(1).maybeSingle()

  // Everything Amazon paid for links placed away from the storefront. It covers
  // the blog AND anywhere else the creator puts links, and Amazon never says
  // which sent the buyer, so the analysis is careful never to call this the
  // blog's revenue.
  let offsiteEarningsCents: number | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: earn } = await (supabase as any)
      .from('amazon_earnings_periods')
      .select('earnings_cents,store_scope')
      .eq('user_id', ownerId).eq('store_scope', 'offsite')
    const rows = (earn ?? []) as { earnings_cents: number | null }[]
    if (rows.length) {
      offsiteEarningsCents = rows.reduce((a, r) => a + (r.earnings_cents ?? 0), 0)
    }
  } catch { /* no earnings synced, so no claim about them */ }

  // Product-link clicks that came from the blog, through Passport.
  //
  // Two separate facts, and conflating them would put a false accusation in
  // front of a creator. Zero clicks on links that exist means readers reached
  // the recommendation and did not take it. Zero clicks because there are no
  // tracked links at all means nothing whatsoever, and reporting that as
  // "nobody clicked your product links" would be inventing a failure.
  //
  // MVP stores source: 'blog' on links it creates for posts, and otherwise logs
  // the referring host, so a click from the creator's own domain counts too.
  let affiliateClicks: number | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: linkCount } = await (supabase as any)
      .from('passport_links').select('code', { count: 'exact', head: true }).eq('user_id', ownerId)
    if ((linkCount ?? 0) > 0) {
      const since = new Date(); since.setDate(since.getDate() - 28)
      const sources = ['source.eq.blog']
      if (blogHost) sources.push(`source.eq.${blogHost}`, `source.eq.www.${blogHost}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: clickCount } = await (supabase as any)
        .from('passport_link_clicks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ownerId)
        .gte('created_at', since.toISOString())
        .or(sources.join(','))
      affiliateClicks = clickCount ?? 0
    }
  } catch { /* Passport not in use, so no claim about link clicks */ }

  let daily: DailyPoint[] = []
  let connected = false
  if (property) {
    const token = await getValidGscToken(supabase, ownerId)
    if (token) {
      connected = true
      // Search Console runs about three days behind, so the last few days are
      // genuinely empty rather than a collapse. Ending the window there keeps
      // the lag from being read as a crash every single day.
      const end = new Date(); end.setDate(end.getDate() - 3)
      const start = new Date(); start.setDate(start.getDate() - 93)
      const rows = await querySearchAnalytics(token, property, {
        startDate: ymd(start), endDate: ymd(end), dimensions: ['date'], rowLimit: 100,
      })
      daily = rows
        .map(r => ({ date: String(r.keys?.[0] || ''), clicks: r.clicks ?? 0, impressions: r.impressions ?? 0 }))
        .filter(r => r.date)
        .sort((a, b) => a.date.localeCompare(b.date))
      // Search Console omits days with no data entirely. Left as gaps, a week of
      // silence would look like a week that never happened rather than a week
      // with no traffic, which is the difference between spotting an outage and
      // missing it.
      if (daily.length) {
        const filled: DailyPoint[] = []
        const cursor = new Date(`${daily[0].date}T00:00:00Z`)
        const last = new Date(`${daily[daily.length - 1].date}T00:00:00Z`)
        const byDate = new Map(daily.map(d => [d.date, d]))
        while (cursor <= last) {
          const key = ymd(cursor)
          filled.push(byDate.get(key) ?? { date: key, clicks: 0, impressions: 0 })
          cursor.setDate(cursor.getDate() + 1)
        }
        daily = filled
      }
    }
  }

  return NextResponse.json(analyseBlogHealth({
    daily,
    connected,
    posts: posts ?? 0,
    firstPublishedAt: firstPost?.published_at ?? null,
    affiliateClicks,
    offsiteEarningsCents,
  }))
}
