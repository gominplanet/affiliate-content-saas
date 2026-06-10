// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Associates earnings — upload + aggregate (revenue loop, epic #249).
//
//   POST /api/analytics/amazon-earnings  { csv }  → parse + REPLACE the owner's
//        stored per-ASIN commission totals (latest export = current truth).
//   GET  /api/analytics/amazon-earnings           → stored total + per-product.
//
// Owner-scoped (getAuthAndOwner → ownerId). Writes via the service-role client
// (the table has SELECT-only RLS, same guardrail as migrations 116/119/121).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { parseEarningsCsv } from '@/lib/amazon-earnings-csv'

export const dynamic = 'force-dynamic'

const MAX_CSV_BYTES = 8 * 1024 * 1024 // 8MB — well over a year of earnings rows

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  let body: { csv?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const csv = typeof body.csv === 'string' ? body.csv : ''
  if (!csv.trim()) return NextResponse.json({ error: 'No CSV content provided.' }, { status: 400 })
  if (csv.length > MAX_CSV_BYTES) return NextResponse.json({ error: 'CSV too large (max 8MB).' }, { status: 413 })

  const parsed = parseEarningsCsv(csv)
  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: parsed.errors.join(' '), warnings: parsed.warnings }, { status: 422 })
  }
  if (parsed.products.length === 0) {
    return NextResponse.json({ error: 'No earnings rows with an ASIN were found in that file.', warnings: parsed.warnings }, { status: 422 })
  }

  const admin = createAdminClient()
  const importedAt = new Date().toISOString()
  try {
    // Latest upload = current truth: replace this owner's rows, then insert.
    await admin.from('amazon_earnings').delete().eq('user_id', ownerId)
    const rows = parsed.products.map(p => ({
      user_id: ownerId,
      asin: p.asin,
      product_title: p.title,
      earnings_usd: p.earnings,
      items_shipped: p.items,
      revenue_usd: p.revenue,
      imported_at: importedAt,
    }))
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await admin.from('amazon_earnings').insert(rows.slice(i, i + CHUNK))
      if (error) throw new Error(error.message)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/amazon_earnings|relation .* does not exist|could not find/i.test(msg)) {
      return NextResponse.json({ error: 'Earnings storage isn’t set up yet — run migration 121 in Supabase, then re-upload.' }, { status: 503 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    products: parsed.products.length,
    totalEarnings: parsed.totalEarnings,
    totalItems: parsed.totalItems,
    totalRevenue: parsed.totalRevenue,
    warnings: parsed.warnings,
    importedAt,
  })
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('amazon_earnings')
      .select('asin,product_title,earnings_usd,items_shipped,revenue_usd,imported_at')
      .eq('user_id', ownerId)
      .order('earnings_usd', { ascending: false })
      .limit(1000)
    const rows = ((data ?? []) as Array<{
      asin: string; product_title: string | null; earnings_usd: number
      items_shipped: number; revenue_usd: number; imported_at: string
    }>)
    const totalEarnings = Math.round(rows.reduce((s, r) => s + Number(r.earnings_usd || 0), 0) * 100) / 100
    const totalItems = rows.reduce((s, r) => s + Number(r.items_shipped || 0), 0)
    return NextResponse.json({
      hasData: rows.length > 0,
      importedAt: rows[0]?.imported_at ?? null,
      totalEarnings,
      totalItems,
      products: rows.slice(0, 100),
    })
  } catch {
    // Pre-migration 121 (or read error) → behave as "no data yet".
    return NextResponse.json({ hasData: false, importedAt: null, totalEarnings: 0, totalItems: 0, products: [] })
  }
}
