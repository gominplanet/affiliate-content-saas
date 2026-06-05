/**
 * POST /api/campaigns/import
 *
 * Session-authed bulk import for the CC & EPC Campaign page. The browser
 * already unzipped + filtered Amazon's "Download all available
 * campaigns" export client-side, so we only receive the (capped) set of
 * matches here. Inserts them as `pending` campaigns, deduped on ASIN
 * (same contract as /api/campaigns/ingest). Pro-tier only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsCampaigns, type Tier } from '@/lib/tier'
import { fetchAmazonProduct } from '@/services/amazon'

export const maxDuration = 60

// Hard server cap regardless of what the client sent. Lowered from 1000
// to 100 per the 2026-06-05 product decision — a single creator queuing
// more than 100 campaigns at once tends to bloat their library with
// low-attention posts AND burn the per-tier blog-generation cap on
// rows they'll never publish. UI also offers a max of 100 in the
// Queue cap dropdown; this is the defence-in-depth backstop.
const MAX = 100

interface Incoming {
  asin?: string
  campaignId?: string
  campaignName?: string
  epc?: string
  endsAt?: string
  /** Snapshot of the catalog's price at the moment the user queued
   *  this row. Optional because legacy/manual paths might not send it. */
  price?: number | null
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsCampaigns(tier)) {
      return NextResponse.json({ error: 'Creator Campaigns is a Pro feature.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { campaigns?: Incoming[] }
    const incoming = Array.isArray(body.campaigns) ? body.campaigns : []
    if (incoming.length === 0) {
      return NextResponse.json({ error: 'No campaigns in payload' }, { status: 400 })
    }

    const seen = new Set<string>()
    const clean = incoming
      .map(c => ({
        asin: String(c.asin ?? '').toUpperCase().trim(),
        cc_campaign_id: c.campaignId?.toString().trim() || null,
        campaign_name: c.campaignName?.toString().trim() || null,
        epc: c.epc?.toString().trim() || null,
        ends_at: c.endsAt?.toString().trim() || null,
        // Coerce only numeric prices; anything else (string, NaN, null)
        // lands as null on the row, which the queue UI renders as no
        // price chip rather than "$NaN".
        product_price: typeof c.price === 'number' && isFinite(c.price) && c.price > 0 ? c.price : null,
      }))
      .filter(c => {
        if (!/^[A-Z0-9]{10}$/.test(c.asin) || seen.has(c.asin)) return false
        seen.add(c.asin)
        return true
      })
      .slice(0, MAX)

    if (clean.length === 0) {
      return NextResponse.json({ error: 'No valid ASINs in payload' }, { status: 400 })
    }

    // Skip ASINs that already have a non-failed campaign row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase
      .from('campaigns')
      .select('asin,status')
      .eq('user_id', user.id)
      .in('asin', clean.map(c => c.asin))
    const blocked = new Set<string>(
      ((existing ?? []) as { asin: string; status: string }[])
        .filter(r => r.status !== 'failed')
        .map(r => r.asin),
    )

    const toInsert = clean
      .filter(c => !blocked.has(c.asin))
      .map(c => ({ ...c, user_id: user.id, status: 'pending' as const }))

    let inserted = 0
    let insertedRows: Array<{ id: string; asin: string }> = []
    if (toInsert.length > 0) {
      // Cast through `any` — campaigns.product_price was added in
      // migration 099 and the generated Database types in this branch
      // don't know about it yet. Drop the cast on the next types-regen
      // pass.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error, count } = await (supabase as any)
        .from('campaigns')
        .insert(toInsert, { count: 'exact' })
        .select('id,asin')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      inserted = count ?? toInsert.length
      insertedRows = (data ?? []) as Array<{ id: string; asin: string }>
    }

    // ── Price + title enrichment (best-effort, throttled) ─────────────────
    // Amazon's Creator Connections weekly export ships no price column,
    // so the catalog rows we just queued have price = null. Scrape each
    // product page now to backfill product_price + product_title on the
    // freshly-queued rows. Stays under Vercel's 60s function ceiling at
    // queue ≤100: concurrency 5, batches of 5, ~1-2s per batch.
    //
    // Best-effort by design — Amazon will rate-limit some calls, return
    // captchas, or just not surface a price for some ASINs. We log the
    // miss and leave the column null (which the UI renders as "no price
    // chip"). The queue itself still lands every row.
    const enrichResult = { ok: 0, failed: 0 }
    if (insertedRows.length > 0) {
      const CONCURRENCY = 5
      // Parse "$24.99" / "$19.99 - $29.99" → 24.99 / 19.99. Mirrors the
      // admin parser logic so price formatting is consistent across the
      // two ingest paths.
      const parsePrice = (s: string | null): number | null => {
        if (!s) return null
        const m = s.match(/[\d]+\.?\d*/)
        const n = m ? parseFloat(m[0]) : NaN
        return isNaN(n) || n <= 0 ? null : n
      }
      async function enrichOne(row: { id: string; asin: string }) {
        try {
          const product = await fetchAmazonProduct(row.asin)
          const price = parsePrice(product.price)
          const title = product.title?.trim() || null
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('campaigns')
            .update({
              ...(price ? { product_price: price } : {}),
              ...(title ? { product_title: title } : {}),
            })
            .eq('id', row.id)
          enrichResult.ok++
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[campaigns/import enrich] ${row.asin}:`, e instanceof Error ? e.message : e)
          enrichResult.failed++
        }
      }
      for (let i = 0; i < insertedRows.length; i += CONCURRENCY) {
        const batch = insertedRows.slice(i, i + CONCURRENCY)
        await Promise.all(batch.map(enrichOne))
      }
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skipped: clean.length - toInsert.length,
      received: incoming.length,
      cappedAt: incoming.length > MAX ? MAX : null,
      enriched: enrichResult.ok,
      enrich_failed: enrichResult.failed,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
