import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('integrations').upsert(
    {
      user_id: user.id,
      facebook_page_id: null,
      facebook_page_name: null,
      facebook_page_access_token: null,
      facebook_pages_json: null,
    },
    { onConflict: 'user_id' },
  )

  return NextResponse.json({ ok: true })
}
