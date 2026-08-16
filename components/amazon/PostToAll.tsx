// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Post to all three" — the one-click fan-out. From one product it generates a
// format-correct MVP Art Director design for every CONNECTED network (Pinterest
// pin, Instagram story, Facebook post), sharing ONE art-director brief so the
// set looks like one campaign and the extra formats cost pennies, then publishes
// each. The per-network tabs stay the place to fine-tune; this is the shortcut.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, User, Package, Rocket, Check, AlertCircle, ExternalLink } from 'lucide-react'
import { HeadlineStyleToggle, useHeadlineStyle, headlineStyleValue } from '@/components/thumbnails/HeadlineStyleToggle'

interface FaceModel { id: string; name: string }
type NetKey = 'pinterest' | 'instagram' | 'facebook'
interface NetState { label: string; accent: string; connected: boolean; status: 'idle' | 'designing' | 'posting' | 'done' | 'error'; url?: string; error?: string }

const NETS: { key: NetKey; label: string; accent: string; format: string; endpoint: string; extra?: Record<string, unknown> }[] = [
  { key: 'pinterest', label: 'Pinterest', accent: '#E60023', format: 'pin', endpoint: '/api/amazon/pin' },
  { key: 'instagram', label: 'Instagram', accent: '#E1306C', format: 'story', endpoint: '/api/amazon/ig', extra: { postType: 'story', ctaLinkInBio: true } },
  { key: 'facebook', label: 'Facebook', accent: '#1877F2', format: 'fb', endpoint: '/api/amazon/fb' },
]

