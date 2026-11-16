'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BRAND SCRIPTS (Seb, 2026-10-13: "pick a brand, then pick the product they
// want to create from that brand, and then let MVP give them the copy to start
// shooting videos"; the brand page 2026-11-15: "A with a C plan card"):
//   1. Pick a brand: the brands you work with on TRYBE, read through SCOUT.
//   2. The brand's page: the product (your sample first), what MVP has from
//      the brand (its brief on TRYBE, documents it sent, its website), and two
//      doors. Quick scripts: ten videos from TrybeVideoIdeas. A batch: any
//      number up to 300, MVP's plan shown before it writes (TrybeBatchScripts).
//      Below, every script you have for the brand.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, ArrowLeft, Search, Check, ExternalLink, AlertTriangle, ImagePlus, X, Upload, Wand2 } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, byBrandName, type MyBrand } from '@/lib/trybe-mybrands'
import { brandPageUrl } from '@/lib/trybe-brand-page'
import TrybeVideoIdeas, { loadBrandPage, type BrandPage } from '@/components/labs/TrybeVideoIdeas'
import TrybeSavedScripts from '@/components/labs/TrybeSavedScripts'
import TrybeBatchScripts, { BatchRun, BrandBatches } from '@/components/labs/TrybeBatchScripts'
import { VIDEO_IDEAS } from '@/lib/trybe-playbook'
import { brandDocs, addBrandPdf } from '@/lib/trybe-brand-pdf-client'
import type { LinksDigest } from '@/lib/trybe-message-links'
import { AmazonLine, ProductAmazon, AmazonFilmedList } from '@/components/labs/TrybeFinderControls'
import { useTrybeAmazon } from '@/components/labs/useTrybeAmazon'
import { shrinkPicture } from '@/lib/buyer-read-client'

const PURPLE = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'

