import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { checkedWrite } from '@/lib/db-error'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await checkedWrite('twitter.disconnect',
    supabase.from('integrations').update({
      twitter_access_token: null,
      twitter_refresh_token: null,
      twitter_user_id: null,
      twitter_handle: null,
      twitter_expires_at: null,
    }).eq('user_id', user.id),
    { userId: user.id })
  if (!ok) return NextResponse.json({ error: 'Could not disconnect. Try again.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
