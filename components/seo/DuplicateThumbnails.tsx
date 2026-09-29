'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Extra copies of YouTube thumbnails in the creator's WordPress media library,
// left by the old heal job (lib/thumbnail-duplicates). Checked on its own when
// the page opens, at most once a day in this browser, and shown only when
// there is something to remove. Removal is a button, never automatic, and the
// result is counted from what WordPress deleted, not from what was asked.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy as CopyIcon } from 'lucide-react'

const SEEN = 'mvp.thumbDupes.checkedAt'

export function DuplicateThumbnails() {
  const [ids, setIds] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let last = 0
    try { last = Number(localStorage.getItem(SEEN) || 0) } catch { /* storage blocked: check anyway */ }
    if (Date.now() - last < 86_400_000) return
    fetch('/api/blog/thumbnail-duplicates', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) return
        setIds(Array.isArray(j.ids) ? j.ids : [])
        // Remembered only when there was nothing to do, so a pile still
        // waiting keeps being shown.
        if (!j.count) { try { localStorage.setItem(SEEN, String(Date.now())) } catch { /* not remembered */ } }
      })
      .catch(() => { /* a report; nothing shown */ })
  }, [])

  const remove = async () => {
    if (!ids?.length) return
    setBusy(true); setTotal(ids.length); setDone(0)
    let left = ids, removed = 0, failed = 0
    try {
      while (left.length) {
        const r = await fetch('/api/blog/thumbnail-duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: left }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) { toast.error(j.error || 'WordPress stopped answering. What was removed stays removed; press the button again for the rest.'); break }
        removed += j.removed || 0; failed += j.failed || 0
        setDone(removed)
        const next: number[] = Array.isArray(j.left) ? j.left : []
        if (next.length >= left.length) break // no progress: stop rather than loop
        left = next
      }
    } finally {
      setBusy(false)
      setIds(left)
      if (removed) toast.success(`Removed ${removed.toLocaleString()} duplicate thumbnail${removed === 1 ? '' : 's'} from your media library.${failed ? ` ${failed} could not be removed.` : ''}`)
      if (!left.length) { try { localStorage.setItem(SEEN, String(Date.now())) } catch { /* not remembered */ } }
    }
  }

  if (!ids || ids.length === 0) return null
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 px-4 py-3 flex items-center gap-2.5">
      <CopyIcon size={15} className="text-[#ff9500] flex-shrink-0" />
      <span className="text-[13px] text-[#4b4b4f] dark:text-[#d2d2d7] flex-1 min-w-0">
        <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{ids.length.toLocaleString()} duplicate thumbnail{ids.length === 1 ? '' : 's'} in your media library.</span>{' '}
        MVP uploaded the same YouTube thumbnails again and again by mistake. None of these copies is used by a post; the one each post shows stays.
        {busy && <> Removed {done.toLocaleString()} of {total.toLocaleString()}…</>}
      </span>
      <button onClick={remove} disabled={busy}
        className="shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-md text-white bg-[#ff9500] transition-opacity hover:opacity-90 disabled:opacity-60">
        {busy ? 'Removing…' : 'Remove them'}
      </button>
    </div>
  )
}