export default function TrybeCreate({ canRead, isAdmin, onFind, start, onStarted }: {
  canRead: boolean; isAdmin: boolean; onFind: () => void
  /** Opened from a brand's page ("Make scripts for it"): start on that brand. */
  start?: { id: string; name: string; product?: string | null } | null
  onStarted?: () => void
}) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState<MyBrand | null>(null)
  const [page, setPage] = useState<BrandPage | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [typed, setTyped] = useState('')
  const [product, setProduct] = useState<string | null>(null)
  // WHERE IT SELLS, BEFORE THE SCRIPTS ARE WRITTEN (Seb, 2026-11-06: "You
  // choose your brand, you choose your product, and then it gives you the
  // scripts"): the product's Amazon or TikTok Shop link, or a screenshot of
  // its reviews, for the script agent to read its buyers. Cleared with the
  // product, so one product's reviews never write another's scripts.
  const [buyerLink, setBuyerLink] = useState('')
  const [buyerShot, setBuyerShot] = useState<string | null>(null)
  const shotRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!product) { setBuyerLink(''); setBuyerShot(null) } }, [product])
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

  // THE BRAND PAGE (Seb, 2026-11-15; for everyone 2026-11-16: "make it
  // available for everyone"): two doors, quick scripts or a batch planned
  // before it is written.
  const [door, setDoor] = useState<'home' | 'quick' | 'batch'>('home')
  const [batchCount, setBatchCount] = useState(50)
  const [batchDue, setBatchDue] = useState('')
  const [openBatch, setOpenBatch] = useState<string | null>(null)
  const [batchKey, setBatchKey] = useState(0)
  const [listKey, setListKey] = useState(0)
  // What the brand sent in messages, read before (Messages, or a PDF added).
  const [docs, setDocs] = useState<{ titles: string[] } | 'failed' | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const docTitles = (d: LinksDigest | null | undefined) => ({ titles: (d?.links || []).filter((l) => l.ok && l.text).map((l) => l.title || l.url) })
  useEffect(() => {
    if (!brand) return
    let live = true
    setDocs(null); setPdfErr(null)
    void brandDocs(brand.id).then((r) => { if (live) setDocs(r.error ? 'failed' : docTitles(r.digest)) }).catch(() => { if (live) setDocs('failed') })
    return () => { live = false }
  }, [brand])
  // The product in your hands first: your sample, else what TRYBE asks for.
  useEffect(() => { if (page && !product && page.products.length) setProduct(page.products[0].name) }, [page, product])
  async function addPdf(f: File) {
    if (!brand) return
    setPdfErr(null)
    const r = await addBrandPdf(brand.id, brand.name, f, (st) => setPdfBusy(st === 'uploading' ? 'Uploading the PDF' : 'Reading every page'))
    setPdfBusy(null)
    if (r.error) { setPdfErr(r.error); return }
    setDocs(docTitles(r.digest))
  }

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

  // ONLY THE BRAND STILL PICKED GETS ITS PAGE. A brief read can take ten
  // seconds or more; picking A, going back and picking B used to let A's page
  // land under B, and B's scripts were then written from A's brief.
  const picking = useRef<string | null>(null)
  async function pickBrand(b: MyBrand) {
    picking.current = b.id
    setBrand(b); setProduct(null); setTyped(''); setPage(null); setPageLoading(true); setDoor('home')
    try {
      const p = await loadBrandPage(b.id)
      if (picking.current === b.id) setPage(p)
    } finally { if (picking.current === b.id) setPageLoading(false) }
  }
  const leaveBrand = () => { picking.current = null; setBrand(null); setProduct(null); setPage(null); setPageLoading(false); setDoor('home') }

  // FROM A BRAND'S PAGE: that brand is picked as soon as your brands load.
  // Scripts are made for brands you work with on TRYBE, so one that is not
  // among them is said by name, never silently dropped back to the list.
  const [startMiss, setStartMiss] = useState<string | null>(null)
  // What it sells, when the page that opened this knows (Match my TikTok): the
  // way to scripts from the product in Video Scripts while the brand is not yours yet.
  const [missProduct, setMissProduct] = useState<string | null>(null)
  useEffect(() => {
    if (!start || !brands) return
    const b = brands.find((x) => x.id === start.id)
    if (b) { setStartMiss(null); void pickBrand(b) } else { setStartMiss(start.name); setMissProduct(start.product || start.name) }
    onStarted?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, brands])

  // A to Z (Seb, 2026-10-22), whatever order TRYBE sends them in.
  const shown = useMemo(() => (brands || []).filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())).sort(byBrandName), [brands, q])
  const soft = { color: 'var(--text-soft)' }
  const card = 'rounded-2xl border p-5'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }


  // WHICH BRAND: the brands you work with on TRYBE (both looks).
  const brandGrid = () => (
        <section className={card} style={cardStyle}>
          {startMiss && <p className="text-[13px] mb-3 inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {startMiss} is not one of the brands you work with on TRYBE yet, so MVP cannot open its brief for scripts. Message it first, or pick one of yours below.{missProduct && <> To start filming now, <a href={`/video-scripts?product=${encodeURIComponent(missProduct)}`} className="font-semibold underline">write scripts from its product in Video Scripts</a>.</>}</p>}
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
                      : <span className="w-16 h-16 rounded-xl inline-flex items-center justify-center text-[22px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: PURPLE }}>{b.name.slice(0, 1).toUpperCase()}</span>}
                    <span className="text-[14px] font-semibold leading-tight">{b.name}</span>
                    {b.earnings != null && b.earnings > 0 && <span className="text-[12px]" style={{ color: GREEN }}>${b.earnings.toLocaleString()} earned</span>}
                    <AmazonLine amazon={amz.brand(b.id)} links={false} className="justify-center" />
                  </button>
                ))}
              </div>
            )}
        </section>
  )

  // YOUR SHOOTING SCRIPTS for the product picked: the quick door (both looks).
  const quickSection = () => brand && product ? (
        <section className={card} style={cardStyle}>
          <button onClick={() => setDoor('home')} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: PURPLE }}><ArrowLeft size={13} /> Back to {brand.name}</button>
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
                <AmazonFilmedList products={m.products} title="This product on Amazon" className="mt-1.5" />
                <p className="text-[12.5px] mt-1" style={soft}>You can submit {m.yourVideos === 1 ? 'that video' : 'those videos'} on TRYBE too, if {m.yourVideos === 1 ? 'it fits' : 'they fit'} {brand.name}&rsquo;s brief. The scripts below are for new videos.</p>
              </div>
            )
          })()}
          <p className="text-[13.5px] mt-0.5 mb-3" style={soft}>Ten videos written from the brief, what its buyers say and TRYBE&rsquo;s top videos, scene by scene. Copy one, or print them all and start shooting.</p>
          {(() => {
            // The product's Amazon listing when you filmed it on Amazon: its
            // buyers' reviews are read from there unless you gave a link.
            const asin = amz.product(brand.name, product)?.products?.[0]?.asin
            const link = buyerLink.trim() || (asin ? `https://www.amazon.com/dp/${asin}` : '')
            return <TrybeVideoIdeas key={`${brand.id}|${product}`} brandId={brand.id} name={brand.name} plan={null} canRead={canRead} isAdmin={isAdmin} product={product} page={page} auto emphasize buyerLink={link} buyerShot={buyerShot} />
          })()}
        </section>
  ) : null

  // ── THE NEW BRAND SCRIPTS (Seb, 2026-11-15: "I like A with a C plan card") ──
  // Pick the brand, then one page: the product, what MVP has from the brand,
  // and two doors, quick scripts or a batch of any size with MVP's plan shown
  // before it writes. Below, every script you have for the brand. Labs first.
  const have = (ok: boolean | null, text: string) => (
    <span className="inline-flex items-center gap-1.5" style={{ color: ok === true ? GREEN : ok === false ? AMBER : 'var(--text-soft)' }}>
      {ok === true ? <Check size={13} /> : ok === false ? <AlertTriangle size={13} /> : null} {text}
    </span>
  )
  const paceLine = (() => {
    if (!batchDue) return 'Optional, for the pace you need'
    const days = Math.ceil((Date.parse(`${batchDue}T23:59:59Z`) - Date.now()) / 86_400_000)
    if (days <= 0) return 'That date has passed'
    const on = new Date(`${batchDue}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    return `${batchCount} by ${on} is about ${Math.ceil(batchCount / days)} a day`
  })()
  const startBatch = (id: string | null) => { setOpenBatch(id); setBatchKey((k) => k + 1); setDoor('batch') }
  const brandHome = () => brand ? (<>
    <section className={card} style={cardStyle}>
      <div className="flex flex-wrap items-center gap-3">
        {brand.logo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={brand.logo} alt="" className="w-12 h-12 rounded-xl object-contain border bg-white" style={{ borderColor: 'var(--border)' }} />
          : <span className="w-12 h-12 rounded-xl inline-flex items-center justify-center text-[20px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: PURPLE }}>{brand.name.slice(0, 1).toUpperCase()}</span>}
        <div className="flex-1 min-w-[12rem]">
          <h2 className="text-[20px] font-bold leading-tight">{brand.name}</h2>
          <AmazonLine amazon={amz.brand(brand.id)} />
        </div>
        <a href={brandPageUrl(brand.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: PURPLE }}>{brand.name} on TRYBE <ExternalLink size={11} /></a>
        <button onClick={leaveBrand} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)' }}><ArrowLeft size={13} /> Another brand</button>
      </div>
      {pageLoading ? (
        <p className="mt-4 text-[13.5px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={14} className="animate-spin" /> Reading {brand.name}&rsquo;s page on TRYBE: its products and its creative brief...</p>
      ) : (<>
        <p className="mt-4 text-[13.5px] font-semibold">Which product are the scripts for?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(page?.products || []).map((p) => {
            const on = product === p.name
            return (
              <button key={p.id || p.name} onClick={() => setProduct(p.name)} aria-pressed={on} className="rounded-xl px-3 py-2 text-left flex items-center gap-2.5"
                style={{ border: `2px solid ${on ? PURPLE : 'var(--border)'}`, background: on ? 'rgb(var(--brand-rgb) / 0.06)' : 'var(--surface)' }}>
                {p.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-contain border bg-white shrink-0" style={{ borderColor: 'var(--border)' }} />
                  : null}
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-snug">{p.name}</span>
                  {p.sample ? <span className="block text-[11.5px] font-semibold" style={{ color: GREEN }}>Your sample: {p.sample.status.replace(/_/g, ' ')}</span>
                    : p.promoted ? <span className="block text-[11.5px] font-semibold" style={{ color: PURPLE }}>TRYBE asks for this</span> : null}
                  <ProductAmazon match={amz.product(brand.name, p.name)} links={false} />
                </span>
              </button>
            )
          })}
          {product && !(page?.products || []).some((p) => p.name === product) && <span className="rounded-xl px-3 py-2 text-[13.5px] font-semibold" style={{ border: `2px solid ${PURPLE}` }}>{product}</span>}
        </div>
        {!page?.products.length && <p className="mt-1 text-[13px]" style={soft}>{page ? `TRYBE lists no products for ${brand.name}.` : `MVP could not read ${brand.name}'s page on TRYBE.`} Type the product you have.</p>}
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { setProduct(typed.trim().slice(0, 140)); setTyped('') } }} className="mt-2 flex flex-wrap gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={page?.products.length ? 'Or type another product you have' : 'The product you have, as the brand spells it'} className="flex-1 min-w-[14rem] rounded-xl border bg-transparent px-3 py-2 text-[13.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          <button type="submit" disabled={!typed.trim()} className="rounded-xl px-4 py-2 text-[13.5px] font-semibold disabled:opacity-50" style={{ border: '1px solid var(--border)' }}>Use this product</button>
        </form>
        {/* WHAT MVP HAS FROM THE BRAND: each source said as there or not. */}
        <div className="mt-4 pt-3 border-t flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]" style={{ borderColor: 'var(--border)' }}>
          <span className="font-semibold">What MVP has from {brand.name}:</span>
          {have(page?.state === 'text' ? true : page?.state === 'none' ? null : false, page?.state === 'text' ? 'Their brief on TRYBE' : page?.state === 'link_only' ? `Their brief is a link MVP could not open${page.briefWhy ? ` (${page.briefWhy})` : ''}` : page?.state === 'none' ? 'No brief on TRYBE' : 'MVP could not read their TRYBE page')}
          {docs === null ? have(null, 'Checking what they sent you...')
            : docs === 'failed' ? have(false, 'Could not check what they sent you')
            : have(docs.titles.length ? true : null, docs.titles.length ? `${docs.titles.length === 1 ? 'A document' : `${docs.titles.length} documents`} they sent you (${docs.titles.slice(0, 3).join(', ')}${docs.titles.length > 3 ? ', ...' : ''})` : 'No documents from your messages yet')}
          {page?.website && have(true, 'Their website')}
          {page?.briefUrl && <a href={page.briefUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: PURPLE }}>Open the brief <ExternalLink size={11} /></a>}
          <button type="button" onClick={() => pdfRef.current?.click()} disabled={!!pdfBusy} className="inline-flex items-center gap-1 font-semibold disabled:opacity-60" style={{ color: PURPLE }}>
            {pdfBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {pdfBusy || 'Add a PDF they sent'}
          </button>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPdf(f) }} />
        </div>
        {pdfErr && <p className="mt-1 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {pdfErr}</p>}
        <details className="mt-3 rounded-xl border px-3.5 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <summary className="text-[13px] font-semibold cursor-pointer">Where it sells <span className="font-normal" style={soft}>(optional, so quick scripts start from what its buyers say)</span></summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <input value={buyerLink} onChange={(e) => setBuyerLink(e.target.value)} placeholder="Its Amazon or TikTok Shop link" className="flex-1 min-w-[14rem] rounded-xl border bg-transparent px-3 py-2 text-[13.5px]" style={{ borderColor: 'var(--border)' }} />
            <button type="button" onClick={() => shotRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)' }}>
              <ImagePlus size={14} /> {buyerShot ? 'Screenshot added' : 'Screenshot of its reviews'}
            </button>
            {buyerShot && <button type="button" onClick={() => setBuyerShot(null)} className="inline-flex items-center gap-1 text-[12.5px]" style={soft}><X size={13} /> Remove</button>}
            <input ref={shotRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void shrinkPicture(f).then(setBuyerShot, () => setBuyerShot(null)) }} />
          </div>
          <p className="mt-1 text-[12px]" style={soft}>Amazon reviews are read by SCOUT in this Chrome; TikTok Shop reviews by MVP. When you filmed this product on Amazon, MVP uses that listing by itself.</p>
        </details>
      </>)}
    </section>

    {!pageLoading && (
      <div className="grid gap-4 md:grid-cols-2">
        <section className={`${card} flex flex-col`} style={cardStyle}>
          <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Film today</p>
          <h3 className="text-[19px] font-bold mt-1">{VIDEO_IDEAS} quick scripts</h3>
          <p className="text-[13.5px] mt-1.5 flex-1" style={soft}>{VIDEO_IDEAS} different videos for {product || 'the product you pick'}, from the brief, what its buyers say and TRYBE&rsquo;s top videos. Each set is kept below until you clear it.</p>
          <button disabled={!product} onClick={() => setDoor('quick')} className="mt-4 self-start inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}><Wand2 size={15} /> Write quick scripts</button>
        </section>
        <section className="rounded-2xl p-5 flex flex-col" style={{ border: `2px solid ${PURPLE}`, background: 'var(--surface)' }}>
          <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: PURPLE }}>A challenge or a big brief</p>
          <h3 className="text-[19px] font-bold mt-1">A batch, as many as the brand asks for</h3>
          <p className="text-[13.5px] mt-1.5" style={soft}>MVP reads everything {brand.name} gave you and shows you its plan first: places, who is on camera, angles and the rules. Then it writes ten at a time and checks every script against the brief.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="How many scripts">
            {[10, 25, 50, 100, 300].map((n) => (
              <button key={n} onClick={() => setBatchCount(n)} aria-pressed={batchCount === n} className="min-w-[3.25rem] rounded-xl px-3 py-2 text-[14px] font-bold"
                style={batchCount === n ? { background: PURPLE, color: '#fff', border: `1px solid ${PURPLE}` } : { border: '1px solid var(--border)' }}>{n}</button>
            ))}
            <input type="number" min={1} max={300} value={[10, 25, 50, 100, 300].includes(batchCount) ? '' : batchCount} placeholder="Other" onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n > 0) setBatchCount(Math.min(300, n)) }} aria-label="Or any number up to 300" className="w-24 rounded-xl border bg-transparent px-2.5 py-2 text-[14px]" style={{ borderColor: 'var(--border)' }} />
          </div>
          <label className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">Due
            <input type="date" value={batchDue} onChange={(e) => setBatchDue(e.target.value)} className="rounded-xl border bg-transparent px-2.5 py-1.5 text-[13.5px]" style={{ borderColor: 'var(--border)' }} />
            <span style={soft}>{paceLine}</span>
          </label>
          <button disabled={!product} onClick={() => startBatch(null)} className="mt-4 self-start inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>Plan {batchCount} scripts</button>
        </section>
      </div>
    )}

    <section className={card} style={cardStyle}>
      <h2 className="text-[17px] font-bold">Your {brand.name} scripts</h2>
      <p className="text-[13px] mt-0.5" style={soft}>Every script you have for {brand.name}: your batches here, your quick sets below.</p>
      <p className="mt-3 mb-2 text-[12px] font-bold uppercase tracking-wider" style={soft}>Batches</p>
      <BrandBatches brandId={brand.id} brandName={brand.name} refreshKey={listKey} onOpen={(id) => startBatch(id)} />
    </section>
    <TrybeSavedScripts brandId={brand.id} brandName={brand.name} refreshKey={listKey} />
  </>) : null

  // Saved scripts need no SCOUT: they are kept on MVP.
  if (!canRead) {
    return (
      <div className="space-y-4">
        <div className={card} style={cardStyle}><p className="text-[15px] font-semibold">Make videos needs SCOUT on TRYBE</p><p className="text-[13.5px] mt-1" style={soft}>Install SCOUT, allow it on TRYBE and sign in to TRYBE in this Chrome. MVP then shows the brands you work with and the products they want videos of.</p></div>
        <TrybeSavedScripts />
        {/* Batch scripts need no SCOUT either: the brief is pasted or uploaded. */}
        <TrybeBatchScripts />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* A failed Amazon match is said, so it never reads as "not on Amazon". */}
      {amz.error && <p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {amz.error.replace(/\.$/, '')}. The Amazon lines below may be missing.</p>}
      {!brand && brandGrid()}
      {brand && door === 'home' && brandHome()}
      {brand && door === 'quick' && quickSection()}
      {brand && door === 'batch' && (product || openBatch) && (
        <section className={card} style={cardStyle}>
          <BatchRun key={batchKey} brand={{ id: brand.id, name: brand.name }} product={product || ''} page={page} count={batchCount} deadline={batchDue || null} openId={openBatch}
            onBack={() => { setDoor('home'); setListKey((k) => k + 1) }} />
        </section>
      )}
    </div>
  )
}
