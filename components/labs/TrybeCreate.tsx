'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MAKE VIDEOS (Seb, 2026-10-13: "pick a brand, then pick the product they want
// to create from that brand, and then let MVP give them the copy to start
// shooting videos. it has to be more streamlined and easy"). Three steps, one
// at a time, each said in plain words:
//   1. Pick a brand: the brands you work with on TRYBE, read through SCOUT.
//   2. Pick the product you have: the brand's "Promote These", or type it.
//      Its creative brief is read on the way (lib route action brief_read).
//   3. Your shooting scripts: ten videos for that product, from the brief,
//      saved per brand and product (TrybeVideoIdeas does the writing).

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ArrowLeft, Search, Check, FileText, ExternalLink, AlertTriangle } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import { brandPageUrl } from '@/lib/trybe-brand-page'
import TrybeVideoIdeas, { loadBrandPage, type BrandPage } from '@/components/labs/TrybeVideoIdeas'
import { AmazonLine, ProductAmazon } from '@/components/labs/TrybeFinderControls'
import { useTrybeAmazon } from '@/components/labs/useTrybeAmazon'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'

export default function TrybeCreate({ canRead, isAdmin, onFind }: { canRead: boolean; isAdmin: boolean; onFind: () => void }) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState<MyBrand | null>(null)
  const [page, setPage] = useState<BrandPage | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [typed, setTyped] = useState('')
  const [product, setProduct] = useState<string | null>(null)
  const [onHand, setOnHand] = useState<'idle' | 'saving' | 'done'>('idle')
  const [onHandErr, setOnHandErr] = useState<string | null>(null)
  // THE AMAZON MATCH (Seb, 2026-10-14): each brand you work with, and each
  // of its products you already filmed on Amazon.
  const amzBrands = useMemo(() => (brands || []).map((b) => ({ id: b.id, name: b.name })), [brands])
  // The product picked in step 3 is read too, typed or not on TRYBE's list.
  const amzProducts = useMemo(() => {
    if (!brand) return []
    const names = Array.from(new Set([...(page ? page.products.map((p) => p.name) : []), ...(product ? [product] : [])]))
    return names.map((name) => ({ brand: brand.name, name }))
  }, [brand, page, product])
  const amz = useTrybeAmazon(amzBrands, amzProducts, amzBrands.length > 0)
  useEffect(() => { setOnHand('idle'); setOnHandErr(null) }, [product, brand])

  async function markOnHand() {
    if (!brand || !product) return
    setOnHand('saving'); setOnHandErr(null)
    try {
      const r = await fetch('/api/labs/trybe/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', brandName: brand.name, brandId: brand.id, product, received: true }), signal: AbortSignal.timeout(30_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Not saved (${r.status})`)
      setOnHand('done')
    } catch (e) { setOnHand('idle'); setOnHandErr(e instanceof Error ? e.message : 'Not saved.') }
  }

  useEffect(() => {
    if (!canRead || brands) return
    requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
      if (!r.ok) { setError(r.error === 'not-allowed' ? 'This needs SCOUT 1.46.0 or newer.' : `TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Are you signed in to TRYBE in this Chrome?`); return }
      setBrands(readBrandStats(r.json))
    }).catch((e) => setError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
  }, [canRead, brands])

  async function pickBrand(b: MyBrand) {
    setBrand(b); setProduct(null); setTyped(''); setPage(null); setPageLoading(true)
    try { setPage(await loadBrandPage(b.id)) } finally { setPageLoading(false) }
  }

  const shown = useMemo(() => (brands || []).filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())), [brands, q])
  const step = !brand ? 1 : !product ? 2 : 3
  const soft = { color: 'var(--text-soft)' }
  const card = 'rounded-2xl border p-5'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }

  // A plain function, not a component made inside this one (that remounts).
  const steps = () => (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold">
      {['Pick a brand', 'Pick the product you have', 'Your shooting scripts'].map((label, i) => {
        const n = i + 1
        const done = step > n
        const on = step === n
        return (
          <li key={label} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden style={soft}>&rsaquo;</span>}
            <button disabled={!done} onClick={() => { if (n === 1) { setBrand(null); setProduct(null) } else if (n === 2) setProduct(null) }}
              className="inline-flex items-center gap-1.5 disabled:cursor-default" style={on ? { color: PURPLE } : done ? { color: 'var(--text)' } : soft}>
              <span className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[12px] font-bold"
                style={done ? { background: GREEN, color: '#fff' } : on ? { background: PURPLE, color: '#fff' } : { border: '1px solid var(--border)' }}>
                {done ? <Check size={13} /> : n}
              </span>
              {label}{n === 1 && brand ? `: ${brand.name}` : n === 2 && product ? `: ${product}` : ''}
            </button>
          </li>
        )
      })}
    </ol>
  )

  if (!canRead) {
    return <div className={card} style={cardStyle}><p className="text-[15px] font-semibold">Make videos needs SCOUT on TRYBE</p><p className="text-[13.5px] mt-1" style={soft}>Install SCOUT, allow it on TRYBE and sign in to TRYBE in this Chrome. MVP then shows the brands you work with and the products they want videos of.</p></div>
  }

  return (
    <div className="space-y-4">
      {steps()}

      {/* 1. The brand */}
      {step === 1 && (
        <section className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="text-[20px] font-bold">Which brand are you making videos for?</h2>
            {(brands?.length ?? 0) > 8 && (
              <label className="ml-auto relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={soft} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a brand" className="rounded-xl border bg-transparent pl-8 pr-3 py-1.5 text-[13.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
              </label>
            )}
          </div>
          {error ? <p className="text-[13.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>
            : !brands ? <p className="text-[13.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={14} className="animate-spin" /> Reading the brands you work with on TRYBE...</p>
            : brands.length === 0 ? <p className="text-[13.5px]" style={soft}>No brand has accepted you on TRYBE yet. <button onClick={onFind} className="font-semibold underline" style={{ color: PURPLE }}>Find brands that fit you</button> first.</p>
            : (
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                {shown.map((b) => (
                  <button key={b.id} onClick={() => void pickBrand(b)} className="rounded-2xl border p-3 flex flex-col items-center gap-2 text-center hover:shadow-sm transition-shadow" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    {b.logo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={b.logo} alt="" className="w-16 h-16 rounded-xl object-contain border" style={{ borderColor: 'var(--border)', background: '#fff' }} />
                      : <span className="w-16 h-16 rounded-xl inline-flex items-center justify-center text-[22px] font-bold" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{b.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="text-[14px] font-semibold leading-tight">{b.name}</span>
                    {b.earnings != null && b.earnings > 0 && <span className="text-[12px]" style={{ color: GREEN }}>${b.earnings.toLocaleString()} earned</span>}
                    <AmazonLine amazon={amz.brand(b.id)} links={false} className="justify-center" />
                  </button>
                ))}
              </div>
            )}
        </section>
      )}

      {/* 2. The product */}
      {step === 2 && brand && (
        <section className={card} style={cardStyle}>
          <button onClick={() => setBrand(null)} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: PURPLE }}><ArrowLeft size={13} /> Another brand</button>
          <h2 className="text-[20px] font-bold">Which {brand.name} product do you have?</h2>
          <AmazonLine amazon={amz.brand(brand.id)} />
          <p className="text-[13.5px] mt-0.5" style={soft}>Every script is about the product you pick, so pick the one in your hands.</p>
          {pageLoading ? (
            <p className="mt-3 text-[13.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={14} className="animate-spin" /> Reading {brand.name}&rsquo;s page on TRYBE: the products it promotes and its creative brief...</p>
          ) : (<>
            {page && page.products.length > 0 ? (() => {
              const card = (p: (typeof page.products)[number]) => (
                <button key={p.id || p.name} onClick={() => setProduct(p.name)} className="rounded-2xl border p-3 flex items-center gap-3 text-left hover:shadow-sm transition-shadow"
                  style={{ borderColor: p.sample ? 'rgba(22,163,74,0.45)' : 'var(--border)', background: 'var(--surface)' }}>
                  {p.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.image} alt="" className="w-20 h-20 rounded-xl object-contain border shrink-0 bg-white" style={{ borderColor: 'var(--border)' }} />
                    : <span className="w-20 h-20 rounded-xl shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold leading-snug">{p.name}</span>
                    {p.price && <span className="block text-[12.5px]" style={soft}>{p.price}</span>}
                    {p.sample && <span className="inline-block mt-1 text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}>Your sample: {p.sample.status.replace(/_/g, ' ')}{p.sample.at ? `, ${new Date(p.sample.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span>}
                    {!p.sample && p.promoted && <span className="inline-block mt-1 text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>TRYBE asks for this</span>}
                    <ProductAmazon match={amz.product(brand.name, p.name)} links={false} />
                  </span>
                </button>
              )
              const mine = page.products.filter((p) => p.sample)
              const rest = page.products.filter((p) => !p.sample)
              const grid = 'mt-2 grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'
              return (<>
                {mine.length > 0 && (<>
                  <p className="mt-3 text-[12px] font-bold uppercase tracking-wider" style={{ color: GREEN }}>Your samples from {brand.name}</p>
                  <div className={grid}>{mine.map(card)}</div>
                </>)}
                {rest.length > 0 && (<>
                  <p className="mt-4 text-[12px] font-bold uppercase tracking-wider" style={soft}>{mine.length ? `More from ${brand.name}` : `${brand.name}'s products on TRYBE`}</p>
                  <div className={grid}>{rest.map(card)}</div>
                </>)}
                {page.samplesRead === 'old' && <p className="mt-2 text-[12px]" style={soft}>Update SCOUT to 1.46.5 and your own sample requests show here first.</p>}
              </>)
            })() : (
              <p className="mt-3 text-[13.5px]" style={soft}>{page ? `TRYBE lists no products to promote for ${brand.name}${isAdmin && page.keys ? ` (TRYBE sent: ${page.keys})` : ''}.` : `MVP could not read ${brand.name}’s page on TRYBE.`} Type the product you have below.</p>
            )}
            <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) setProduct(typed.trim().slice(0, 140)) }} className="mt-3 flex flex-wrap gap-2">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={page?.products.length ? 'Or type another product you have' : 'The product you have'} className="flex-1 min-w-[14rem] rounded-xl border bg-transparent px-3 py-2 text-[13.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
              <button type="submit" disabled={!typed.trim()} className="rounded-xl px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>Use this product</button>
            </form>
            {/* The brief, said in one line, with the way to open it. */}
            <div className="mt-4 rounded-xl px-3.5 py-2.5 text-[13px] flex flex-wrap items-center gap-x-3 gap-y-1" style={{ background: page?.brief ? 'rgba(22,163,74,0.08)' : 'rgba(180,83,9,0.08)' }}>
              <FileText size={14} style={{ color: page?.brief ? GREEN : AMBER }} />
              <span style={{ color: page?.brief ? GREEN : AMBER }} className="font-semibold">
                {page?.brief ? 'MVP read their creative brief: your scripts follow it.' : page?.state === 'link_only' ? `MVP could not read their brief${page.briefWhy ? `: ${page.briefWhy}` : '.'}` : page?.state === 'none' ? 'TRYBE shows no brief for this brand.' : 'MVP could not read their brief.'}
              </span>
              {page?.briefUrl && <a href={page.briefUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: PURPLE }}>Open the brief <ExternalLink size={11} /></a>}
              <a href={brandPageUrl(brand.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: PURPLE }}>{brand.name} on TRYBE <ExternalLink size={11} /></a>
            </div>
          </>)}
        </section>
      )}

      {/* 3. The scripts */}
      {step === 3 && brand && product && (
        <section className={card} style={cardStyle}>
          <button onClick={() => setProduct(null)} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: PURPLE }}><ArrowLeft size={13} /> Another product</button>
          <div className="flex flex-wrap items-start gap-3">
            <h2 className="text-[20px] font-bold flex-1 min-w-[14rem]">Your shooting scripts: {product}</h2>
            {/* ON HAND: the one tick the weekly planner reads (Received on the
                This week samples list), added from here in one press. */}
            <button onClick={() => void markOnHand()} disabled={onHand !== 'idle'} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold disabled:opacity-70"
              style={onHand === 'done' ? { background: 'rgba(22,163,74,0.10)', color: GREEN } : { border: `1px solid ${GREEN}`, color: GREEN }}>
              {onHand === 'saving' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {onHand === 'done' ? 'On hand: in your weekly planner' : 'I have this product'}
            </button>
          </div>
          {onHandErr && <p className="text-[12.5px] mt-1" style={{ color: AMBER }}>{onHandErr}</p>}
          {/* THE AMAZON MATCH, step 3 (Seb, 2026-10-14): this product already
              filmed on Amazon is a TRYBE video too; else the brand's line. */}
          {(() => {
            const m = amz.product(brand.name, product)
            if (!m?.yourVideos) return <AmazonLine amazon={amz.brand(brand.id)} />
            return (
              <div className="mt-2 rounded-xl px-3 py-2" style={{ background: 'rgba(22,163,74,0.08)' }}>
                <ProductAmazon match={m} />
                <p className="text-[12.5px] mt-1" style={soft}>You can submit {m.yourVideos === 1 ? 'that video' : 'those videos'} on TRYBE too, if {m.yourVideos === 1 ? 'it fits' : 'they fit'} {brand.name}&rsquo;s brief. The scripts below are for new videos.</p>
              </div>
            )
          })()}
          <p className="text-[13.5px] mt-0.5 mb-3" style={soft}>Ten videos, each with its hook, the first 2 seconds, the beats and the close. Copy one, or print them all and start shooting.</p>
          <TrybeVideoIdeas key={`${brand.id}|${product}`} brandId={brand.id} name={brand.name} plan={null} canRead={canRead} isAdmin={isAdmin} product={product} page={page} auto emphasize />
        </section>
      )}
    </div>
  )
}
