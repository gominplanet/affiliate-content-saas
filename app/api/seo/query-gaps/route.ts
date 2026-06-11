// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Phase 3 GSC feedback loop — "missed demand" mining. Google Search Console
// shows queries the site ALREADY gets impressions for; some of them have no
// post that really targets them (we rank page 2+ via a tangential post, or we
// show up but nobody clicks). Those are proven-demand topics the user should
// write next — far better bets than gut-feel topic picks.
//
// One Search Analytics call per request (dimensions [query,page], 28-day
// window). No caching layer in v1: the /seo page fetches once per visit and
// GSC's per-site quota (1,200 queries/min) makes that a non-issue.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getValidGscToken, querySearchAnalytics } from '@/lib/gsc'

export const maxDuration = 30

export interface QueryGap {
  query: string
  impressions: number
  clicks: number
  /** Best (lowest) average position any of our pages holds for this query. */
  position: number
  /** The page that currently ranks best for it (may be only tangentially related). */
  bestPage: string | null
}

// Generic words that don't define a topic — shared shape with
// lib/keyword-research.ts but tuned for query-vs-title matching.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'for', 'and', 'or', 'of', 'to', 'with', 'in', 'on', 'is',
  'are', 'best', 'top', 'review', 'reviews', 'vs', 'my', 'your', 'how', 'what',
  'does', 'do', 'can', 'it', 'this', 'that',
])

function sigTokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // GSC connection — property + token. Not connected → empty, never an error
  // (the card on /seo simply hides).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('gsc_property')
    .eq('user_id', ownerId)
    .maybeSingle()
  const property = (intRow?.gsc_property as string | null) || null
  if (!property) return NextResponse.json({ connected: false, gaps: [] })
  const token = await getValidGscToken(supabase, ownerId)
  if (!token) return NextResponse.json({ connected: false, gaps: [] })

  // Brand tokens — branded queries aren't "missed demand", they're navigation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brandRow } = await (supabase as any)
    .from('brand_profiles')
    .select('name')
    .eq('user_id', ownerId)
    .maybeSingle()
  const brandTokens = new Set(sigTokens((brandRow?.name as string | null) || ''))

  // Site-wide query+page report, 28 days (GSC has ~3-day lag).
  const end = new Date(); end.setDate(end.getDate() - 3)
  const start = new Date(); start.setDate(start.getDate() - 31)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const rows = await querySearchAnalytics(token, property, {
    startDate: ymd(start), endDate: ymd(end), dimensions: ['query', 'page'], rowLimit: 500,
  })
  if (!rows.length) return NextResponse.json({ connected: true, property, gaps: [] })

  // What do we already cover? A query is "covered" when a SINGLE existing
  // post's title+keyword contains every significant token of the query —
  // i.e. there's a post squarely about it, so it's a rebuild candidate
  // (handled by the rebuild loop), not a new-post gap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: posts } = await (supabase as any)
    .from('blog_posts')
    .select('title,seo_keyword')
    .eq('user_id', ownerId)
    .not('wordpress_url', 'is', null)
    .limit(500)
  const haystacks: string[][] = ((posts as Array<{ title: string | null; seo_keyword: string | null }> | null) ?? [])
    .map(p => sigTokens(`${p.title || ''} ${p.seo_keyword || ''}`))

  // Aggregate by query across pages.
  const byQuery = new Map<string, { impressions: number; clicks: number; position: number; bestPage: string | null }>()
  for (const r of rows) {
    const q = r.keys?.[0]
    const page = r.keys?.[1] ?? null
    if (!q) continue
    const cur = byQuery.get(q) ?? { impressions: 0, clicks: 0, position: Infinity, bestPage: null }
    cur.impressions += r.impressions ?? 0
    cur.clicks += r.clicks ?? 0
    if ((r.position ?? Infinity) < cur.position) { cur.position = r.position; cur.bestPage = page }
    byQuery.set(q, cur)
  }

  const gaps: QueryGap[] = []
  for (const [q, agg] of byQuery) {
    const toks = sigTokens(q)
    if (toks.length < 2) continue                                  // too generic to target
    if (toks.some(t => brandTokens.has(t))) continue               // branded/navigational
    const covered = haystacks.some(h => toks.every(t => h.some(ht => ht.includes(t))))
    if (covered) continue                                          // a post already targets it
    const invisible = agg.clicks === 0 && agg.impressions >= 20    // demand, zero clicks
    const weakRank = agg.position > 12 && agg.impressions >= 15    // page 2+, real impressions
    if (!invisible && !weakRank) continue
    gaps.push({
      query: q,
      impressions: Math.round(agg.impressions),
      clicks: Math.round(agg.clicks),
      position: Math.round(agg.position * 10) / 10,
      bestPage: agg.bestPage,
    })
  }

  // Highest-impression gaps first; zero-click demand gets a nudge up.
  gaps.sort((a, b) =>
    (b.impressions * (b.clicks === 0 ? 1.25 : 1)) - (a.impressions * (a.clicks === 0 ? 1.25 : 1)))

  return NextResponse.json({ connected: true, property, gaps: gaps.slice(0, 15) })
}
