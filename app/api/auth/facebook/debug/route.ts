import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const GRAPH = 'https://graph.facebook.com/v19.0'

export async function GET(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token param required' })

  const [meRes, accountsRes] = await Promise.all([
    fetch(`${GRAPH}/me?access_token=${token}&fields=id,name`),
    fetch(`${GRAPH}/me/accounts?access_token=${token}&fields=id,name,access_token&limit=100`),
  ])

  return NextResponse.json({
    me: await meRes.json(),
    accounts: await accountsRes.json(),
  })
}
