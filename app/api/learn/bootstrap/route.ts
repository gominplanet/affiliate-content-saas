// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/learn/bootstrap — "Learn my voice from my videos now."
// Fetches transcripts for the creator's recent videos and refines the voice
// fingerprint on the spot, so a new creator sounds like themselves from their
// first post instead of waiting to publish a few times. Best-effort; returns
// how many transcripts it read and whether the fingerprint updated.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { bootstrapVoiceFromChannel } from '@/lib/voice-bootstrap'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
  const tier = normalizeTier(integ?.tier)

  const blocked = await spendGate(ownerId, tier)
  if (blocked) return blocked

  const result = await bootstrapVoiceFromChannel(supabase, { userId: ownerId, tier })
  return NextResponse.json(result)
}
