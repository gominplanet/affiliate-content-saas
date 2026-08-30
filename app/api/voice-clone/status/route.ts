// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/voice-clone/status — does the creator have a cloned voice, and is
// cloning available at all? Drives the "Use my voice" card.
//   -> { ok, enabled, hasVoice, name }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { voiceCloneConfigured } from '@/lib/voice-clone'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('brand_profiles').select('eleven_voice_id,eleven_voice_name').eq('user_id', user.id).maybeSingle()
  const id = (data?.eleven_voice_id as string | null) || null

  return NextResponse.json({
    ok: true,
    enabled: voiceCloneConfigured(),
    hasVoice: !!(id && id.trim()),
    name: (data?.eleven_voice_name as string | null) || null,
  })
}
