// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/covered-sales — once a day, every creator with the feature
// (admin only while it is in Labs testing, lib/labs-preview) has their covered
// products checked, and a product that has gone on sale raises an alert
// in the dashboard's Price Alerts box (price_alerts, kind 'covered_sale').
//
// FAIR AND BOUNDED. Creators are taken least-recently-checked first, as many
// as the time allows, and the check itself reads the shared deal cache before
// spending any Keepa tokens (lib/covered-sales). One alert per product per
// week, unless the sale gets at least ten points deeper, so a long sale does
// not raise the same alert every morning.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { coveredProducts, findSales, saleLabel } from '@/lib/covered-sales'
import { fetchKeepaTokenStatus } from '@/services/keepa'

export const runtime = 'nodejs'
export const maxDuration = 300

const REALERT_DAYS = 7
const DEEPER_BY = 10

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  const left = () => 280_000 - (Date.now() - started)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any

  const { data: ints } = await sb.from('integrations').select('user_id,tier').not('tier', 'is', null).limit(5000)
  const labs = ((ints ?? []) as Array<{ user_id: string; tier: string }>)
    .filter((r) => canUsePreview('on_sale', r.tier)).map((r) => r.user_id)
  if (labs.length === 0) return NextResponse.json({ ok: true, users: 0 })

  // Least recently checked first. A database without migration 373 has no
  // table to remember in, and simply checks in the order it has.
  const lastChecked = new Map<string, string>()
  const { data: checks, error: chkErr } = await sb.from('covered_sale_checks').select('user_id,checked_at').in('user_id', labs)
  if (!chkErr) for (const c of (checks ?? []) as Array<{ user_id: string; checked_at: string }>) lastChecked.set(c.user_id, c.checked_at)
  const order = [...labs].sort((a, b) => (lastChecked.get(a) ?? '').localeCompare(lastChecked.get(b) ?? ''))

  let users = 0, alerts = 0
  for (const userId of order) {
    if (left() < 90_000) break
    // KEEPA IS SHARED with every other feature. Below a floor, stop and let
    // tomorrow's run carry on from the creators not reached today.
    const tokens = await fetchKeepaTokenStatus()
    if (tokens.tokensLeft != null && tokens.tokensLeft < 150) break
    const covered = await coveredProducts(sb, userId)
    const onSale = covered.length ? await findSales(sb, covered, { keepaCap: 100 }) : []

    if (onSale.length) {
      const since = new Date(Date.now() - REALERT_DAYS * 86_400_000).toISOString()
      const { data: recent } = await sb.from('price_alerts').select('asin,label')
        .eq('user_id', userId).eq('kind', 'covered_sale').gte('created_at', since)
      const recentPct = new Map<string, number>()
      for (const r of (recent ?? []) as Array<{ asin: string; label: string | null }>) {
        // No percentage in the label (a lightning deal, a new low) counts as
        // the deepest, so the same sale is not raised again within the week.
        const m = /(\d+)%/.exec(r.label || '')
        recentPct.set(r.asin, Math.max(recentPct.get(r.asin) ?? 0, m ? Number(m[1]) : 100))
      }
      const rows = onSale.filter((p) => {
        const was = recentPct.get(p.asin)
        return was === undefined || (p.verdict.pct ?? 0) >= was + DEEPER_BY
      }).slice(0, 10).map((p) => {
        const vids = p.sources.filter((s) => s.kind === 'video').length
        return {
          user_id: userId, asin: p.asin, kind: 'covered_sale',
          title: p.title, image_url: p.image,
          price_now_cents: p.verdict.nowCents, price_ref_cents: p.verdict.refCents,
          label: `${saleLabel(p.verdict)}. ${vids ? `In ${vids} of your videos` : 'In your storefront'}`,
        }
      })
      if (rows.length) {
        const { error } = await sb.from('price_alerts').insert(rows)
        if (!error) alerts += rows.length
      }
    }
    await sb.from('covered_sale_checks').upsert({
      user_id: userId, checked_at: new Date().toISOString(), asins: covered.length, on_sale: onSale.length,
    }, { onConflict: 'user_id' })
    users++
  }
  return NextResponse.json({ ok: true, users, alerts, of: order.length })
}
