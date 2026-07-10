/**
 * GET /api/wordpress/connection-health
 *
 * Lightweight signal for the topbar "Fix connection" button: is this owner's
 * WordPress connection currently broken (a recent publish blocked by a
 * firewall/WAF, deactivated plugin, or bad app password — with no successful
 * publish since)? The detection lives in lib/wp-connection-health so the
 * generation pre-flight (/api/blog/enqueue) shares the exact same signal.
 *
 * Response: { needsAttention: boolean, lastFailedAt?: string }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWpConnectionHealth } from '@/lib/wp-connection-health'

export async function GET() {
  const supabase = await createServerClient()
  const authCtx = await getAuthAndOwner(supabase)
  if (authCtx.error) return authCtx.error

  const health = await getWpConnectionHealth(supabase, authCtx.ownerId)
  return NextResponse.json(health)
}
