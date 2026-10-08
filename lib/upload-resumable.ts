// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A RESUMABLE browser upload to Supabase Storage (the TUS protocol Storage
// supports at /storage/v1/upload/resumable).
//
// WHY. A video went up as one long request, so any dropped connection or
// one-minute pause on a slow line threw the whole upload away: a 288MB file
// at 0.3MB/s restarted from zero two or three times and still failed. Here the
// file goes in 6MB pieces (the size Storage requires), and after a drop the
// upload asks Storage how much arrived and carries on from there. A retry
// costs one piece, never the file.

import { STALL_MS } from '@/lib/upload-progress'
import { saysExpired } from '@/lib/fresh-token'

/** Storage's resumable endpoint takes 6MB pieces, the last one smaller. */
export const CHUNK = 6 * 1024 * 1024
/** How many drops in a row, with nothing new arriving, before giving up. */
export const MAX_RESUMES = 12

export interface ResumableEvents {
  onProgress: (p: { sent: number; total: number }) => void
  /** A drop, and where the upload picks up from. */
  onResume?: (p: { resumes: number; from: number; reason: string }) => void
  onSent?: () => void
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))

export async function uploadResumable(opts: {
  supabaseUrl: string
  anonKey: string
  /** Called before every piece, so a long upload never runs on an expired
   *  token; `force` when the server just refused one as expired. */
  getAccessToken: (force?: boolean) => Promise<string | null>
  bucket: string
  path: string
  file: File
  contentType: string
} & ResumableEvents): Promise<void> {
  const base = opts.supabaseUrl.replace(/\/$/, '')
  const endpoint = `${base}/storage/v1/upload/resumable`
  const total = opts.file.size
  const headers = async (force = false): Promise<Record<string, string>> => {
    const token = await opts.getAccessToken(force)
    if (!token) throw new Error('Signed out during the upload. Sign in again and add this one again.')
    return { authorization: `Bearer ${token}`, apikey: opts.anonKey, 'Tus-Resumable': '1.0.0' }
  }

  // 1. Open the upload.
  const meta = [
    `bucketName ${b64(opts.bucket)}`, `objectName ${b64(opts.path)}`,
    `contentType ${b64(opts.contentType)}`, `cacheControl ${b64('3600')}`,
  ].join(',')
  const open = async (force: boolean) => fetch(endpoint, {
    method: 'POST',
    headers: { ...(await headers(force)), 'Upload-Length': String(total), 'Upload-Metadata': meta, 'x-upsert': 'false' },
    signal: AbortSignal.timeout(30_000),
  })
  let created = await open(false)
  let msg = created.status !== 201 ? await created.text().catch(() => '') : ''
  // AN EXPIRED SIGN-IN IS RENEWED AND ASKED AGAIN, not taken as "resumable
  // is not available": that fell back to a single upload on the same expired
  // token, and the file failed with '"exp" claim timestamp check failed'.
  if (created.status !== 201 && saysExpired(msg)) {
    created = await open(true)
    msg = created.status !== 201 ? await created.text().catch(() => '') : ''
  }
  if (created.status !== 201) {
    throw new ResumableUnavailable(`Storage would not open a resumable upload (${created.status}${msg ? `: ${msg.slice(0, 120)}` : ''}).`)
  }
  const loc = created.headers.get('Location') || created.headers.get('location')
  if (!loc) throw new ResumableUnavailable('Storage opened the upload but did not say where to send it.')
  const uploadUrl = /^https?:\/\//i.test(loc) ? loc : `${base}${loc.startsWith('/') ? '' : '/'}${loc}`

  // 2. Send the pieces, picking up after any drop.
  let offset = 0
  let resumes = 0      // every pick-up, for the progress line
  let stalled = 0      // drops in a row with nothing new arriving
  let lastDropAt = -1
  let renew = false
  while (offset < total) {
    try {
      offset = await sendPiece(uploadUrl, await headers(renew), opts.file, offset, total, opts.onProgress)
      renew = false
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      // The sign-in ran out between pieces: renewed before the next one.
      renew = saysExpired(reason)
      resumes++
      // MAX_RESUMES counts drops IN A ROW. Counted over the whole file, a big
      // video on a flaky line failed after 13 drops even though every one of
      // them picked up and carried on.
      stalled = offset > lastDropAt ? 1 : stalled + 1
      lastDropAt = offset
      if (stalled > MAX_RESUMES || resumes > MAX_RESUMES * 10) throw new Error(`The connection kept dropping without getting further (${resumes} drops). Last time: ${reason}`)
      await new Promise((r) => setTimeout(r, Math.min(15_000, 1500 * stalled)))
      // Where Storage has it up to: everything before this is kept. A missing
      // header is "not known", never zero: zero sent every later piece to the
      // wrong place and used up the pick-ups.
      const at = await fetch(uploadUrl, { method: 'HEAD', headers: await headers(renew), signal: AbortSignal.timeout(20_000) }).catch(() => null)
      const h = at?.headers.get('Upload-Offset') ?? null
      const known = h === null ? NaN : Number(h)
      if (at && at.ok && Number.isFinite(known) && known >= 0) offset = known
      opts.onResume?.({ resumes, from: offset, reason })
      opts.onProgress({ sent: offset, total })
    }
  }
  opts.onSent?.()
}

/** The resumable endpoint is not there or refused to start: the caller can
 *  fall back to a single upload. */
export class ResumableUnavailable extends Error {}

/** One 6MB piece, with progress inside it and the same stall rule as before. */
function sendPiece(url: string, headers: Record<string, string>, file: File, offset: number, total: number,
  onProgress: (p: { sent: number; total: number }) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const end = Math.min(total, offset + CHUNK)
    const xhr = new XMLHttpRequest()
    xhr.open('PATCH', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.setRequestHeader('Upload-Offset', String(offset))
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream')
    let last = Date.now()
    const watchdog = setInterval(() => {
      if (Date.now() - last > STALL_MS) { clearInterval(watchdog); xhr.abort(); reject(new Error('The upload stopped moving for a minute.')) }
    }, 2_000)
    xhr.upload.onprogress = (e) => { last = Date.now(); onProgress({ sent: offset + e.loaded, total }) }
    xhr.onload = () => {
      clearInterval(watchdog)
      if (xhr.status === 204 || (xhr.status >= 200 && xhr.status < 300)) {
        const next = Number(xhr.getResponseHeader('Upload-Offset'))
        resolve(Number.isFinite(next) && next > offset ? next : end)
        return
      }
      reject(new Error(`Storage said ${xhr.status}${xhr.responseText ? `: ${xhr.responseText.slice(0, 120)}` : ''}.`))
    }
    xhr.onerror = () => { clearInterval(watchdog); reject(new Error('The connection dropped.')) }
    xhr.onabort = () => clearInterval(watchdog)
    xhr.send(file.slice(offset, end))
  })
}
