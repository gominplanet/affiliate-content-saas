'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE VIDEO BUILDER (Seb, 2026-11-27: "if I click on that, it takes me step
// by step in the creation of the video"; it was the Video Builder, and "I don't
// know if I like the name ... It should be something more encompassing").
// One path from a brand to videos sent to it on TRYBE:
//   1 Brand     a brand you work with on TRYBE
//   2 Product   which of its products the videos are for
//   3 Rules     everything the brand gave you, read into do's and don'ts
//               (TrybeStudioRules)
//   4 Scripts   modular hooks, bodies, CTAs and the B-roll to film, talking
//               to camera or voiceover (TrybeStudioScripts)
//   5 Make      the options and music, your clips, Process, then each video
//               checked and sent (TrybeStudioVideos)
// Everything is kept per brand and product (studio_projects, migration 477),
// so you come back to it after the shoot. Pro only when it opens; the team
// first (labs-preview trybe_studio).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ArrowLeft, ArrowRight, Search, Wand2, AlertTriangle, Check } from 'lucide-react'
import { getScoutStatus, requestTrybeApi } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_TRYBE_SUBMIT_MIN_VERSION } from '@/lib/scout-version'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import type { StudioSheet } from '@/lib/studio-rules'
import { loadBrandPage, type BrandPage } from '@/components/labs/TrybeVideoIdeas'
import TrybeStudioRules from '@/components/labs/TrybeStudioRules'
import TrybeStudioScripts, { type BuilderProject } from '@/components/labs/TrybeStudioScripts'
import TrybeStudioVideos from '@/components/labs/TrybeStudioVideos'

const ACCENT = 'var(--accent)'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
export const BUILDER_NAME = 'Video Builder'
type Step = 'brand' | 'product' | 'rules' | 'scripts' | 'make'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'brand', label: 'Brand' }, { id: 'product', label: 'Product' }, { id: 'rules', label: 'Rules' }, { id: 'scripts', label: 'Scripts' }, { id: 'make', label: 'Make' },
]

