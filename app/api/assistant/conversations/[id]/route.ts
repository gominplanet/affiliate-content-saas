/**
 * GET    /api/assistant/conversations/[id]   → messages in a conversation
 * DELETE /api/assistant/conversations/[id]   → delete it (cascades messages)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('assistant_messages')
    .select('id,role,content,created_at')
    .eq('conversation_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
  return NextResponse.json({ messages: data ?? [] })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('assistant_conversations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
