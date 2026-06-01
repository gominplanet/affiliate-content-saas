/**
 * GET  /api/assistant/conversations         → list this user's conversations
 * POST /api/assistant/conversations          → create a new (empty) one
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from('assistant_conversations')
    .select('id,title,updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)
  return NextResponse.json({ conversations: data ?? [] })
}

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from('assistant_conversations')
    .insert({ user_id: user.id, title: 'New chat' })
    .select('id,title,updated_at')
    .single()
  return NextResponse.json({ conversation: data })
}
