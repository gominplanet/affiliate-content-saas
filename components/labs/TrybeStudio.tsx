'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE EDIT STUDIO (Seb, 2026-11-26: "this whole entire build is for users who
// submit content to brands through trybe"; "this is not a scripting tool ...
// this is an editing tool"). Pick a brand you work with on TRYBE; MVP reads
// everything it gave you into one list of rules (phase 1, TrybeStudioRules);
// drop your vertical takes, tick the options, and each finished video is
// checked against those rules and sent to the brand in one press (phase 2,
// TrybeStudioVideos). Pro only when it opens; the team first (labs-preview
// trybe_studio).

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ArrowLeft, Search, Wand2, AlertTriangle } from 'lucide-react'
import { getScoutStatus, requestTrybeApi } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_TRYBE_SUBMIT_MIN_VERSION } from '@/lib/scout-version'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import type { StudioSheet } from '@/lib/studio-rules'
import TrybeStudioRules from '@/components/labs/TrybeStudioRules'
import TrybeStudioVideos from '@/components/labs/TrybeStudioVideos'

const ACCENT = 'var(--accent)'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }

export default function TrybeStudio({ canRead }: {
  /** SCOUT can read TRYBE (the brands you work with, a brand's page). */
  canRead: boolean
}) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [canSend, setCanSend] = useState(false)
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null)
  const [sheet, setSheet] = useState<StudioSheet | null>(null)
  const [q, setQ] = useState('')

  // The brands you work with on TRYBE, through SCOUT: the same read as Upload.
  useEffect(() => {
    getScoutStatus().then((st) => {
      setCanSend(!!st.installed && scoutAtLeast(st.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION))
      if (!st.installed) { setBrandsError('Install SCOUT and sign in to TRYBE in this Chrome to see the brands you work with.'); return }
      requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
        if (!r.ok) { setBrandsError(`TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Sign in to TRYBE in this Chrome, then reload.`); return }
        setBrands(readBrandStats(r.json))
      }).catch((e) => setBrandsError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
    }).catch(() => setBrandsError('SCOUT did not answer. Install it, sign in to TRYBE in this Chrome, then reload.'))
  }, [])

  const shown = useMemo(() => (brands ?? []).filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [brands, q])

  if (brand) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setBrand(null); setSheet(null) }} className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: ACCENT }}><ArrowLeft size={13} /> Another brand</button>
          <h2 className="text-[20px] font-bold">{brand.name}</h2>
          <span className="text-[12px] rounded-full px-2.5 py-0.5 font-semibold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>Edit Studio</span>
        </div>
        <TrybeStudioRules brand={brand} canRead={canRead} onSheet={setSheet} />
        <TrybeStudioVideos brand={brand} brands={brands} brandsError={brandsError} canSend={canSend} hasRules={!!sheet} />
      </div>
    )
  }

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h2 className="text-[20px] font-bold inline-flex items-center gap-2"><Wand2 size={19} style={{ color: ACCENT }} /> Edit Studio</h2>
        {(brands?.length ?? 0) > 8 && (
          <label className="ml-auto relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a brand" className="rounded-xl border bg-transparent pl-8 pr-3 py-1.5 text-[13.5px]" style={{ borderColor: 'var(--border)' }} />
          </label>
        )}
      </div>
      <p className="text-[13px] mb-4" style={soft}>Pick the brand your videos are for. MVP reads its rules, edits your vertical takes as TRYBE ads with the options you tick, checks each one against the rules, and sends it to the brand when you press Send.</p>
      {brandsError && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {brandsError}</p>}
      {!brands && !brandsError && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading the brands you work with on TRYBE...</p>}
      {brands && brands.length === 0 && <p className="text-[13px]" style={soft}>No brand has accepted you on TRYBE yet. Find brands first, then come back with their videos.</p>}
      {shown.length > 0 && (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {shown.map((b) => (
            <button key={b.id} onClick={() => setBrand({ id: b.id, name: b.name })} className="rounded-2xl border p-3 flex flex-col items-center gap-2 text-center hover:shadow-sm transition-shadow" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {b.logo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={b.logo} alt="" className="w-14 h-14 rounded-xl object-contain border" style={{ borderColor: 'var(--border)', background: '#fff' }} />
                : <span className="w-14 h-14 rounded-xl inline-flex items-center justify-center text-[20px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>{b.name.slice(0, 1).toUpperCase()}</span>}
              <span className="text-[14px] font-semibold leading-tight">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
