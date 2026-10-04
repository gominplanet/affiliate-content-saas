// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/ingest-live  { campaigns: [...] }
// Folds campaigns SCOUT found in a LIVE brand search of the creator's own CC grid
// into the shared cc_campaign_catalog, so Browse reflects Amazon's live count
// instead of only the last import snapshot. Upsert on campaign_id (last wins); the
// nightly enrich cron fills in Keepa price/rating/demand later. Returns how many
// rows were written, skipped and failed, and how many just turned full.
//
// It wrote nothing for a long time without saying so: every row carried
// rep_asin (a generated column Postgres refuses) and updated_at (a column the
// catalogue does not have), so every chunk failed and the error was dropped.
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

  const num = (v: unknown): number | null => { const n = Number(v); return isFinite(n) && v != null && v !== '' ? n : null }
  const rows = list.map((c) => {
    const campaign_id = String(c?.campaignId || '').slice(0, 200)
    if (!campaign_id) return null
    const asins = Array.isArray(c?.asins) ? c.asins.map((a: unknown) => String(a).toUpperCase()).filter(Boolean).slice(0, 60) : []
    return {
      campaign_id,
      campaign_name: c?.name ? String(c.name).slice(0, 500) : null,
      brand_name: c?.brand ? String(c.brand).slice(0, 200) : null,
      // rep_asin is generated from asins[1] (migration 197), so the card's own
      // ASIN goes first in asins rather than into rep_asin, which Postgres refuses.
      asins: c?.asin && !asins.includes(String(c.asin).toUpperCase()) ? [String(c.asin).toUpperCase().slice(0, 12), ...asins].slice(0, 60) : asins,
      commission_pct: num(c?.commissionPct),
      ends_at: c?.endsAt ? String(c.endsAt) : null,
      budget: num(c?.budget),
      budget_remaining: num(c?.budgetRemaining),
      available_slot: num(c?.availableSlot),
      total_slot: num(c?.totalSlot),
      image_url: c?.image ? String(c.image).slice(0, 1000) : null,
      rating: num(c?.rating),
      review_count: num(c?.reviewCount),
    }
  }).filter(Boolean)

  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 })

  // The catalog is service-role writable (the drain cron owns it); use the admin
  // client so the upsert isn't blocked by RLS. Missing key → no write, not a crash.
  let admin
  try { admin = createAdminClient() } catch { return NextResponse.json({ ok: true, upserted: 0, note: 'no-admin-key' }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // A FIELD AMAZON LEFT OUT KEEPS ITS VALUE. The upsert writes every column, so a
  // live result with no end date or no spot count used to wipe the catalogue's
  // value with null, and a new campaign missing a required field (name,
  // commission, end date) failed its whole 500-row chunk without a word. Merge
  // over what is there, and skip only the rows that still cannot be stored.
  type Row = Record<string, unknown> & { campaign_id: string }
  const incoming = rows as Row[]
  const existing = new Map<string, Row>()
  for (let i = 0; i < incoming.length; i += 300) {
    const ids = incoming.slice(i, i + 300).map((r) => r.campaign_id)
    const { data } = await sb.from('cc_campaign_catalog')
      .select('campaign_id,campaign_name,brand_name,asins,commission_pct,ends_at,budget,budget_remaining,available_slot,total_slot,image_url,rating,review_count')
      .in('campaign_id', ids)
    for (const r of (data ?? []) as Row[]) existing.set(r.campaign_id, r)
  }
  const merged: Row[] = []
  let skipped = 0
  let nowFull = 0
  for (const r of incoming) {
    const old = existing.get(r.campaign_id)
    const m: Row = { ...r }
    if (old) {
      for (const [k, v] of Object.entries(r)) {
        const empty = v == null || (Array.isArray(v) && v.length === 0)
        if (empty && old[k] != null) m[k] = old[k]
      }
    }
    if (!m.campaign_name || m.commission_pct == null || !m.ends_at) { skipped++; continue }
    if (typeof m.available_slot === 'number' && m.available_slot <= 0 && !(typeof old?.available_slot === 'number' && (old.available_slot as number) <= 0)) nowFull++
    merged.push(m)
  }

  let upserted = 0
  let failed = 0
  for (let i = 0; i < merged.length; i += 500) {
    const chunk = merged.slice(i, i + 500)
    try {
      const { error } = await sb.from('cc_campaign_catalog').upsert(chunk, { onConflict: 'campaign_id', ignoreDuplicates: false })
      if (!error) upserted += chunk.length
      else failed += chunk.length
    } catch { failed += chunk.length }
  }

  // What happened, counted: written, skipped for missing fields, failed, and how
  // many just turned full (those drop out of "Has open spots" for everyone).
  return NextResponse.json({ ok: true, upserted, skipped, failed, nowFull })
}
