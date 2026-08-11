import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { deleteSocialAccountsForPlatform } from '@/lib/social-accounts'
import { checkedWrite } from '@/lib/db-error'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await checkedWrite('facebook.disconnect',
    supabase.from('integrations').upsert(
      {
        user_id: user.id,
        facebook_page_id: null,
        facebook_page_name: null,
        facebook_page_access_token: null,
        facebook_pages_json: null,
      },
      { onConflict: 'user_id' },
    ),
    { userId: user.id })
  if (!ok) return NextResponse.json({ error: 'Could not disconnect. Try again.' }, { status: 500 })

  try {
    await deleteSocialAccountsForPlatform(supabase, user.id, 'facebook')
  } catch (e) {
    console.warn('[facebook/disconnect] social_accounts cleanup failed:', e)
  }

  return NextResponse.json({ ok: true })
}
