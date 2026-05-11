import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('integrations').update({
    linkedin_access_token: null,
    linkedin_person_id: null,
    linkedin_person_name: null,
  }).eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
