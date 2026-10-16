// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/hashtags/trends — the live hashtag data the engine uses (lib/hashtag-
// trends, migration 434).
//   GET: how fresh each source is (TikTok, YouTube, Instagram), and the tags
//     worth checking on Instagram next for this creator.
//   POST { action: 'tiktok', bodies, rows, country }: TikTok Creative
//     Center's lists, as SCOUT read them in the creator's Chrome.
//   POST { action: 'instagram', items }: Instagram's post counts for tags, as
//     SCOUT asked Instagram in the creator's signed-in Chrome.
// SHARED, SO GUARDED: what a member's SCOUT sends is parsed and capped here,
// never trusted as written, and only adds or refreshes rows.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseTikTokCC, parseInstagramCounts, saveTrends, trendTag } from '@/lib/hashtag-trends'
import { categoriesFor } from '@/lib/hashtag-map'
import { trendStanding } from '@/lib/hashtag-engine'
import { canUsePreview } from '@/lib/labs-preview'

export const runtime = 'nodejs'

const SOURCES = [
  { platform: 'tiktok', source: 'tiktok_cc', label: 'TikTok Creative Center', by: 'SCOUT, in your Chrome' },
  { platform: 'youtube', source: 'youtube', label: 'YouTube hashtag pages', by: 'MVP, every night' },
  { platform: 'instagram', source: 'instagram', label: 'Instagram tag counts', by: 'SCOUT, in your Chrome' },
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function allowed(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  return canUsePreview('hashtag_trends', data?.tier)
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const head = { count: 'exact' as const, head: true }
  const since = new Date(Date.now() - 10 * 86_400_000).toISOString()
  const sources = await Promise.all(SOURCES.map(async (s) => {
    const [{ count, error }, { data: last }] = await Promise.all([
      admin.from('hashtag_trends').select('tag', head).eq('source', s.source).gte('seen_at', since),
      admin.from('hashtag_trends').select('seen_at').eq('source', s.source).order('seen_at', { ascending: false }).limit(1),
    ])
    return { ...s, tags: error ? null : count ?? 0, lastAt: (last?.[0]?.seen_at as string | undefined) ?? null, missing: !!error && /does not exist|schema cache/i.test(error.message) }
  }))
  // INSTAGRAM, WHAT TO CHECK NEXT: this creator's own recent Instagram tags,
  // then their niches' category tags, that nobody checked in two weeks.
  const { data: mine } = await admin.from('reach_samples').select('hashtags,niche').eq('user_id', user.id).eq('platform', 'instagram').order('posted_at', { ascending: false }).limit(60)
  const want: string[] = []
  for (const r of (mine ?? []) as Array<{ hashtags: string[] | null; niche: string | null }>) for (const t of r.hashtags || []) { const k = trendTag(t); if (k && !want.includes(k)) want.push(k) }
  const niches = Array.from(new Set(((mine ?? []) as Array<{ niche: string | null }>).map((r) => r.niche).filter(Boolean))) as string[]
  for (const c of categoriesFor(niches.join(' '), 3)) for (const t of [...c.niche, ...c.mid]) { const k = trendTag(t); if (k && !want.includes(k)) want.push(k) }
  const { data: done } = await admin.from('hashtag_trends').select('tag').eq('source', 'instagram').in('tag', want.length ? want.slice(0, 200) : ['#-']).gte('seen_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
  const checked = new Set(((done ?? []) as Array<{ tag: string }>).map((r) => r.tag))
  // WHAT WAS ACTUALLY READ, for the screen: TikTok's list as it stood, and
  // the Instagram counts, dead ends included.
  const { data: tt } = await admin.from('hashtag_trends').select('tag,rank,posts,label,region,seen_at').eq('source', 'tiktok_cc').gte('seen_at', since).order('seen_at', { ascending: false }).order('rank', { ascending: true }).limit(40)
  const tiktokTop = ((tt ?? []) as Array<{ tag: string; rank: number | null; posts: number | null; label: string | null; region: string }>)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).slice(0, 12)
  const { data: ig } = await admin.from('hashtag_trends').select('tag,posts,seen_at').eq('source', 'instagram').gte('seen_at', since).order('seen_at', { ascending: false }).limit(20)
  const instagramRecent = ((ig ?? []) as Array<{ tag: string; posts: number | null }>).map((r) => ({ tag: r.tag, posts: r.posts, standing: trendStanding({ source: 'instagram', posts: r.posts }) }))
  return NextResponse.json({ ok: true, allowed: await allowed(admin, user.id), sources, tiktokTop, instagramRecent, instagramNext: want.filter((t) => !checked.has(t)).slice(0, 15) })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { action?: string; bodies?: unknown[]; rows?: unknown[]; country?: string; items?: unknown[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  if (!(await allowed(admin, user.id))) return NextResponse.json({ error: 'Live hashtag reading is in Labs.' }, { status: 403 })
  // Creative Center's own answers first; the rows read off its page only add
  // what the answers did not carry.
  const rows = body.action === 'tiktok' ? parseTikTokCC([...(Array.isArray(body.bodies) ? body.bodies.slice(0, 30) : []), { rows: Array.isArray(body.rows) ? body.rows.slice(0, 200) : [] }], String(body.country || 'US').toUpperCase())
    : body.action === 'instagram' ? parseInstagramCounts(Array.isArray(body.items) ? body.items : [])
    : null
  if (!rows) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  if (!rows.length) return NextResponse.json({ ok: false, saved: 0, error: body.action === 'tiktok' ? 'SCOUT read no hashtags from TikTok Creative Center.' : 'SCOUT read no Instagram counts.' })
  const { saved, error } = await saveTrends(admin, rows)
  if (error) return NextResponse.json({ ok: false, saved: 0, error: /does not exist|schema cache/i.test(error) ? 'Live hashtag data needs migration 434 in Supabase first.' : error }, { status: 500 })
  return NextResponse.json({ ok: true, saved, read: rows.length })
}
