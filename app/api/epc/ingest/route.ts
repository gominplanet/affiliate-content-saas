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
import { keepaConfigured } from '@/services/keepa'
import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildEpcPatch } from '@/lib/epc-enrich'

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
  reviewCount?: number | null
  availability?: string | null
  category?: string | null
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
          review_count: num(r.reviewCount),
          availability: (r.availability || '').trim().slice(0, 40) || null,
          category: (r.category || '').trim().slice(0, 80) || null,
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

    // How many of these are NEW to the library vs already saved. Each scan re-reads
    // the same top products, so almost all are usually dupes — reporting "saved N"
    // (all scanned) made the growing total look stuck. Compute the real new count
    // against the user's existing ASINs (one bounded column read).
    let addedCount = rows.length
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingRows } = await (supabase as any)
        .from('epc_products').select('asin').eq('user_id', user.id)
      const existingSet = new Set(((existingRows ?? []) as { asin: string }[]).map((e) => (e.asin || '').toUpperCase()))
      addedCount = rows.filter((r) => !existingSet.has(r.asin)).length
    } catch { /* fall back to rows.length */ }

    // Upsert on (user_id, asin). first_seen_at is omitted so it keeps its
    // original value on update and defaults on insert.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { error } = await (supabase as any)
      .from('epc_products')
      .upsert(rows, { onConflict: 'user_id,asin' })

    // review_count / availability / category came in migration 299. If the server
    // hasn't run 299 yet, the upsert errors on the unknown COLUMN (not a missing
    // table) — so strip those three and retry once. The core scan still saves; the
    // richer card fields just fill in on the next scan once 299 is run.
    const isColumnError = (m: string) => /could not find the '.*' column|column .* does not exist/i.test(m)
    const isMissingTable = (m: string) => /relation .*epc_products.* does not exist|could not find the table/i.test(m)
    if (error && isColumnError(error.message || '') && !isMissingTable(error.message || '')) {
      const stripped = rows.map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const o: any = { ...r }; delete o.review_count; delete o.availability; delete o.category; return o
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retry = await (supabase as any).from('epc_products').upsert(stripped, { onConflict: 'user_id,asin' })
      error = retry.error
    }

    if (error) {
      console.error('[epc/ingest]', error.message)
      // Distinguish a genuinely missing TABLE (migration 278) from a missing COLUMN
      // (migration 299) so the message points at the right fix instead of a stale one.
      const msg = error.message || ''
      return NextResponse.json({
        error: isMissingTable(msg)
          ? 'EPC storage isn’t set up on the server yet — run database migration 278 (epc_products), then scan again.'
          : isColumnError(msg)
            ? 'EPC needs a quick database update — run migration 299 (epc_card_fields), then scan again.'
            : `Could not save the scan: ${msg}`,
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
          // Only NEVER-enriched rows. Gating on image_url IS NULL too would keep
          // re-selecting products Keepa has no image for (enriched_at set, image
          // still null), re-spending tokens every scan. Migration 281 nulls
          // enriched_at once for the pre-fix blanks so they get a single retry.
          .eq('user_id', user.id).in('asin', asins)
          .is('deal_enriched_at', null).limit(100)
        const need = Array.isArray(needRows) ? needRows as { asin: string; image_url: string | null }[] : []
        if (need.length) {
          const basics = await fetchKeepaBasicsCached(createAdminClient(), need.map((n) => n.asin))
          const at = new Date().toISOString()
          await Promise.all(need.map(async (n) => {
            const patch = buildEpcPatch(basics.get(n.asin.toUpperCase()), n.image_url, at)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('epc_products').update(patch).eq('user_id', user.id).eq('asin', n.asin)
          }))
        }
      }
    } catch (e) {
      console.warn('[epc/ingest] keepa enrich skipped:', e instanceof Error ? e.message : e)
    }

    // Feed the shared cross-user catalog (migration 289) so every scan builds a
    // discovery pool all creators can browse. Product-level only (no per-user
    // data); the EPC here is a reference value. Best-effort, service-role.
    try {
      const catalogRows = rows.map((r) => ({
        asin: r.asin, title: r.title, brand: r.brand, image_url: r.image_url,
        price_cents: r.price_cents, rating: r.rating,
        review_count: r.review_count, availability: r.availability, category: r.category,
        epc_value_ref: r.epc_value, budget_ref: r.budget, last_seen_at: scannedAt,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any
      const { error: catErr } = await admin.from('epc_catalog').upsert(catalogRows, { onConflict: 'asin' })
      // Same migration-299 guard as epc_products: strip the new columns and retry
      // so the shared catalog still builds before 299 is run.
      if (catErr && isColumnError(catErr.message || '') && !isMissingTable(catErr.message || '')) {
        const stripped = catalogRows.map((r) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const o: any = { ...r }; delete o.review_count; delete o.availability; delete o.category; return o
        })
        await admin.from('epc_catalog').upsert(stripped, { onConflict: 'asin' })
      }
    } catch (e) { console.warn('[epc/ingest] catalog upsert skipped:', e instanceof Error ? e.message : e) }

    return NextResponse.json({ ok: true, saved: rows.length, added: addedCount })
  } catch (err) {
    console.error('[epc/ingest]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't save the scan just now. Please try again.") }, { status: 500 })
  }
}
