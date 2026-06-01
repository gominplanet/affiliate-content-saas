import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('integrations').update({
    twitter_access_token: null,
    twitter_refresh_token: null,
    twitter_user_id: null,
    twitter_handle: null,
    twitter_expires_at: null,
  }).eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
