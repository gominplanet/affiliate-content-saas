// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/storefront/import-earnings — import a creator's Amazon earnings
// report CSV (the "Download Reports" export) as year-to-date per-product rows.
//
// SCOUT reads one report period at a time and only the regular Commissions
// table; this path lets a creator drop in the FULL year in one file, for both
// the Commissions report AND the Creator Connections report, so the storefront
// reflects real income instead of a single month.
//
// Multipart form: file (the CSV), source ('amazon_commissions' | 'creator_connections'),
// year (e.g. 2026). Session-authed; writes via the admin client (RLS grants users
// SELECT only). Stored as period_type='ytd', keyed by (user, asin, 'ytd',
// year-01-01, source) so re-uploads replace in place and the two report types
// never overwrite each other.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseEarningsCsv } from '@/lib/amazon-earnings-csv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SOURCES = new Set(['amazon_commissions', 'creator_connections'])
const toCents = (v: number | null): number | null => (v == null ? null : Math.round(v * 100))

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const form = await request.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'Expected a CSV file upload.' }, { status: 400 })

    const file = form.get('file')
    const source = String(form.get('source') ?? 'amazon_commissions')
    const yearRaw = parseInt(String(form.get('year') ?? ''), 10)
    const now = new Date()
    const year = isFinite(yearRaw) && yearRaw >= 2015 && yearRaw <= now.getUTCFullYear() + 1 ? yearRaw : now.getUTCFullYear()

    if (!SOURCES.has(source)) return NextResponse.json({ error: 'Unknown report type.' }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file received.' }, { status: 400 })
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'That file is over 8 MB — export a single year and try again.' }, { status: 400 })

    const text = await file.text()
    if (!text.trim()) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })

    const parsed = parseEarningsCsv(text)
    if (!parsed.rows.length) {
      // Nothing mapped — hand back the diagnostic so the header vocabulary can be
      // tuned to this creator's actual export instead of failing blind.
      return NextResponse.json({
        ok: false,
        error: parsed.skippedNoAsin > 0
          ? `Read ${parsed.totalRows} rows but none carried an ASIN — this looks like a campaign-level export. Try the per-product report.`
          : "Couldn't find earnings columns in that file. Make sure it's the Amazon report CSV.",
        matched: parsed.matched,
        unmatchedHeaders: parsed.unmatchedHeaders,
        totalRows: parsed.totalRows,
        skippedNoAsin: parsed.skippedNoAsin,
      }, { status: 422 })
    }

    const periodStart = `${year}-01-01`
    // End at today for the current year, else Dec 31 of that year.
    const periodEnd = year === now.getUTCFullYear()
      ? now.toISOString().slice(0, 10)
      : `${year}-12-31`
    const syncedAt = now.toISOString()

    const rows = parsed.rows.map(r => ({
      user_id: user.id,
      asin: r.asin,
      product_title: r.title,
      period_type: 'ytd' as const,
      period_start: periodStart,
      period_end: periodEnd,
      units: r.units,
      revenue_cents: toCents(r.revenue),
      commission_cents: toCents(r.earnings),
      clicks: r.clicks,
      source,
      synced_at: syncedAt,
    }))

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('storefront_earnings')
      .upsert(rows, { onConflict: 'user_id,asin,period_type,period_start,source' })
    if (error) {
      console.warn('[storefront/import-earnings] upsert failed:', error.message)
      // The wider unique key (migration 268) may not be applied yet.
      const hint = /on conflict|constraint|unique|column .* does not exist/i.test(error.message)
        ? 'The storefront earnings table needs migration 268 — run it, then re-upload.'
        : 'Could not save the earnings.'
      return NextResponse.json({ error: hint }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      imported: rows.length,
      totalEarnings: parsed.totalEarnings,
      skippedNoAsin: parsed.skippedNoAsin,
      source,
      year,
      unmatchedHeaders: parsed.unmatchedHeaders,
    })
  } catch (e) {
    console.warn('[storefront/import-earnings] error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Import failed — try again.' }, { status: 500 })
  }
}
