// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/voice-clone/delete — remove the creator's cloned voice.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { deleteClonedVoice } from '@/lib/voice-clone'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await deleteClonedVoice(supabase as any, user.id)
  return NextResponse.json({ ok: true })
}
