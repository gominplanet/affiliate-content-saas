/**
 * GET /api/seo/aio-summary
 *
 * Account-level AIO (AI-answer readiness) rollup across the creator's posts:
 * average score, grade spread, the checks that fail most often (with the fix),
 * and the lowest-scoring posts to fix first. Reads the aio jsonb the generator
 * persists on blog_posts (migration 266). Signed-in only; no model call.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import type { AioScore } from '@/lib/aio-score'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PostRow { id: string; title: string | null; wordpress_url: string | null; aio: AioScore | null }

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  let rows: PostRow[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,wordpress_url,aio')
      .eq('user_id', ownerId)
      .not('aio', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(500)
    if (error) return NextResponse.json({ ok: true, scored: 0, note: 'aio column not present yet' })
    rows = (data ?? []) as PostRow[]
  } catch {
    return NextResponse.json({ ok: true, scored: 0 })
  }

  const scored = rows.filter(r => r.aio && typeof r.aio.score === 'number')
  if (!scored.length) return NextResponse.json({ ok: true, scored: 0 })

  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
  const failCounts = new Map<string, { label: string; hint: string; count: number }>()
  let sum = 0
  for (const r of scored) {
    const a = r.aio!
    sum += a.score
    if (grades[a.grade] != null) grades[a.grade]++
    for (const c of a.checks || []) {
      if (c.pass) continue
      const cur = failCounts.get(c.key) || { label: c.label, hint: c.hint, count: 0 }
      cur.count++
      failCounts.set(c.key, cur)
    }
  }
  const topFixes = [...failCounts.values()].sort((a, b) => b.count - a.count).slice(0, 4)
    .map(f => ({ label: f.label, hint: f.hint, count: f.count, share: Math.round((f.count / scored.length) * 100) }))
  const worst = [...scored].sort((a, b) => (a.aio!.score) - (b.aio!.score)).slice(0, 6)
    .map(r => ({ id: r.id, title: r.title, url: r.wordpress_url, score: r.aio!.score, grade: r.aio!.grade }))

  return NextResponse.json({
    ok: true,
    scored: scored.length,
    avgScore: Math.round(sum / scored.length),
    grades,
    topFixes,
    worst,
  })
}
