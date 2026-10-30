// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GOOGLE DRIVE FOR THE REVIEW EDITOR (Seb, 2026-10-30: "we're not storing the
// big raw files since we're using Google Drive. So Google Drive would be
// storing the raw files").
//
// The creator connects Drive once and picks their takes in Google's own
// picker. The permission is drive.file: MVP can open only the files picked
// with it, nothing else in their Drive, which is why Google needs no security
// review for it (reading a whole Drive would). The lasting access is kept
// encrypted (google_drive_links); each piece of background work mints a fresh
// hour-long token from it, and the video server pulls the file straight from
// Drive with that token, so the raw takes are never stored by MVP.
//
// The connect comes back through the YouTube callback (the address already
// registered with Google), marked as a Drive connect in its one-time state.

import { maybeEncrypt, maybeDecrypt } from '@/lib/secrets'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
export const DRIVE_SCOPES = [DRIVE_SCOPE, EMAIL_SCOPE]
export const DRIVE_HOST = 'www.googleapis.com'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Google's project number, which the picker needs so the files picked are
 *  opened for MVP: the first part of the OAuth client id. Pure. */
export function driveAppId(clientId = process.env.GOOGLE_CLIENT_ID || ''): string | null {
  const m = /^(\d{6,})-/.exec(clientId)
  return m ? m[1] : null
}

