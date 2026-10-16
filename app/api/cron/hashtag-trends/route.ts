// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/hashtag-trends — YouTube's own numbers for the tags MVP uses
// (lib/hashtag-trends). Each run checks the tags creators actually posted in
// the last two weeks, then MVP's category tags, oldest-checked first, on each
// tag's public YouTube hashtag page ("2M videos • 505K channels"). Kept in the
// shared hashtag_trends table (migration 434) for the hashtag engine. A tag
// YouTube did not answer for is left as it was, never written as zero.
//
// TikTok and Instagram are read by SCOUT in a creator's Chrome (their pages
// need a signed-in browser), through /api/hashtags/trends.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { allCategoryTags } from '@/lib/hashtag-map'
import { readYouTubeHashtag, saveTrends, trendTag, type TrendRow } from '@/lib/hashtag-trends'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Tags checked per run, and at once; a tag is checked again after a week. */
const PER_RUN = 80
const AT_ONCE = 4
const RECHECK_DAYS = 7
const BUDGET_MS = 240_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  // What creators posted lately leads, then the category map.
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data: used } = await admin.from('reach_samples').select('hashtags').gte('posted_at', since).limit(3000)
  const counts = new Map<string, number>()
  for (const r of (used ?? []) as Array<{ hashtags: string[] | null }>) for (const t of r.hashtags || []) { const k = trendTag(t); if (k) counts.set(k, (counts.get(k) || 0) + 1) }
  const candidates = [...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t), ...allCategoryTags()]
  const unique = Array.from(new Set(candidates))

  // Skip what was checked this week.
  const fresh = new Set<string>()
  const { data: recent, error: rErr } = await admin.from('hashtag_trends').select('tag').eq('platform', 'youtube').gte('seen_at', new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString()).limit(5000)
  if (rErr && /does not exist|schema cache/i.test(rErr.message)) return NextResponse.json({ ok: false, error: 'hashtag_trends is missing: run migration 434.' })
  for (const r of (recent ?? []) as Array<{ tag: string }>) fresh.add(r.tag)
  const todo = unique.filter((t) => !fresh.has(t)).slice(0, PER_RUN)

  const rows: TrendRow[] = []
  let unanswered = 0
  for (let i = 0; i < todo.length && Date.now() - started < BUDGET_MS; i += AT_ONCE) {
    const got = await Promise.all(todo.slice(i, i + AT_ONCE).map((t) => readYouTubeHashtag(t)))
    for (const g of got) { if (g) rows.push(g); else unanswered++ }
  }
  const { saved, error } = await saveTrends(admin, rows)
  return NextResponse.json({ ok: !error, checked: todo.length, read: rows.length, saved, unanswered, error })
}
