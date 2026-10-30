/**
 * /api/review-edit/drive — Google Drive for the review editor (lib/google-drive).
 *
 * GET   { connected, email, appId, key, token }: what the page needs to open
 *       Google's picker. token is an hour-long Drive token for this creator's
 *       own picker, limited to the files they pick (drive.file).
 * POST  { action: 'disconnect' }: forget the connection and revoke it at Google.
 *       { action: 'folders', aRoll?, bRoll? }: remember the A-roll and B-roll
 *       folders ({ id, name }).
 *       { action: 'files', ids }: the picked files as Drive describes them
 *       (name, size, shape, length, when added), for pairing a batch.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { driveAccessToken, driveAppId, driveLink, disconnectDrive, saveDriveFolders, driveFile, isDriveId, type DriveFile } from '@/lib/google-drive'
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
  return NextResponse.json({ connected: true, email: link.email, appId, key, token: t.token, aRoll: link.aRoll, bRoll: link.bRoll })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as { action?: string; aRoll?: unknown; bRoll?: unknown; ids?: unknown }
  if (body.action === 'disconnect') {
    await disconnectDrive(editDb(), g.userId)
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'folders') {
    const r = await saveDriveFolders(editDb(), g.userId, { aRoll: body.aRoll, bRoll: body.bRoll })
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 500 })
  }
  if (body.action === 'files') {
    const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).filter(isDriveId))).slice(0, 80)
    if (!ids.length) return NextResponse.json({ error: 'No files were picked.' }, { status: 400 })
    const t = await driveAccessToken(editDb(), g.userId)
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 409 })
    const files: DriveFile[] = []
    const problems: { id: string; error: string }[] = []
    for (let i = 0; i < ids.length; i += 6) {
      const part = await Promise.all(ids.slice(i, i + 6).map(async (id) => ({ id, r: await driveFile(t.token, id) })))
      for (const { id, r } of part) { if (r.ok) files.push(r.file); else problems.push({ id, error: r.error }) }
    }
    return NextResponse.json({ files, problems })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
