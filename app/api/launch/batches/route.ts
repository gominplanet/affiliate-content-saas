// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/launch/batches — the creator's batches, newest first.
// POST /api/launch/batches — start one.
//
// A batch is ten videos set up together. What is shared (the CTA, the Amazon
// countries, the publishing cadence) is chosen once; the product, title and
// thumbnail belong to each video on its own.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { MAX_ITEMS } from '@/lib/launch-batch'

export const runtime = 'nodejs'

/** Batches listed. A creator with more than this has a filing problem, not a
 *  paging problem. */
const LIST = 25

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb.from('launch_batches')
    .select('id,name,state,markets,daily_slots,start_on,timezone,created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(LIST)
  if (error) {
    // NAMED. A list that silently comes back empty reads as "you have none",
    // which is a different thing from "the table is not there yet".
    return NextResponse.json({
      error: 'Could not read your batches. Run migration 357, then reload.',
      detail: error.message,
    }, { status: 500 })
  }

  // COUNTED IN POSTGRES, never from a fetched array. A page length passed off
  // as a total has appeared three times in this codebase already.
  const ids = (data ?? []).map((b: { id: string }) => b.id)
  const counts = new Map<string, number>()
  if (ids.length > 0) {
    for (const id of ids) {
      const { count } = await sb.from('launch_items')
        .select('id', { count: 'exact', head: true }).eq('batch_id', id)
      counts.set(id, count ?? 0)
    }
  }

  return NextResponse.json({
    ok: true,
    batches: (data ?? []).map((b: { id: string }) => ({ ...b, videos: counts.get(b.id) ?? 0 })),
  })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Launch batches are a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { name?: string; timezone?: string }

  // THE CREATOR'S OWN ZONE, sent by their browser. Not a display detail:
  // YouTube's publishAt is an absolute instant, so a batch stored against UTC
  // would publish a creator in Toronto at five in the morning. Validated here
  // rather than trusted, because an unknown zone would silently become UTC and
  // a published video cannot be unpublished.
  let timezone = (body.timezone || '').trim() || 'UTC'
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { timezone = 'UTC' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb.from('launch_batches').insert({
    user_id: user.id,
    name: (body.name || '').trim().slice(0, 120) || 'Untitled batch',
    timezone,
  }).select('id').single()

  if (error || !data) {
    return NextResponse.json({
      error: 'Could not start a batch. Run migration 357, then try again.',
      detail: error?.message ?? null,
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id, maxItems: MAX_ITEMS })
}
