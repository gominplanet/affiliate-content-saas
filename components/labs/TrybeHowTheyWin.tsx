'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE > Create > How they win (Seb, 2026-10-18, after TrybeDaily shipped
// The Race): every Top 100 video MVP has seen for a brand, what was actually
// said in it, and one press to turn a winner into a script in your voice.
//
// WHY THE SCRIPTS ARE WORTH ANYTHING. A brand that keeps putting new videos
// in TRYBE's Top 100 is a brand spending on ads and paying creators. The
// videos it picked are the shape of video it approves. Copying that shape is
// the fastest way to get approved by it; copying its sentences is the fastest
// way to be dropped by it, which is why the rewrite refuses to hand the
// original back (lib/trybe-scripts tooAlike).
//
// THE BOARD SAYS HOW THIN IT IS. One read of TRYBE's own script endpoint kept
// 4 openings out of 25 asked, so a brand with two scripts and eleven videos
// is normal. The coverage line is not decoration: without it a creator reads
// two videos and believes they have seen how that brand wins.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Play, Copy, Wand2, AlertTriangle, ChevronDown, ChevronRight, Ear, Download } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import { readTopEntries } from '@/lib/trybe-working'
import { CLOSENESS, coverageWords, type Closeness, type TopScript } from '@/lib/trybe-scripts'

const PURPLE = '#7C3AED'
const card = 'rounded-2xl border p-4'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const soft = { color: 'var(--text-soft)' }
const field = 'w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent'
const fieldStyle = { borderColor: 'var(--border)', color: 'var(--text)' }

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const r = await fetch('/api/labs/trybe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    })
    const json = await r.json().catch(() => ({}))
    return { ok: r.ok, json: (json && typeof json === 'object' ? json : {}) as Record<string, unknown> }
  } catch (e) {
    return { ok: false, json: { error: e instanceof Error ? e.message : 'No answer.' } }
  }
}

interface Written { hooks: string[]; script: string }

