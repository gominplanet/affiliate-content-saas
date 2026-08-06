// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// POST /api/campaigns/sync-joined
//   { campaigns: [{ campaignId, asin, brand, name }] }
//
// Ingests the creator's ACCEPTED/ACTIVE Creator Connections campaigns as read
// straight from Amazon by SCOUT (collaboration/search), so "Joined only" shows
// everything they've joined — including campaigns joined directly on Amazon, not
// just those accepted through MVP. Marks each ASIN accepted in the per-user
// campaigns table (upsert; readers OR flags across rows). Session-authed.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface InCampaign { campaignId?: string; asin?: string; brand?: string; name?: string }

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth

    const body = await request.json().catch(() => ({})) as { campaigns?: InCampaign[] }
    const now = new Date().toISOString()

    // Dedup incoming by valid ASIN, cap for safety.
    const byAsin = new Map<string, InCampaign>()
    for (const c of body.campaigns ?? []) {
      const a = String(c?.asin || '').toUpperCase()
      if (/^[A-Z0-9]{10}$/.test(a) && !byAsin.has(a)) byAsin.set(a, c)
      if (byAsin.size >= 1000) break
    }
    if (byAsin.size === 0) return NextResponse.json({ ok: true, synced: 0, inserted: 0, updated: 0 })

    const asins = [...byAsin.keys()]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // Which of these ASINs already have a campaigns row for this user?
    const { data: existing } = await sb
      .from('campaigns')
      .select('id,asin')
      .eq('user_id', ownerId)
      .in('asin', asins)
    const existingByAsin = new Map<string, string>()
    for (const r of existing ?? []) {
      const a = String(r?.asin || '').toUpperCase()
      if (a && !existingByAsin.has(a)) existingByAsin.set(a, r.id)
    }

    const toUpdateIds: string[] = []
    const toInsert: Record<string, unknown>[] = []
    for (const [asin, c] of byAsin) {
      const id = existingByAsin.get(asin)
      if (id) { toUpdateIds.push(id); continue }
      const row: Record<string, unknown> = { user_id: ownerId, asin, status: 'pending', accepted_at: now }
      if (c.campaignId) row.cc_campaign_id = c.campaignId
      if (c.brand) row.brand_name = String(c.brand).slice(0, 200)
      if (c.name) row.product_title = String(c.name).slice(0, 300)
      toInsert.push(row)
    }

    if (toUpdateIds.length) {
      await sb.from('campaigns').update({ accepted_at: now, updated_at: now }).in('id', toUpdateIds)
    }
    if (toInsert.length) {
      await sb.from('campaigns').insert(toInsert)
    }

    return NextResponse.json({ ok: true, synced: byAsin.size, inserted: toInsert.length, updated: toUpdateIds.length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
