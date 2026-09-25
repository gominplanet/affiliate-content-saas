// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/youtube/shorts-status { ids } — which of these videos are Shorts,
// for Co-Pilot's Short mode (Labs). true, false, or null when it could not be
// told (lib/shorts-detect). Uses the creator's default channel login, so their
// own private drafts are read from YouTube's own frame size and length.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { detectShorts } from '@/lib/shorts-detect'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('shorts_mode', intg?.tier)) return NextResponse.json({ shorts: {} })
  const body = await req.json().catch(() => ({})) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : []
  let token: string | null = null
  try { token = await getChannelOAuthToken(supabase, user.id, null) } catch { token = null }
  const map = await detectShorts(ids, token)
  return NextResponse.json({ shorts: Object.fromEntries(map) })
}