export default function TrybeHowTheyWin({ canRead, isAdmin }: { canRead: boolean; isAdmin: boolean }) {
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [brand, setBrand] = useState<{ id: string | null; name: string } | null>(null)
  const [typed, setTyped] = useState('')
  const [videos, setVideos] = useState<TopScript[] | null>(null)
  const [coverage, setCoverage] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // The rewrite, per video.
  const [writing, setWriting] = useState<string | null>(null)
  const [written, setWritten] = useState<Record<string, Written>>({})
  const [writeError, setWriteError] = useState<Record<string, string>>({})
  const [experience, setExperience] = useState('')
  const [product, setProduct] = useState('')
  const [closeness, setCloseness] = useState<Closeness>('similar')
  // Admin collection.
  const [collecting, setCollecting] = useState<string | null>(null)
  const [collected, setCollected] = useState<string | null>(null)
  const stop = useRef(false)

  useEffect(() => {
    if (!canRead) return
    requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
      if (!r.ok) { setBrandsError(`TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Sign in to TRYBE in this Chrome, then reload.`); return }
      setBrands(readBrandStats(r.json))
    }).catch((e) => setBrandsError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
  }, [canRead])

  const load = useCallback(async (b: { id: string | null; name: string }) => {
    setBrand(b); setVideos(null); setLoadError(null); setWritten({}); setWriteError({})
    const r = await post({ action: 'top_scripts', brandId: b.id || undefined, brandName: b.name })
    if (!r.ok) { setLoadError(String(r.json.error || 'MVP could not read that brand’s videos.')); return }
    setVideos((r.json.videos ?? []) as TopScript[])
    setCoverage(String(r.json.coverage || ''))
  }, [])

  const ready = useMemo(() => (videos ?? []).filter((v) => v.state === 'ready' && v.script), [videos])

  async function rewrite(v: TopScript) {
    if (!v.script) return
    setWriting(v.submission_id)
    setWriteError((e) => { const n = { ...e }; delete n[v.submission_id]; return n })
    const r = await post({
      action: 'script_rewrite', reference: v.script, experience, product,
      closeness, brand: v.brand_name || brand?.name || '', avatar: '',
    })
    setWriting(null)
    if (!r.ok) { setWriteError((e) => ({ ...e, [v.submission_id]: String(r.json.error || 'MVP could not write it.') })); return }
    setWritten((w) => ({ ...w, [v.submission_id]: { hooks: (r.json.hooks ?? []) as string[], script: String(r.json.script || '') } }))
  }

  /**
   * The team's collection pass, in the open.
   *
   * Reads today's Top 100 through SCOUT, files every entry, then fills the
   * words: TRYBE's own script first because it is free, and only then a
   * transcription, which costs. Every step says what it actually did.
   */
  async function collect() {
    stop.current = false
    setCollecting('Reading TRYBE’s Top 100'); setCollected(null)
    try {
      const top = await requestTrybeApi('GET', '/backend/api/creator/v2/top-creatives')
      if (!top.ok) { setCollecting(null); toast.error(`MVP could not read the Top 100: ${top.error || 'SCOUT did not answer.'}`); return }
      const entries = readTopEntries(top.json)
      if (!entries.length) { setCollecting(null); toast.error('TRYBE answered, but MVP could not read the Top 100 from it.'); return }
      const seen = await post({ action: 'top_scripts_seen', entries })
      if (!seen.ok) { setCollecting(null); toast.error(String(seen.json.error || 'MVP could not file the Top 100.')); return }
      const need = (seen.json.need ?? []) as Array<{ submissionId: string }>
      const hear = new Set((seen.json.hear ?? []) as string[])
      let fromTrybe = 0, heard = 0, nothing = 0
      // FREE FIRST. TRYBE shares the words for some of them, and those cost
      // nothing but a request.
      for (let i = 0; i < need.length && !stop.current; i++) {
        setCollecting(`Asking TRYBE for the words (${i + 1} of ${need.length})`)
        const id = need[i].submissionId
        const sr = await requestTrybeApi('GET', `/backend/api/creator/v2/submissions/${encodeURIComponent(id)}/script`).catch(() => null)
        const saved = await post({ action: 'top_script_save', submissionId: id, script: sr?.ok ? (sr.json as Record<string, unknown>) : null })
        if (saved.ok && Number(saved.json.saved) === 1) { fromTrybe++; hear.delete(id) }
      }
      // THEN THE ONES THAT COST. Best placed first, and only the ones TRYBE
      // had nothing for.
      const toHear = [...hear]
      for (let i = 0; i < toHear.length && !stop.current; i++) {
        setCollecting(`Listening to the video (${i + 1} of ${toHear.length})`)
        const h = await post({ action: 'top_script_hear', submissionId: toHear[i] })
        if (h.ok && Number(h.json.heard) === 1) heard++
        else nothing++
      }
      setCollected(`Filed ${entries.length} videos. TRYBE shared the words for ${fromTrybe}. MVP listened to ${heard}.${nothing ? ` ${nothing} had nothing MVP could read.` : ''}`)
      if (brand) void load(brand)
    } finally {
      setCollecting(null)
    }
  }

  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast.success('Copied.'), () => toast.error('Could not copy.')) }

  if (!canRead) {
    return (
      <div className={card} style={cardStyle}>
        <p className="text-[15px] font-semibold">How they win needs SCOUT on TRYBE</p>
        <p className="text-[13.5px] mt-1" style={soft}>Install SCOUT, allow it on TRYBE and sign in to TRYBE in this Chrome. MVP then shows the brands you work with and the videos TRYBE picked for them.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={card} style={cardStyle}>
        <h3 className="text-[15px] font-semibold">How they win</h3>
        <p className="text-[13.5px] mt-1" style={soft}>
          The videos TRYBE picked for its Top 100, brand by brand, with what was said in them. A brand that keeps landing new videos there is spending on ads and paying creators, and these are the videos it approves.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {(brands ?? []).slice(0, 14).map((b) => (
            <button key={b.id} type="button" onClick={() => void load({ id: b.id, name: b.name })}
              className="rounded-full border px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ borderColor: brand?.id === b.id ? PURPLE : 'var(--border)', color: brand?.id === b.id ? PURPLE : 'var(--text)' }}>
              {b.name}
            </button>
          ))}
        </div>
        {brandsError && <p className="text-[12.5px] mt-2" style={{ color: '#B45309' }}>{brandsError}</p>}

        <div className="mt-3 flex gap-2">
          <input className={field} style={fieldStyle} placeholder="Or type any brand on TRYBE" value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) void load({ id: null, name: typed.trim() }) }} />
          <button type="button" onClick={() => typed.trim() && void load({ id: null, name: typed.trim() })}
            className="inline-flex items-center gap-1.5 rounded-xl border px-4 text-[13px] font-semibold" style={{ borderColor: 'var(--border)' }}>
            <Search size={14} /> Look
          </button>
        </div>

        {isAdmin && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <button type="button" onClick={() => void collect()} disabled={!!collecting}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PURPLE }}>
              {collecting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {collecting || 'Collect today’s Top 100'}
            </button>
            <p className="text-[11.5px] mt-2" style={soft}>
              Admin. Files today’s Top 100 for every member, asks TRYBE for the words first because that is free, then pays to listen to the ones it had none for.
            </p>
            {collected && <p className="text-[12.5px] mt-1.5" style={{ color: '#15803D' }}>{collected}</p>}
          </div>
        )}
      </div>

      {brand && !videos && !loadError && (
        <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading {brand.name}’s videos...</p>
      )}
      {loadError && <div className={card} style={cardStyle}><p className="text-[13px]" style={{ color: '#B91C1C' }}>{loadError}</p></div>}

      {videos && (
        <div className={card} style={cardStyle}>
          <p className="text-[13.5px] font-semibold">{brand?.name}</p>
          {/* HOW THIN IT IS, SAID. Two scripts out of eleven videos is normal. */}
          <p className="text-[12.5px] mt-0.5" style={soft}>{coverage || coverageWords(videos)}</p>
          {ready.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input className={field} style={fieldStyle} placeholder="Which product do you have?" value={product} onChange={(e) => setProduct(e.target.value)} />
              <div className="flex gap-1.5">
                {(Object.keys(CLOSENESS) as Closeness[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCloseness(c)} title={CLOSENESS[c].says}
                    className="flex-1 rounded-lg border px-2 py-2 text-[12px] font-semibold"
                    style={{ borderColor: closeness === c ? PURPLE : 'var(--border)', color: closeness === c ? PURPLE : 'var(--text)' }}>
                    {CLOSENESS[c].label}
                  </button>
                ))}
              </div>
              <textarea className={`${field} sm:col-span-2`} style={fieldStyle} rows={2}
                placeholder="What actually happened to you with it? This is the part MVP cannot invent."
                value={experience} onChange={(e) => setExperience(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {(videos ?? []).map((v) => {
        const isOpen = !!open[v.submission_id]
        const w = written[v.submission_id]
        return (
          <div key={v.submission_id} className={card} style={cardStyle}>
            <div className="flex items-start gap-3">
              {v.thumbnail && (
                <a href={v.video_url || v.thumbnail} target="_blank" rel="noopener noreferrer" title="Watch it"
                  className="relative shrink-0 w-[70px] rounded-xl overflow-hidden border" style={{ aspectRatio: '9 / 16', borderColor: 'var(--border)' }}>
                  { /* eslint-disable-next-line @next/next/no-img-element */ }
                  <img src={v.thumbnail} alt="" className="w-full h-full object-cover" />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12px]" style={soft}>
                  {v.best_rank ? `TRYBE #${v.best_rank}` : 'In the Top 100'}{v.creator ? ` · ${v.creator}` : ''}{v.seconds ? ` · ${v.seconds}s` : ''}
                </p>
                {v.hook
                  ? <p className="text-[14px] font-semibold mt-0.5 leading-snug">&ldquo;{v.hook}&rdquo;</p>
                  : <p className="text-[13px] mt-0.5" style={soft}>No opening line yet.</p>}
                <p className="text-[11.5px] mt-1" style={soft}>
                  {v.state === 'ready'
                    ? (v.source === 'trybe' ? 'TRYBE shared these words.' : 'MVP listened to the video for these words.')
                    : v.detail || 'Nothing read from this one yet.'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {v.video_url && <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}><Play size={12} /> Watch it</a>}
                  {v.script && (
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [v.submission_id]: !isOpen }))} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {isOpen ? 'Hide the script' : 'Read the script'}
                    </button>
                  )}
                  {v.script && <button type="button" onClick={() => copy(v.script as string)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={soft}><Copy size={12} /> Copy</button>}
                  {v.script && (
                    <button type="button" onClick={() => void rewrite(v)} disabled={writing === v.submission_id}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: PURPLE }}>
                      {writing === v.submission_id ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Write mine from this
                    </button>
                  )}
                  {v.state !== 'ready' && !v.script && <span className="inline-flex items-center gap-1 text-[12px]" style={soft}><Ear size={12} /> Waiting on the words</span>}
                </div>
              </div>
            </div>

            {isOpen && v.script && (
              <p className="mt-3 pt-3 border-t text-[13px] leading-relaxed whitespace-pre-wrap" style={{ borderColor: 'var(--border)' }}>{v.script}</p>
            )}

            {writeError[v.submission_id] && (
              <p className="mt-3 text-[12.5px] inline-flex items-start gap-1.5" style={{ color: '#B45309' }}>
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> <span>{writeError[v.submission_id]}</span>
              </p>
            )}

            {w && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[12px] font-semibold" style={soft}>Three openings to pick from</p>
                <ul className="mt-1 space-y-1">
                  {w.hooks.map((h, i) => (
                    <li key={i} className="text-[13px] flex items-start gap-2">
                      <span style={{ color: PURPLE }}>{i + 1}.</span>
                      <button type="button" onClick={() => copy(h)} className="text-left hover:underline">{h}</button>
                    </li>
                  ))}
                  {!w.hooks.length && <li className="text-[12.5px]" style={soft}>MVP wrote the script but no openings came back with it.</li>}
                </ul>
                <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">{w.script}</p>
                <button type="button" onClick={() => copy(`${w.hooks[0] ? `${w.hooks[0]}\n\n` : ''}${w.script}`)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)' }}>
                  <Copy size={12} /> Copy the script
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
