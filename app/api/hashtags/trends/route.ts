// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/hashtags/trends — the live hashtag data the engine uses (lib/hashtag-
// trends, migration 434).
//   GET: how fresh each source is (TikTok, YouTube, Instagram), and the tags
//     worth checking on Instagram next for this creator.
//   POST { action: 'tiktok' }: MVP's server reads TikTok Creative Center's
//     lists now (the nightly read, on demand).
//   POST { action: 'instagram', items }: Instagram's post counts for tags, as
//     SCOUT asked Instagram in the creator's signed-in Chrome.
// SHARED, SO GUARDED: what a member's SCOUT sends is parsed and capped here,
// never trusted as written, and only adds or refreshes rows.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseInstagramCounts, readTikTokTrends, saveTrends, trendTag } from '@/lib/hashtag-trends'
import { categoriesFor } from '@/lib/hashtag-map'
import { trendStanding } from '@/lib/hashtag-engine'
import { canUsePreview } from '@/lib/labs-preview'

export const runtime = 'nodejs'

const SOURCES = [
  { platform: 'tiktok', source: 'tiktok_cc', label: 'TikTok Creative Center', by: 'MVP, every night' },
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
  // then the tags captions asked for (hashtag_wanted, migration 448: found
  // and counted on YouTube as each caption was written), then their niches'
  // category tags, that nobody checked in two weeks.
  const { data: mine } = await admin.from('reach_samples').select('hashtags,niche').eq('user_id', user.id).eq('platform', 'instagram').order('posted_at', { ascending: false }).limit(60)
  const want: string[] = []
  for (const r of (mine ?? []) as Array<{ hashtags: string[] | null; niche: string | null }>) for (const t of r.hashtags || []) { const k = trendTag(t); if (k && !want.includes(k)) want.push(k) }
  const { data: asked } = await admin.from('hashtag_wanted').select('tag').eq('platform', 'instagram').order('wanted_at', { ascending: false }).limit(120)
  for (const r of (asked ?? []) as Array<{ tag: string }>) { const k = trendTag(r.tag); if (k && !want.includes(k)) want.push(k) }
  const niches = Array.from(new Set(((mine ?? []) as Array<{ niche: string | null }>).map((r) => r.niche).filter(Boolean))) as string[]
  for (const c of categoriesFor(niches.join(' '), 3)) for (const t of [...c.niche, ...c.mid]) { const k = trendTag(t); if (k && !want.includes(k)) want.push(k) }
  const { data: done } = await admin.from('hashtag_trends').select('tag').eq('source', 'instagram').in('tag', want.length ? want.slice(0, 300) : ['#-']).gte('seen_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
  const checked = new Set(((done ?? []) as Array<{ tag: string }>).map((r) => r.tag))
  // WHAT WAS ACTUALLY READ, for the screen: TikTok's list as it stood, and
  // the Instagram counts, dead ends included.
  const { data: tt } = await admin.from('hashtag_trends').select('tag,rank,posts,label,region,seen_at').eq('source', 'tiktok_cc').gte('seen_at', since).order('seen_at', { ascending: false }).order('rank', { ascending: true }).limit(40)
  const tiktokTop = ((tt ?? []) as Array<{ tag: string; rank: number | null; posts: number | null; label: string | null; region: string }>)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).slice(0, 12)
  const { data: ig } = await admin.from('hashtag_trends').select('tag,posts,seen_at').eq('source', 'instagram').gte('seen_at', since).order('seen_at', { ascending: false }).limit(20)
  const instagramRecent = ((ig ?? []) as Array<{ tag: string; posts: number | null }>).map((r) => ({ tag: r.tag, posts: r.posts, standing: trendStanding({ source: 'instagram', posts: r.posts }) }))
  return NextResponse.json({ ok: true, allowed: await allowed(admin, user.id), sources, tiktokTop, instagramRecent, instagramNext: want.filter((t) => !checked.has(t)).slice(0, 20) })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { action?: string; country?: string; items?: unknown[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  if (!(await allowed(admin, user.id))) return NextResponse.json({ error: 'Live hashtag reading is in Labs.' }, { status: 403 })
  // TikTok: MVP's server reads Creative Center itself, now (the same read
  // as every night). Instagram: the counts SCOUT asked Instagram for.
  let tiktok: { asked: number; answered: number } | null = null
  let rows = null as ReturnType<typeof parseInstagramCounts> | null
  if (body.action === 'tiktok') {
    const tt = await readTikTokTrends(String(body.country || 'US').toUpperCase())
    if (tt.error) return NextResponse.json({ ok: false, saved: 0, error: `TikTok Creative Center did not answer: ${tt.error}` })
    tiktok = { asked: tt.asked, answered: tt.answered }
    rows = tt.rows
  } else if (body.action === 'instagram') rows = parseInstagramCounts(Array.isArray(body.items) ? body.items : [])
  if (!rows) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  if (!rows.length) return NextResponse.json({ ok: false, saved: 0, error: body.action === 'tiktok' ? 'TikTok Creative Center answered but listed no usable hashtags.' : 'SCOUT read no Instagram counts.' })
  const { saved, error } = await saveTrends(admin, rows)
  if (error) return NextResponse.json({ ok: false, saved: 0, error: /does not exist|schema cache/i.test(error) ? 'Live hashtag data needs migration 434 in Supabase first.' : error }, { status: 500 })
  return NextResponse.json({ ok: true, saved, read: rows.length, ...(tiktok || {}) })
}
