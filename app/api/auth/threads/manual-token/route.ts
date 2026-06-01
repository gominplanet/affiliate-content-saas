import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accessToken } = await request.json()
  if (!accessToken?.trim()) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  // Fetch Threads user ID from the token
  const meRes = await fetch(
    `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken.trim()}`,
  )
  if (!meRes.ok) {
    const err = await meRes.json()
    return NextResponse.json({ error: err.error?.message || 'Invalid token' }, { status: 400 })
  }
  const { id: threadsUserId, username } = await meRes.json() as { id: string; username: string }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('integrations').upsert(
    { user_id: user.id, threads_access_token: accessToken.trim(), threads_user_id: threadsUserId },
    { onConflict: 'user_id' },
  )

  return NextResponse.json({ ok: true, username })
}
