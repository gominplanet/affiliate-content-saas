'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SAMPLE GUARD (Seb, 2026-10-14: "build 1, 2, 3, and 4"; Austin's
// "sample jail"). Before you ask a brand for another sample: how many are
// here and not filmed, and how many are on the way (lib/trybe-week
// sampleGuard). Shown only when it is worth saying. With `samples` it uses
// the list already on the page; without, it reads your samples once.

import { useEffect, useState } from 'react'
import { PackageX } from 'lucide-react'
import { sampleGuard, type Sample } from '@/lib/trybe-week'

type Row = Pick<Sample, 'received_at' | 'filmed_at' | 'submitted_at'>

export default function TrybeSampleGuard({ samples, onFilm }: { samples?: Row[] | null; onFilm?: () => void }) {
  const [read, setRead] = useState<Row[] | null>(samples ?? null)
  useEffect(() => { if (samples) setRead(samples) }, [samples])
  useEffect(() => {
    if (samples !== undefined) return
    let gone = false
    fetch('/api/labs/trybe/samples', { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).then((d) => { if (!gone && Array.isArray(d.samples)) setRead(d.samples) }).catch(() => { /* nothing to warn about from a failed read */ })
    return () => { gone = true }
  }, [samples])
  if (!read) return null
  const g = sampleGuard(read)
  if (!g.says) return null
  const stop = g.level === 'stop'
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-xl px-3 py-2.5 mb-3" style={{ background: stop ? 'rgba(220,38,38,0.08)' : 'rgba(180,83,9,0.09)' }} role="status">
      <PackageX size={15} className="mt-0.5 shrink-0" style={{ color: stop ? '#DC2626' : '#B45309' }} />
      <p className="text-[12.5px] flex-1 min-w-[14rem]"><b>{stop ? 'Sample jail:' : 'Samples piling up:'}</b> {g.says}</p>
      {onFilm && <button onClick={onFilm} className="text-[12px] font-semibold underline" style={{ color: '#7C3AED' }}>Plan them in This week</button>}
    </div>
  )
}