export default function TrybeStudio({ canRead }: {
  /** SCOUT can read TRYBE (the brands you work with, a brand's page). */
  canRead: boolean
}) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [canSend, setCanSend] = useState(false)
  const [step, setStep] = useState<Step>('brand')
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null)
  const [page, setPage] = useState<BrandPage | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [typed, setTyped] = useState('')
  const [project, setProject] = useState<BuilderProject | null>(null)
  const [projectErr, setProjectErr] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
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

  const pickBrand = useCallback(async (b: { id: string; name: string }) => {
    setBrand(b); setProject(null); setSheet(null); setPage(null); setTyped(''); setProjectErr(null); setStep('product')
    setPageLoading(true)
    try { setPage(await loadBrandPage(b.id)) } catch { setPage(null) } finally { setPageLoading(false) }
  }, [])

  // The product picked opens its video set (one per brand and product), new or kept.
  const pickProduct = async (product: string) => {
    if (!brand || !product.trim()) return
    setOpening(product); setProjectErr(null)
    try {
      const r = await fetch('/api/labs/trybe-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'project', brandId: brand.id, brandName: brand.name, product: product.trim() }), signal: AbortSignal.timeout(30_000) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `MVP answered ${r.status}`)
      setProject(j.project as BuilderProject)
      setStep('rules')
    } catch (e) { setProjectErr(e instanceof Error ? e.message : 'No answer') } finally { setOpening(null) }
  }

  const shown = useMemo(() => (brands ?? []).filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [brands, q])
  const reached: Record<Step, boolean> = { brand: true, product: !!brand, rules: !!project, scripts: !!project, make: !!project }
  const done: Record<Step, boolean> = { brand: !!brand, product: !!project, rules: !!sheet, scripts: !!project?.scripts, make: false }
  const idx = STEPS.findIndex((s) => s.id === step)
  const next = STEPS[idx + 1]
  const prev = STEPS[idx - 1]
  // This step's own job done: the rules read, the scripts written.
  const stepDone = step === 'rules' ? !!sheet : step === 'scripts' ? !!project?.scripts : true
  const skipWords = step === 'scripts' ? 'Skip: I already filmed my videos' : step === 'rules' ? 'Skip the rules for now' : `Skip to ${next?.label ?? 'the next step'}`

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-[20px] font-bold inline-flex items-center gap-2"><Wand2 size={19} style={{ color: ACCENT }} /> {BUILDER_NAME}</h2>
          {brand && <span className="text-[13px] font-semibold" style={soft}>{brand.name}{project ? `: ${project.product}` : ''}</span>}
        </div>
        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button disabled={!reached[s.id]} onClick={() => setStep(s.id)} aria-current={step === s.id ? 'step' : undefined}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40"
                style={step === s.id ? { background: ACCENT, color: '#fff' } : { border: '1px solid var(--border)', color: 'var(--text)' }}>
                <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px] font-bold" style={step === s.id ? { background: 'rgba(255,255,255,0.25)' } : { background: 'rgb(var(--brand-rgb) / 0.10)', color: ACCENT }}>{done[s.id] ? <Check size={11} /> : i + 1}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {step === 'brand' && (
        <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h3 className="text-[17px] font-bold">Which brand are these videos for?</h3>
            {(brands?.length ?? 0) > 8 && (
              <label className="ml-auto relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a brand" className="rounded-xl border bg-transparent pl-8 pr-3 py-1.5 text-[13.5px]" style={{ borderColor: 'var(--border)' }} />
              </label>
            )}
          </div>
          <p className="text-[13px] mb-4" style={soft}>Step by step: the product, the brand&rsquo;s rules, scripts to shoot, then MVP puts your clips together into finished videos and sends them to the brand when you press Send.</p>
          {brandsError && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {brandsError}</p>}
          {!brands && !brandsError && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading the brands you work with on TRYBE...</p>}
          {brands && brands.length === 0 && <p className="text-[13px]" style={soft}>No brand has accepted you on TRYBE yet. Find brands first, then come back.</p>}
          {shown.length > 0 && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              {shown.map((b) => (
                <button key={b.id} onClick={() => void pickBrand({ id: b.id, name: b.name })} className="rounded-2xl border p-3 flex flex-col items-center gap-2 text-center hover:shadow-sm transition-shadow" style={{ borderColor: brand?.id === b.id ? ACCENT : 'var(--border)', background: 'var(--surface)' }}>
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
      )}

      {step === 'product' && brand && (
        <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <h3 className="text-[17px] font-bold">Which {brand.name} product?</h3>
          <p className="text-[13px] mb-3" style={soft}>The scripts, the rules check and the send are for this product. Each product keeps its own scripts and videos.</p>
          {pageLoading && <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading {brand.name}&rsquo;s products on TRYBE...</p>}
          {!pageLoading && (
            <>
              <div className="flex flex-wrap gap-2">
                {(page?.products ?? []).map((p) => (
                  <button key={p.name} onClick={() => void pickProduct(p.name)} disabled={!!opening} className="rounded-xl px-3 py-2 text-[13.5px] font-semibold inline-flex items-center gap-2 disabled:opacity-60" style={{ border: `${project?.product === p.name ? 2 : 1}px solid ${project?.product === p.name ? ACCENT : 'var(--border)'}` }}>
                    {opening === p.name && <Loader2 size={13} className="animate-spin" />}{p.name}{p.promoted ? <span className="text-[11px] font-bold" style={{ color: ACCENT }}>Promoted</span> : null}
                  </button>
                ))}
              </div>
              {!page?.products.length && <p className="text-[13px]" style={soft}>{page ? `TRYBE lists no products for ${brand.name}.` : `MVP could not read ${brand.name}'s page on TRYBE.`} Type the product below.</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 160))} placeholder="Or type the product" className="flex-1 min-w-[14rem] rounded-xl border bg-transparent px-3 py-2 text-[13.5px]" style={{ borderColor: 'var(--border)' }} />
                <button onClick={() => void pickProduct(typed)} disabled={!typed.trim() || !!opening} className="rounded-xl px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: ACCENT, color: '#fff' }}>Use this product</button>
              </div>
            </>
          )}
          {projectErr && <p className="text-[13px] inline-flex items-start gap-1.5 mt-2" style={{ color: '#DC2626' }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {projectErr}</p>}
        </section>
      )}

      {/* The rules stay mounted once read, so moving between steps never reads them again. */}
      {brand && project && <div hidden={step !== 'rules'}><TrybeStudioRules brand={brand} canRead={canRead} onSheet={setSheet} /></div>}
      {step === 'scripts' && brand && project && <TrybeStudioScripts brand={brand} project={project} hasRules={!!sheet} onProject={setProject} />}
      {step === 'make' && brand && project && <TrybeStudioVideos brand={brand} brands={brands} brandsError={brandsError} canSend={canSend} hasRules={!!sheet} project={project} onProject={setProject} />}

      {step !== 'brand' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {prev ? <button onClick={() => setStep(prev.id)} className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: ACCENT }}><ArrowLeft size={13} /> {prev.label}</button> : <span />}
          {/* ONE MAIN BUTTON AT A TIME (Seb, 2026-11-28: "Why is there both buttons? ... I guess write
              the scripts is first and then we click make"). Until this step's own job is done (the rules
              read, the scripts written), going on is a quiet skip, never a second main button beside it. */}
          {next && reached[next.id] && (stepDone
            ? <button onClick={() => setStep(next.id)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13.5px] font-semibold" style={{ background: ACCENT, color: '#fff' }}>Next: {next.label} <ArrowRight size={14} /></button>
            : <button onClick={() => setStep(next.id)} className="inline-flex items-center gap-1 text-[13px] font-semibold underline" style={{ color: 'var(--text-3)' }}>{skipWords} <ArrowRight size={13} /></button>)}
        </div>
      )}
    </div>
  )
}
