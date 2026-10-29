'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: which TRYBE brand a vertical video goes to, and the choices TRYBE's
// own upload asks for (program, brief angle, products, only on TRYBE, a note).
// Read through SCOUT from the creator's signed in TRYBE, the way TRYBE's page
// reads them (lib/trybe-submit readBrandOptions). Nothing is sent from here:
// the drop's Launch sends it.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandOptions, type BrandOptions } from '@/lib/trybe-submit'
import { byBrandName, type MyBrand } from '@/lib/trybe-mybrands'
import { groupProducts, productAudience, worthGrouping, type Audience } from '@/lib/trybe-product-groups'

export interface TrybeChoice {
  brandId: string
  brandName: string
  programId: string | null
  angleId: string | null
  productIds: string[]
  /** The picked products' names, for ticking the matching sample in This week. */
  productNames?: string[]
  exclusive: boolean
  notes: string
  /** The brand wants a product picked and none is yet. */
  needsProduct: boolean
}

export const emptyChoice = (): TrybeChoice => ({ brandId: '', brandName: '', programId: null, angleId: null, productIds: [], exclusive: false, notes: '', needsProduct: false })

/** What still stops this video going to TRYBE, or null. */
export function choiceBlocker(c: TrybeChoice | null): string | null {
  if (!c?.brandId) return 'Pick the TRYBE brand'
  if (c.needsProduct && c.productIds.length === 0) return `Pick the ${c.brandName} product it shows`
  return null
}

const field = 'w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent'
const fieldStyle = { borderColor: 'var(--border)', color: 'var(--text)' }

