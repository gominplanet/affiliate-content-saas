import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { checkedWrite } from '@/lib/db-error'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await checkedWrite('linkedin.disconnect',
    supabase.from('integrations').update({
      linkedin_access_token: null,
      linkedin_person_id: null,
      linkedin_person_name: null,
    }).eq('user_id', user.id),
    { userId: user.id })
  if (!ok) return NextResponse.json({ error: 'Could not disconnect. Try again.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
