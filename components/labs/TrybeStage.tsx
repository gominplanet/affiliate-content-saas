'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR STAGE, on Find brands (Seb, 2026-10-14): "especially at first, it is
// good to understand how brands work and stick to volume.. once you see your
// winners with MVP, then you can focus on those and really double and triple
// down on what matters and what pays." Read from the creator's own TRYBE
// numbers (brands/stats through SCOUT), judged by judgeBrands, staged by
// lib/trybe-finder stageOf. A read that failed is said, never shown as
// "no winners yet".

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp, Layers, Rocket, RotateCcw } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, judgeBrands } from '@/lib/trybe-mybrands'
import { stageOf, roadWords, ROAD_GOAL, type StageRead } from '@/lib/trybe-finder'
import { readAdWinners } from '@/components/labs/useTrybeAds'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'

export default function TrybeStage({ canRead, onGo }: { canRead: boolean; onGo: (tab: 'brands' | 'week') => void }) {
  const [read, setRead] = useState<StageRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!canRead) return
    let gone = false
    setLoading(true); setError(null)
    // Your ads too (SCOUT 1.47.0): brands winning on ads count as winners.
    // Not read (an older SCOUT) judges by approvals and pay, as before.
    Promise.all([requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all'), readAdWinners().catch(() => null)])
      .then(([r, ads]) => {
        if (gone) return
        if (!r.ok) { setError('MVP could not read your TRYBE numbers just now, so your stage is not known.'); return }
        setRead(stageOf(judgeBrands(readBrandStats(r.json)), ads))
      })
      .catch(() => { if (!gone) setError('MVP could not read your TRYBE numbers just now, so your stage is not known.') })
      .finally(() => { if (!gone) setLoading(false) })
    return () => { gone = true }
  }, [canRead, nonce])

  if (!canRead) return null
  if (loading && !read) {
    return <p className="text-[12px] mb-3 inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}><Loader2 size={12} className="animate-spin" /> Reading your TRYBE numbers for your stage...</p>
  }
  if (error && !read) {
    return (
      <p className="text-[12px] mb-3 inline-flex items-center gap-2" style={{ color: AMBER }}>
        {error} <button onClick={() => setNonce((n) => n + 1)} className="font-semibold underline inline-flex items-center gap-1"><RotateCcw size={11} /> Try again</button>
      </p>
    )
  }
  if (!read) return null
  const Icon = read.stage === 'double' ? TrendingUp : read.stage === 'volume' ? Layers : Rocket
  const tone = read.stage === 'double' ? GREEN : PURPLE
  // The two stages side by side, the current one lit: where you are, and what is next.
  const steps: Array<{ id: 'volume' | 'double'; label: string }> = [{ id: 'volume', label: '1. Volume: learn what pays' }, { id: 'double', label: '2. Double down on winners' }]
  const at = read.stage === 'double' ? 'double' : 'volume'
  return (
    <section className="rounded-xl border p-3.5 mb-3" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} aria-label="Your stage">
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {steps.map((s) => (
          <span key={s.id} className="text-[11px] font-bold rounded-full px-2.5 py-0.5"
            style={s.id === at ? { background: tone, color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-3)' }}>{s.label}</span>
        ))}
      </div>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center" style={{ background: `${tone}1F`, color: tone }}><Icon size={16} /></span>
        <div className="min-w-0">
          <p className="text-[14.5px] font-bold">{read.title}</p>
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{read.says}</p>
          {read.sent != null && (
            <div className="mt-2" aria-label="Road to 500">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                <span>Road to {ROAD_GOAL}</span><span className="tabular-nums">{Math.min(read.sent, ROAD_GOAL)} / {ROAD_GOAL}</span>
              </div>
              <div className="h-2 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--surface-2)' }} role="progressbar" aria-valuemin={0} aria-valuemax={ROAD_GOAL} aria-valuenow={Math.min(read.sent, ROAD_GOAL)}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (read.sent / ROAD_GOAL) * 100)}%`, background: read.sent >= ROAD_GOAL ? GREEN : PURPLE }} />
              </div>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-2)' }}>{roadWords(read.sent)}</p>
            </div>
          )}
          {read.adWins.length > 0 && (
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-2)' }}>
              <span className="font-semibold" style={{ color: GREEN }}>Winning on ads:</span> {read.adWins.slice(0, 3).map((a) => `${a.brand} (${a.why})`).join('; ')}
            </p>
          )}
          <p className="text-[12px] mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <button onClick={() => onGo('brands')} className="font-semibold underline" style={{ color: PURPLE }}>See My brands</button>
            {read.stage === 'double' && <button onClick={() => onGo('week')} className="font-semibold underline" style={{ color: PURPLE }}>Plan their videos in This week</button>}
          </p>
        </div>
      </div>
    </section>
  )
}
