// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CREATOR CONNECTIONS CAMPAIGNS FOR PRODUCTS THE CREATOR ALREADY SELLS.
//
// A product that sells through a creator's links earns the base Amazon rate.
// If its brand runs a Creator Connections campaign, accepting it adds the
// campaign commission to every sale after that, for work already done. This
// finds those: products with orders in the creator's own Amazon earnings
// (amazon_earnings_products), crossed with open campaigns in the shared
// catalog (cc_campaign_catalog), less any campaign already accepted.
//
// A campaign with no open slots is left out (it cannot be accepted), and one
// past its end date too. Each match says what the product earned, so the list
// is read in the order of what is worth most.

import { ccRequestUrl } from '@/lib/cc-urls'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export type SoldMatch = {
  campaignId: string
  campaignName: string
  brand: string | null
  commissionPct: number
  endsAt: string
  slotsLeft: number | null
  asin: string
  productTitle: string | null
  orders: number
  earningsCents: number
  detailsUrl: string
}

export async function soldCampaignMatches(sb: Sb, ownerId: string, opts: { days?: number } = {}): Promise<{ matches: SoldMatch[]; soldProducts: number; synced: boolean }> {
  const days = opts.days ?? 90
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  // What sold, per product, over the window.
  const sold = new Map<string, { orders: number; earningsCents: number; title: string | null }>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('amazon_earnings_products')
      .select('asin, product_title, orders, earnings_cents')
      .eq('user_id', ownerId).gte('period_start', since).gt('orders', 0)
      .range(from, from + 999)
    if (error) break
    for (const r of (data ?? []) as Array<{ asin: string; product_title: string | null; orders: number | null; earnings_cents: number | null }>) {
      const a = String(r.asin || '').toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(a)) continue
      const cur = sold.get(a) ?? { orders: 0, earningsCents: 0, title: r.product_title }
      cur.orders += Number(r.orders) || 0
      cur.earningsCents += Number(r.earnings_cents) || 0
      sold.set(a, cur)
    }
    if (!data || data.length < 1000) break
  }
  if (!sold.size) {
    const { count } = await sb.from('amazon_earnings_products').select('asin', { count: 'exact', head: true }).eq('user_id', ownerId)
    return { matches: [], soldProducts: 0, synced: (count ?? 0) > 0 }
  }

  // Campaigns already accepted, from both places MVP records them.
  const accepted = new Set<string>()
  const [a1, a2] = await Promise.all([
    sb.from('cc_accepted_campaigns').select('campaign_id').eq('user_id', ownerId).limit(5000),
    sb.from('campaigns').select('cc_campaign_id').eq('user_id', ownerId).not('accepted_at', 'is', null).not('cc_campaign_id', 'is', null).limit(5000),
  ])
  for (const r of (a1.data ?? []) as Array<{ campaign_id: string }>) accepted.add(r.campaign_id)
  for (const r of (a2.data ?? []) as Array<{ cc_campaign_id: string }>) accepted.add(r.cc_campaign_id)

  // Open campaigns that name any sold product.
  const today = new Date().toISOString().slice(0, 10)
  const asins = [...sold.keys()]
  const found = new Map<string, SoldMatch>()
  for (let i = 0; i < asins.length; i += 150) {
    const part = asins.slice(i, i + 150)
    const { data } = await sb.from('cc_campaign_catalog')
      .select('campaign_id, campaign_name, brand_name, asins, commission_pct, ends_at, available_slot')
      .overlaps('asins', part).gte('ends_at', today).limit(1000)
    for (const c of (data ?? []) as Array<{ campaign_id: string; campaign_name: string; brand_name: string | null; asins: string[]; commission_pct: number; ends_at: string; available_slot: number | null }>) {
      if (accepted.has(c.campaign_id)) continue
      if (c.available_slot != null && c.available_slot <= 0) continue
      // The best-selling product of theirs this creator sold names the match.
      const mine = (c.asins ?? []).map((x) => String(x).toUpperCase()).filter((x) => sold.has(x))
        .sort((x, y) => (sold.get(y)!.earningsCents - sold.get(x)!.earningsCents))
      if (!mine.length) continue
      const s = sold.get(mine[0])!
      const prev = found.get(c.campaign_id)
      if (prev && prev.earningsCents >= s.earningsCents) continue
      found.set(c.campaign_id, {
        campaignId: c.campaign_id, campaignName: c.campaign_name, brand: c.brand_name,
        commissionPct: Number(c.commission_pct) || 0, endsAt: c.ends_at, slotsLeft: c.available_slot,
        asin: mine[0], productTitle: s.title, orders: s.orders, earningsCents: s.earningsCents,
        detailsUrl: ccRequestUrl(c.campaign_id),
      })
    }
  }
  const matches = [...found.values()].sort((x, y) => y.earningsCents - x.earningsCents || y.commissionPct - x.commissionPct)
  return { matches, soldProducts: sold.size, synced: true }
}
