// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/brand-hub — the consolidated brand-relationship feed.
//
// Unions the three brand stores (inbound brand_inquiries, outbound
// collaborations, Amazon Creator Connections campaigns) into one brand-keyed
// timeline. Read-only; VA-aware via getAuthAndOwner. Resilient to migration lag
// on the campaigns table (same optional-column-drop trick the queue uses).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { buildBrandHub, type InquiryRow, type CampaignRow, type CollabRow } from '@/lib/brand-hub-types'

export const maxDuration = 30

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Campaigns: drop any column that a lagging DB doesn't have yet, one at a
  // time, so a single un-run migration never blanks the whole hub.
  const CAMP_CORE = ['id', 'created_at']
  const CAMP_OPT = [
    'brand_name', 'product_title', 'campaign_name', 'commission_pct',
    'messaged_at', 'last_message', 'accepted_at', 'amazon_joined_at',
    'status', 'wordpress_url', 'details_url',
  ]
  const fetchCampaigns = async () => {
    let cols = [...CAMP_CORE, ...CAMP_OPT]
    for (let i = 0; i <= CAMP_OPT.length; i++) {
      const res = await sb.from('campaigns').select(cols.join(','))
        .eq('user_id', ownerId).order('created_at', { ascending: false }).limit(1000)
      if (!res.error) return res
      const m = (res.error.message || '').match(/column\s+"?(?:[\w]+\.)*(\w+)"?\s+does not exist/i)
      if (!m) return res
      const next = cols.filter(c => c !== m[1])
      if (next.length === cols.length || next.length <= CAMP_CORE.length) return res
      cols = next
    }
    return sb.from('campaigns').select(CAMP_CORE.join(','))
      .eq('user_id', ownerId).order('created_at', { ascending: false }).limit(1000)
  }

  const [inqRes, campRes, collabRes] = await Promise.all([
    sb.from('brand_inquiries')
      .select('brand_name,contact_name,contact_email,message,source_url,read_at,archived,created_at')
      .eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(1000),
    fetchCampaigns(),
    // brand_url is migration 260 — if a DB is a beat behind, drop it and retry
    // rather than blanking every pitch.
    (async () => {
      const cols = 'brand_name,brand_url,product_or_asin,generated_email,platforms,website_url,youtube_url,created_at'
      const res = await sb.from('collaborations').select(cols)
        .eq('user_id', ownerId).order('created_at', { ascending: false }).limit(1000)
      if (!res.error) return res
      return sb.from('collaborations')
        .select('brand_name,product_or_asin,generated_email,platforms,website_url,youtube_url,created_at')
        .eq('user_id', ownerId).order('created_at', { ascending: false }).limit(1000)
    })(),
  ])

  const data = buildBrandHub(
    (inqRes.data as InquiryRow[]) || [],
    (campRes.data as CampaignRow[]) || [],
    (collabRes.data as CollabRow[]) || [],
  )
  return NextResponse.json(data)
}