export default function PostToAll({ presetProduct }: { presetProduct?: { value: string; nonce: number } }) {
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState('')
  const [mode, setMode] = useState<'face' | 'product'>('face')
  const [faces, setFaces] = useState<FaceModel[]>([])
  const [faceId, setFaceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useHeadlineStyle()
  const [nets, setNets] = useState<Record<NetKey, NetState>>({
    pinterest: { label: 'Pinterest', accent: '#E60023', connected: false, status: 'idle' },
    instagram: { label: 'Instagram', accent: '#E1306C', connected: false, status: 'idle' },
    facebook: { label: 'Facebook', accent: '#1877F2', connected: false, status: 'idle' },
  })

  useEffect(() => { if (presetProduct?.value) setProduct(presetProduct.value) /* eslint-disable-next-line */ }, [presetProduct?.nonce])

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/face-models').then(r => r.json()).catch(() => ({}))
        const ready = (d.models || []).filter((m: { status?: string }) => m.status === 'ready').map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))
        setFaces(ready)
        if (ready.length > 0) setFaceId(ready[0].id); else setMode('product')
      } catch { /* ignore */ }
      try {
        const s = await fetch('/api/amazon/social-status').then(r => r.json())
        setNets(prev => ({
          pinterest: { ...prev.pinterest, connected: !!s?.pinterest?.connected },
          instagram: { ...prev.instagram, connected: !!s?.instagram?.connected },
          facebook: { ...prev.facebook, connected: !!s?.facebook?.connected },
        }))
      } catch { /* ignore */ }
    })()
  }, [])

  const setNet = (k: NetKey, patch: Partial<NetState>) => setNets(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }))

  const run = useCallback(async () => {
    const raw = product.trim()
    if (!raw) return
    if (mode === 'face' && !faceId) return
    const connectedNets = NETS.filter(n => nets[n.key].connected)
    if (connectedNets.length === 0) return
    setBusy(true)
    const isUrl = /^https?:\/\//i.test(raw)
    const isAsin = /^[A-Z0-9]{10}$/i.test(raw)
    const productField = isUrl ? { productUrl: raw } : isAsin ? { asin: raw.toUpperCase() } : { productUrl: raw }
    const bk = `${(isAsin ? raw.toUpperCase() : raw)}::all::${Date.now()}` // shared brief across all networks

    // Sequential so one shared art-director brief is generated first, then reused
    // (the cache is keyed on briefKey) for the rest — cheaper + consistent.
    for (const n of connectedNets) {
      setNet(n.key, { status: 'designing', url: undefined, error: undefined })
      try {
        const genRes = await fetch('/api/youtube/generate-thumbnail', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(290000),
          body: JSON.stringify({
            videoTitle: 'Product spotlight', textMode: 'graphic', format: n.format, briefKey: bk,
            headlineStyle: headlineStyleValue(question),
            ...(n.extra || {}), ...productField, ...(mode === 'product' ? { noHuman: true } : { faceModelId: faceId }),
          }),
        })
        const genData = await genRes.json().catch(() => ({}))
        if (!genRes.ok) throw new Error((genData.error as string) || 'Design failed')
        const imageUrl = (Array.isArray(genData.thumbnailUrls) && genData.thumbnailUrls[0]) || genData.thumbnailUrl
        if (!imageUrl) throw new Error('No design came back')

        setNet(n.key, { status: 'posting' })
        const pubRes = await fetch(n.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(120000),
          body: JSON.stringify({ imageUrl, ...productField, ...(n.key === 'instagram' ? { postType: 'story' } : {}) }),
        })
        const pubData = await pubRes.json().catch(() => ({}))
        if (!pubRes.ok) throw new Error((pubData.error as string) || 'Post failed')
        setNet(n.key, { status: 'done', url: (pubData.pinUrl || pubData.postUrl) as string | undefined })
      } catch (e) {
        setNet(n.key, { status: 'error', error: e instanceof Error ? e.message : 'Failed' })
      }
    }
    setBusy(false)
  }, [product, mode, faceId, nets, question])

  const anyConnected = NETS.some(n => nets[n.key].connected)

  if (!open) {
    return (
      <div className="mb-4">
        <button onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-300 dark:border-white/15 text-sm font-semibold transition hover:bg-gray-50 dark:hover:bg-white/5" style={{ color: 'var(--text)' }}>
          <Rocket size={15} className="text-[#d97706]" /> Post to all three at once
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket size={16} className="text-[#d97706]" />
          <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Post to all three at once</h2>
        </div>
        <button onClick={() => setOpen(false)} className="text-[11px] hover:underline" style={{ color: 'var(--text-soft)' }}>Hide</button>
      </div>
      <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
        One product → a Pinterest pin, an Instagram story (with link-in-bio) and a Facebook post, all from one shared design. Fine-tune any of them in the tabs below instead.
      </p>

      <input value={product} onChange={e => setProduct(e.target.value)} placeholder="https://www.amazon.com/dp/B0…  or  B0D5H9M72G"
        className="w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]" />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setMode('face')} disabled={faces.length === 0}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition disabled:opacity-40 ${mode === 'face' ? 'border-[#d97706] text-[#d97706] bg-[#d97706]/5' : 'border-gray-200 dark:border-white/10'}`} style={mode !== 'face' ? { color: 'var(--text)' } : undefined}>
          <User size={15} /> With my face
        </button>
        <button onClick={() => setMode('product')}
          className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition ${mode === 'product' ? 'border-[#d97706] text-[#d97706] bg-[#d97706]/5' : 'border-gray-200 dark:border-white/10'}`} style={mode !== 'product' ? { color: 'var(--text)' } : undefined}>
          <Package size={15} /> Product only
        </button>
      </div>
      {mode === 'face' && faces.length > 1 && (
        <select value={faceId} onChange={e => setFaceId(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7]">
          {faces.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}

      <HeadlineStyleToggle question={question} onChange={setQuestion} disabled={busy} compact />

      {/* Per-network status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {NETS.map(n => {
          const st = nets[n.key]
          return (
            <div key={n.key} className={`flex items-center gap-2 rounded-xl border p-2.5 ${st.connected ? 'border-gray-200 dark:border-white/10' : 'border-gray-100 dark:border-white/5 opacity-50'}`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: n.accent }} />
              <span className="text-[13px] font-semibold flex-1" style={{ color: 'var(--text)' }}>{n.label}</span>
              {!st.connected ? <span className="text-[10px]" style={{ color: 'var(--text-soft)' }}>not connected</span>
                : st.status === 'designing' ? <span className="text-[10px] inline-flex items-center gap-1" style={{ color: 'var(--text-soft)' }}><Loader2 size={11} className="animate-spin" /> designing</span>
                : st.status === 'posting' ? <span className="text-[10px] inline-flex items-center gap-1" style={{ color: 'var(--text-soft)' }}><Loader2 size={11} className="animate-spin" /> posting</span>
                : st.status === 'done' ? (st.url ? <a href={st.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[#34c759] inline-flex items-center gap-0.5"><Check size={12} /> posted <ExternalLink size={11} /></a> : <span className="text-[11px] font-semibold text-[#34c759] inline-flex items-center gap-0.5"><Check size={12} /> posted</span>)
                : st.status === 'error' ? <span className="text-[10px] text-[#b91c1c] dark:text-[#f87171] inline-flex items-center gap-1" title={st.error}><AlertCircle size={11} /> failed</span>
                : <span className="text-[10px] text-[#34c759]">ready</span>}
            </div>
          )
        })}
      </div>

      <button onClick={run} disabled={busy || !product.trim() || !anyConnected}
        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-semibold text-sm transition disabled:opacity-60" style={{ backgroundColor: '#d97706' }}>
        {busy ? <><Loader2 size={16} className="animate-spin" /> Designing + posting…</> : <><Rocket size={16} /> Generate &amp; post to all connected</>}
      </button>
      {!anyConnected && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Connect at least one network above first.</p>}
    </div>
  )
}
