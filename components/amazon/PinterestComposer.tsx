// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pinterest composer for the Amazon Influencer → Social Influencer page.
// Flow: product link → MVP Art Director thumbnail → AI Pin copy → geni.us
// affiliate link → publish to the creator's Pinterest board.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, User, Package, Wand2, Send, AlertCircle, ExternalLink, Check } from 'lucide-react'

const PIN_RED = '#E60023'
interface FaceModel { id: string; name: string }
interface Board { id: string; name: string }

export default function PinterestComposer() {
  // Product + thumbnail
  const [product, setProduct] = useState('')
  const [mode, setMode] = useState<'face' | 'product'>('face')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [faceId, setFaceId] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // Pinterest
  const [connected, setConnected] = useState<boolean | null>(null)
  const [boards, setBoards] = useState<Board[]>([])
  const [boardId, setBoardId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pubBusy, setPubBusy] = useState(false)
  const [pubError, setPubError] = useState<string | null>(null)
  const [result, setResult] = useState<{ pinUrl: string; note: string | null } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/face-models').then(r => r.json()).catch(() => ({}))
        const ready = (d.models || []).filter((m: { status?: string }) => m.status === 'ready').map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))
        setFaces(ready)
        if (ready.length > 0) setFaceId(ready[0].id); else setMode('product')
      } catch { /* ignore */ }
      try {
        const s = await fetch('/api/amazon/pinterest-status').then(r => r.json())
        setConnected(!!s.connected)
        setBoards(s.boards || [])
        setBoardId(s.defaultBoardId || (s.boards?.[0]?.id ?? ''))
      } catch { setConnected(false) }
    })()
  }, [])

  const generate = useCallback(async () => {
    const raw = product.trim()
    if (!raw) { setGenError('Paste an Amazon product link or ASIN first.'); return }
    if (mode === 'face' && !faceId) { setGenError('Pick a face, or switch to Product only.'); return }
    setGenBusy(true); setGenError(null); setThumbUrl(null); setResult(null)
    const isUrl = /^https?:\/\//i.test(raw)
    const isAsin = /^[A-Z0-9]{10}$/i.test(raw)
    const bodyReq: Record<string, unknown> = {
      videoTitle: 'This hidden gem',
      textMode: 'graphic',
      format: 'pin', // 2:3 vertical 1000×1500, text-heavy shopping pin
      ...(isUrl ? { productUrl: raw } : isAsin ? { asin: raw.toUpperCase() } : { productUrl: raw }),
      ...(mode === 'product' ? { noHuman: true } : { faceModelId: faceId }),
    }
    try {
      const res = await fetch('/api/youtube/generate-thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(290000), body: JSON.stringify(bodyReq),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || 'Thumbnail failed. Try again.')
      const url = (Array.isArray(data.thumbnailUrls) && data.thumbnailUrls[0]) || data.thumbnailUrl
      if (!url) throw new Error('No thumbnail came back. Try again.')
      setThumbUrl(url)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Thumbnail failed. Try again.')
    } finally { setGenBusy(false) }
  }, [product, mode, faceId])

  const publish = useCallback(async () => {
    if (!thumbUrl) return
    setPubBusy(true); setPubError(null); setResult(null)
    const raw = product.trim()
    const isUrl = /^https?:\/\//i.test(raw)
    try {
      const res = await fetch('/api/amazon/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          imageUrl: thumbUrl,
          ...(isUrl ? { productUrl: raw } : { asin: raw.toUpperCase() }),
          boardId: boardId || undefined,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data.error as string) || 'Pin failed. Try again.')
      // Echo the server-written copy back into the boxes.
      if (data.title && !title) setTitle(data.title)
      if (data.description && !description) setDescription(data.description)
      setResult({ pinUrl: data.pinUrl as string, note: (data.geniuslinkNote as string) || null })
    } catch (err) {
      setPubError(err instanceof Error ? err.message : 'Pin failed. Try again.')
    } finally { setPubBusy(false) }
  }, [thumbUrl, product, boardId, title, description])

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${PIN_RED}1a` }}>
          <Send size={16} style={{ color: PIN_RED }} />
        </span>
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Create a Pin</h2>
          <p className="text-[11px]" style={{ color: 'var(--text-soft)' }}>Thumbnail → AI copy → affiliate link → your Pinterest board</p>
        </div>
      </div>

      {connected === false && (
        <div className="flex items-start gap-2 text-[13px] rounded-lg border border-[#E60023]/30 bg-[#E60023]/5 p-3" style={{ color: 'var(--text-soft)' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" style={{ color: PIN_RED }} />
          <span>Pinterest isn&apos;t connected yet. <Link href="/connect-socials" className="font-semibold hover:underline" style={{ color: PIN_RED }}>Connect it</Link> to publish Pins.</span>
        </div>
      )}

      {/* Step 1 — product + thumbnail */}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Amazon product link or ASIN</span>
          <input value={product} onChange={e => setProduct(e.target.value)} placeholder="https://www.amazon.com/dp/B0…  or  B0D5H9M72G"
            className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMode('face')} disabled={faces.length === 0}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition disabled:opacity-40 ${mode === 'face' ? 'border-[#E60023] text-[#E60023] bg-[#E60023]/5' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
            <User size={15} /> With my face
          </button>
          <button onClick={() => setMode('product')}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition ${mode === 'product' ? 'border-[#E60023] text-[#E60023] bg-[#E60023]/5' : 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
            <Package size={15} /> Product only
          </button>
        </div>
        {mode === 'face' && faces.length > 1 && (
          <select value={faceId} onChange={e => setFaceId(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]">
            {faces.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <button onClick={generate} disabled={genBusy}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#d2d2d7] dark:border-[#3a3a3c] text-sm font-semibold transition disabled:opacity-60" style={{ color: 'var(--text)' }}>
          {genBusy ? <><Loader2 size={16} className="animate-spin" /> Designing…</> : <><Wand2 size={16} /> {thumbUrl ? 'Regenerate thumbnail' : 'Generate thumbnail'}</>}
        </button>
        {genError && <p className="text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" />{genError}</p>}
        {thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="Thumbnail" className="w-full rounded-xl border border-gray-200 dark:border-white/10" />
        )}
      </div>

      {/* Step 2 — pin details (once a thumbnail exists) */}
      {thumbUrl && (
        <div className="flex flex-col gap-3 pt-1 border-t border-gray-100 dark:border-white/10">
          {boards.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Board</span>
              <select value={boardId} onChange={e => setBoardId(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]">
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Pin title <span className="font-normal" style={{ color: 'var(--text-soft)' }}>— blank = AI writes it</span></span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Leave blank to auto-write"
              className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Description</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Leave blank to auto-write"
              className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6] resize-none" />
          </label>
          <button onClick={publish} disabled={pubBusy || connected === false}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-semibold text-sm transition disabled:opacity-60" style={{ backgroundColor: PIN_RED }}>
            {pubBusy ? <><Loader2 size={16} className="animate-spin" /> Pinning…</> : <><Send size={16} /> Publish Pin</>}
          </button>
          {pubError && <p className="text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" />{pubError}</p>}
          {result && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-[#34c759]/30 bg-[#34c759]/5 p-3">
              <a href={result.pinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-semibold text-[#34c759]">
                <Check size={15} /> Pin published <ExternalLink size={13} />
              </a>
              {result.note && <p className="text-[11px]" style={{ color: 'var(--text-soft)' }}>{result.note}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
