// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-user cache of resolved Creator Connections message URLs (detailsUrl), so
// "Message the brand" can skip the slow live SCOUT grid search once a campaign
// has been resolved before (from a message find OR a Smart Scan).
//
//   GET    ?asin=            → { detailsUrl, campaignId } | { detailsUrl: null }  (null if absent/stale)
//   POST   { asin, campaignId?, detailsUrl } | { links: [...] }  → cache one or many
//   DELETE ?asin=            → drop a stale entry (self-heal after a failed send)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// CC opportunities last weeks; re-resolve after this so a stale URL can't linger.
const TTL_DAYS = 14
const isAsin = (s: unknown): s is string => typeof s === 'string' && /^[A-Z0-9]{10}$/.test(s.toUpperCase())
const isUrl = (s: unknown): s is string => typeof s === 'string' && /^https:\/\/[^\s]*amazon\.com\//i.test(s)

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!isAsin(asin)) return NextResponse.json({ detailsUrl: null })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cc_message_links')
    .select('details_url, campaign_id, resolved_at')
    .eq('user_id', user.id).eq('asin', asin).maybeSingle()
  if (error || !data) return NextResponse.json({ detailsUrl: null })

  const ageMs = Date.now() - new Date(data.resolved_at).getTime()
  if (ageMs > TTL_DAYS * 86_400_000) return NextResponse.json({ detailsUrl: null, stale: true })
  return NextResponse.json({ detailsUrl: data.details_url, campaignId: data.campaign_id ?? null })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    asin?: string; campaignId?: string | null; detailsUrl?: string
    links?: Array<{ asin?: string; campaignId?: string | null; detailsUrl?: string }>
  }
  const incoming = body.links ?? [{ asin: body.asin, campaignId: body.campaignId, detailsUrl: body.detailsUrl }]

  const rows = incoming
    .filter(l => isAsin(l.asin) && isUrl(l.detailsUrl))
    .map(l => ({
      user_id: user.id,
      asin: (l.asin as string).toUpperCase(),
      campaign_id: l.campaignId ?? null,
      details_url: l.detailsUrl as string,
      resolved_at: new Date().toISOString(),
    }))
  // Dedupe by asin (a batch can carry the same rep product twice).
  const byAsin = new Map(rows.map(r => [r.asin, r]))
  const deduped = [...byAsin.values()]
  if (!deduped.length) return NextResponse.json({ ok: true, cached: 0 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('cc_message_links').upsert(deduped, { onConflict: 'user_id,asin' })
  if (error) return NextResponse.json({ ok: false, cached: 0 }, { status: 200 }) // best-effort, never blocks messaging
  return NextResponse.json({ ok: true, cached: deduped.length })
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!isAsin(asin)) return NextResponse.json({ ok: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('cc_message_links').delete().eq('user_id', user.id).eq('asin', asin)
  return NextResponse.json({ ok: true })
}
