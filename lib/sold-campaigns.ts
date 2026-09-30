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
// OTHER COLOURS AND SIZES COUNT. A creator who sold the black fan matches a
// campaign naming the white one, or naming the parent listing, through the
// product's family (lib/asin-family). Such a match says so: Amazon pays a
// campaign's commission on the products it names, so the row names the
// version the campaign pays on, and it is not presented as the one sold.
//
// A campaign with no open slots is left out (it cannot be accepted), and one
// past its end date too. Each match says what the product earned, so the list
// is read in the order of what is worth most.

import { ccRequestUrl } from '@/lib/cc-urls'
import { familiesFor, familyMembers, type Family } from '@/lib/asin-family'

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
  /** 'exact': the campaign names the product sold. 'variant': it names another
   *  colour or size of it, or its parent listing. */
  matchKind: 'exact' | 'variant'
  /** The product the campaign pays on, when it is not `asin`. */
  campaignAsin: string | null
  /** The sold product's own colour or size, when known. */
  soldAttrs: string | null
  productTitle: string | null
  orders: number
  earningsCents: number
  detailsUrl: string
}

export async function soldCampaignMatches(sb: Sb, ownerId: string, opts: { days?: number; familySb?: Sb; maxLookups?: number } = {}): Promise<{ matches: SoldMatch[]; soldProducts: number; synced: boolean; familiesKnown: number }> {
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
    return { matches: [], soldProducts: 0, synced: (count ?? 0) > 0, familiesKnown: 0 }
  }

  // Campaigns already accepted, from both places MVP records them.
  const accepted = new Set<string>()
  const [a1, a2] = await Promise.all([
    sb.from('cc_accepted_campaigns').select('campaign_id').eq('user_id', ownerId).limit(5000),
    sb.from('campaigns').select('cc_campaign_id').eq('user_id', ownerId).not('accepted_at', 'is', null).not('cc_campaign_id', 'is', null).limit(5000),
  ])
  for (const r of (a1.data ?? []) as Array<{ campaign_id: string }>) accepted.add(r.campaign_id)
  for (const r of (a2.data ?? []) as Array<{ cc_campaign_id: string }>) accepted.add(r.cc_campaign_id)

  // Families, best earners first so a Keepa limit falls on the least sold.
  const asins = [...sold.keys()].sort((x, y) => sold.get(y)!.earningsCents - sold.get(x)!.earningsCents)
  const { families } = await familiesFor(opts.familySb ?? sb, asins, { maxLookups: opts.maxLookups })
  // Every product that counts as a sold one, pointing back at the sold ASINs.
  const bySibling = new Map<string, Set<string>>()
  const byParent = new Map<string, Set<string>>()
  for (const a of asins) {
    const f: Family | undefined = families.get(a)
    for (const m of familyMembers(f, a)) {
      if (!bySibling.has(m)) bySibling.set(m, new Set())
      bySibling.get(m)!.add(a)
    }
    // A product with no parent may be the parent itself (a single listing).
    const parent = f?.parentAsin ?? a
    if (!byParent.has(parent)) byParent.set(parent, new Set())
    byParent.get(parent)!.add(a)
  }

  type Cat = { campaign_id: string; campaign_name: string; brand_name: string | null; asins: string[]; commission_pct: number; ends_at: string; available_slot: number | null; parent_asin: string | null }
  const today = new Date().toISOString().slice(0, 10)
  const cols = 'campaign_id, campaign_name, brand_name, asins, commission_pct, ends_at, available_slot, parent_asin'
  const campaigns = new Map<string, Cat>()
  const keys = [...bySibling.keys()]
  for (let i = 0; i < keys.length; i += 150) {
    const { data } = await sb.from('cc_campaign_catalog').select(cols).overlaps('asins', keys.slice(i, i + 150)).gte('ends_at', today).limit(1000)
    for (const c of (data ?? []) as Cat[]) campaigns.set(c.campaign_id, c)
  }
  const parents = [...byParent.keys()]
  for (let i = 0; i < parents.length; i += 150) {
    const { data } = await sb.from('cc_campaign_catalog').select(cols).in('parent_asin', parents.slice(i, i + 150)).gte('ends_at', today).limit(1000)
    for (const c of (data ?? []) as Cat[]) campaigns.set(c.campaign_id, c)
  }

  const found = new Map<string, SoldMatch>()
  const best = (list: string[]) => list.sort((x, y) => sold.get(y)!.earningsCents - sold.get(x)!.earningsCents)[0]
  for (const c of campaigns.values()) {
    if (accepted.has(c.campaign_id)) continue
    if (c.available_slot != null && c.available_slot <= 0) continue
    const named = (c.asins ?? []).map((x) => String(x).toUpperCase())
    // Exact first: the campaign names a product this creator sold.
    const exact = named.filter((x) => sold.has(x))
    let asin: string | undefined
    let campaignAsin: string | null = null
    let kind: 'exact' | 'variant' = 'exact'
    if (exact.length) {
      asin = best(exact)
    } else {
      // Then a sibling or the parent named by the campaign, or the campaign's
      // product sharing a parent with one sold.
      const via = new Map<string, string>() // sold asin -> the campaign product it matched
      for (const x of named) for (const a of bySibling.get(x) ?? []) if (!via.has(a)) via.set(a, x)
      if (c.parent_asin) for (const a of byParent.get(String(c.parent_asin).toUpperCase()) ?? []) if (!via.has(a)) via.set(a, named[0] ?? String(c.parent_asin))
      if (!via.size) continue
      asin = best([...via.keys()])
      campaignAsin = via.get(asin) ?? null
      kind = 'variant'
    }
    const s = sold.get(asin)!
    found.set(c.campaign_id, {
      campaignId: c.campaign_id, campaignName: c.campaign_name, brand: c.brand_name,
      commissionPct: Number(c.commission_pct) || 0, endsAt: c.ends_at, slotsLeft: c.available_slot,
      asin, matchKind: kind, campaignAsin, soldAttrs: families.get(asin)?.attrs ?? null,
      productTitle: s.title, orders: s.orders, earningsCents: s.earningsCents,
      detailsUrl: ccRequestUrl(c.campaign_id),
    })
  }
  const matches = [...found.values()].sort((x, y) => y.earningsCents - x.earningsCents || y.commissionPct - x.commissionPct)
  return { matches, soldProducts: sold.size, synced: true, familiesKnown: [...families.values()].filter((f) => f.parentAsin || f.siblings.length).length }
}
