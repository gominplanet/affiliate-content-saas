/**
 * GET    /api/assistant/conversations/[id]   → messages in a conversation
 * DELETE /api/assistant/conversations/[id]   → delete it (cascades messages)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Paginated load — fetch the most recent `limit` messages (newest-last for
  // display), and page backwards with `?before=<created_at>`. Bounds both the
  // query and the rendered DOM so a long conversation doesn't load every row.
  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '60', 10) || 60, 10), 100)
  const before = url.searchParams.get('before') // ISO created_at cursor (exclusive)

  let q = supabase
    .from('assistant_messages')
    .select('id,role,content,created_at')
    .eq('conversation_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit + 1) // +1 to detect whether older messages remain
  if (before) q = q.lt('created_at', before)

  const { data } = await q
  const rows = data ?? []
  const hasMore = rows.length > limit
  // Trim the sentinel row, then flip to ascending (oldest-first) for the UI.
  const messages = rows.slice(0, limit).reverse()
  return NextResponse.json({ messages, hasMore })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase
    .from('assistant_conversations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
