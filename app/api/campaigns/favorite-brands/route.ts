// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Favorite brands watchlist for Creator Connections.
//   GET                      -> { ok, brands: [{ brand, label, openCount, totalCount, lastCheckedAt }] }
//   POST { brand }           -> { ok, brand }            (add / upsert a favorite)
//   DELETE ?brand=<label>    -> { ok }                   (remove a favorite)
//
// Open counts are computed live against cc_campaign_catalog so the list is
// always fresh; the background cron (check-favorite-brands) keeps a stored
// snapshot for change detection + the daily digest.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { campaignFullness } from '@/lib/cc-intelligence'
import { ccScanBrandCampaigns, ccAcceptedCampaignIds, ccIsAcceptable } from '@/lib/cc-brand-scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FAVORITES = 60

function normBrand(v: string): string {
  return (v || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Live open / joined / total campaign counts for a brand from the shared catalog.
 *
 *  "open" is defined as exactly what Accept all will act on, via the shared
 *  ccIsAcceptable, and reads the SAME scan Accept all reads. That identity is
 *  the whole point: the badge previously counted from an unordered slice and
 *  from campaigns that had already ended, so it sat at "3 open" through any
 *  number of accepts because those three could never be accepted at all.
 *
 *  "joined" = you already accepted it (open or not), tracked so the badge can
 *  say "joined" instead of the misleading "all full" when your only campaign for
 *  that brand is one you already grabbed.
 *
 *  `capped` says the brand has more campaigns than one scan reads, so the
 *  numbers describe a slice. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandCounts(sb: any, label: string, accepted: Set<string>): Promise<{ open: number; joined: number; total: number; capped: boolean }> {
  const { rows, capped } = await ccScanBrandCampaigns(sb, label)
  let open = 0, joined = 0
  for (const r of rows) {
    const cid = String(r.campaign_id || '')
    if (cid && accepted.has(cid)) { joined++; continue } // you joined THIS campaign → not "open" for you
    const f = campaignFullness(r.available_slot, r.total_slot)
    if (ccIsAcceptable(r, accepted, f.isFull)) open++
  }
  return { open, joined, total: rows.length, capped }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: favs } = await sb
    .from('cc_favorite_brands')
    .select('brand_key, brand_label, open_count, last_checked_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  const accepted = await ccAcceptedCampaignIds(sb, user.id)
  const brands = await Promise.all(((favs ?? []) as Array<{ brand_key: string; brand_label: string; last_checked_at: string | null }>).map(async (f) => {
    const counts = await brandCounts(sb, f.brand_label, accepted)
    return { brand: f.brand_key, label: f.brand_label, openCount: counts.open, joinedCount: counts.joined, totalCount: counts.total, capped: counts.capped, lastCheckedAt: f.last_checked_at ?? null }
  }))

  return NextResponse.json({ ok: true, brands })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { brand?: string }
  const label = (body.brand || '').trim().slice(0, 80)
  const key = normBrand(label)
  if (!key) return NextResponse.json({ error: 'A brand name is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { count } = await sb.from('cc_favorite_brands').select('brand_key', { count: 'exact', head: true }).eq('user_id', user.id)
  if ((count ?? 0) >= MAX_FAVORITES) {
    return NextResponse.json({ error: `You can track up to ${MAX_FAVORITES} brands.` }, { status: 400 })
  }

  const { error } = await sb.from('cc_favorite_brands').upsert(
    { user_id: user.id, brand_key: key, brand_label: label },
    { onConflict: 'user_id,brand_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const counts = await brandCounts(sb, label, await ccAcceptedCampaignIds(sb, user.id))
  return NextResponse.json({ ok: true, brand: { brand: key, label, openCount: counts.open, joinedCount: counts.joined, totalCount: counts.total, capped: counts.capped, lastCheckedAt: null } })
}

export async function DELETE(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = normBrand(new URL(req.url).searchParams.get('brand') || '')
  if (!key) return NextResponse.json({ error: 'A brand is required.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  await sb.from('cc_favorite_brands').delete().eq('user_id', user.id).eq('brand_key', key)
  return NextResponse.json({ ok: true })
}
