'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// COMPARE BRANDS SIDE BY SIDE (Seb, 2026-10-17: "do ... eight"). The brands
// pressed Compare on in Find brands wait in a small bar at the foot of the
// screen; Compare opens them next to each other, one row per thing that
// matters (lib/trybe-compare), the better value marked. "Not known" is never
// the better one.

import { useEffect, useMemo, useState } from 'react'
import { X, ArrowLeftRight, Check } from 'lucide-react'
import { compareRows, COMPARE_MAX, type CompareBrand } from '@/lib/trybe-compare'
import { BrandMark } from '@/components/labs/TrybeFinderControls'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'

export default function TrybeCompare({ brands, onRemove, onClear }: { brands: Array<CompareBrand & { website?: string | null }>; onRemove: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => compareRows(brands), [brands])
  useEffect(() => { if (brands.length < 2) setOpen(false) }, [brands.length])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!brands.length) return null
  const soft = { color: 'var(--text-soft)' }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(40rem,calc(100vw-2rem))] rounded-2xl border shadow-lg px-3 py-2.5 flex flex-wrap items-center gap-2" style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'var(--surface)' }} role="region" aria-label="Brands to compare">
        <ArrowLeftRight size={15} style={{ color: PURPLE }} />
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {brands.map((b) => (
            <span key={b.brand_id} className="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-0.5 text-[12.5px] font-semibold max-w-[12rem]" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>
              <span className="truncate">{b.name}</span>
              <button onClick={() => onRemove(b.brand_id)} aria-label={`Take ${b.name} out of the comparison`}><X size={12} /></button>
            </span>
          ))}
          {brands.length < 2 && <span className="text-[12px]" style={soft}>Press Compare on one more brand.</span>}
        </div>
        <button onClick={onClear} className="text-[12px] font-semibold underline" style={soft}>Clear</button>
        <button onClick={() => setOpen(true)} disabled={brands.length < 2} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>
          Compare {brands.length}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Brands side by side" onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-4xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}>
            <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h2 className="text-[17px] font-bold flex-1">Side by side</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 rounded-lg hover:bg-[var(--surface-2)]"><X size={18} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[34rem]">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 w-[28%]" />
                    {brands.slice(0, COMPARE_MAX).map((b) => (
                      <th key={b.brand_id} className="text-left px-3 py-3 align-bottom">
                        <span className="flex items-center gap-2">
                          <BrandMark name={b.name} website={b.website ?? null} size={30} />
                          <span className="font-bold text-[14px] leading-tight">{b.name}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <th scope="row" className="text-left px-4 py-2.5 align-top font-semibold">
                        {r.label}
                        <span className="block text-[11.5px] font-normal leading-snug" style={soft}>{r.says}</span>
                      </th>
                      {r.values.map((v, i) => {
                        const best = r.best === i
                        return (
                          <td key={i} className="px-3 py-2.5 align-top tabular-nums" style={best ? { color: GREEN, fontWeight: 700 } : v === 'Not known' ? soft : undefined}>
                            <span className="inline-flex items-start gap-1">{best && <Check size={13} className="mt-0.5 shrink-0" aria-hidden />}{v}{best && <span className="sr-only"> (the better of these)</span>}</span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[12px] border-t" style={{ ...soft, borderColor: 'var(--border)' }}>Green is the better value on that row. &ldquo;Not known&rdquo; means TRYBE or MVP has no figure for it yet, and it is never counted as better. Estimates are for choosing brands only: never put a rate in a message to a brand.</p>
          </div>
        </div>
      )}
    </>
  )
}
