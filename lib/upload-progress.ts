// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A browser upload to Supabase Storage that reports how far it has got.
//
// WHY NOT supabase.storage.upload(). That call is one fetch with nothing to
// say until it ends, so a 400MB video read "Uploading 3..." for ten minutes
// whether it was 90% done or had stalled at the first byte, and the creator
// could not tell which. XMLHttpRequest is the one browser API that reports
// upload progress, so this is the same request storage-js sends (the same
// endpoint, the same form body), sent in a way that can be watched.
//
// A STALL IS NAMED AND RETRIED. No progress for STALL_MS means the connection
// is not moving, and waiting longer will not change that: the request is
// dropped and started again, and the caller is told so it can say it.

export const STALL_MS = 60_000

export interface UploadProgress {
  sent: number
  total: number
}

export class UploadStalled extends Error {
  constructor() { super('The upload stopped moving for a minute.') }
}

export function uploadWithProgress(opts: {
  supabaseUrl: string
  anonKey: string
  accessToken: string
  bucket: string
  path: string
  file: File
  contentType: string
  onProgress: (p: UploadProgress) => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const url = `${opts.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${opts.bucket}/${opts.path.split('/').map(encodeURIComponent).join('/')}`
    xhr.open('POST', url)
    xhr.setRequestHeader('authorization', `Bearer ${opts.accessToken}`)
    xhr.setRequestHeader('apikey', opts.anonKey)
    xhr.setRequestHeader('x-upsert', 'false')

    let last = Date.now()
    const watchdog = setInterval(() => {
      if (Date.now() - last > STALL_MS) {
        clearInterval(watchdog)
        xhr.abort()
        reject(new UploadStalled())
      }
    }, 2_000)

    xhr.upload.onprogress = (e) => {
      last = Date.now()
      opts.onProgress({ sent: e.loaded, total: e.lengthComputable ? e.total : opts.file.size })
    }
    xhr.onload = () => {
      clearInterval(watchdog)
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return }
      let msg = `Storage said ${xhr.status}.`
      try {
        const j = JSON.parse(xhr.responseText || '{}') as { message?: string; error?: string }
        msg = j.message || j.error || msg
      } catch { /* the status is the message */ }
      reject(new Error(msg))
    }
    xhr.onerror = () => { clearInterval(watchdog); reject(new Error('The connection dropped during the upload.')) }
    xhr.onabort = () => { clearInterval(watchdog) }

    // THE SAME BODY storage-js sends: a form with the cache setting and the
    // file. The file is re-typed when the browser did not know it, so storage
    // records a video rather than an octet stream.
    const body = new FormData()
    body.append('cacheControl', '3600')
    body.append('', opts.file.type ? opts.file : new Blob([opts.file], { type: opts.contentType }), opts.file.name)
    xhr.send(body)
  })
}