export default function DropTrybePicker({ brands, brandsError, value, onChange }: {
  brands: MyBrand[] | null
  brandsError: string | null
  value: TrybeChoice
  onChange: (c: TrybeChoice) => void
}) {
  const [opts, setOpts] = useState<BrandOptions | null>(null)
  const [optsError, setOptsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // A long product list is grouped, searchable and filterable (Seb,
  // 2026-10-29: "the list is too messy like this").
  const [search, setSearch] = useState('')
  const [audience, setAudience] = useState<Audience | null>(null)

  // The brand's programs, angles and products, read when a brand is picked.
  useEffect(() => {
    if (!value.brandId) { setOpts(null); return }
    let gone = false
    setLoading(true); setOptsError(null)
    const id = encodeURIComponent(value.brandId)
    Promise.all([
      requestTrybeApi('GET', `/backend/api/creator/v2/brands/${id}/details`),
      requestTrybeApi('GET', `/backend/api/creator/v2/brands/${id}/products`),
    ]).then(([d, p]) => {
      if (gone) return
      if (!d.ok) { setOptsError(`TRYBE did not show this brand's details${d.status ? ` (${d.status})` : ''}. Are you signed in to TRYBE in this Chrome?`); setOpts(null); return }
      const o = readBrandOptions(d.json, p.ok ? p.json : null)
      setOpts(o)
      // The first program and nothing else picked, until the creator says.
      const programId = value.programId && o.programs.some((x) => x.id === value.programId) ? value.programId : (o.programs[0]?.id ?? null)
      onChange({ ...value, programId, needsProduct: o.needsProduct && o.products.length > 0,
        productIds: value.productIds.filter((x) => o.products.some((pp) => pp.id === x)) })
      if (o.needsProduct && !p.ok) setOptsError(`This brand asks for a product, and TRYBE did not show its products${p.status ? ` (${p.status})` : ''}.`)
    }).catch((e) => { if (!gone) setOptsError(e instanceof Error ? e.message : 'SCOUT did not answer.') })
      .finally(() => { if (!gone) setLoading(false) })
    return () => { gone = true }
    // Only a new brand reads again; the rest of the choice is the creator's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.brandId])

  const angles = (opts?.angles ?? []).filter((a) => !value.programId || a.programId === value.programId)

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
      <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
        TRYBE brand
        {brandsError ? <span className="font-normal text-[12px] text-amber-700 dark:text-amber-300">{brandsError}</span>
          : !brands ? <span className="inline-flex items-center gap-1.5 font-normal"><Loader2 size={12} className="animate-spin" /> Reading your TRYBE brands through SCOUT</span>
            : brands.length === 0 ? <span className="font-normal text-[12px] text-amber-700 dark:text-amber-300">TRYBE shows no brands you work with yet. Join a brand on TRYBE first.</span>
              : (
                <select className={field} style={fieldStyle} value={value.brandId}
                  onChange={(e) => { const b = brands.find((x) => x.id === e.target.value); onChange({ ...emptyChoice(), notes: value.notes, exclusive: value.exclusive, brandId: b?.id ?? '', brandName: b?.name ?? '' }) }}>
                  <option value="">Pick the brand this video is for</option>
                  {[...brands].sort(byBrandName).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
      </label>

      {value.brandId && loading && <p className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-2)' }}><Loader2 size={12} className="animate-spin" /> Reading {value.brandName} on TRYBE</p>}
      {optsError && <p className="text-[12px] text-amber-700 dark:text-amber-300">{optsError}</p>}

      {opts && !loading && (
        <>
          {opts.programs.length > 1 && (
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
              Program
              <select className={field} style={fieldStyle} value={value.programId ?? ''} onChange={(e) => onChange({ ...value, programId: e.target.value || null, angleId: null })}>
                {opts.programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.subtitle ? `: ${p.subtitle}` : ''}</option>)}
              </select>
            </label>
          )}
          {angles.length > 0 && (
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
              Brief angle (optional)
              <select className={field} style={fieldStyle} value={value.angleId ?? ''} onChange={(e) => onChange({ ...value, angleId: e.target.value || null })}>
                <option value="">No angle</option>
                {angles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          {opts.products.length > 0 && (() => {
            const toggle = (id: string) => {
              const on = value.productIds.includes(id)
              const ids = on ? value.productIds.filter((x) => x !== id) : [...value.productIds, id]
              onChange({ ...value, productIds: ids, productNames: opts.products.filter((pp) => ids.includes(pp.id)).map((pp) => pp.name) })
            }
            const chip = (p: BrandOptions['products'][number]) => {
              const on = value.productIds.includes(p.id)
              return (
                <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(p.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]"
                  style={{ borderColor: on ? '#0EA5A4' : 'var(--border)', background: on ? 'rgba(14,165,164,0.10)' : 'transparent', color: 'var(--text)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image && <img src={p.image} alt="" className="w-5 h-5 rounded object-cover" />}
                  {p.name}
                </button>
              )
            }
            const grouped = worthGrouping(opts.products)
            const audiences = Array.from(new Set(opts.products.map((p) => productAudience(p.name)).filter(Boolean))) as Audience[]
            const q = search.trim().toLowerCase()
            const shown = opts.products.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!audience || [audience, 'Unisex', null].includes(productAudience(p.name))))
            const picked = opts.products.filter((p) => value.productIds.includes(p.id))
            return (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  Product{opts.needsProduct ? ' (the brand asks for one)' : ' (optional)'}
                </legend>
                {!grouped ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">{opts.products.map(chip)}</div>
                ) : (
                  <div className="flex flex-col gap-2 mt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input className={`${field} max-w-[260px]`} style={fieldStyle} placeholder={`Search ${opts.products.length} products`} value={search} onChange={(e) => setSearch(e.target.value)} />
                      {audiences.length > 1 && ([null, ...audiences.filter((a) => a !== 'Unisex')] as (Audience | null)[]).map((a) => (
                        <button key={a ?? 'all'} type="button" onClick={() => setAudience(a)} className="rounded-full border px-2.5 py-1 text-[11.5px]"
                          style={{ borderColor: audience === a ? '#0EA5A4' : 'var(--border)', background: audience === a ? 'rgba(14,165,164,0.10)' : 'transparent', color: 'var(--text)' }}>
                          {a ?? 'All'}
                        </button>
                      ))}
                    </div>
                    {picked.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>Picked:</span>
                        {picked.map(chip)}
                      </div>
                    )}
                    {shown.length === 0 && <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>No product matches that.</p>}
                    {groupProducts(shown).map((g) => (
                      <details key={g.group} open={!!q || !!audience || g.items.some((p) => value.productIds.includes(p.id))} className="rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--border)' }}>
                        <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                          {g.group} <span className="font-normal" style={{ color: 'var(--text-2)' }}>({g.items.length})</span>
                        </summary>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">{g.items.map(chip)}</div>
                      </details>
                    ))}
                  </div>
                )}
              </fieldset>
            )
          })()}
          <label className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--text)' }}>
            <input type="checkbox" className="mt-0.5" checked={value.exclusive} onChange={(e) => onChange({ ...value, exclusive: e.target.checked })} />
            <span>Only on TRYBE. Tick this only if you will not post this video anywhere else: TRYBE tells the brand it is theirs alone.</span>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
            Note to the brand (optional)
            <textarea className={field} style={fieldStyle} rows={2} maxLength={2000} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
          </label>
        </>
      )}
    </div>
  )
}
