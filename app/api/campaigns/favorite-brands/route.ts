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
import { brandMatches, brandLikeToken } from '@/lib/brand-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FAVORITES = 60

function normBrand(v: string): string {
  return (v || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The user's already-joined campaign IDs — so "open" means open AND not yet
 *  joined. Keyed on the campaign ID, NOT the ASIN: Amazon runs several distinct
 *  campaigns for the same product (same ASIN, different windows), each separately
 *  joinable, so an ASIN key would wrongly hide brand-new campaigns just because you
 *  joined an earlier one for that product. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function acceptedCampaignIds(sb: any, userId: string): Promise<Set<string>> {
  const set = new Set<string>()
  try {
    const { data } = await sb.from('campaigns')
      .select('cc_campaign_id, accepted_at, amazon_joined_at')
      .eq('user_id', userId)
      .limit(4000)
    for (const r of (data ?? [])) {
      const id = String(r?.cc_campaign_id || '').trim()
      if (id && (r.accepted_at || r.amazon_joined_at)) set.add(id)
    }
  } catch { /* no rows → nothing excluded */ }
  return set
}

/** Live open / joined / total campaign counts for a brand from the shared catalog.
 *  "open" = has spots AND the creator hasn't already accepted it.
 *  "joined" = you already accepted it (open or not) — tracked so the badge can say
 *  "joined" instead of the misleading "all full" when your only open campaign is one
 *  you already grabbed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandCounts(sb: any, label: string, accepted: Set<string>): Promise<{ open: number; joined: number; total: number }> {
  const tok = brandLikeToken(label)
  if (!tok) return { open: 0, joined: 0, total: 0 }
  // Broad DB pre-filter (brand OR title contains the token), then a precise
  // whole-word check in JS so "Dreame" catches variant/null brands via the title
  // without pulling look-alikes like "Dreamegg".
  const { data } = await sb
    .from('cc_campaign_catalog')
    .select('campaign_id, rep_asin, brand_name, campaign_name, available_slot, total_slot')
    .or(`brand_name.ilike.%${tok}%,campaign_name.ilike.%${tok}%`)
    .limit(1000)
  const rows = (Array.isArray(data) ? data : []).filter((r: { brand_name?: string | null; campaign_name?: string | null }) =>
    brandMatches(label, r.brand_name, r.campaign_name))
  let open = 0, joined = 0
  for (const r of rows) {
    const cid = String(r.campaign_id || '')
    if (cid && accepted.has(cid)) { joined++; continue } // you joined THIS campaign → not "open" for you
    const f = campaignFullness(r.available_slot as number | null, r.total_slot as number | null)
    if (!f.isFull) open++
  }
  return { open, joined, total: rows.length }
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

  const accepted = await acceptedCampaignIds(sb, user.id)
  const brands = await Promise.all(((favs ?? []) as Array<{ brand_key: string; brand_label: string; last_checked_at: string | null }>).map(async (f) => {
    const counts = await brandCounts(sb, f.brand_label, accepted)
    return { brand: f.brand_key, label: f.brand_label, openCount: counts.open, joinedCount: counts.joined, totalCount: counts.total, lastCheckedAt: f.last_checked_at ?? null }
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
  const counts = await brandCounts(sb, label, await acceptedCampaignIds(sb, user.id))
  return NextResponse.json({ ok: true, brand: { brand: key, label, openCount: counts.open, joinedCount: counts.joined, totalCount: counts.total, lastCheckedAt: null } })
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
