import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId } = await request.json()
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('integrations')
    .select('facebook_pages_json')
    .eq('user_id', user.id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages: { id: string; name: string; access_token: string }[] = JSON.parse((row as any)?.facebook_pages_json || '[]')
  const page = pages.find((p) => p.id === pageId)
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('integrations').upsert(
    { user_id: user.id, facebook_page_id: page.id, facebook_page_name: page.name, facebook_page_access_token: page.access_token },
    { onConflict: 'user_id' },
  )

  return NextResponse.json({ ok: true, page: { id: page.id, name: page.name } })
}
