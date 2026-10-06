'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Outreach (Labs). Four steps on one page:
//   1. Core message + daily cap (20 to start).
//   2. Find brands: SCOUT reads TRYBE's Discover Brands in your signed-in tab.
//   3. Prepare drafts: MVP reads each brand's website and rewrites the core
//      message for that brand and its products. You skim, edit or skip.
//   4. Send all: SCOUT presses Request to Join for each, 45 to 120 seconds
//      apart with a longer pause every five, and stops at the daily cap.
//
// What each row shows is what happened: "Sent" only when SCOUT saw TRYBE close
// the request box, "Not confirmed" when Send Request was pressed and TRYBE did
// not show it closing (it stays counted until you check), "Already requested"
// when TRYBE itself said so.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Sparkles, Send, Square, ExternalLink, Check, AlertTriangle, Globe, Star, Handshake, RotateCcw } from 'lucide-react'
import { requestTrybeAccess, requestTrybeScan, requestTrybeSend } from '@/lib/extension-frame'
import { nextGapMs } from '@/lib/trybe-outreach'

const PURPLE = '#7C3AED'

interface Brand {
  brand_id: string
  name: string
  categories: string[] | null
  website: string | null
  about: string | null
  pay_text: string | null
  rating: number | null
  reviews: number | null
  creator_earnings: string | null
  total_creators: number | null
  trybe_score: number | null
  site_summary: string | null
  site_products: string[] | null
  site_error: string | null
  status: 'new' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already'
  draft: string | null
  sent_at: string | null
  send_started_at: string | null
  error: string | null
  worked_with: boolean
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'

const STARTER = `Hi! I'm an Amazon Influencer who makes short, real-life product videos that show the item in real use. I'd love to create UGC for you. I can turn around a first video within a week, and I'm happy to start with one so you can see the fit. Looking forward to working together!`

function priority(b: Brand): number {
  return (b.worked_with ? 1000 : 0) + (b.trybe_score ?? 0) + (b.pay_text ? Math.min(50, parseFloat((b.pay_text.match(/[\d.]+/) || ['0'])[0]) || 0) : 0)
}

async function api(body?: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const d = await r.json().catch(() => ({}))
  if (!r.ok && !d.capped) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

export default function TrybeOutreach() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [core, setCore] = useState('')
  const [cap, setCap] = useState(20)
  const [used, setUsed] = useState(0)
  const [savingSettings, setSavingSettings] = useState(false)
  const [access, setAccess] = useState<Access>('checking')
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [drafting, setDrafting] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [waitUntil, setWaitUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const stopRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const d = await api()
      setBrands(d.brands || [])
      setCore(c => c || d.settings?.coreMessage || '')
      setCap(d.settings?.dailyCap ?? 20)
      setUsed(d.usedToday ?? 0)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void requestTrybeAccess(false).then(r => setAccess(r.state)) }, [])
  useEffect(() => {
    if (!waitUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waitUntil])

  const queue = useMemo(() => brands.filter(b => b.status === 'drafted' && b.draft).sort((a, b) => priority(b) - priority(a)), [brands])
  const fresh = useMemo(() => brands.filter(b => b.status === 'new').sort((a, b) => priority(b) - priority(a)), [brands])
  const history = useMemo(() => brands.filter(b => ['sent', 'sending', 'failed', 'already'].includes(b.status))
    .sort((a, b) => Date.parse(b.send_started_at || b.sent_at || '0') - Date.parse(a.send_started_at || a.sent_at || '0')), [brands])
  const remaining = Math.max(0, cap - used)

  function patch(id: string, p: Partial<Brand>) { setBrands(bs => bs.map(b => b.brand_id === id ? { ...b, ...p } : b)) }

  async function saveSettings() {
    setSavingSettings(true)
    try {
      const d = await api({ action: 'settings', coreMessage: core, dailyCap: cap })
      setCap(d.settings.dailyCap)
      toast.success('Saved')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed') }
    finally { setSavingSettings(false) }
  }

  async function allow() {
    const r = await requestTrybeAccess(true)
    setAccess(r.state)
    if (r.state === 'granted') toast.success('SCOUT can work in TRYBE now')
  }

  async function scan() {
    setScanning(true); setScanNote(null)
    try {
      const res = await requestTrybeScan(brands.map(b => b.name), 30)
      if (!res.ok) {
        const why: Record<string, string> = {
          'no-access': 'SCOUT is not allowed on TRYBE yet. Press Allow SCOUT on TRYBE.',
          'not-signed-in': 'TRYBE opened its sign-in page. Sign in to TRYBE in this browser, then try again.',
          'discover-not-found': 'SCOUT could not find Discover Brands. TRYBE may have changed the page.',
          'no-rows': 'SCOUT opened Discover Brands but saw no brand rows on it.',
        }
        setScanNote(why[res.error || ''] || `SCOUT could not read TRYBE: ${res.error || 'no answer'}.`)
      }
      const got = res.brands || []
      if (got.length) {
        const d = await api({ action: 'import', brands: got })
        const failed = res.failures?.length ? ` ${res.failures.length} could not be read (${res.failures.slice(0, 3).map(f => f.name).join(', ')}${res.failures.length > 3 ? '...' : ''}).` : ''
        setScanNote(`Read ${got.length} brands: ${d.added} new, ${d.already} TRYBE already shows as requested.${failed}`)
      } else if (res.ok) {
        setScanNote(res.failures?.length
          ? `SCOUT listed ${res.listed} brands but could not read any of their popups (${res.failures[0].error}).`
          : `No brands you have not seen yet (${res.listed ?? 0} listed).`)
      }
      await load()
    } catch (e) { setScanNote(e instanceof Error ? e.message : 'Scan failed') }
    finally { setScanning(false) }
  }

  async function prepare() {
    if (!core.trim()) { toast.error('Write your core message first'); return }
    await api({ action: 'settings', coreMessage: core, dailyCap: cap }).catch(() => null)
    // Enough for today's remaining sends, and never more than 50 at once.
    const want = Math.max(0, Math.min(50, remaining) - queue.length)
    const pick = fresh.slice(0, want)
    if (!pick.length) { toast.message(want ? 'No new brands to draft. Find brands first.' : 'The queue already covers today.'); return }
    setDrafting({ done: 0, total: pick.length })
    let failed = 0
    for (let i = 0; i < pick.length; i += 4) {
      const chunk = pick.slice(i, i + 4).map(b => b.brand_id)
      try {
        const d = await api({ action: 'draft', brandIds: chunk })
        failed += (d.results || []).filter((r: { ok: boolean }) => !r.ok).length
      } catch (e) { failed += chunk.length; toast.error(e instanceof Error ? e.message : 'Draft failed'); break }
      setDrafting({ done: Math.min(pick.length, i + 4), total: pick.length })
    }
    setDrafting(null)
    if (failed) toast.error(`${failed} draft${failed === 1 ? '' : 's'} failed`)
    await load()
  }

  async function saveDraft(b: Brand, text: string) {
    if (text === b.draft) return
    patch(b.brand_id, { draft: text })
    await api({ action: 'edit', brandId: b.brand_id, draft: text }).catch(e => toast.error(e.message))
  }

  async function skip(b: Brand, undo = false) {
    const d = await api({ action: undo ? 'unskip' : 'skip', brandId: b.brand_id }).catch(e => { toast.error(e.message); return null })
    if (d?.status) patch(b.brand_id, { status: d.status })
  }

  async function requeue(b: Brand) {
    await api({ action: 'edit', brandId: b.brand_id, draft: b.draft || '' }).catch(e => toast.error(e.message))
    await load()
  }

  async function settle(b: Brand, went: boolean) {
    await api({ action: 'reset', brandId: b.brand_id, went }).catch(e => toast.error(e.message))
    await load()
  }

  async function sendAll() {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); return }
    const list = queue.slice(0, remaining)
    if (!list.length) return
    stopRef.current = false
    setRunning(true)
    let sentThisRun = 0
    let lastFailed = false
    try {
      for (let i = 0; i < list.length; i++) {
        if (stopRef.current) break
        const b = list[i]
        const c = await api({ action: 'claim', brandId: b.brand_id }).catch(e => ({ ok: false, error: e.message }))
        if (c.capped) { toast.message(`Daily cap reached (${c.usedToday} of ${c.dailyCap} in the last 24 hours)`); break }
        if (!c.ok) { patch(b.brand_id, { error: c.error }); continue }
        setUsed(c.usedToday)
        setCurrent(b.brand_id)
        patch(b.brand_id, { status: 'sending', send_started_at: new Date().toISOString(), error: null })
        const res = await requestTrybeSend(c.url, c.name, c.message)
        await api({ action: 'result', brandId: b.brand_id, outcome: res.outcome, error: res.error ? `${res.error}${res.steps?.length ? ` (got to: ${res.steps[res.steps.length - 1]})` : ''}` : null }).catch(() => null)
        patch(b.brand_id, {
          status: res.outcome === 'sent' ? 'sent' : res.outcome === 'already' ? 'already' : res.outcome === 'failed' ? 'failed' : 'sending',
          error: res.outcome === 'sent' || res.outcome === 'already' ? null : (res.error || 'Not confirmed'),
        })
        if (res.outcome === 'failed') setUsed(u => Math.max(0, u - 1))
        if (res.outcome === 'already') setUsed(u => Math.max(0, u - 1))
        setCurrent(null)
        // Two failures in a row usually mean TRYBE changed or signed out: stop.
        if (res.outcome === 'failed' && lastFailed) {
          toast.error('Two sends in a row failed, so SCOUT stopped. Check the errors below.')
          break
        }
        lastFailed = res.outcome === 'failed'
        if (res.outcome === 'sent') sentThisRun++
        if (i < list.length - 1 && !stopRef.current) {
          const gap = nextGapMs(sentThisRun)
          setWaitUntil(Date.now() + gap); setNow(Date.now())
          const end = Date.now() + gap
          while (Date.now() < end && !stopRef.current) await new Promise(r => setTimeout(r, 500))
          setWaitUntil(null)
        }
      }
    } finally {
      setRunning(false); setCurrent(null); setWaitUntil(null)
      await load()
    }
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={16} className="animate-spin" /></div>

  const card = 'rounded-2xl border p-5'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const soft = { color: 'var(--text-soft)' }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5" style={{ color: 'var(--text)' }}>
      <div>
        <h1 className="text-[22px] font-bold flex items-center gap-2"><Handshake size={20} style={{ color: PURPLE }} /> TRYBE Outreach <span className="text-[11px] font-semibold rounded px-1.5 py-0.5" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>Labs</span></h1>
        <p className="text-[13px] mt-1" style={soft}>SCOUT finds brands on TRYBE, MVP writes a first message for each from its website, you approve the queue, and SCOUT sends the requests slowly.</p>
      </div>

      {/* Status */}
      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <span><b>{used}</b> of <b>{cap}</b> sent in the last 24 hours</span>
          <span style={soft}>{queue.length} in the queue, {fresh.length} found and not drafted</span>
          <span className="ml-auto">
            {access === 'granted' && <span className="inline-flex items-center gap-1" style={{ color: '#16A34A' }}><Check size={14} /> SCOUT can work in TRYBE</span>}
            {access === 'checking' && <span style={soft}>Checking SCOUT...</span>}
            {access === 'no-scout' && <span style={{ color: '#DC2626' }}>SCOUT is not installed in this browser</span>}
            {access === 'old' && <span style={{ color: '#DC2626' }}>SCOUT needs an update for TRYBE</span>}
            {access === 'not-granted' && <button onClick={() => void allow()} className={btn} style={{ background: PURPLE, color: '#fff' }}>Allow SCOUT on TRYBE</button>}
          </span>
        </div>
      </div>

      {/* 1. Core message */}
      <div className={card} style={cardStyle}>
        <p className="text-[14px] font-semibold">1. Your core message</p>
        <p className="text-[12px] mb-2" style={soft}>MVP keeps its points and voice, and rewrites it for each brand and its products. Your Outreach Profile is used too.</p>
        <textarea value={core} onChange={e => setCore(e.target.value)} rows={5} placeholder={STARTER}
          className="w-full rounded-lg border p-3 text-[13px]" style={{ borderColor: 'var(--border)', background: 'var(--bg, transparent)' }} />
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {!core.trim() && <button onClick={() => setCore(STARTER)} className={btn} style={{ border: '1px solid var(--border)' }}>Use the starter</button>}
          <label className="text-[13px] flex items-center gap-2">Daily cap
            <input type="number" min={1} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} className="w-16 rounded border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
          </label>
          <button onClick={() => void saveSettings()} disabled={savingSettings} className={btn} style={{ background: PURPLE, color: '#fff' }}>{savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
        </div>
      </div>

      {/* 2 + 3. Find and draft */}
      <div className={card} style={cardStyle}>
        <p className="text-[14px] font-semibold">2. Find brands, then prepare the drafts</p>
        <p className="text-[12px] mb-3" style={soft}>Be signed in to TRYBE in this browser. SCOUT opens Discover Brands in a tab, reads up to 30 brands you have not seen, then brings you back here. Brands you already promote come first.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void scan()} disabled={scanning || running || access !== 'granted'} className={btn} style={{ border: '1px solid var(--border)' }}>
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} {scanning ? 'SCOUT is reading TRYBE...' : 'Find brands'}
          </button>
          <button onClick={() => void prepare()} disabled={!!drafting || running || !fresh.length} className={btn} style={{ background: PURPLE, color: '#fff' }}>
            {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {drafting ? `Drafting ${drafting.done} of ${drafting.total}...` : `Prepare drafts (${Math.min(fresh.length, Math.max(0, Math.min(50, remaining) - queue.length))})`}
          </button>
        </div>
        {scanNote && <p className="text-[12px] mt-2">{scanNote}</p>}
      </div>

      {/* 4. Queue */}
      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <p className="text-[14px] font-semibold">3. Morning queue ({queue.length})</p>
          <div className="ml-auto flex items-center gap-2">
            {running && waitUntil && <span className="text-[12px]" style={soft}>Next request in {Math.max(0, Math.ceil((waitUntil - now) / 1000))}s</span>}
            {running
              ? <button onClick={() => { stopRef.current = true }} className={btn} style={{ border: '1px solid var(--border)' }}><Square size={13} /> Stop</button>
              : <button onClick={() => void sendAll()} disabled={!queue.length || !remaining || access !== 'granted'} className={btn} style={{ background: PURPLE, color: '#fff' }}><Send size={13} /> Send all ({Math.min(queue.length, remaining)})</button>}
          </div>
        </div>
        {running && <p className="text-[12px] mb-3" style={{ color: '#B45309' }}>Keep this tab open. SCOUT opens TRYBE for each request and brings you back, 45 seconds to 2 minutes apart, with a longer pause every five.</p>}
        {!remaining && <p className="text-[12px] mb-3" style={soft}>Today&rsquo;s cap is used. The queue waits for tomorrow.</p>}
        {!queue.length && <p className="text-[13px]" style={soft}>Nothing drafted yet.</p>}
        <div className="space-y-3">
          {queue.map(b => <QueueRow key={b.brand_id} b={b} busy={current === b.brand_id} disabled={running} onSave={t => void saveDraft(b, t)} onSkip={() => void skip(b)} />)}
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold mb-2">Sent and tried</p>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {history.map(b => (
              <div key={b.brand_id} className="py-2 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium">{b.name}</span>
                {b.status === 'sent' && <span className="inline-flex items-center gap-1" style={{ color: '#16A34A' }}><Check size={13} /> Sent {b.sent_at ? new Date(b.sent_at).toLocaleString() : ''}</span>}
                {b.status === 'already' && <span style={soft}>Already requested on TRYBE</span>}
                {b.status === 'failed' && (
                  <span className="inline-flex flex-wrap items-center gap-2" style={{ color: '#DC2626' }}>
                    <AlertTriangle size={13} /> Not sent: {b.error}
                    {!running && b.draft && <button onClick={() => void requeue(b)} className="underline">Queue it again</button>}
                  </span>
                )}
                {b.status === 'sending' && current !== b.brand_id && (
                  <span className="inline-flex flex-wrap items-center gap-2" style={{ color: '#B45309' }}>
                    <AlertTriangle size={13} /> Not confirmed{b.error ? `: ${b.error}` : ''}. Is it in TRYBE&rsquo;s Pending Requests?
                    <button onClick={() => void settle(b, true)} className="underline">Yes, it went</button>
                    <button onClick={() => void settle(b, false)} className="underline">No, queue it again</button>
                  </span>
                )}
                {b.status === 'sending' && current === b.brand_id && <span className="inline-flex items-center gap-1" style={soft}><Loader2 size={13} className="animate-spin" /> Sending now</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {brands.some(b => b.status === 'skipped') && (
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold mb-2">Skipped</p>
          <div className="flex flex-wrap gap-2">
            {brands.filter(b => b.status === 'skipped').map(b => (
              <button key={b.brand_id} onClick={() => void skip(b, true)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]" style={{ borderColor: 'var(--border)' }}>
                <RotateCcw size={11} /> {b.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QueueRow({ b, busy, disabled, onSave, onSkip }: { b: Brand; busy: boolean; disabled: boolean; onSave: (t: string) => void; onSkip: () => void }) {
  const [text, setText] = useState(b.draft || '')
  useEffect(() => { setText(b.draft || '') }, [b.draft])
  const researched = !!(b.site_summary || (b.site_products && b.site_products.length))
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: busy ? PURPLE : 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] mb-1.5">
        <span className="font-semibold">{b.name}</span>
        {b.worked_with && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: '#16A34A' }}>You already promote them</span>}
        {b.pay_text && <span className="text-[12px]" style={{ color: PURPLE }}>{b.pay_text}</span>}
        {b.trybe_score != null && <span className="text-[12px] inline-flex items-center gap-0.5" style={{ color: 'var(--text-soft)' }}><Star size={11} /> Score {b.trybe_score}</span>}
        {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-[12px] inline-flex items-center gap-0.5" style={{ color: 'var(--text-soft)' }}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
        <span className="ml-auto text-[11px]" style={{ color: researched ? '#16A34A' : '#B45309' }}>
          {researched ? `Written from their website${b.site_products?.length ? `, ${b.site_products.length} products seen` : ''}` : `Website not read${b.site_error ? `: ${b.site_error}` : ''}`}
        </span>
      </div>
      {b.categories && b.categories.length > 0 && <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-soft)' }}>{b.categories.join(' • ')}</p>}
      <textarea value={text} onChange={e => setText(e.target.value)} onBlur={() => onSave(text)} rows={4} disabled={disabled}
        className="w-full rounded-lg border p-2.5 text-[13px]" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
      <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--text-soft)' }}>
        <span>{text.length} characters</span>
        {b.error && <span style={{ color: '#DC2626' }}>Last try: {b.error}</span>}
        {busy && <span className="inline-flex items-center gap-1" style={{ color: PURPLE }}><Loader2 size={11} className="animate-spin" /> Sending now</span>}
        <button onClick={onSkip} disabled={disabled} className="ml-auto underline disabled:opacity-50">Skip</button>
      </div>
    </div>
  )
}
