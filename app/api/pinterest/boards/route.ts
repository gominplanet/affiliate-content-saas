// Pinterest board picker API.
//   GET  → live list of the creator's boards (fresh from Pinterest) + the
//          current pin target.
//   POST → set the target: { action: 'select', boardId } sends all pins to that
//          board; { action: 'create', name } makes a new board and selects it;
//          { action: 'auto' } clears the target (organize by category).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { PinterestService } from '@/services/pinterest'

export const dynamic = 'force-dynamic'

async function loadPinterest(supabase: Awaited<ReturnType<typeof createServerClient>>, userId: string) {
  const { data: raw } = await supabase
    .from('integrations')
    .select('pinterest_access_token,pinterest_pin_target')
    .eq('user_id', userId)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = decryptIntegrationRow(raw as any) as { pinterest_access_token?: string | null; pinterest_pin_target?: string | null } | null
  return row
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await loadPinterest(supabase, user.id)
  const token = row?.pinterest_access_token || ''
  if (!token) return NextResponse.json({ ok: true, connected: false, boards: [], target: null })
  try {
    const boards = await new PinterestService(token).getBoards()
    return NextResponse.json({ ok: true, connected: true, boards, target: row?.pinterest_pin_target || null })
  } catch (e) {
    return NextResponse.json({ ok: true, connected: true, boards: [], target: row?.pinterest_pin_target || null, error: e instanceof Error ? e.message : 'Could not load boards' })
  }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { action?: string; boardId?: string; name?: string }
  const row = await loadPinterest(supabase, user.id)
  const token = row?.pinterest_access_token || ''
  if (!token) return NextResponse.json({ error: 'Pinterest not connected' }, { status: 400 })
  const pinterest = new PinterestService(token)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    if (body.action === 'auto') {
      await sb.from('integrations').update({ pinterest_pin_target: null }).eq('user_id', user.id)
      return NextResponse.json({ ok: true, target: null })
    }
    if (body.action === 'create') {
      const name = (body.name || '').trim().slice(0, 180)
      if (!name) return NextResponse.json({ error: 'Board name required' }, { status: 400 })
      const board = await pinterest.findOrCreateBoard(name)
      await sb.from('integrations')
        .update({ pinterest_pin_target: board.id, pinterest_board_id: board.id, pinterest_board_name: board.name })
        .eq('user_id', user.id)
      return NextResponse.json({ ok: true, target: board.id, board })
    }
    if (body.action === 'select') {
      const boardId = (body.boardId || '').trim()
      if (!boardId) return NextResponse.json({ error: 'boardId required' }, { status: 400 })
      // Confirm the board still exists on the account (and grab its name).
      const boards = await pinterest.getBoards()
      const board = boards.find(b => b.id === boardId)
      if (!board) return NextResponse.json({ error: 'That board no longer exists — refresh and pick again.' }, { status: 400 })
      await sb.from('integrations')
        .update({ pinterest_pin_target: board.id, pinterest_board_id: board.id, pinterest_board_name: board.name })
        .eq('user_id', user.id)
      return NextResponse.json({ ok: true, target: board.id, board })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
