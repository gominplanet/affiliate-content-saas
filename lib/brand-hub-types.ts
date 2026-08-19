// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand Hub — the consolidated brand-relationship view. Brand data lives in
// three disjoint tables today (inbound brand_inquiries, outbound
// collaborations, and Amazon Creator Connections campaigns), keyed differently
// and with no shared brand entity. This module is the pure join layer: it takes
// rows from all three and folds them into one timeline per brand, so a creator
// can finally see the full history of every brand they've talked to.
//
// Kept framework-free (no Supabase, no React) so it's trivially testable and
// shared by both the API route and the page.

export type BrandEventType =
  | 'inquiry'            // a brand messaged the creator through their blog form
  | 'pitch'             // the creator sent an outreach pitch email
  | 'campaign_added'    // an Amazon CC campaign was queued/saved
  | 'campaign_messaged' // the creator messaged the brand inside Amazon
  | 'campaign_accepted' // the creator accepted the campaign
  | 'campaign_joined'   // Amazon confirmed the creator joined
  | 'post_published'    // a post went live for this brand

export interface BrandEvent {
  type: BrandEventType
  /** ISO timestamp — the timeline sorts on this. */
  at: string
  title: string
  detail?: string
  url?: string
  email?: string
  product?: string
  platforms?: string[]
  /** Inbound inquiry that hasn't been read yet. */
  unread?: boolean
}

export type BrandChannel = 'inbound' | 'pitch' | 'campaign'

export interface BrandEntity {
  key: string
  name: string
  channels: BrandChannel[]
  /** Headline status, derived from the furthest-along event. */
  status: string
  lastActivityAt: string
  counts: { inquiries: number; pitches: number; campaigns: number; postsPublished: number }
  /** Unread inbound inquiries for this brand. */
  unread: number
  /** Newest first. */
  events: BrandEvent[]
}

export interface BrandHubData {
  brands: BrandEntity[]
  totals: { brands: number; inquiries: number; pitches: number; campaigns: number; unread: number }
}

// ── Input row shapes (loosely typed — the route selects resiliently) ─────────

export interface InquiryRow {
  brand_name?: string | null
  contact_name?: string | null
  contact_email?: string | null
  message?: string | null
  source_url?: string | null
  read_at?: string | null
  archived?: boolean | null
  created_at?: string | null
}

export interface CampaignRow {
  brand_name?: string | null
  product_title?: string | null
  campaign_name?: string | null
  commission_pct?: number | null
  messaged_at?: string | null
  last_message?: string | null
  accepted_at?: string | null
  amazon_joined_at?: string | null
  status?: string | null
  wordpress_url?: string | null
  details_url?: string | null
  created_at?: string | null
}

export interface CollabRow {
  brand_name?: string | null
  brand_url?: string | null
  product_or_asin?: string | null
  generated_email?: string | null
  platforms?: string[] | null
  website_url?: string | null
  youtube_url?: string | null
  created_at?: string | null
}

/**
 * A brand-side link for a pitch, if we have one. Prefers the brand's own site;
 * falls back to the product the pitch is about (a full URL, or an ASIN turned
 * into an Amazon link). Returns undefined when there's nothing brand-relevant —
 * we deliberately never fall back to the creator's own links.
 */
