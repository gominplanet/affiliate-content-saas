// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// StorefrontStage — the Amazon geos step. One master video, localized for every
// Amazon marketplace the creator sells in (title + description per market in
// their voice), with an optional dub in their own cloned voice. Used inside
// Launchpad (with a preset video) and on the standalone Storefront Sync page
// (with its own picker).
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Globe, Loader2, Check, Circle, Mic, Play } from 'lucide-react'
import { toast } from 'sonner'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Vid { id: string; title: string; thumbnail_url: string | null }
interface Market { domain: string; code: string; country: string; langName: string; needsTranslation: boolean }
interface Target { domain: string; market: string; country: string; lang: string; dub: boolean; title: string | null; description: string | null; state: string; detail: string | null; videoUrl: string | null }

const label = { color: 'var(--fg)' } as const
const muted = { color: 'var(--fg-muted)' } as const

/** presetVideoId: when set, the stage syncs THAT video and hides its own picker
 *  (Launchpad passes the already-picked video). */
export default function StorefrontStage({ presetVideoId }: { presetVideoId?: string | null }) {
  const [videos, setVideos] = useState<Vid[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(!presetVideoId)
  const [picked, setPicked] = useState<string | null>(presetVideoId || null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [asin, setAsin] = useState('')
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [dubbing, setDubbing] = useState<string | null>(null)

  const [voice, setVoice] = useState<{ enabled: boolean; hasVoice: boolean; name: string | null } | null>(null)
  const [consent, setConsent] = useState(false)
  const [cloning, setCloning] = useState(false)

  useEffect(() => { if (presetVideoId) setPicked(presetVideoId) }, [presetVideoId])

  const load = useCallback(async () => {
    try {
      const [mr, vr] = await Promise.all([
        fetch('/api/global-sync/markets').then(r => r.json()).catch(() => ({})),
        fetch('/api/voice-clone/status').then(r => r.json()).catch(() => ({})),
      ])
      if (Array.isArray(mr?.markets)) {
        setMarkets(mr.markets)
        // Default to every non-US market so the common case is one click.
        setChosen(new Set(mr.markets.filter((m: Market) => m.domain !== 'amazon.com').map((m: Market) => m.domain)))
      }
      if (vr?.ok) setVoice({ enabled: !!vr.enabled, hasVoice: !!vr.hasVoice, name: vr.name || null })
      if (!presetVideoId) {
        const sb = createBrowserClient()
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (sb as any)
            .from('youtube_videos').select('id,title,thumbnail_url')
            .eq('user_id', user.id).order('published_at', { ascending: false, nullsFirst: false }).limit(18)
          setVideos(Array.isArray(data) ? data : [])
        }
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [presetVideoId])
  useEffect(() => { load() }, [load])

  const toggleMarket = (domain: string) => setChosen(prev => {
    const next = new Set(prev); next.has(domain) ? next.delete(domain) : next.add(domain); return next
  })

  async function start() {
    if (!picked) { toast.error('Pick a master video first'); return }
    if (chosen.size === 0) { toast.error('Pick at least one marketplace'); return }
    setRunning(true); setTargets([]); setJobId(null)
    try {
      const r = await fetch('/api/global-sync/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: picked, markets: Array.from(chosen), asin: asin.trim() || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.jobId) throw new Error(j.error || 'Could not start the sync')
      setJobId(j.jobId)
      for (let i = 0; i < 40; i++) {
        await sleep(3000)
        const jr = await fetch(`/api/global-sync/${j.jobId}`).then(x => x.json()).catch(() => ({}))
        if (Array.isArray(jr?.targets)) setTargets(jr.targets)
        if (jr?.status === 'done' || jr?.status === 'failed') break
      }
      toast.success('Storefronts localized')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the sync')
    } finally { setRunning(false) }
  }

  async function refreshVoice() {
    const vr = await fetch('/api/voice-clone/status').then(r => r.json()).catch(() => ({}))
    if (vr?.ok) setVoice({ enabled: !!vr.enabled, hasVoice: !!vr.hasVoice, name: vr.name || null })
  }
  async function cloneVoice() {
    if (!consent) { toast.error('Please confirm you have the right to clone this voice'); return }
    setCloning(true)
    try {
      const r = await fetch('/api/voice-clone/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Voice cloning failed')
      await refreshVoice()
      toast.success('Your voice is ready. New dubs will sound like you.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Voice cloning failed') } finally { setCloning(false) }
  }
  async function removeVoice() {
    setCloning(true)
    try { await fetch('/api/voice-clone/delete', { method: 'POST' }); await refreshVoice(); setConsent(false); toast.success('Cloned voice removed') }
    catch { /* ignore */ } finally { setCloning(false) }
  }

  async function refreshTargets() {
    if (!jobId) return
    const jr = await fetch(`/api/global-sync/${jobId}`).then(x => x.json()).catch(() => ({}))
    if (Array.isArray(jr?.targets)) setTargets(jr.targets)
  }
  async function dubOne(domain: string) {
    if (!jobId) return
    setDubbing(domain)
    try {
      const r = await fetch('/api/global-sync/dub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, domain }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Dub failed')
      await refreshTargets()
      toast.success(j.note === 'voiceover_only' ? 'Voiceover ready' : 'Dub ready')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Dub failed'); await refreshTargets() } finally { setDubbing(null) }
  }

  return (
    <div className="space-y-5">
      {/* Sounds like you — cloned voice for dubs */}
      {voice?.enabled && (
        <div className="card p-4" style={{ background: 'rgba(14,165,164,0.04)' }}>
          {voice.hasVoice ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Mic size={15} style={{ color: '#0EA5A4' }} />
                <span className="text-sm" style={label}>Dubs use <span className="font-semibold">your voice</span>{voice.name ? ` (from “${voice.name}”)` : ''}.</span>
              </div>
              <button type="button" onClick={() => void removeVoice()} disabled={cloning} className="text-[12px] underline disabled:opacity-60" style={muted}>Remove</button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Mic size={15} style={{ color: '#0EA5A4' }} />
                <span className="text-sm font-semibold" style={label}>Make dubs sound like you</span>
              </div>
              <p className="text-[12px] mb-2.5" style={muted}>MVP learns your voice from a recent video, then narrates every non-English dub in your own voice.</p>
              <label className="flex items-start gap-2 text-[12px] cursor-pointer mb-2.5" style={muted}>
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-[#0EA5A4]" />
                <span>I confirm this is my own voice, or I have permission to clone it.</span>
              </label>
              <button type="button" onClick={() => void cloneVoice()} disabled={cloning || !consent}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded-lg text-white disabled:opacity-60" style={{ background: '#0EA5A4' }}>
                {cloning ? <><Loader2 size={14} className="animate-spin" /> Learning your voice…</> : <><Mic size={14} /> Use my voice</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Master video picker — only when no video was passed in */}
      {!presetVideoId && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-3" style={label}>Pick your master video</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm py-4" style={muted}><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : videos.length === 0 ? (
            <p className="text-sm" style={muted}>No videos yet. Sync your channel first.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {videos.map(v => {
                const on = picked === v.id
                return (
                  <button key={v.id} type="button" onClick={() => setPicked(v.id)} className="text-left rounded-xl border overflow-hidden"
                    style={{ borderColor: on ? '#0EA5A4' : 'var(--border)', borderWidth: on ? 2 : 1, background: 'var(--bg)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" className="w-full aspect-video object-cover" /> : <div className="w-full aspect-video" style={{ background: 'var(--surface)' }} />}
                    <div className="p-2"><p className="text-[12px] font-medium line-clamp-2" style={label}>{v.title}</p></div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Markets */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={label}>Marketplaces</h2>
          <button type="button" className="text-[12px] underline" style={muted}
            onClick={() => setChosen(new Set(markets.filter(m => m.domain !== 'amazon.com').map(m => m.domain)))}>
            Select all (except US)
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {markets.map(m => {
            const on = chosen.has(m.domain)
            return (
              <label key={m.domain} className="flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-sm"
                style={{ borderColor: on ? '#0EA5A4' : 'var(--border)', background: on ? 'rgba(14,165,164,0.05)' : 'transparent', color: 'var(--fg)' }}>
                <input type="checkbox" checked={on} onChange={() => toggleMarket(m.domain)} disabled={running} className="accent-[#0EA5A4]" />
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{m.code}</span>
                  <span className="text-[11px] ml-1" style={muted}>{m.needsTranslation ? m.langName : 'English'}</span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="mt-3">
          <label className="text-[12px] font-medium" style={muted}>Featured ASIN (optional)</label>
          <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="B0XXXXXXXX or a product link"
            className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }} />
        </div>
      </div>

      <button onClick={() => void start()} disabled={running || !picked || chosen.size === 0}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
        {running ? <><Loader2 size={16} className="animate-spin" /> Localizing…</> : <><Globe size={16} /> Sync to {chosen.size || ''} {chosen.size === 1 ? 'market' : 'markets'}</>}
      </button>

      {targets.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-3" style={label}>Localized copy</h2>
          <div className="space-y-3">
            {targets.map(t => (
              <div key={t.domain} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 mb-1">
                  {t.state === 'localized' || t.state === 'delivered' ? <Check size={14} style={{ color: '#10B981' }} /> : <Circle size={13} style={muted} />}
                  <span className="text-sm font-medium" style={label}>{t.country}</span>
                  <span className="text-[11px]" style={muted}>{t.lang}{t.dub ? ' · dub' : ''}</span>
                </div>
                {t.title && <p className="text-[13px] font-medium" style={label}>{t.title}</p>}
                {t.description && <p className="text-[12px] mt-0.5 line-clamp-3" style={muted}>{t.description}</p>}
                {t.detail && <p className="text-[11px] mt-1" style={muted}>{t.detail}</p>}
                {t.dub && (t.state === 'localized' || t.state === 'failed' || t.state === 'dubbing') && (
                  <div className="flex items-center gap-3 mt-2">
                    {t.videoUrl ? (
                      <a href={t.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#0EA5A4' }}>
                        <Play size={13} /> Play dub
                      </a>
                    ) : (
                      <button type="button" onClick={() => void dubOne(t.domain)} disabled={dubbing === t.domain}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg border disabled:opacity-60"
                        style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>
                        {dubbing === t.domain ? <><Loader2 size={13} className="animate-spin" /> Dubbing…</> : <><Mic size={13} /> Generate dub</>}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
