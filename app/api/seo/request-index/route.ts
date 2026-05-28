/**
 * POST /api/seo/request-index — submit URL(s) to Google's Indexing API
 *
 * Body: { urls: string[] }   — 1-50 URLs, MUST belong to the user's verified
 *                              GSC property.
 *
 * Returns: { results: IndexingSubmitResult[], scopeMissing?: true }
 *   When the token doesn't carry the indexing scope yet (existing GSC
 *   connections from before this feature shipped), returns scopeMissing
 *   with a 412 so the dashboard prompts the user to reconnect.
 *
 * Per-user soft cap of 50/day in addition to Google's hard 200/day on the
 * shared OAuth project — protects us from one creator burning the
 * project-wide quota everyone shares.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidGscToken, submitUrlForIndexing, tokenHasIndexingScope } from '@/lib/gsc'

const PER_USER_DAILY_CAP = 50

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { urls?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 50)
    : []
  if (urls.length === 0) return NextResponse.json({ error: 'Provide one or more URLs.' }, { status: 400 })

  // ── Get the token + check scope ───────────────────────────────────────────
  const token = await getValidGscToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({
      error: 'Search Console isn\'t connected. Connect it on /seo first.',
      scopeMissing: true,
    }, { status: 412 })
  }
  const hasScope = await tokenHasIndexingScope(token)
  if (!hasScope) {
    return NextResponse.json({
      error: 'We don\'t have indexing permission yet — disconnect and reconnect Search Console so Google grants the new scope.',
      scopeMissing: true,
    }, { status: 412 })
  }

  // ── Per-user daily cap (insurance on top of Google's project quota) ───────
  // Counts SELF submissions (any outcome) in the last 24h. Lets a power-user
  // keep slamming if everything's been getting accepted; protects us from
  // burning the shared project quota in one creator's afternoon.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from('indexing_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since)
  const room = Math.max(0, PER_USER_DAILY_CAP - (count ?? 0))
  if (room <= 0) {
    return NextResponse.json({
      error: `You've hit today's submit cap (${PER_USER_DAILY_CAP}/24h). Google's free quota is 200/day site-wide — we cap each creator at 50 so one user can't burn it.`,
      limitReached: true,
    }, { status: 429 })
  }
  const toSubmit = urls.slice(0, room)

  // ── Submit (sequential — Indexing API rate-limits aggressive bursts) ──────
  // 1 URL/sec is comfortably under Google's 600/min hard ceiling.
  const results = [] as Awaited<ReturnType<typeof submitUrlForIndexing>>[]
  for (const u of toSubmit) {
    const r = await submitUrlForIndexing(token, u)
    results.push(r)
    // Persist regardless of outcome — the dashboard reads back the most-
    // recent attempt timestamp so creators can see "submitted 3 hours ago"
    // on individual posts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('indexing_submissions').insert({
      user_id: user.id,
      url: r.url,
      outcome: r.outcome,
      message: r.message?.slice(0, 500) ?? null,
    })
  }

  return NextResponse.json({ results, dailyRemaining: Math.max(0, room - results.length) })
}
