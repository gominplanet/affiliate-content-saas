/**
 * /api/review-edit/drive — Google Drive for the review editor (lib/google-drive).
 *
 * GET   { connected, email, appId, key, token }: what the page needs to open
 *       Google's picker. token is an hour-long Drive token for this creator's
 *       own picker, limited to the files they pick (drive.file).
 * POST  { action: 'disconnect' }: forget the connection and revoke it at Google.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { driveAccessToken, driveAppId, driveLink, disconnectDrive } from '@/lib/google-drive'
import { editDb } from '@/lib/review-edit-server'

export const runtime = 'nodejs'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in again.' }, { status: 401 }) }
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('review_edit', intg?.tier)) return { error: NextResponse.json({ error: 'The review editor is still being tested.' }, { status: 403 }) }
  return { userId: user.id }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const db = editDb()
  const appId = driveAppId()
  // The picker's own key, when one is set (Google Cloud, an API key for the
  // Google Picker API). Served to signed-in editors only.
  const key = process.env.GOOGLE_PICKER_KEY || null
  const { data: probe, error: tableErr } = await db.from('google_drive_links').select('user_id').limit(1)
  void probe
  if (tableErr && /google_drive_links/.test(tableErr.message)) return NextResponse.json({ connected: false, needsSql: true, error: 'Google Drive needs migration 460 in Supabase first.' })
  const link = await driveLink(db, g.userId)
  if (!link) return NextResponse.json({ connected: false, appId, key })
  const t = await driveAccessToken(db, g.userId)
  if (!t.ok) return NextResponse.json({ connected: false, appId, key, error: t.error })
  return NextResponse.json({ connected: true, email: link.email, appId, key, token: t.token })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as { action?: string }
  if (body.action === 'disconnect') {
    await disconnectDrive(editDb(), g.userId)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
