// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/global-sync/markets — the supported Amazon marketplace registry, so
// the Storefront Sync UI (and Launchpad) can render the market picker without
// hard-coding the list on the client.
import { NextResponse } from 'next/server'
import { MARKETS } from '@/lib/global-sync'

export const runtime = 'nodejs'

export async function GET() {
  const markets = MARKETS.map(m => ({
    domain: m.domain,
    code: m.code,
    country: m.country,
    langName: m.langName,
    needsTranslation: m.needsTranslation,
  }))
  return NextResponse.json({ ok: true, markets })
}
