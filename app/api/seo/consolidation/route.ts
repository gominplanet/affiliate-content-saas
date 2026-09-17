/**
 * GET /api/seo/consolidation
 *
 * Which posts are doing nothing, and how fast is this creator publishing onto
 * the pile.
 *
 * 279 posts on one site, 47 indexed, 394 in Google's "Crawled, currently not
 * indexed". That catalogue is not helped by a 280th post. It is helped by
 * turning the weakest forty into the strongest ten.
 *
 * Strictly read-only. Merging or redirecting is destructive to live content on
 * somebody's own site, so this produces a list a person reads and decides on.
 * Nothing here deletes, edits or redirects anything.
 *
 * Every judgement is in lib/consolidation.ts and lib/publish-velocity.ts as pure
 * functions, so the thresholds and the refusals are tested rather than eyeballed.
 * This file only fetches.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken, querySearchAnalyticsOrNull } from '@/lib/gsc'
import { buildConsolidationReport, type PostStat } from '@/lib/consolidation'
import { readVelocity } from '@/lib/publish-velocity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Compare two URLs the way Search Console and WordPress disagree about them:
 *  scheme, www and the trailing slash all vary between the two. */
function urlKey(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return `${u.hostname.replace(/^www\./i, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
  } catch { return null }
}

function monthsSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (isNaN(then.getTime())) return null
  const now = new Date()
  return Math.max(0, (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth()))
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any)
    .from('integrations').select('gsc_property,wordpress_url').eq('user_id', ownerId).maybeSingle()
  const property: string | null = integ?.gsc_property || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,content,published_at,wordpress_url')
    .eq('user_id', ownerId)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: true })
    .limit(2000)

  const posts = ((rows ?? []) as Array<{
    id: string; title: string | null; content: string | null
    published_at: string | null; wordpress_url: string | null
  }>)

  const firstPublished = posts[0]?.published_at ?? null
  const ageMonths = monthsSince(firstPublished)

  // Per-page performance over a window long enough that a quiet month does not
  // condemn a post. Six months, because the grace period alone can be six.
  let statsAvailable = false
  const byPage = new Map<string, { impressions: number; clicks: number }>()
  if (property) {
    const token = await getValidGscToken(supabase, ownerId)
    if (token) {
      const end = new Date(); end.setDate(end.getDate() - 3)
      const start = new Date(); start.setDate(start.getDate() - 183)
      const pageRows = await querySearchAnalyticsOrNull(token, property, {
        startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], rowLimit: 5000,
      })
      // null means Google did not answer. Treating that as "no page was ever
      // shown" would present every post on the site as a merge candidate.
      if (pageRows !== null) {
        statsAvailable = true
        for (const r of pageRows) {
          const key = urlKey(r.keys?.[0])
          if (!key) continue
          const prev = byPage.get(key)
          byPage.set(key, {
            impressions: (prev?.impressions ?? 0) + (r.impressions ?? 0),
            clicks: (prev?.clicks ?? 0) + (r.clicks ?? 0),
          })
        }
      }
    }
  }

  const stats: PostStat[] = posts.map(p => {
    const key = urlKey(p.wordpress_url)
    const hit = key ? byPage.get(key) : undefined
    const text = String(p.content ?? '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
    return {
      id: String(p.id),
      title: String(p.title ?? 'Untitled'),
      url: p.wordpress_url ?? null,
      publishedAt: p.published_at,
      words: text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0,
      // Search Console omits pages with no data entirely, so a post that is not
      // in the response was genuinely never shown. That is only true once we
      // know the fetch itself succeeded, which statsAvailable carries.
      impressions: hit?.impressions ?? 0,
      clicks: hit?.clicks ?? 0,
    }
  })

  const report = buildConsolidationReport(stats, { ageMonths, statsAvailable })

  const velocity = readVelocity({
    publishedAt: posts.map(p => p.published_at).filter((d): d is string => !!d),
    totalPosts: posts.length,
    postsShown: statsAvailable ? stats.filter(s => (s.impressions ?? 0) > 0).length : null,
    ageMonths,
  })

  return NextResponse.json({
    connected: statsAvailable,
    totalPosts: posts.length,
    ageMonths,
    velocity,
    ...report,
    // The list is long on a big site and the panel only ever shows the worst.
    candidates: report.candidates.slice(0, 100),
  })
}
