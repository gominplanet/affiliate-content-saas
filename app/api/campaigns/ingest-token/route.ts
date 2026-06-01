/**
 * GET  /api/campaigns/ingest-token  → current token (mints one if absent)
 * POST /api/campaigns/ingest-token  → regenerates (invalidates the old one)
 *
 * Session-authed. The returned token is what the user pastes into the
 * Chrome extension so it can push scouted Creator Connections campaigns
 * into their CC Campaigns list (see /api/campaigns/ingest).
 */
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

function mint(): string {
  return 'cc_' + randomBytes(24).toString('base64url')
}

async function getOrCreate(force: boolean) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('integrations')
    .select('cc_ingest_token')
    .eq('user_id', user.id)
    .single()

  let token: string | null = row?.cc_ingest_token ?? null
  if (!token || force) {
    token = mint()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('integrations')
      .upsert({ user_id: user.id, cc_ingest_token: token }, { onConflict: 'user_id' })
    if (error) return { error: error.message, status: 500 as const }
  }
  return { token }
}

export async function GET() {
  const r = await getOrCreate(false)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ token: r.token })
}

export async function POST() {
  const r = await getOrCreate(true)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ token: r.token })
}
