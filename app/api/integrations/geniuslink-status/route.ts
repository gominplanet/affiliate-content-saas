// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/integrations/geniuslink-status — cheap "does this creator already
// track clicks per channel?" check for the one-time nudge in
// lib/geniuslink-nudge. No external calls, just the integrations row.
//
// Returns the link style as well as the Geniuslink connection, because
// Geniuslink is not the only way to get per-channel clicks: Passport Links
// file every click under its channel too. Only a creator on plain tagged
// Amazon links has nothing tracking them, and only they should be told.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getLinkStyle } from '@/lib/link-cloak'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  // Unknown is not "untracked": an unreadable answer never earns a nudge.
  if (auth.error) return NextResponse.json({ connected: false, linkStyle: null })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = await getLinkStyle(supabase as any, auth.ownerId)
  const connected = !!(cfg.geniuslinkKey && cfg.geniuslinkSecret)
  return NextResponse.json({ connected, linkStyle: cfg.style })
}
