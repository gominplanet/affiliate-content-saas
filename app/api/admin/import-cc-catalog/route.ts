// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/import-cc-catalog   (admin only)
//
// Merges the weekly CC campaign CSV into the live catalog WITHOUT wiping the
// enriched product signals. Flow:
//   1. Load your weekly CSV into the staging table `cc_campaign_catalog_import`
//      (Supabase dashboard import or SQL COPY — replace it freely).
//   2. POST here. This runs merge_cc_catalog_import() (migration 200): upserts
//      the campaign-economics columns, leaves image/sales/rating/video
//      enrichment untouched on surviving rows, and purges campaigns that fell
//      out of the latest CSV.
//
// Returns { upserted, purged } so you can confirm the import landed.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET → row counts for the admin page (live catalog + what's staged, and how
// much of the live catalog is enriched so far).
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const admin = createAdminClient()
  const countOf = async (table: string, mod?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (admin as any).from(table).select('campaign_id', { count: 'exact', head: true })
      if (mod) q = mod(q)
      const { count } = await q
      return count ?? 0
    } catch { return null }
  }
  const [staged, live, enriched] = await Promise.all([
    countOf('cc_campaign_catalog_import'),
    countOf('cc_campaign_catalog'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf('cc_campaign_catalog', (q: any) => q.not('product_verified_at', 'is', null)),
  ])
  return NextResponse.json({ ok: true, staged, live, enriched })
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { confirm?: boolean }
    const admin = createAdminClient()
    // Guard 1: refuse to merge an empty staging table (that would purge the whole
    // live catalog). A real weekly import always has tens of thousands of rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any)
      .from('cc_campaign_catalog_import').select('campaign_id', { count: 'exact', head: true })
    if (!count || count < 1) {
      return NextResponse.json({
        error: 'Staging table cc_campaign_catalog_import is empty. Load your CSV into it first, then run this.',
      }, { status: 400 })
    }

    // Guard 2: a merge PURGES every live row not in staging. If staging is far
    // smaller than the live catalog, this is almost certainly a PARTIAL upload
    // (only some of the weekly files loaded) — refuse and make the admin confirm,
    // rather than silently deleting the rest of the catalog.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: liveCount } = await (admin as any)
      .from('cc_campaign_catalog').select('campaign_id', { count: 'exact', head: true })
    const live = liveCount ?? 0
    if (!body.confirm && live > 0 && count < live * 0.6) {
      return NextResponse.json({
        needsConfirm: true,
        staged: count,
        live,
        wouldPurgeApprox: Math.max(0, live - count),
        error: `Only ${count.toLocaleString()} campaigns are staged, but the live catalog has ${live.toLocaleString()}. Merging now would remove roughly ${Math.max(0, live - count).toLocaleString()} campaigns. If you haven't uploaded ALL your CSV files yet, upload the rest first.`,
      }, { status: 409 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).rpc('merge_cc_catalog_import')
    if (error) {
      console.error('[import-cc-catalog]', error.message)
      return NextResponse.json({ error: toUserMessage(error, 'Import merge failed. Please try again.') }, { status: 500 })
    }
    const row = Array.isArray(data) ? data[0] : data
    return NextResponse.json({
      ok: true,
      staged: count,
      upserted: Number(row?.upserted ?? 0),
      purged: Number(row?.purged ?? 0),
    })
  } catch (err) {
    console.error('[import-cc-catalog]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Import failed. Please try again.') }, { status: 500 })
  }
}
