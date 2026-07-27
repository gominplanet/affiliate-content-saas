/**
 * GET /api/cron/check-price-watches
 *
 * Phase 1 of the Keepa content-trigger loop. Re-checks watched products against
 * their price history and writes a price_alert when something worth acting on
 * happens:
 *   • new_low     — hit a genuine new all-time low → "price just dropped" nudge.
 *   • stale_price — drifted far from a published post's claimed price → refresh.
 *
 * Paced like the Deal Radar enrichment: bounded per run, stops on low Keepa
 * tokens or near a wall deadline, and round-robins by least-recently-checked so
 * coverage grows without ever draining the balance.
 *
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 * Fully env-gated: with KEEPA_API_KEY unset it returns {skipped} and no-ops.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKeepaProductStats, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Max watches to check per run (env-tunable). ~1 Keepa token each, so 150/run
 *  stays well under the balance; the wall deadline caps time. The rest catch up
 *  next run (we check least-recently-checked first). */
const CHECK_MAX = Math.max(0, Number(process.env.PRICE_WATCH_CHECK_MAX) || 150)
/** A stale_price alert fires when the live price drifts at least this far (either
 *  direction) from what a published post was written against. */
const STALE_DRIFT_PCT = 20

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!keepaConfigured()) return NextResponse.json({ ok: true, skipped: 'keepa_unconfigured' })
  if (CHECK_MAX === 0) return NextResponse.json({ ok: true, skipped: 'disabled' })

  const admin = createAdminClient()
  const deadline = Date.now() + 260_000 // stay under maxDuration (300s)

  // Least-recently-checked first so coverage round-robins across runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: watches } = await (admin as any)
    .from('product_watches')
    .select('id,user_id,asin,source,blog_post_id,title,image_url,baseline_price_cents,last_price_cents,last_alerted_low_cents')
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(CHECK_MAX)

  let checked = 0
  let newLows = 0
  let stale = 0

  for (const w of (watches ?? []) as WatchRow[]) {
    if (Date.now() > deadline) break
    const a = await fetchKeepaProductStats(w.asin)
    const now = a.currentCents
    const low = a.allTimeLowCents
    const nowIso = new Date().toISOString()

    // Always stamp the check so we round-robin even when there's no event.
    const patch: Record<string, unknown> = { last_checked_at: nowIso, last_price_cents: now ?? w.last_price_cents }

    // ── new_low: at/near the all-time low AND lower than any low we've alerted.
    if (
      now != null && low != null && low > 0 &&
      now <= Math.round(low * 1.005) &&                       // is (essentially) the low
      (w.last_alerted_low_cents == null || now < w.last_alerted_low_cents)
    ) {
      await insertAlert(admin, {
        user_id: w.user_id, asin: w.asin, kind: 'new_low',
        title: w.title, image_url: w.image_url,
        price_now_cents: now, price_ref_cents: low,
        label: 'Hit an all-time low',
        blog_post_id: w.blog_post_id ?? null,
      })
      patch.last_alerted_low_cents = now
      newLows++
    }

    // ── stale_price: only for post-linked watches with a baseline, when the live
    //    price has drifted far from what the post was written against. De-duped:
    //    skip if an unseen stale alert already exists for this product.
    if (
      w.source === 'deal_post' && w.baseline_price_cents != null && w.baseline_price_cents > 0 &&
      now != null &&
      Math.abs(now - w.baseline_price_cents) / w.baseline_price_cents >= STALE_DRIFT_PCT / 100
    ) {
      const { data: existing } = await (admin as any)
        .from('price_alerts')
        .select('id')
        .eq('user_id', w.user_id).eq('asin', w.asin).eq('kind', 'stale_price').eq('seen', false)
        .limit(1)
      if (!existing?.length) {
        await insertAlert(admin, {
          user_id: w.user_id, asin: w.asin, kind: 'stale_price',
          title: w.title, image_url: w.image_url,
          price_now_cents: now, price_ref_cents: w.baseline_price_cents,
          label: now < w.baseline_price_cents ? 'Price dropped since you posted' : 'Price rose since you posted',
          blog_post_id: w.blog_post_id ?? null,
        })
        stale++
      }
    }

    await (admin as any).from('product_watches').update(patch).eq('id', w.id)
    checked++
  }

  return NextResponse.json({ ok: true, checked, newLows, stale })
}

interface WatchRow {
  id: string
  user_id: string
  asin: string
  source: string
  blog_post_id: string | null
  title: string | null
  image_url: string | null
  baseline_price_cents: number | null
  last_price_cents: number | null
  last_alerted_low_cents: number | null
}

interface NewAlert {
  user_id: string
  asin: string
  kind: 'new_low' | 'stale_price'
  title: string | null
  image_url: string | null
  price_now_cents: number | null
  price_ref_cents: number | null
  label: string
  blog_post_id: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertAlert(admin: any, alert: NewAlert): Promise<void> {
  await admin.from('price_alerts').insert(alert)
}
