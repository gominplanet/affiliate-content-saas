// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The browser half of Liftoff's Studio uploads (lib/studio-upload): ask MVP
// which videos are waiting, claim one, have SCOUT upload it through YouTube
// Studio, and report what happened. One at a time, and one run per page, so
// the Liftoff runner and the board never start the same upload twice.

import { requestStudioUpload, requestStudioFinish, type StudioUploadResult } from '@/lib/extension-frame'

export type StudioUploadItem = {
  itemId: string; channelId: string; fileUrl: string; fileName: string
  /** A video SCOUT uploaded that is still a draft in Studio: saved, not uploaded. */
  draft?: boolean; videoId?: string | null
  title: string; description: string; tries: number
  tags?: string[]; thumbnailUrl?: string | null; playlist?: string | null
  visibility?: { mode: 'schedule'; publishAt: string } | { mode: 'public' } | { mode: 'private' }
  want: { details: boolean; notifySubscribers: boolean; monetize: boolean; selfCert: boolean; endScreen: boolean; tagProduct: false }
}

export type StudioUploadOutcome = { itemId: string; title: string; ok: boolean; videoId?: string; said: string }

let running: Promise<StudioUploadOutcome[]> | null = null

/** Upload every waiting video, one by one. Resolves with what happened to each. */
export function runStudioUploads(opts: { background?: boolean; onProgress?: (o: StudioUploadOutcome | { itemId: string; title: string; starting: true }) => void } = {}): Promise<StudioUploadOutcome[]> {
  if (running) return running
  running = (async () => {
    const done: StudioUploadOutcome[] = []
    let list: StudioUploadItem[] = []
    try {
      const r = await fetch('/api/launch/studio-uploads', { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.on) return done
      list = Array.isArray(d.items) ? d.items : []
    } catch { return done }

    for (const it of list) {
      // Claimed first, on the try count the server read, so a second tab or
      // the other runner cannot start the same upload.
      let claimed = false
      try {
        const c = await fetch('/api/launch/studio-uploads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: it.itemId, claim: true }), signal: AbortSignal.timeout(30_000),
        })
        claimed = c.ok && !!(await c.json().catch(() => ({}))).ok
      } catch { claimed = false }
      if (!claimed) continue
      opts.onProgress?.({ itemId: it.itemId, title: it.title, starting: true })

      // ── A DRAFT: OPENED IN STUDIO AND SAVED, NOTHING UPLOADED ────────────
      if (it.draft && it.videoId) {
        const vis = it.visibility ?? { mode: 'private' as const }
        let fin: Awaited<ReturnType<typeof requestStudioFinish>>
        try {
          fin = await requestStudioFinish(it.videoId, {
            details: it.want.details, monetize: it.want.monetize, selfCert: it.want.selfCert, endScreen: it.want.endScreen,
            notifySubscribers: it.want.notifySubscribers, tagProduct: false, visibility: vis, background: opts.background === true,
          })
        } catch (e) { fin = { ok: false, steps: [], error: e instanceof Error ? e.message : 'failed' } }
        const visStep = fin.steps.find((x) => x.step === 'visibility')
        // Studio showing it as a normal video means it was saved already;
        // MVP reads its real state back from YouTube.
        const saved = fin.path === 'video' || !!(visStep && visStep.ok)
        const result = { saved, visibility: fin.path === 'video' ? 'private' : vis.mode, publishAt: vis.mode === 'schedule' ? vis.publishAt : null, error: fin.error, steps: fin.steps }
        for (let a = 0; a < 3; a++) {
          const ok = await fetch('/api/launch/studio-uploads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: it.itemId, draftResult: result }), signal: AbortSignal.timeout(30_000),
          }).then((x) => x.ok).catch(() => false)
          if (ok) break
          await new Promise((r) => setTimeout(r, 2000 * (a + 1)))
        }
        const out: StudioUploadOutcome = { itemId: it.itemId, title: it.title, ok: saved, videoId: it.videoId, said: saved ? 'Saved in Studio' : (fin.error || 'SCOUT could not save the draft') }
        done.push(out)
        opts.onProgress?.(out)
        if (fin.error === 'busy' || fin.error === 'not-installed') break
        continue
      }

      let res: StudioUploadResult
      try {
        res = await requestStudioUpload({
          itemId: it.itemId, channelId: it.channelId, fileUrl: it.fileUrl, fileName: it.fileName,
          title: it.title, description: it.description, want: it.want, background: opts.background === true,
          tags: it.tags, thumbnailUrl: it.thumbnailUrl, playlist: it.playlist, visibility: it.visibility,
        })
      } catch (e) {
        res = { ok: false, steps: [], error: e instanceof Error ? e.message : 'failed' }
      }

      // THE RESULT IS REPORTED HOWEVER IT WENT, and tried again: an id that
      // never reaches MVP is a video on the channel that nobody schedules.
      let said = ''
      for (let a = 0; a < 3; a++) {
        try {
          const p = await fetch('/api/launch/studio-uploads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: it.itemId, result: res }), signal: AbortSignal.timeout(60_000),
          })
          const d = await p.json().catch(() => ({}))
          if (p.ok) { said = d.recorded || d.error || ''; break }
        } catch { /* try again */ }
        await new Promise((r) => setTimeout(r, 2000 * (a + 1)))
      }
      const out: StudioUploadOutcome = {
        itemId: it.itemId, title: it.title, ok: !!res.videoId, videoId: res.videoId,
        said: res.videoId
          ? (!res.saved ? `Uploaded (${res.videoId}) but not saved in Studio`
            : res.did && res.did.visibility === 'schedule' ? `Uploaded and scheduled in Studio (${res.videoId})`
            : res.did && res.did.visibility === 'public' ? `Uploaded and published in Studio (${res.videoId})`
            : `Uploaded through Studio (${res.videoId})`)
          : said || res.detail || res.error || 'SCOUT could not upload it',
      }
      done.push(out)
      opts.onProgress?.(out)
      // SCOUT is one Studio at a time; busy means stop for now.
      if (res.error === 'busy' || res.error === 'not-installed') break
    }
    return done
  })().finally(() => { running = null })
  return running
}
