// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/voice-clone/status — does the creator have a cloned voice, and is
// cloning available at all? Drives the "Use my voice" card.
//   -> { ok, enabled, hasVoice, name }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { voiceCloneConfigured } from '@/lib/voice-clone'
import { dubCreditBalance } from '@/lib/dub-credits'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('brand_profiles').select('eleven_voice_id,eleven_voice_name').eq('user_id', user.id).maybeSingle()
  const id = (data?.eleven_voice_id as string | null) || null

  const { data: integ } = await sb
    .from('integrations').select('tier,subscription_period_start').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  // Your-voice credit balance (null = unlimited for admin). Applies the period
  // grant on read, so the card always shows the current allowance.
  const credits = ['pro', 'admin'].includes(tier)
    ? await dubCreditBalance(sb, user.id, tier, (integ?.subscription_period_start as string | null) ?? null)
    : 0

  return NextResponse.json({
    ok: true,
    enabled: voiceCloneConfigured(),
    hasVoice: !!(id && id.trim()),
    name: (data?.eleven_voice_name as string | null) || null,
    credits,
  })
}
