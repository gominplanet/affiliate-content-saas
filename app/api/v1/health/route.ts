/**
 * GET /api/v1/health
 *
 * Public unauthenticated health probe. Lets integrations confirm the API
 * surface is reachable without needing a valid key — useful for setup
 * docs ("if `curl /api/v1/health` returns 200, your network can reach us").
 *
 * Intentionally returns the bare minimum: ok + the API version. No timestamps
 * (so the response is fully cacheable) and no environment leakage.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true, version: 'v1' })
}