/** Where the video server reads a picked file from. Pure. */
export function driveMediaUrl(fileId: string): string {
  return `https://${DRIVE_HOST}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
}

/** A Drive file id as Google writes them. Pure. */
export function isDriveId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(v)
}

/** Google's reason, said plainly: the ones a creator or Seb can act on. Pure. */
export function driveWords(status: number, body: string): string {
  if (/accessNotConfigured|has not been used in project|is disabled/i.test(body)) return 'Google says the Google Drive API is switched off for MVP’s Google project. It needs switching on in Google Cloud.'
  if (status === 404 || /notFound|File not found/i.test(body)) return 'MVP cannot open that file: it was moved, deleted, or not picked through MVP. Pick it again.'
  if (status === 401 || /invalid_grant|invalid_token|Invalid Credentials/i.test(body)) return 'MVP lost its access to your Google Drive. Connect Google Drive again.'
  if (status === 403 && /insufficient|scope/i.test(body)) return 'Google Drive was connected without the box that lets MVP open your files. Connect Google Drive again and tick it.'
  return `Google Drive answered ${status}.`
}

/** The code Google sent back, turned into the lasting access and kept. */
export async function finishDriveConnect(db: Db, userId: string, code: string, redirectUri: string): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
  })
  const raw = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, error: `Google did not connect Drive (${res.status}). Press Connect Google Drive again.` }
  let t: { access_token?: string; refresh_token?: string; scope?: string } = {}
  try { t = JSON.parse(raw) } catch { /* below */ }
  if (!String(t.scope || '').split(/\s+/).includes(DRIVE_SCOPE)) return { ok: false, error: 'The box that lets MVP open the files you pick was not ticked. Press Connect Google Drive again and tick it.' }
  if (!t.refresh_token) return { ok: false, error: 'Google did not give MVP lasting access. Press Connect Google Drive again.' }
  let email: string | null = null
  try {
    const me = await fetchWithTimeout('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })
    if (me.ok) email = ((await me.json()) as { email?: string }).email ?? null
  } catch { /* the address is only shown on the page */ }
  const { error } = await db.from('google_drive_links').upsert({ user_id: userId, refresh_token: maybeEncrypt(t.refresh_token), email, scope: t.scope, updated_at: new Date().toISOString() })
  if (error) return { ok: false, error: /google_drive_links/.test(error.message) ? 'MVP needs migration 460 in Supabase before Google Drive can be connected.' : 'MVP could not save the connection. Press Connect Google Drive again.' }
  return { ok: true, email }
}

export interface DriveFolder { id: string; name: string }
export interface DriveLink { email: string | null; connectedAt: string; aRoll: DriveFolder | null; bRoll: DriveFolder | null }

const folderOf = (v: unknown): DriveFolder | null => {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  return o && isDriveId(o.id) ? { id: o.id, name: String(o.name || 'Folder').slice(0, 120) } : null
}

export async function driveLink(db: Db, userId: string): Promise<DriveLink | null> {
  // '*' so a link read before migration 461 (no folder columns) still reads.
  const { data } = await db.from('google_drive_links').select('*').eq('user_id', userId).maybeSingle()
  return data ? { email: data.email ?? null, connectedAt: data.connected_at, aRoll: folderOf(data.a_roll), bRoll: folderOf(data.b_roll) } : null
}

/** Remember the creator's A-roll and B-roll folders. */
export async function saveDriveFolders(db: Db, userId: string, f: { aRoll?: unknown; bRoll?: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (f.aRoll !== undefined) patch.a_roll = folderOf(f.aRoll)
  if (f.bRoll !== undefined) patch.b_roll = folderOf(f.bRoll)
  const { error } = await db.from('google_drive_links').update(patch).eq('user_id', userId)
  if (error) return { ok: false, error: /a_roll|b_roll/.test(error.message) ? 'Remembering your folders needs migration 461 in Supabase first.' : 'Your folders were not saved.' }
  return { ok: true }
}

/** A fresh hour-long token for this creator's Drive, or why there is none.
 *  Access Google has taken back is forgotten, so the page asks to connect. */
export async function driveAccessToken(db: Db, userId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { data } = await db.from('google_drive_links').select('refresh_token').eq('user_id', userId).maybeSingle()
  const refresh = data ? maybeDecrypt(data.refresh_token) : null
  if (!refresh) return { ok: false, error: 'Google Drive is not connected. Connect it on the Review editor page.' }
  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
  })
  const raw = await res.text().catch(() => '')
  if (!res.ok) {
    if (/invalid_grant/.test(raw)) await db.from('google_drive_links').delete().eq('user_id', userId)
    return { ok: false, error: driveWords(res.status === 400 ? 401 : res.status, raw) }
  }
  try {
    const token = (JSON.parse(raw) as { access_token?: string }).access_token
    return token ? { ok: true, token } : { ok: false, error: 'Google gave no access. Connect Google Drive again.' }
  } catch { return { ok: false, error: 'Google gave no access. Connect Google Drive again.' } }
}

export interface DriveFile { id: string; name: string; mimeType: string; bytes: number | null; width: number | null; height: number | null; seconds: number | null; createdAt: string | null }

/** A picked file as Drive describes it: confirms MVP can open it and that it
 *  is a video. */
export async function driveFile(token: string, fileId: string): Promise<{ ok: true; file: DriveFile } | { ok: false; error: string }> {
  const res = await fetchWithTimeout(`https://${DRIVE_HOST}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,createdTime,videoMediaMetadata&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  const raw = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, error: driveWords(res.status, raw) }
  try {
    const f = JSON.parse(raw) as { id: string; name?: string; mimeType?: string; size?: string; createdTime?: string; videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string } }
    if (!String(f.mimeType || '').startsWith('video/')) return { ok: false, error: `${f.name || 'That file'} is not a video.` }
    const v = f.videoMediaMetadata || {}
    return { ok: true, file: { id: f.id, name: f.name || 'video', mimeType: f.mimeType || 'video/mp4', bytes: f.size ? Number(f.size) : null, width: v.width ?? null, height: v.height ?? null, seconds: v.durationMillis ? Number(v.durationMillis) / 1000 : null, createdAt: f.createdTime ?? null } }
  } catch { return { ok: false, error: 'Google Drive gave an answer MVP could not read.' } }
}

/** Forget the connection, and tell Google to take the access back. */
export async function disconnectDrive(db: Db, userId: string): Promise<void> {
  const { data } = await db.from('google_drive_links').select('refresh_token').eq('user_id', userId).maybeSingle()
  const refresh = data ? maybeDecrypt(data.refresh_token) : null
  if (refresh) { try { await fetchWithTimeout(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }) } catch { /* forgotten here either way */ } }
  await db.from('google_drive_links').delete().eq('user_id', userId)
}
