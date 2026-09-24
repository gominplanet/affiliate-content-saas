// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Liftoff's background tab: what SCOUT opens, pinned and behind, when the
// Liftoff page is closed and a launched batch still has work that only the
// creator's browser can do (the Studio steps and the Amazon uploads).
//
// EVERY LAUNCHED BATCH, not only one. It goes through each in turn, does the
// same work the page does (the same request builder, the same delivery helper),
// then tells SCOUT whether anything is still coming, and SCOUT closes it.
//
// IT NEVER RETRIES WHAT FAILED. A Studio pass that ran is kept whatever it
// found, and a refused Amazon listing is left for a person to press Send
// again: the background is for work that has not been tried, not for
// hammering work that was.
'use client'

import { useEffect, useRef, useState } from 'react'
import { requestStudioFinish, getScoutStatus, liftoffDone, liftoffAlive } from '@/lib/extension-frame'
import { deliverPreparedStorefronts } from '@/lib/storefront-delivery'
import { liftoffStudioRequest, normalizeStudioOptions, storeStudioRun, type StoredStudioRun } from '@/lib/studio-finish'
import { liftoffPending, type PendingItem } from '@/lib/liftoff-pending'
import { isScoutOutdated } from '@/lib/scout-version'

interface RunnerItem extends PendingItem {
  position: number
  title: string | null
  asin: string | null
  publish_at: string | null
  studio_finish?: StoredStudioRun | null
}

export default function LiftoffRunner() {
  const [lines, setLines] = useState<string[]>(['Starting…'])
  const started = useRef(false)
  const say = (l: string) => setLines((prev) => [...prev.slice(-30), l])

  useEffect(() => {
    if (started.current) return
    started.current = true
    // STILL HERE, every two minutes, so SCOUT closes a tab that has stopped
    // rather than one that is halfway through a long batch.
    void liftoffAlive()
    const alive = setInterval(() => { void liftoffAlive() }, 120_000)
    void (async () => {
      let more = false
      const sigs: string[] = []
      try {
        const st = await getScoutStatus()
        const studioPossible = st.installed && !isScoutOutdated(st.version)
        const r = await fetch('/api/launch/batches')
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { clearInterval(alive); say(`Could not read your batches: ${j?.error || r.status}`); await liftoffDone(true, 'error'); return }
        const launched = ((j.batches ?? []) as Array<{ id: string; name: string; state: string }>)
          .filter((b) => b.state === 'launching' || b.state === 'launched')
        if (launched.length === 0) say('No launched batches.')

        for (const b of launched) {
          const dr = await fetch(`/api/launch/batches/${b.id}`)
          const d = await dr.json().catch(() => ({}))
          if (!dr.ok || !d?.ok) { say(`${b.name}: could not be read`); more = true; sigs.push(`${b.id}:unread`); continue }
          const items = (d.items ?? []) as RunnerItem[]
          const markets = ((d.batch?.markets ?? []) as Array<{ domain: string }>).map((m) => m.domain)
          const sendToYouTube = d.batch?.send_to_youtube !== false
          const opts = normalizeStudioOptions(d.studioOptions)
          const notify = d.notifySubscribers === true
          const pend = { sendToYouTube, studioPossible }
          const before = liftoffPending(items, markets, pend)
          if (before.youtube + before.studio + before.amazon === 0) continue
          say(`${b.name}: ${before.studio} Studio, ${before.amazon} Amazon, ${before.youtube} still uploading`)

          // ── STUDIO FIRST: the settings belong on the video before it goes
          // public, and SCOUT does one job at a time.
          if (sendToYouTube && studioPossible) {
            for (const it of items) {
              // THE SAME RULE AS THE COUNT: on YouTube, recent, and no run
              // yet (or one that timed out, with tries left).
              if (!it.youtube_video_id || liftoffPending([it], [], pend).studio === 0) continue
              say(`Studio: ${it.title || `video ${it.position + 1}`}`)
              const fin = await requestStudioFinish(it.youtube_video_id, liftoffStudioRequest(it, opts, notify, true))
              // SCOUT never started, or is busy with another video: nothing
              // was done, so nothing is kept, and it comes round again.
              if (fin.error === 'not-installed' || fin.error === 'busy') { more = true; continue }
              const run = storeStudioRun(fin, new Date(), it.studio_finish)
              const pr = await fetch(`/api/launch/items/${it.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studioFinish: run }),
              }).catch(() => null)
              // NOT KEPT IS NOT DONE: said, and the count below still sees it.
              if (!pr || !pr.ok) { say('  SCOUT finished, but its report could not be saved'); more = true; continue }
              say(run.ok ? '  every setting read back' : '  finished with something to check (see the report)')
            }
          }

          // ── THEN AMAZON, scoped to this batch's videos and countries, never
          // retrying a listing Amazon refused.
          // Only videos with Amazon work left in the window: a batch's old
          // videos are not sent round again.
          const videoIds = items.filter((i) => liftoffPending([i], markets, pend).amazon > 0)
            .map((i) => i.video_id).filter((v): v is string => !!v)
          if (markets.length > 0 && videoIds.length > 0) {
            const out = await deliverPreparedStorefronts({ videoIds, domains: markets, retryFailed: false })
            if (out.error) { say(`Amazon: ${out.error}`); if (/still uploading/i.test(out.error)) more = true }
            else if (out.nothingReady) say(out.waitingOnDub ? `Amazon: ${out.waitingOnDub} waiting on their dub` : 'Amazon: nothing ready yet')
            else say(`Amazon: ${out.handedOver} uploaded${out.duplicates ? `, ${out.duplicates} already there` : ''}${out.failed.length ? `, ${out.failed.length} failed` : ''}`)
          }

          // What is left AFTER this run, re-read, decides whether to come back.
          const ar = await fetch(`/api/launch/batches/${b.id}`)
          const a = await ar.json().catch(() => ({}))
          // A failed re-read is not "nothing left".
          if (!ar.ok || !a?.ok) { say(`${b.name}: could not be read again`); more = true; sigs.push(`${b.id}:unread`); continue }
          const after = liftoffPending((a.items ?? []) as RunnerItem[], markets, pend)
          if (after.youtube + after.studio + after.amazon > 0) { more = true; sigs.push(after.signature) }
        }
      } catch (e) {
        say(`Stopped: ${e instanceof Error ? e.message : String(e)}`)
        more = true
      }
      clearInterval(alive)
      say(more ? 'More to do later. SCOUT will look again.' : 'All done. Nothing left to send.')
      await liftoffDone(more, sigs.join('#'))
    })()
  }, [])

  return (
    <div className="max-w-xl p-6">
      <h1 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Liftoff is finishing your batches</h1>
      <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-2)' }}>
        SCOUT opened this tab to finish the Studio steps and the Amazon uploads while the Liftoff page is closed.
        It closes itself when it is done. You can keep using Chrome.
      </p>
      <ul className="mt-3 flex flex-col gap-0.5 text-[12px] tabular-nums" style={{ color: 'var(--text)' }}>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  )
}
