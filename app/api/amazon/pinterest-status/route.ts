// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon/pinterest-status — is Pinterest connected, and which boards
// can the creator pin to? Drives the Pinterest composer's board dropdown +
// connect prompt. Returns cached boards from the integrations row, falling back
// to a live board fetch when the cache is empty.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { PinterestService } from '@/services/pinterest'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawInt } = await supabase
    .from('integrations')
    .select('pinterest_access_token,pinterest_board_id,pinterest_board_name,pinterest_boards_json')
    .eq('user_id', user.id).single()
  const intRow = decryptIntegrationRow(rawInt)

  if (!intRow?.pinterest_access_token) {
    return NextResponse.json({ connected: false, boards: [], defaultBoardId: null })
  }

  // Prefer the cached board list; refetch live if it's empty.
  let boards: Array<{ id: string; name: string }> = []
  const cached = intRow.pinterest_boards_json
  if (Array.isArray(cached)) {
    boards = (cached as Array<{ id?: string; Id?: string; name?: string; Name?: string }>)
      .map(b => ({ id: String(b.id ?? b.Id ?? ''), name: String(b.name ?? b.Name ?? '') }))
      .filter(b => b.id)
  }
  if (boards.length === 0) {
    try {
      const svc = new PinterestService(intRow.pinterest_access_token as string)
      const live = await svc.getBoards()
      boards = (live || []).map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
    } catch { /* leave empty — composer still works with the default board */ }
  }

  return NextResponse.json({
    connected: true,
    boards,
    defaultBoardId: (intRow.pinterest_board_id as string | null) ?? (boards[0]?.id ?? null),
  })
}
