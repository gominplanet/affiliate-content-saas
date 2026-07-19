/**
 * GET /api/social/health — dead social connections for the signed-in user.
 *
 * Powers the topbar "reconnect" alert. A channel is "dead" once it has failed
 * N scheduled posts in a row with no success since (see lib/channel-health) —
 * an expired token, a platform that was never connected but is still in the
 * publishing schedule, or one that just keeps erroring.
 *
 * Read-only + cheap (one indexed read of recent finished rows). VA-aware:
 * reports on the OWNER's channels, since that's whose connections publish.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getDeadChannels } from '@/lib/channel-health'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const dead = await getDeadChannels(supabase, ownerId)
  return NextResponse.json({ dead, count: dead.length })
}
