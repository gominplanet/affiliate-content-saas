'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Rebuild a creator's video posts on our side (app/api/admin/rebuild-posts):
// in place on their site, on our AI cost, not counted against their rebuilds,
// and only where their video's words can be read. Each post shows why it is
// offered and how its last repair went, so a refusal never looks like a fix.
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

type Repair = { status: string; error: string | null; at: string } | null
type Row = { id: string; title: string | null; videoId: string; url: string | null; createdAt: string; hasTranscript: boolean; reasons: string[]; repair: Repair }

export function RebuildPosts({ userId, email }: { userId: string; email: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [photos, setPhotos] = useState(false)

  async function load(pickSuggested: boolean) {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/admin/rebuild-posts?userId=${encodeURIComponent(userId)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) throw new Error(d.error || `Could not load (${r.status})`)
      const list = (d.posts ?? []) as Row[]
      setRows(list)
      setOpen(true)
      if (pickSuggested) setPicked(new Set(list.filter((p) => p.reasons.length > 0 && !inFlight(p.repair)).map((p) => p.videoId)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }

  // While repairs are queued or running, check on them.
  const running = (rows ?? []).some((p) => inFlight(p.repair))
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { void load(false) }, 20_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, userId])

  async function queue() {
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/admin/rebuild-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, videoIds: Array.from(picked), includeImages: photos }),
      })
      const d = await r.json().catch(() => null) as { ok?: boolean; queued?: number; refused?: Array<{ reason: string }>; error?: string } | null
      if (!d) setNote({ ok: false, text: 'The request returned nothing readable, so it is not known whether anything was queued. Reload the list to see.' })
      else if (d.error) setNote({ ok: false, text: d.error })
      else setNote({
        ok: (d.queued ?? 0) > 0,
        text: `${d.queued ?? 0} queued. They run one at a time, about a minute or two each.${d.refused?.length ? ` ${d.refused.length} not queued: ${d.refused.map((x) => x.reason).join('; ')}.` : ''}`,
      })
      setConfirm(false)
      setPicked(new Set())
      await load(false)
    } finally {
      setBusy(false)
    }
  }

  const counts = (rows ?? []).reduce((m, p) => {
    const s = p.repair?.status
    if (s === 'done' || s === 'updated') m.done++
    else if (s === 'failed') m.failed++
    else if (s === 'queued' || s === 'running') m.waiting++
    return m
  }, { done: 0, failed: 0, waiting: 0 })

  return (
    <div className="border-t border-gray-100 dark:border-white/10 pt-4 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Rebuild their video posts (on us)</p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
            Rewrites each post from their own video, in place on their site. Same address, date, status and featured image. It does not use up their rebuilds or their monthly posts, and it is skipped when the video&apos;s words cannot be read. Photos inside the old post are not kept unless you tick new photos below.
          </p>
        </div>
        {!open && (
          <button onClick={() => load(true)} disabled={loading} className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {loading ? 'Checking' : 'Check their posts'}
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-[#ff3b30] mt-2">{error}</p>}
      {note && <p className={`text-[12px] mt-2 ${note.ok ? 'text-[#34c759]' : 'text-[#ff9500]'}`}>{note.text}</p>}

      {open && rows && (
        <div className="mt-3">
          {rows.length === 0 ? (
            <p className="text-[12px] text-[#86868b]">No live posts made from their videos.</p>
          ) : (
            <>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#b0b0b5] mb-2">
                {rows.filter((p) => p.reasons.length > 0).length} of {rows.length} look worth rebuilding (ticked).
                {(counts.done || counts.failed || counts.waiting) ? ` Repairs so far: ${counts.done} rebuilt, ${counts.failed} not rebuilt, ${counts.waiting} waiting.` : ''}
                {running && ' Checking again every 20 seconds.'}
              </p>
              <ul className="flex flex-col gap-1 max-h-96 overflow-y-auto pr-1">
                {rows.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 py-1 border-b border-gray-100 dark:border-white/5 last:border-0">
                    <input type="checkbox" className="mt-1 flex-shrink-0" disabled={inFlight(p.repair)}
                      checked={picked.has(p.videoId)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(p.videoId); else next.delete(p.videoId)
                        setPicked(next); setConfirm(false)
                      }} />
                    <div className="min-w-0">
                      <p className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                        {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.title || 'Untitled'}</a> : (p.title || 'Untitled')}
                      </p>
                      <p className="text-[10px] text-[#86868b]">
                        {p.createdAt?.slice(0, 10)}
                        {p.reasons.length ? ` · ${p.reasons.join(' · ')}` : ' · looks fine'}
                      </p>
                      <RepairLine repair={p.repair} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#6e6e73] dark:text-[#b0b0b5]">
                  <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} /> Make new photos for the post body (slower, image cost on us)
                </label>
                <button onClick={() => load(false)} disabled={loading} className="btn-secondary text-xs inline-flex items-center gap-1.5">
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
                </button>
                {picked.size > 0 && (!confirm ? (
                  <button onClick={() => setConfirm(true)} className="btn-primary text-xs">Rebuild {picked.size} selected</button>
                ) : (
                  <>
                    <span className="text-[11px] text-[#ff9500]">
                      This rewrites {picked.size} live post{picked.size === 1 ? '' : 's'} on {email}&apos;s site. Their current text is replaced.
                    </span>
                    <button onClick={queue} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {busy ? 'Queuing' : 'Yes, rebuild them'}
                    </button>
                    <button onClick={() => setConfirm(false)} className="btn-secondary text-xs">Cancel</button>
                  </>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function inFlight(r: Repair): boolean {
  return r?.status === 'queued' || r?.status === 'running'
}

function RepairLine({ repair }: { repair: Repair }) {
  if (!repair) return null
  const when = repair.at ? new Date(repair.at).toLocaleString() : ''
  if (repair.status === 'done') return <p className="text-[10.5px] text-[#34c759]">Rebuilt {when}</p>
  if (repair.status === 'updated') return <p className="text-[10.5px] text-[#ff9500]">The worker stopped waiting, but the post was rewritten {when}. Open it to check.</p>
  if (repair.status === 'failed') return <p className="text-[10.5px] text-[#ff3b30]">Not rebuilt, post left as it was: {(repair.error || 'no reason recorded').slice(0, 220)}</p>
  if (repair.status === 'running') return <p className="text-[10.5px] text-[#ff9500]">Rebuilding now…</p>
  return <p className="text-[10.5px] text-[#86868b]">Queued</p>
}
