// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Storefront Sync — Global Storefront Sync workspace (Milestone 1). Pick a
// master video and the Amazon marketplaces you sell in, and MVP localizes the
// title + description per market in your voice (captions + dub land next). In
// LABS while we verify each market's delivery flow.
'use client'

import { useEffect, useState, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { createBrowserClient } from '@/lib/supabase/client'
import { Globe, Loader2, Check, Circle } from 'lucide-react'
import { toast } from 'sonner'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Vid { id: string; title: string; thumbnail_url: string | null }
interface Market { domain: string; code: string; country: string; langName: string; needsTranslation: boolean }
interface Target { domain: string; market: string; country: string; lang: string; dub: boolean; title: string | null; description: string | null; state: string }

export default function GlobalSyncPage() {
  const [videos, setVideos] = useState<Vid[]>([])
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [asin, setAsin] = useState('')
  const [running, setRunning] = useState(false)
  const [targets, setTargets] = useState<Target[]>([])

  const load = useCallback(async () => {
    try {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      const [mr] = await Promise.all([fetch('/api/global-sync/markets').then(r => r.json()).catch(() => ({}))])
      if (Array.isArray(mr?.markets)) setMarkets(mr.markets)
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (sb as any)
          .from('youtube_videos').select('id,title,thumbnail_url')
          .eq('user_id', user.id).order('published_at', { ascending: false, nullsFirst: false }).limit(18)
        setVideos(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggleMarket = (domain: string) => setChosen(prev => {
    const next = new Set(prev); next.has(domain) ? next.delete(domain) : next.add(domain); return next
  })

  async function start() {
    if (!picked) { toast.error('Pick a master video first'); return }
    if (chosen.size === 0) { toast.error('Pick at least one marketplace'); return }
    setRunning(true); setTargets([])
    try {
      const r = await fetch('/api/global-sync/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: picked, markets: Array.from(chosen), asin: asin.trim() || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.jobId) throw new Error(j.error || 'Could not start the sync')
      // Poll the job until every market is localized (~2 min cap).
      for (let i = 0; i < 40; i++) {
        await sleep(3000)
        const jr = await fetch(`/api/global-sync/${j.jobId}`).then(x => x.json()).catch(() => ({}))
        if (Array.isArray(jr?.targets)) setTargets(jr.targets)
        if (jr?.status === 'done' || jr?.status === 'failed') break
      }
      toast.success('Sync finished')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the sync')
    } finally { setRunning(false) }
  }

  const label = { color: 'var(--fg)' } as const
  const muted = { color: 'var(--fg-muted)' } as const

  return (
    <>
      <PageHero
        title="Storefront Sync"
        subtitle="One master video, localized for every Amazon marketplace you sell in. Titles and descriptions are rewritten in your voice, per market."
      />

      <div className="max-w-3xl space-y-6 pb-28">
        {/* 1. Master video */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-3" style={label}>1. Pick your master video</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm py-4" style={muted}><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : videos.length === 0 ? (
            <p className="text-sm" style={muted}>No videos yet. Sync your channel first.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {videos.map(v => {
                const on = picked === v.id
                return (
                  <button key={v.id} type="button" onClick={() => setPicked(v.id)}
                    className="text-left rounded-xl border overflow-hidden"
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

        {/* 2. Markets */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={label}>2. Choose your marketplaces</h2>
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

        {/* 3. Run */}
        <button onClick={() => void start()} disabled={running || !picked || chosen.size === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#0EA5A4,#0891B2)' }}>
          {running ? <><Loader2 size={16} className="animate-spin" /> Localizing…</> : <><Globe size={16} /> Sync to {chosen.size || ''} {chosen.size === 1 ? 'market' : 'markets'}</>}
        </button>

        {/* Results */}
        {targets.length > 0 && (
          <div className="card p-5">
            <h2 className="text-sm font-semibold mb-3" style={label}>Localized copy</h2>
            <div className="space-y-3">
              {targets.map(t => (
                <div key={t.domain} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    {t.state === 'localized' || t.state === 'delivered' ? <Check size={14} style={{ color: '#10B981' }} /> : <Circle size={13} style={muted} />}
                    <span className="text-sm font-medium" style={label}>{t.country}</span>
                    <span className="text-[11px]" style={muted}>{t.lang}{t.dub ? ' · dub next' : ''}</span>
                  </div>
                  {t.title && <p className="text-[13px] font-medium" style={label}>{t.title}</p>}
                  {t.description && <p className="text-[12px] mt-0.5 line-clamp-3" style={muted}>{t.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
