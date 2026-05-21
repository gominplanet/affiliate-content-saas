/**
 * POST /api/campaigns/ingest
 *
 * Bearer-token authed (NOT a session — the Chrome extension runs on
 * amazon.com and has no dashboard cookie). The user's per-account
 * ingest token (integrations.cc_ingest_token) resolves the account;
 * RLS is bypassed via the service-role client.
 *
 * Body: { campaigns: [{ asin, campaignName?, epc?, endsAt? }] }
 *
 * Each scouted campaign becomes a `pending` campaigns row, ready for
 * one-click "Generate post" on the CC Campaigns page. ASINs that already
 * have a non-failed campaign row are skipped (idempotent re-scans).
 *
 * Pro-tier only — same gate as the generate route.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

interface IncomingCampaign {
  asin?: string
  campaignName?: string
  epc?: string
  endsAt?: string
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (request.headers.get('x-cc-token') || '').trim()
    if (!token) {
      return NextResponse.json({ error: 'Missing ingest token' }, { status: 401, headers: CORS })
    }

    const admin = createAdminClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (admin as any)
      .from('integrations')
      .select('user_id,tier')
      .eq('cc_ingest_token', token)
      .single()
    if (!intRow?.user_id) {
      return NextResponse.json({ error: 'Invalid ingest token' }, { status: 401, headers: CORS })
    }
    const userId = intRow.user_id as string
    const tier = (intRow.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json(
        { error: 'CC Campaigns is a Pro plan feature.' },
        { status: 403, headers: CORS },
      )
    }

    const body = await request.json().catch(() => ({})) as { campaigns?: IncomingCampaign[] }
    const incoming = Array.isArray(body.campaigns) ? body.campaigns : []
    if (incoming.length === 0) {
      return NextResponse.json({ error: 'No campaigns in payload' }, { status: 400, headers: CORS })
    }

    // Normalize + validate
    const seen = new Set<string>()
    const clean = incoming
      .map(c => {
        const asin = String(c.asin ?? '').toUpperCase().trim()
        return {
          asin,
          campaign_name: c.campaignName?.toString().trim() || null,
          epc: c.epc?.toString().trim() || null,
          ends_at: c.endsAt?.toString().trim() || null,
        }
      })
      .filter(c => {
        if (!/^[A-Z0-9]{10}$/.test(c.asin)) return false
        if (seen.has(c.asin)) return false
        seen.add(c.asin)
        return true
      })

    if (clean.length === 0) {
      return NextResponse.json({ error: 'No valid ASINs in payload' }, { status: 400, headers: CORS })
    }

    // Skip ASINs that already have a live (non-failed) campaign row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (admin as any)
      .from('campaigns')
      .select('asin,status')
      .eq('user_id', userId)
      .in('asin', clean.map(c => c.asin))
    const blocked = new Set<string>(
      ((existing ?? []) as { asin: string; status: string }[])
        .filter(r => r.status !== 'failed')
        .map(r => r.asin),
    )

    const toInsert = clean
      .filter(c => !blocked.has(c.asin))
      .map(c => ({ ...c, user_id: userId, status: 'pending' as const }))

    let inserted = 0
    if (toInsert.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await (admin as any)
        .from('campaigns')
        .insert(toInsert, { count: 'exact' })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })
      }
      inserted = count ?? toInsert.length
    }

    return NextResponse.json(
      { ok: true, inserted, skipped: clean.length - toInsert.length, received: incoming.length },
      { headers: CORS },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS })
  }
}
