// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/hashtags/counts?tags=#a,#b — what each platform counted for these
// tags (hashtag_trends: YouTube read as captions are written and every night,
// Instagram read by SCOUT, TikTok's trend list), for the size chips beside a
// caption (components/social/TagCounts). A tag nobody counted comes back with
// no counts, so the screen can say so rather than guess.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { trendTag } from '@/lib/hashtag-trends'
import { COUNT_FRESH_DAYS } from '@/lib/hashtag-research'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = new URL(request.url).searchParams.get('tags') || ''
  const tags = Array.from(new Set(raw.split(',').map((t) => trendTag(t.trim())).filter((t): t is string => !!t))).slice(0, 30)
  if (!tags.length) return NextResponse.json({ ok: true, tags: [] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const since = new Date(Date.now() - COUNT_FRESH_DAYS * 86_400_000).toISOString()
  const { data, error } = await admin.from('hashtag_trends').select('platform, tag, source, rank, posts, label, seen_at').in('tag', tags).gte('seen_at', since).limit(300)
  if (error) return NextResponse.json({ ok: false, error: /does not exist|schema cache/i.test(error.message) ? 'Hashtag counts need migration 434 in Supabase first.' : error.message }, { status: 500 })
  const rows = (data || []) as Array<{ platform: string; tag: string; source: string; rank: number | null; posts: number | null; label: string | null; seen_at: string }>
  return NextResponse.json({
    ok: true,
    tags: tags.map((tag) => ({ tag, counts: rows.filter((r) => r.tag === tag).map((r) => ({ platform: r.platform, source: r.source, rank: r.rank, posts: r.posts, label: r.label, seenAt: r.seen_at })) })),
  })
}
