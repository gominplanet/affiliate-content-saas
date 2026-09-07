// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Influencer → Thumbnail Generator. Paste an Amazon product link (or an
// ASIN), pick who's in it (a trained face, or product-only), and MVP Art
// Director designs a full 1280×720 thumbnail. No YouTube video required — the
// product link IS the source. Calls POST /api/youtube/generate-thumbnail.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, Download, Loader2, User, Package, AlertCircle, Wand2 } from 'lucide-react'
import PageExplainer from '@/components/amazon/PageExplainer'
import { HeadlineStyleToggle, useHeadlineStyle, headlineStyleValue } from '@/components/thumbnails/HeadlineStyleToggle'
import WearProductToggle, { useWearProduct } from '@/components/thumbnails/WearProductToggle'
import ExpressionPicker, { useExpression } from '@/components/thumbnails/ExpressionPicker'

interface FaceModel { id: string; name: string; outfit_pref?: string | null }

export default function AmazonThumbnailsPage() {
  const [product, setProduct] = useState('')
  const [headline, setHeadline] = useState('')
  const [mode, setMode] = useState<'face' | 'product'>('face')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [faceId, setFaceId] = useState<string>('')
  const [outfit, setOutfit] = useState('')
  const [loadingFaces, setLoadingFaces] = useState(true)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** The render, plus WHAT WENT IN to make it. A wrong-coloured garment is
   *  either the wrong source photo or a bad prompt, and you cannot tell which
   *  from the output alone. */
  const [result, setResult] = useState<{
    url: string; hook: string
    sourceTitle?: string | null; sourceImage?: string | null
    expressionUsed?: string; wearApplied?: boolean; expressionViaPortrait?: boolean
    garmentMatch?: boolean | null; garmentNote?: string | null; garmentRetried?: boolean
  } | null>(null)
  const [question, setQuestion] = useHeadlineStyle()
  const [wear, setWear] = useWearProduct()
  const [expression, setExpression] = useExpression()

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/face-models')
        const data = await res.json().catch(() => ({}))
        const ready = (data.models || [])
          .filter((m: { status?: string }) => m.status === 'ready')
          .map((m: { id: string; name: string; outfit_pref?: string | null }) => ({ id: m.id, name: m.name, outfit_pref: m.outfit_pref ?? null }))
        setFaces(ready)
        if (ready.length > 0) { setFaceId(ready[0].id); setOutfit(ready[0].outfit_pref || '') }
        else setMode('product')
      } catch { /* leave empty */ }
      finally { setLoadingFaces(false) }
    })()
  }, [])

  // Prefill the product from ?asin= — lets Brainstorm's "Make the thumbnail"
  // land here ready to generate for that exact product.
  useEffect(() => {
    try {
      const asin = new URLSearchParams(window.location.search).get('asin')
      if (asin && /^[A-Z0-9]{10}$/i.test(asin)) setProduct(asin.toUpperCase())
    } catch { /* no query param */ }
  }, [])

  // The outfit field is the face's saved wardrobe. Persist any edit to the face
  // before generating, so the render (which reads the saved value) uses it and the
  // choice sticks for next time. Best-effort — never blocks generation.
  const saveOutfitIfDirty = useCallback(async () => {
    if (mode !== 'face' || !faceId) return
    const face = faces.find(f => f.id === faceId)
    const next = outfit.trim()
    if (!face || next === (face.outfit_pref || '')) return
    try {
      await fetch(`/api/face-models/${faceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outfitPref: next }),
      })
      setFaces(prev => prev.map(f => f.id === faceId ? { ...f, outfit_pref: next || null } : f))
    } catch { /* best-effort */ }
  }, [mode, faceId, faces, outfit])

  const generate = useCallback(async () => {
    const raw = product.trim()
    if (!raw) { setError('Paste an Amazon product link or ASIN first.'); return }
    if (mode === 'face' && !faceId) { setError('Pick a face, or switch to Product only.'); return }

    setBusy(true); setError(null); setResult(null); setStatus('Designing your thumbnail…')
    await saveOutfitIfDirty()

    const isUrl = /^https?:\/\//i.test(raw)
    const isAsin = /^[A-Z0-9]{10}$/i.test(raw)
    const body: Record<string, unknown> = {
      videoTitle: headline.trim() || 'Product spotlight',
      textMode: 'graphic',
      ...(isUrl ? { productUrl: raw } : isAsin ? { asin: raw.toUpperCase() } : { productUrl: raw }),
      ...(mode === 'product' ? { noHuman: true } : { faceModelId: faceId }),
      ...(headline.trim() ? { customHeadline: headline.trim() } : {}),
      headlineStyle: headlineStyleValue(question),
      // Apparel goes ON the person. Meaningless without a face, and the server
      // ignores it for a product nobody wears.
      wearProduct: wear && mode === 'face',
      ...(mode === 'face' ? { expression } : {}),
    }

    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(290000),
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Surface the ACTUAL engine reason so a persistent failure is diagnosable
        // rather than a generic "snag".
        const why = typeof data.gfxFallbackReason === 'string' ? data.gfxFallbackReason.slice(0, 220) : ''
        const base = (data.message as string) || (data.error as string) || 'Generation failed. Try again.'
        throw new Error(why && !base.includes(why) ? `${base} (${why})` : base)
      }
      const url = (Array.isArray(data.thumbnailUrls) && data.thumbnailUrls[0]) || data.thumbnailUrl
      if (!url) throw new Error('No thumbnail came back. Try again.')
      setResult({
        url, hook: (data.overlayHook as string) || '',
        sourceTitle: (data.sourceProductTitle as string | null) ?? null,
        sourceImage: (data.sourceProductImageUrl as string | null) ?? null,
        expressionUsed: (data.expressionUsed as string) || 'auto',
        expressionViaPortrait: !!data.expressionViaPortrait,
        garmentMatch: (data.garmentMatch as boolean | null) ?? null,
        garmentNote: (data.garmentNote as string | null) ?? null,
        garmentRetried: !!data.garmentRetried,
        wearApplied: !!data.wearApplied,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed. Try again.')
    } finally {
      setBusy(false); setStatus('')
    }
  }, [product, headline, mode, faceId, question, wear, expression, saveOutfitIfDirty])

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-[#d97706]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
            Amazon Influencer · Thumbnail Generator
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
          MVP Art Director
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          Paste an Amazon product link or ASIN. The Art Director resolves the real product and designs a scroll-stopping 1280×720 thumbnail, with you in it or product-only.
        </p>
      </header>

      <PageExplainer
        heading="Turn any product into a click-worthy thumbnail"
        intro="A thumbnail is the cover image that makes shoppers stop and click, on your storefront video reviews, your idea lists, and every social post. MVP designs a professional one from just the product link. No video, no Canva, no design skills."
        steps={[
          { title: 'Paste a product', body: 'Copy any Amazon product link (or its 10-character ASIN) and paste it in. That is your source, no video needed.' },
          { title: 'Choose who’s in it', body: 'Star your own face in the design, or pick “Product only.” Add your face once under Face Models and it is reused every time.' },
          { title: 'Add a headline (optional)', body: 'Type a punchy line like “WORTH IT?!”, or leave it blank and the Art Director writes one that fits the product.' },
          { title: 'Generate & use it', body: 'MVP designs the full 1280×720 thumbnail in seconds. Download it, or send it to Social Influencer to post everywhere.' },
        ]}
        footnote={<>Want your face in designs? Set it up once under <Link href="/photobooth" className="font-semibold" style={{ color: '#d97706' }}>Face Models</Link>. Ready to post? Head to <Link href="/amazon/social" className="font-semibold" style={{ color: '#d97706' }}>Social Influencer</Link>.</>}
      />

      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 flex flex-col gap-5">
        {/* Product input */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Amazon product link or ASIN</span>
          <input
            value={product}
            onChange={e => setProduct(e.target.value)}
            placeholder="https://www.amazon.com/dp/B0…  or  B0D5H9M72G  or a geni.us link"
            className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]"
          />
        </label>

        {/* Mode toggle */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Who&apos;s in the thumbnail?</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode('face')}
              disabled={faces.length === 0}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition disabled:opacity-40 ${mode === 'face' ? 'border-[#d97706] bg-[#d97706]/10 text-[#d97706]' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}
            >
              <User size={15} /> With my face
            </button>
            <button
              onClick={() => setMode('product')}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition ${mode === 'product' ? 'border-[#d97706] bg-[#d97706]/10 text-[#d97706]' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}
            >
              <Package size={15} /> Product only
            </button>
          </div>

          {mode === 'face' && (
            loadingFaces ? (
              <p className="text-xs" style={{ color: 'var(--text-soft)' }}>Loading your faces…</p>
            ) : faces.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
                No face yet. <Link href="/photobooth" className="text-[#d97706] font-semibold hover:underline">Upload your selfies</Link> to put yourself in the thumbnail, or use Product only.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                <select
                  value={faceId}
                  onChange={e => {
                    const id = e.target.value
                    setFaceId(id)
                    // Load the picked face's saved wardrobe into the field.
                    setOutfit(faces.find(f => f.id === id)?.outfit_pref || '')
                  }}
                  className="px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                >
                  {faces.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>

                {/* Wardrobe — pins the outfit so you always appear the same way.
                    Saved to this face and reused everywhere. */}
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Outfit <span className="font-normal" style={{ color: 'var(--text-soft)' }}>— optional, keeps you in the same clothing</span></span>
                  <input
                    value={outfit}
                    onChange={e => setOutfit(e.target.value)}
                    onBlur={() => { void saveOutfitIfDirty() }}
                    placeholder="e.g. a white lab coat"
                    maxLength={120}
                    className="px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-[#d97706]"
                  />
                  <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>
                    Leave blank to let the Art Director vary it. Saved to this face for next time.
                  </span>
                </label>
              </div>
            )
          )}
        </div>

        {/* Optional headline */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Headline <span className="font-normal" style={{ color: 'var(--text-soft)' }}>— optional, leave blank and the Art Director writes it</span></span>
          <input
            value={headline}
            onChange={e => setHeadline(e.target.value)}
            placeholder="e.g. NO MORE GYM FEES"
            className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]"
          />
        </label>

        {/* Headline style — Polished (default) vs Question hook (curiosity
            question + matching face). Only meaningful when the Art Director
            writes the headline (no custom headline typed above). */}
        {!headline.trim() && (
          <HeadlineStyleToggle question={question} onChange={setQuestion} disabled={busy} />
        )}

        {/* Apparel goes ON the person. Independent of the headline style, which
            is why it sits outside that block. */}
        {mode === 'face' && (
          <>
            <WearProductToggle wear={wear} onChange={setWear} disabled={busy} />
            <ExpressionPicker value={expression} onChange={setExpression} disabled={busy} />
          </>
        )}

        <button
          onClick={generate}
          disabled={busy}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#d97706] hover:bg-[#c2410c] text-white font-semibold text-sm transition disabled:opacity-60"
        >
          {busy ? <><Loader2 size={16} className="animate-spin" /> {status || 'Working…'}</> : <><Wand2 size={16} /> Generate thumbnail</>}
        </button>

        {error && (
          <div className="flex items-start gap-2 text-[13px] text-[#b91c1c] dark:text-[#f87171]">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /> <span>{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.url} alt="Generated thumbnail" className="w-full rounded-xl border border-gray-200 dark:border-white/10" />
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <a
              href={result.url}
              download="thumbnail.jpg"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#d97706] hover:bg-[#c2410c] text-white font-semibold text-sm transition"
            >
              <Download size={15} /> Download
            </a>
            {result.hook && <span className="text-xs px-2 py-1 rounded-full bg-[#d97706]/10 text-[#d97706] font-medium">{result.hook}</span>}
          </div>

          {/* WHAT WENT IN. If the garment in the render is not the garment on
              this card, MVP was handed the wrong product photo and no amount of
              prompt wording will fix it — check the ASIN, not the design.
              Amazon lists each colour of a shirt as its own ASIN, so a variant
              is the single easiest thing to get wrong. */}
          {(result.sourceImage || result.sourceTitle) && (
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-white/10">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#86868b] mb-2">What MVP used</p>
              <div className="flex items-start gap-3">
                {result.sourceImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.sourceImage} alt="Product reference MVP used"
                    className="w-16 h-16 object-contain rounded-lg border border-gray-200 dark:border-white/10 bg-white flex-shrink-0" />
                )}
                <div className="min-w-0">
                  {result.sourceTitle && (
                    <p className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug">{result.sourceTitle}</p>
                  )}
                  <p className="text-[11px] text-[#86868b] mt-1">
                    Expression: {result.expressionUsed === 'auto' ? 'Auto' : result.expressionUsed}
                    {result.expressionViaPortrait ? ' (posed reference)' : result.expressionUsed !== 'auto' ? ' (prompt only)' : ''}
                    {result.wearApplied ? ' · worn on you' : ''}
                  </p>
                  {/* The garment judge's verdict, when one ran. A creator should
                      not have to compare a render against a product page pixel by
                      pixel to find out MVP already knew. */}
                  {result.garmentMatch === false ? (
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: '#b45309' }}>
                      The garment still does not match the product{result.garmentRetried ? ', after a second attempt' : ''}
                      {result.garmentNote ? `: ${result.garmentNote}` : '.'} Generate again, or use it if it is close enough.
                    </p>
                  ) : result.garmentMatch === true ? (
                    <p className="text-[11px] text-[#1f7a4d] mt-0.5">
                      Garment checked against the product photo{result.garmentRetried ? ' (took a second attempt)' : ''}.
                    </p>
                  ) : null}
                  <p className="text-[11px] text-[#86868b] mt-0.5">
                    If this is not the product you meant, the ASIN is the wrong colour or variant.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
