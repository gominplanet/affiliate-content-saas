/**
 * POST /api/epc/ingest — save scraped EPC / Sponsored-Products opportunities.
 *
 * SCOUT scrapes the creator's open "Creator Connections Check → Sponsored
 * Products" tab (there's no CSV export) and hands the rows to the app via the
 * MVP_CC_SCAN bridge (lib/extension-frame scoutCreatorConnections). This route
 * persists them into the per-user EPC library, upserting on (user_id, asin) so
 * re-scanning refreshes the numbers + scanned_at while keeping first_seen_at.
 * The scan happens in-app through the session, so this is a normal same-origin
 * authenticated POST — no extension token / CORS needed.
 *
 * Body: { products: ScoutedCampaign[] } (the raw scraped rows).
 * Returns: { ok, saved }.
 *
 * Gate: paid tiers (tierAllowsCampaigns) — same as the rest of CC Campaigns.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, tierAllowsCampaigns } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'
import { fetchKeepaBasics, keepaConfigured } from '@/services/keepa'

export const dynamic = 'force-dynamic'

interface IncomingRow {
  asin?: string
  campaignName?: string
  brand?: string
  epc?: string
  epcValue?: number | null
  endsAt?: string | null
  price?: string | null
  priceValue?: number | null
  rating?: string | number | null
  budget?: string | null
  image?: string | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : null
}
// Only Low / Medium / High are meaningful budget scores; anything else → null.
const cleanBudget = (v: unknown): string | null => {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'low' ? 'Low' : s === 'medium' ? 'Medium' : s === 'high' ? 'High' : null
}
const cleanDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ig } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(ig?.tier)
    if (!tierAllowsCampaigns(tier)) {
      return NextResponse.json({ error: 'The EPC library is available on paid plans.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { products?: unknown }
    const incoming = Array.isArray(body.products) ? (body.products as IncomingRow[]) : []
    if (!incoming.length) return NextResponse.json({ error: 'Nothing to save — the scan returned no rows.' }, { status: 400 })

    const scannedAt = new Date().toISOString()
    const seen = new Set<string>()
    const rows = incoming
      .map((r) => {
        const asin = String(r.asin || '').trim().toUpperCase()
        if (!/^[A-Z0-9]{10}$/.test(asin)) return null
        const priceVal = num(r.priceValue) ?? num(r.price)
        return {
          user_id: user.id,
          asin,
          title: (r.campaignName || '').trim() || null,
          brand: (r.brand || '').trim() || null,
          image_url: (r.image || '') || null,
          price_cents: priceVal != null ? Math.round(priceVal * 100) : null,
          epc_value: num(r.epcValue) ?? num(r.epc),
          epc_display: (r.epc || '').trim() || null,
          budget: cleanBudget(r.budget),
          rating: num(r.rating),
          ends_at: cleanDate(r.endsAt),
          details_url: null as string | null,
          scanned_at: scannedAt,
        }
      })
      .filter((r): r is NonNullable<typeof r> => {
        if (!r) return false
        if (seen.has(r.asin)) return false // de-dupe within one scan
        seen.add(r.asin)
        return true
      })

    if (!rows.length) return NextResponse.json({ error: 'No valid products in the scan.' }, { status: 400 })

    // Upsert on (user_id, asin). first_seen_at is omitted so it keeps its
    // original value on update and defaults on insert.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('epc_products')
      .upsert(rows, { onConflict: 'user_id,asin' })
    if (error) {
      console.error('[epc/ingest]', error.message)
      // The most common cause on a fresh deploy: migration 278 (the epc_products
      // table) hasn't been run. Name it so it's fixable at a glance instead of a
      // generic "try again".
      const missingTable = /does not exist|could not find the table|schema cache|relation .* does not exist/i.test(error.message || '')
      return NextResponse.json({
        error: missingTable
          ? 'EPC storage isn’t set up on the server yet — run database migration 278 (epc_products), then scan again.'
          : `Could not save the scan: ${error.message}`,
      }, { status: 500 })
    }

    // ── Enrich with Keepa (image fallback + monthly sold + sales rank) ────────
    // Best-effort. Only ASINs that aren't enriched yet, so re-scanning the same
    // products doesn't re-spend Keepa tokens. If migration 279 isn't run, the
    // enriched_at filter query fails, `need` is empty, and we spend nothing.
    try {
      if (keepaConfigured()) {
        const asins = rows.map((r) => r.asin)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: needRows } = await (supabase as any)
          .from('epc_products')
          .select('asin, image_url')
          // Never-enriched rows, OR rows enriched before but still missing an image
          // (backfills the ones an earlier image-field bug left blank). Once a row
          // has an image it drops out of this set, so we don't re-spend on it.
          .eq('user_id', user.id).in('asin', asins)
          .or('enriched_at.is.null,image_url.is.null').limit(100)
        const need = Array.isArray(needRows) ? needRows as { asin: string; image_url: string | null }[] : []
        if (need.length) {
          const basics = await fetchKeepaBasics(need.map((n) => n.asin))
          const at = new Date().toISOString()
          await Promise.all(need.map(async (n) => {
            const b = basics.get(n.asin.toUpperCase())
            const patch: Record<string, unknown> = { enriched_at: at }
            if (b) {
              if (b.monthlySold != null) patch.monthly_sold = b.monthlySold
              if (b.salesRank != null) patch.sales_rank = b.salesRank
              if (b.salesRankCategory) patch.sales_rank_category = b.salesRankCategory
              // Only fill the image if the scrape didn't get one.
              if (!n.image_url && b.imageUrl) patch.image_url = b.imageUrl
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('epc_products').update(patch).eq('user_id', user.id).eq('asin', n.asin)
          }))
        }
      }
    } catch (e) {
      console.warn('[epc/ingest] keepa enrich skipped:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ ok: true, saved: rows.length })
  } catch (err) {
    console.error('[epc/ingest]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't save the scan just now. Please try again.") }, { status: 500 })
  }
}
