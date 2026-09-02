// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/ingest-live  { campaigns: [...] }
// Folds campaigns SCOUT found in a LIVE brand search of the creator's own CC grid
// into the shared cc_campaign_catalog, so Browse reflects Amazon's live count
// instead of only the last import snapshot. Upsert on campaign_id (last wins); the
// nightly enrich cron fills in Keepa price/rating/demand later. Returns how many
// rows were written.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiveCampaign = any

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { campaigns?: LiveCampaign[] }
  const list = Array.isArray(body.campaigns) ? body.campaigns : []
  if (list.length === 0) return NextResponse.json({ ok: true, upserted: 0 })

  const nowIso = new Date().toISOString()
  const num = (v: unknown): number | null => { const n = Number(v); return isFinite(n) && v != null && v !== '' ? n : null }
  const rows = list.map((c) => {
    const campaign_id = String(c?.campaignId || '').slice(0, 200)
    if (!campaign_id) return null
    const asins = Array.isArray(c?.asins) ? c.asins.map((a: unknown) => String(a).toUpperCase()).filter(Boolean).slice(0, 60) : []
    return {
      campaign_id,
      campaign_name: c?.name ? String(c.name).slice(0, 500) : null,
      brand_name: c?.brand ? String(c.brand).slice(0, 200) : null,
      rep_asin: c?.asin ? String(c.asin).toUpperCase().slice(0, 12) : (asins[0] || null),
      asins,
      commission_pct: num(c?.commissionPct),
      ends_at: c?.endsAt ? String(c.endsAt) : null,
      budget: num(c?.budget),
      budget_remaining: num(c?.budgetRemaining),
      available_slot: num(c?.availableSlot),
      total_slot: num(c?.totalSlot),
      image_url: c?.image ? String(c.image).slice(0, 1000) : null,
      rating: num(c?.rating),
      review_count: num(c?.reviewCount),
      updated_at: nowIso,
    }
  }).filter(Boolean)

  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 })

  // The catalog is service-role writable (the drain cron owns it); use the admin
  // client so the upsert isn't blocked by RLS. Missing key → no write, not a crash.
  let admin
  try { admin = createAdminClient() } catch { return NextResponse.json({ ok: true, upserted: 0, note: 'no-admin-key' }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  let upserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    try {
      const { error } = await sb.from('cc_campaign_catalog').upsert(chunk, { onConflict: 'campaign_id', ignoreDuplicates: false })
      if (!error) upserted += chunk.length
    } catch { /* skip chunk */ }
  }

  return NextResponse.json({ ok: true, upserted })
}
