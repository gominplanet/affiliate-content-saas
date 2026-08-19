// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/integrations/geniuslink-status — cheap "is Geniuslink connected?"
// check for client-side upsell nudges. No external calls, just a column read.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return NextResponse.json({ connected: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations')
    .select('geniuslink_api_key,geniuslink_api_secret')
    .eq('user_id', auth.ownerId)
    .maybeSingle()
  const connected = !!(data?.geniuslink_api_key && data?.geniuslink_api_secret)
  return NextResponse.json({ connected })
}
