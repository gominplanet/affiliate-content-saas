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
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export const maxDuration = 60

const MAX = 1000 // hard server cap regardless of client

interface Incoming {
  asin?: string
  campaignName?: string
  epc?: string
  endsAt?: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json({ error: 'CC Campaigns is a Pro plan feature.' }, { status: 403 })
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
        campaign_name: c.campaignName?.toString().trim() || null,
        epc: c.epc?.toString().trim() || null,
        ends_at: c.endsAt?.toString().trim() || null,
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
    const { data: existing } = await (supabase as any)
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
    if (toInsert.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await (supabase as any)
        .from('campaigns').insert(toInsert, { count: 'exact' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      inserted = count ?? toInsert.length
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skipped: clean.length - toInsert.length,
      received: incoming.length,
      cappedAt: incoming.length > MAX ? MAX : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
