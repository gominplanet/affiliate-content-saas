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

    const body = await request.json().catch(() => ({})) as { campaigns?: InCampaign[]; reconcile?: boolean }
    const now = new Date().toISOString()
    // Reconcile (default on): after writing the incoming joined set, clear the
    // amazon_joined_at marker on the user's rows that are NO LONGER in Amazon's
    // list, so "Joined only" mirrors Amazon exactly. Only runs when we got a
    // non-empty list (guarded below) — a failed/empty sync never wipes the saved
    // joined set, which is the whole point of persisting it.
    const reconcile = body.reconcile !== false

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
      // amazon_joined_at is the authoritative, PERSISTED "joined on Amazon" marker
      // that "Joined only" reads — so the joined list survives reloads with no
      // re-sync. accepted_at is written alongside for badge/back-compat.
      const row: Record<string, unknown> = { user_id: ownerId, asin, status: 'pending', accepted_at: now, amazon_joined_at: now }
      if (c.campaignId) row.cc_campaign_id = c.campaignId
      if (c.brand) row.brand_name = String(c.brand).slice(0, 200)
      if (c.name) row.product_title = String(c.name).slice(0, 300)
      toInsert.push(row)
    }

    if (toUpdateIds.length) {
      await sb.from('campaigns').update({ accepted_at: now, amazon_joined_at: now, updated_at: now }).in('id', toUpdateIds)
    }
    if (toInsert.length) {
      await sb.from('campaigns').insert(toInsert)
    }

    // Reconcile: clear the joined marker on rows that are no longer in Amazon's
    // list, so "Joined only" stays an exact mirror. Guarded by a healthy non-empty
    // sync (byAsin.size > 0 is already true here) so a bad sync can't wipe the set.
    let cleared = 0
    if (reconcile) {
      const { data: stale } = await sb
        .from('campaigns')
        .select('id,asin')
        .eq('user_id', ownerId)
        .not('amazon_joined_at', 'is', null)
      const staleIds = (stale ?? [])
        .filter((r: { asin?: string }) => !byAsin.has(String(r?.asin || '').toUpperCase()))
        .map((r: { id: string }) => r.id)
      if (staleIds.length) {
        // Batch in chunks to keep the IN() lists sane.
        for (let i = 0; i < staleIds.length; i += 200) {
          const chunk = staleIds.slice(i, i + 200)
          await sb.from('campaigns').update({ amazon_joined_at: null, updated_at: now }).in('id', chunk)
        }
        cleared = staleIds.length
      }
    }

    return NextResponse.json({ ok: true, synced: byAsin.size, inserted: toInsert.length, updated: toUpdateIds.length, cleared })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
