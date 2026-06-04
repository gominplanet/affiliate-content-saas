// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// GET /api/wordpress/health
//
// THE single authoritative WordPress connection check for the dashboard.
// Wraps lib/wordpress-health.ts probeWpHealth(). Every "Connected" badge
// in the UI calls this — never reads DB fields directly. Server
// components can skip this endpoint and call probeWpHealth() in-process.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { probeWpHealth } from '@/lib/wordpress-health'

export const maxDuration = 15

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')
  const result = await probeWpHealth(supabase, user.id, siteId)
  return NextResponse.json(result)
}
