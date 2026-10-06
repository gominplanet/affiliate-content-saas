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
import { ccAccessOk } from '@/lib/cc-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LiveCampaign = any

/** Rows one live search may write. A brand search returns tens. */
const MAX_LIVE_CAMPAIGNS = 1000

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // THE SHARED CATALOGUE IS WRITTEN ONLY BY SOMEONE WHO MAY READ IT (2026-10-06
  // security audit). This wrote cc_campaign_catalog, which every member browses,
  // with the service key for ANY signed-in account, in any amount: one request
  // could rename every campaign, point its picture anywhere or mark them all
  // full for everyone. Same gate as /api/cc/campaigns, a bounded batch, and a
  // picture only from an https address.
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!(await ccAccessOk(supabase, user.id, (intRow?.tier as string) ?? 'trial'))) {
    return NextResponse.json({ ok: false, needsCcVerify: true, error: 'Verify your Creator Connections access first.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { campaigns?: LiveCampaign[] }
  const list = Array.isArray(body.campaigns) ? body.campaigns.slice(0, MAX_LIVE_CAMPAIGNS) : []
  if (list.length === 0) return NextResponse.json({ ok: true, upserted: 0 })

  const num = (v: unknown): number | null => { const n = Number(v); return isFinite(n) && v != null && v !== '' ? n : null }
  const rows = list.map((c) => {
    const campaign_id = String(c?.campaignId || '').slice(0, 200)
    if (!campaign_id) return null
    const asins = Array.isArray(c?.asins) ? c.asins.map((a: unknown) => String(a).toUpperCase()).filter((a: string) => /^[A-Z0-9]{10}$/.test(a)).slice(0, 60) : []
    return {
      campaign_id,
      campaign_name: c?.name ? String(c.name).slice(0, 500) : null,
      brand_name: c?.brand ? String(c.brand).slice(0, 200) : null,
      // rep_asin is generated from asins[1] (migration 197), so the card's own
      // ASIN goes first in asins rather than into rep_asin, which Postgres refuses.
      asins: c?.asin && /^[A-Z0-9]{10}$/i.test(String(c.asin)) && !asins.includes(String(c.asin).toUpperCase()) ? [String(c.asin).toUpperCase(), ...asins].slice(0, 60) : asins,
      commission_pct: num(c?.commissionPct),
      ends_at: c?.endsAt ? String(c.endsAt) : null,
      budget: num(c?.budget),
      budget_remaining: num(c?.budgetRemaining),
      available_slot: num(c?.availableSlot),
      total_slot: num(c?.totalSlot),
      image_url: c?.image && /^https:\/\//i.test(String(c.image)) ? String(c.image).slice(0, 1000) : null,
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
  // A MEMBER'S SCAN ONLY REFRESHES NUMBERS (Seb, 2026-10-07). It used to write
  // whole campaigns, so any verified account could add campaigns or rename,
  // repicture and re-price them for everybody. Now: only campaigns already in
  // the catalogue (new ones come from the admin import), only the live numbers
  // (spots, budget, rating, reviews), a daily cap per account, and every change
  // signed with who made it and when, so a bad actor can be undone.
  const LIVE_FIELDS = ['available_slot', 'total_slot', 'budget', 'budget_remaining', 'rating', 'review_count'] as const
  const DAILY_ROWS_PER_ACCOUNT = 3000
  const stamp = new Date().toISOString()
  let unknown = 0
  let capped = false
  const merged: Row[] = []
  let skipped = 0
  let nowFull = 0
  for (const r of incoming) {
    const old = existing.get(r.campaign_id)
    if (!old) { unknown++; continue }
    const m: Row = { campaign_id: r.campaign_id }
    for (const k of LIVE_FIELDS) {
      const v = r[k]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
      // Bounds a real grid never crosses.
      if ((k === 'available_slot' || k === 'total_slot') && v > 100_000) continue
      if (k === 'rating' && v > 5) continue
      m[k] = v
    }
    if (Object.keys(m).length === 1) { skipped++; continue }
    if (typeof m.available_slot === 'number' && m.available_slot <= 0 && !(typeof old.available_slot === 'number' && (old.available_slot as number) <= 0)) nowFull++
    merged.push(m)
  }

  // THE DAILY CAP, counted from the rows this account last wrote (migration
  // 413). Without the columns the cap steps aside, and says so in the log.
  let audited = true
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count, error } = await sb.from('cc_campaign_catalog').select('campaign_id', { count: 'exact', head: true })
      .eq('last_live_by', user.id).gte('last_live_at', since)
    if (error) throw error
    const room = Math.max(0, DAILY_ROWS_PER_ACCOUNT - (count ?? 0))
    if (merged.length > room) { capped = true; merged.length = room }
  } catch (e) {
    audited = false
    console.warn('[ingest-live] no audit columns (run migration 413); daily cap is OFF:', e instanceof Error ? e.message : String(e))
  }

  let upserted = 0
  let failed = 0
  for (let i = 0; i < merged.length; i += 500) {
    const chunk = merged.slice(i, i + 500).map((m) => (audited ? { ...m, last_live_by: user.id, last_live_at: stamp } : m))
    try {
      // Every row here already exists, so this only ever updates the fields sent.
      const { error } = await sb.from('cc_campaign_catalog').upsert(chunk, { onConflict: 'campaign_id', ignoreDuplicates: false })
      if (!error) upserted += chunk.length
      else failed += chunk.length
    } catch { failed += chunk.length }
  }

  return NextResponse.json({ ok: true, upserted, skipped, failed, nowFull, unknown, capped })
}
