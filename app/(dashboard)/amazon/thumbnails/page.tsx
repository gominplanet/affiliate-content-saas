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

interface FaceModel { id: string; name: string }

export default function AmazonThumbnailsPage() {
  const [product, setProduct] = useState('')
  const [headline, setHeadline] = useState('')
  const [mode, setMode] = useState<'face' | 'product'>('face')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [faceId, setFaceId] = useState<string>('')
  const [loadingFaces, setLoadingFaces] = useState(true)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; diag: string; hook: string } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/face-models')
        const data = await res.json().catch(() => ({}))
        const ready = (data.models || [])
          .filter((m: { status?: string }) => m.status === 'ready')
          .map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))
        setFaces(ready)
        if (ready.length > 0) setFaceId(ready[0].id)
        else setMode('product')
      } catch { /* leave empty */ }
      finally { setLoadingFaces(false) }
    })()
  }, [])

  const generate = useCallback(async () => {
    const raw = product.trim()
    if (!raw) { setError('Paste an Amazon product link or ASIN first.'); return }
    if (mode === 'face' && !faceId) { setError('Pick a face, or switch to Product only.'); return }

    setBusy(true); setError(null); setResult(null); setStatus('Designing your thumbnail…')

    const isUrl = /^https?:\/\//i.test(raw)
    const isAsin = /^[A-Z0-9]{10}$/i.test(raw)
    const body: Record<string, unknown> = {
      videoTitle: headline.trim() || 'New Amazon find',
      textMode: 'graphic',
      ...(isUrl ? { productUrl: raw } : isAsin ? { asin: raw.toUpperCase() } : { productUrl: raw }),
      ...(mode === 'product' ? { noHuman: true } : { faceModelId: faceId }),
      ...(headline.trim() ? { customHeadline: headline.trim() } : {}),
    }

    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(240000),
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data.message as string) || (data.error as string) || 'Generation failed. Try again.')
      }
      const url = (Array.isArray(data.thumbnailUrls) && data.thumbnailUrls[0]) || data.thumbnailUrl
      if (!url) throw new Error('No thumbnail came back. Try again.')
      const engine = (data.modelUsed as string) || 'unknown'
      const isGpt = engine === 'gpt-image-graphic' || engine === 'gpt-image-graphic-product'
      const diag = [
        `engine: ${isGpt ? 'gpt-image ✓' : engine}`,
        isGpt && data.gfxQuality ? `quality: ${data.gfxQuality}` : '',
        isGpt ? (data.artDirected ? 'art-director: ON' : 'art-director: OFF') : '',
        data.gfxFallbackReason ? `fell back → ${data.gfxFallbackReason}` : '',
      ].filter(Boolean).join(' · ')
      setResult({ url, diag, hook: (data.overlayHook as string) || '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed. Try again.')
    } finally {
      setBusy(false); setStatus('')
    }
  }, [product, headline, mode, faceId])

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
              <select
                value={faceId}
                onChange={e => setFaceId(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              >
                {faces.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
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
          {result.diag && <p className="text-[10px] mt-2 font-mono" style={{ color: 'var(--text-soft)' }}>🔧 {result.diag}</p>}
        </div>
      )}
    </div>
  )
}
