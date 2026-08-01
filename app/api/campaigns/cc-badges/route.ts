// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/cc-badges   { asins: string[] }
//
// Batch "which of these ASINs have a LIVE Creator Connections campaign?" for the
// Blog Post Generator list, so each post can show a small "CC" badge. One
// GIN-indexed overlap query against the shared catalog (cc_campaign_catalog),
// no SCOUT, no Amazon traffic. Returns the subset of input ASINs that match.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { asins?: string[] }
  const asins = [...new Set((body.asins ?? [])
    .map(a => String(a || '').toUpperCase())
    .filter(a => /^[A-Z0-9]{10}$/.test(a)))].slice(0, 120)
  if (!asins.length) return NextResponse.json({ ok: true, matched: [] })

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const wanted = new Set(asins)
  const matched = new Set<string>()
  try {
    // Rows whose asins array OVERLAPS our input set, among live campaigns. Each
    // row may carry several ASINs; intersect with the input to mark matches.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('cc_campaign_catalog')
      .select('asins')
      .overlaps('asins', asins)
      .gte('ends_at', today)
      .limit(2000)
    for (const row of (data ?? []) as Array<{ asins: string[] | null }>) {
      for (const a of row.asins ?? []) {
        const up = String(a || '').toUpperCase()
        if (wanted.has(up)) matched.add(up)
      }
    }
  } catch { /* best-effort — return whatever matched */ }

  return NextResponse.json({ ok: true, matched: [...matched] })
}