export function pitchBrandLink(c: CollabRow): string | undefined {
  const brand = (c.brand_url || '').trim()
  if (brand) return /^https?:\/\//i.test(brand) ? brand : `https://${brand}`
  const p = (c.product_or_asin || '').trim()
  if (!p) return undefined
  if (/^https?:\/\//i.test(p)) return p
  if (/^[A-Z0-9]{10}$/i.test(p)) return `https://www.amazon.com/dp/${p.toUpperCase()}`
  return undefined
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Collapse a brand name to a stable grouping key so "Acme Inc.", "acme", and
 * "ACME  Inc" all land on the same brand. Strips punctuation and the common
 * legal suffixes. Returns '' for empty input (caller decides the fallback).
 */
export function normalizeBrandKey(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|gmbh)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function emailDomainName(email: string | null | undefined): string {
  const m = (email || '').match(/@([^.\s]+)\./)
  if (!m) return ''
  const d = m[1]
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : ''
}

const STATUS_RANK: Record<string, number> = {
  'Joined': 6, 'Accepted': 5, 'Messaged': 4, 'Pitched': 3, 'Inquiry received': 2, 'Saved': 1,
}

interface Acc {
  key: string
  name: string
  channels: Set<BrandChannel>
  counts: { inquiries: number; pitches: number; campaigns: number; postsPublished: number }
  unread: number
  events: BrandEvent[]
  statuses: Set<string>
}

/**
 * The join. Folds all three sources into one brand-keyed timeline.
 */
export function buildBrandHub(
  inquiries: InquiryRow[],
  campaigns: CampaignRow[],
  collabs: CollabRow[],
): BrandHubData {
  const byKey = new Map<string, Acc>()

  const ensure = (rawName: string): Acc => {
    const key = normalizeBrandKey(rawName) || rawName.trim().toLowerCase() || 'unknown'
    let acc = byKey.get(key)
    if (!acc) {
      acc = {
        key,
        name: rawName.trim() || 'Unknown brand',
        channels: new Set(),
        counts: { inquiries: 0, pitches: 0, campaigns: 0, postsPublished: 0 },
        unread: 0,
        events: [],
        statuses: new Set(),
      }
      byKey.set(key, acc)
    }
    return acc
  }

  // Inbound inquiries
  for (const q of inquiries) {
    if (q.archived) continue
    const name = (q.brand_name || q.contact_name || emailDomainName(q.contact_email) || 'Unknown brand').trim()
    const acc = ensure(name)
    acc.channels.add('inbound')
    acc.counts.inquiries += 1
    acc.statuses.add('Inquiry received')
    const unread = !q.read_at
    if (unread) acc.unread += 1
    acc.events.push({
      type: 'inquiry',
      at: q.created_at || new Date(0).toISOString(),
      title: q.contact_name ? `Message from ${q.contact_name}` : 'Brand message received',
      detail: (q.message || '').trim() || undefined,
      email: q.contact_email || undefined,
      url: q.source_url || undefined,
      unread,
    })
  }

  // Outbound pitches
  for (const c of collabs) {
    const name = (c.brand_name || '').trim()
    if (!name) continue
    const acc = ensure(name)
    acc.channels.add('pitch')
    acc.counts.pitches += 1
    acc.statuses.add('Pitched')
    // The "Open" link is a BRAND-side link only (brand_url, else the pitched
    // product). We never fall back to collaborations.website_url/youtube_url —
    // those are the CREATOR's own links and opening them is useless here.
    acc.events.push({
      type: 'pitch',
      at: c.created_at || new Date(0).toISOString(),
      title: 'Pitch email sent',
      detail: (c.generated_email || '').trim() || undefined,
      url: pitchBrandLink(c),
      platforms: (c.platforms || []).filter(Boolean),
    })
  }

  // Amazon Creator Connections campaigns — one row can yield several events.
  for (const cp of campaigns) {
    const name = (cp.brand_name || cp.campaign_name || cp.product_title || '').trim()
    if (!name) continue
    const acc = ensure(name)
    acc.channels.add('campaign')
    acc.counts.campaigns += 1
    const product = (cp.product_title || cp.campaign_name || '').trim() || undefined

    acc.statuses.add('Saved')
    acc.events.push({
      type: 'campaign_added',
      at: cp.created_at || new Date(0).toISOString(),
      title: 'Campaign added',
      detail: cp.commission_pct ? `${cp.commission_pct}% commission` : undefined,
      product,
      url: cp.details_url || undefined,
    })
    if (cp.messaged_at) {
      acc.statuses.add('Messaged')
      acc.events.push({
        type: 'campaign_messaged', at: cp.messaged_at,
        title: 'Messaged brand on Amazon', detail: (cp.last_message || '').trim() || undefined, product,
      })
    }
    if (cp.accepted_at) {
      acc.statuses.add('Accepted')
      acc.events.push({ type: 'campaign_accepted', at: cp.accepted_at, title: 'Accepted campaign', product })
    }
    if (cp.amazon_joined_at) {
      acc.statuses.add('Joined')
      acc.events.push({ type: 'campaign_joined', at: cp.amazon_joined_at, title: 'Joined on Amazon', product })
    }
    if ((cp.status === 'published' || cp.status === 'posted') && cp.wordpress_url) {
      acc.counts.postsPublished += 1
      acc.events.push({
        type: 'post_published',
        at: cp.created_at || new Date(0).toISOString(),
        title: 'Post published', product, url: cp.wordpress_url,
      })
    }
  }

  const brands: BrandEntity[] = []
  let totalInq = 0, totalPitch = 0, totalCamp = 0, totalUnread = 0
  for (const acc of byKey.values()) {
    acc.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const lastActivityAt = acc.events.length ? acc.events[0].at : new Date(0).toISOString()
    // Headline = the furthest-along status this brand reached.
    let status = 'Saved'
    let best = 0
    for (const s of acc.statuses) {
      const r = STATUS_RANK[s] ?? 0
      if (r > best) { best = r; status = s }
    }
    totalInq += acc.counts.inquiries
    totalPitch += acc.counts.pitches
    totalCamp += acc.counts.campaigns
    totalUnread += acc.unread
    brands.push({
      key: acc.key,
      name: acc.name,
      channels: Array.from(acc.channels),
      status,
      lastActivityAt,
      counts: acc.counts,
      unread: acc.unread,
      events: acc.events,
    })
  }
  brands.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))

  return {
    brands,
    totals: { brands: brands.length, inquiries: totalInq, pitches: totalPitch, campaigns: totalCamp, unread: totalUnread },
  }
}
