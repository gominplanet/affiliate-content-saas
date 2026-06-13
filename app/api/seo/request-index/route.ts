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
 * Pro-only + a tiny per-user daily cap, because Google's Indexing API draws
 * from a SINGLE 200/day quota on MVP's shared OAuth project — it physically
 * can't scale to every account. So it's an optional Pro accelerator (a small
 * daily nudge), NOT the indexing mechanism: every account's posts still index
 * automatically via their sitemap regardless of this button.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidGscToken, submitUrlForIndexing, tokenHasIndexingScope } from '@/lib/gsc'

const PER_USER_DAILY_CAP = 2

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pro-only. The shared 200/day project quota means this can't be offered to
  // every tier; it's a growth perk for Pro. Everyone else still gets automatic
  // sitemap indexing — so this is additive, not a gate on getting indexed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (intRow?.tier as string | null) || 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: 'Manual index submission is a Pro feature. Your posts still index automatically through your sitemap — this is just an optional speed-up.',
      proRequired: true,
    }, { status: 403 })
  }

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
  const { count } = await supabase
    .from('indexing_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since)
  const room = Math.max(0, PER_USER_DAILY_CAP - (count ?? 0))
  if (room <= 0) {
    return NextResponse.json({
      error: `You've used today's ${PER_USER_DAILY_CAP} manual index nudges. They share one Google quota across all of MVP, so the daily allowance is small — but your posts keep indexing automatically via your sitemap regardless.`,
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
    await supabase.from('indexing_submissions').insert({
      user_id: user.id,
      url: r.url,
      outcome: r.outcome,
      message: r.message?.slice(0, 500) ?? null,
    })
  }

  return NextResponse.json({ results, dailyRemaining: Math.max(0, room - results.length) })
}
