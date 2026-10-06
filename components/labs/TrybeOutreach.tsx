'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Outreach (Labs). Seb's flow, 2026-10-06:
//   1. Write the core message: the idea of what goes out. Line breaks are kept.
//   2. Pick categories and keywords. SCOUT searches TRYBE for the keywords and
//      presses the categories as TRYBE's own filters; MVP reads each brand's
//      TRYBE profile and website and judges whether it fits. "Not just blindly
//      message all brands."
//   3. The brands that fit are listed, best first, with why. Tick and draft.
//   Morning queue, its own tab: every day, when this page is opened, MVP and
//   SCOUT find up to 20 new brands that fit and draft them. You skim and press
//   Send all; SCOUT presses Request to Join for each, 45 to 120 seconds apart.
//
// What each row shows is what happened: "Sent" only when SCOUT saw TRYBE close
// the request box, "Not confirmed" when Send Request was pressed and TRYBE did
// not show it closing, "Already requested" when TRYBE itself said so. Every
// step of a send run is written in the run log, so a run that could not start
// says why instead of looking like nothing happened.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Sparkles, Send, Square, ExternalLink, Check, AlertTriangle, Globe, Star, Handshake, RotateCcw, X, Plus } from 'lucide-react'
import { requestTrybeAccess, requestTrybeScan, requestTrybeSend, type TrybeScanPass } from '@/lib/extension-frame'
import { nextGapMs, prefsKey, CATEGORY_SUGGESTIONS, DAILY_FIND, SCAN_READ } from '@/lib/trybe-outreach'
import { SCOUT_TRYBE_FIND_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'

const PURPLE = '#7C3AED'
/** Where to join TRYBE, free (MVP's referral link). */
const TRYBE_JOIN_URL = 'https://jointrybe.com/r/HTLEJE47'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

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
  status: 'new' | 'not_fit' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already'
  draft: string | null
  sent_at: string | null
  send_started_at: string | null
  error: string | null
  worked_with: boolean
  fit_score?: number | null
  fit_reason?: string | null
  fit_prefs?: string | null
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'
type Tab = 'find' | 'queue' | 'sent'
interface LogLine { at: number; name: string; text: string; tone: 'ok' | 'warn' | 'bad' | 'info' }

const STARTER = `Hi! I'm an Amazon Influencer who makes short, real-life product videos that show the item in real use. I'd love to create UGC for you.

I can turn around a first video within a week, and I'm happy to start with one so you can see the fit.

Looking forward to working together!`

/** SCOUT's send codes, in words. */
const SEND_WORDS: Record<string, string> = {
  'not-signed-in': 'TRYBE is signed out in this Chrome',
  'brand-not-found': 'SCOUT could not find this brand on TRYBE',
  'message-box-not-found': 'TRYBE did not open the message box',
  'send-button-not-found': 'SCOUT could not find Send Request',
  'message-did-not-take': 'TRYBE did not take the message',
  'send-disabled': 'Send Request stayed greyed out',
  'no-access': 'SCOUT is not allowed on TRYBE',
  'bad-url': 'The brand link is not a TRYBE link',
  'no-message': 'The draft is empty',
  'no-answer-from-page': 'The TRYBE page did not answer',
}
const sendWords = (e: string | null | undefined) => {
  const raw = String(e || '')
  const code = raw.split(' (')[0]
  return SEND_WORDS[code] ? raw.replace(code, SEND_WORDS[code]) : raw
}

function priority(b: Brand): number {
  return (b.worked_with ? 1000 : 0) + (b.fit_score ?? 0) * 2 + (b.trybe_score ?? 0) + (b.pay_text ? Math.min(50, parseFloat((b.pay_text.match(/[\d.]+/) || ['0'])[0]) || 0) : 0)
}

async function api(body?: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok && !d.capped) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

function passWords(p: TrybeScanPass): string {
  if (p.kind === 'list') return `Discover list: ${p.listed} listed, ${p.read} new read`
  const what = p.kind === 'search' ? `Search "${p.term}"` : `Category "${p.term}"`
  if (!p.applied) return p.kind === 'search' ? `${what}: TRYBE's search box was not found` : `${what}: TRYBE shows no filter by that name`
  return `${what}: ${p.listed} listed, ${p.read} new read`
}

export default function TrybeOutreach() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('find')
  const [core, setCore] = useState('')
  const [cap, setCap] = useState(20)
  const [used, setUsed] = useState(0)
  const [cats, setCats] = useState<string[]>([])
  const [kws, setKws] = useState<string[]>([])
  const [kwInput, setKwInput] = useState('')
  const [savedKey, setSavedKey] = useState(prefsKey([], []))
  const [dailyFind, setDailyFind] = useState(true)
  const [lastFindAt, setLastFindAt] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [access, setAccess] = useState<Access>('checking')
  const [scoutVersion, setScoutVersion] = useState<string | null>(null)
  const [finding, setFinding] = useState<{ stage: string; done?: number; total?: number } | null>(null)
  const [findNotes, setFindNotes] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showNotFit, setShowNotFit] = useState(false)
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [waitUntil, setWaitUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [log, setLog] = useState<LogLine[]>([])
  const stopRef = useRef(false)
  const autoRan = useRef(false)

  const say = (name: string, text: string, tone: LogLine['tone']) => setLog(l => [{ at: Date.now(), name, text, tone }, ...l].slice(0, 200))

  const load = useCallback(async () => {
    try {
      const d = await api()
      setBrands(d.brands || [])
      setCore(c => c || d.settings?.coreMessage || '')
      setCap(d.settings?.dailyCap ?? 20)
      setUsed(d.usedToday ?? 0)
      const c = d.settings?.categories || [], k = d.settings?.keywords || []
      setSavedKey(prefsKey(c, k))
      setDailyFind(d.settings?.dailyFind !== false)
      setLastFindAt(d.settings?.lastFindAt ?? null)
      return d
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load'); return null }
    finally { setLoading(false) }
  }, [])

  // The niche fields are filled once from what was saved, then belong to the page.
  useEffect(() => {
    void load().then(d => {
      if (!d) return
      setCats(d.settings?.categories || [])
      setKws(d.settings?.keywords || [])
    })
  }, [load])
  useEffect(() => { void requestTrybeAccess(false).then(r => { setAccess(r.state); setScoutVersion(r.version ?? null) }) }, [])
  useEffect(() => {
    if (!waitUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waitUntil])

  const pageKey = prefsKey(cats, kws)
  const unsavedNiche = pageKey !== savedKey
  const hasNiche = cats.length > 0 || kws.length > 0
  const canSearchTrybe = scoutAtLeast(scoutVersion, SCOUT_TRYBE_FIND_MIN_VERSION)

  const queue = useMemo(() => brands.filter(b => b.status === 'drafted' && b.draft).sort((a, b) => priority(b) - priority(a)), [brands])
  const found = useMemo(() => brands.filter(b => b.status === 'new' && b.fit_prefs === savedKey).sort((a, b) => priority(b) - priority(a)), [brands, savedKey])
  const notFit = useMemo(() => brands.filter(b => b.status === 'not_fit' && b.fit_prefs === savedKey).sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0)), [brands, savedKey])
  const unjudged = useMemo(() => brands.filter(b => (b.status === 'new' || b.status === 'not_fit') && b.fit_prefs !== savedKey), [brands, savedKey])
  const history = useMemo(() => brands.filter(b => ['sent', 'sending', 'failed', 'already'].includes(b.status))
    .sort((a, b) => Date.parse(b.send_started_at || b.sent_at || '0') - Date.parse(a.send_started_at || a.sent_at || '0')), [brands])
  const remaining = Math.max(0, cap - used)

  // Categories offered: the usual ones, the ones TRYBE showed on brands found,
  // and any already picked.
  const catOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const b of brands) for (const c of b.categories || []) seen.set(c, (seen.get(c) || 0) + 1)
    const fromTrybe = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c]) => c)
    const all = [...cats, ...fromTrybe, ...CATEGORY_SUGGESTIONS]
    return all.filter((c, i) => all.findIndex(o => o.toLowerCase() === c.toLowerCase()) === i)
  }, [brands, cats])

  function patch(id: string, p: Partial<Brand>) { setBrands(bs => bs.map(b => b.brand_id === id ? { ...b, ...p } : b)) }

  async function saveSettings(quiet = false) {
    setSavingSettings(true)
    try {
      const d = await api({ action: 'settings', coreMessage: core, dailyCap: cap, categories: cats, keywords: kws, dailyFind })
      setCap(d.settings.dailyCap)
      setSavedKey(prefsKey(d.settings.categories || [], d.settings.keywords || []))
      if (!quiet) toast.success('Saved')
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); return false }
    finally { setSavingSettings(false) }
  }

  async function allow() {
    const r = await requestTrybeAccess(true)
    setAccess(r.state); setScoutVersion(r.version ?? null)
    if (r.state === 'granted') toast.success('SCOUT can work in TRYBE now')
  }

  function addKeyword() {
    const parts = kwInput.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    setKws(k => {
      const next = [...k]
      for (const p of parts) if (!next.some(o => o.toLowerCase() === p.toLowerCase()) && next.length < 12) next.push(p.slice(0, 40))
      return next
    })
    setKwInput('')
  }

  /** Draft these brands into the morning queue, four at a time. */
  async function draftIds(ids: string[]): Promise<{ ok: number; failed: number }> {
    let ok = 0, failed = 0
    setFinding({ stage: 'Writing drafts', done: 0, total: ids.length })
    for (let i = 0; i < ids.length; i += 4) {
      const chunk = ids.slice(i, i + 4)
      try {
        const d = await api({ action: 'draft', brandIds: chunk })
        for (const r of (d.results || []) as Array<{ ok: boolean }>) r.ok ? ok++ : failed++
      } catch (e) { failed += chunk.length; toast.error(e instanceof Error ? e.message : 'Draft failed'); break }
      setFinding({ stage: 'Writing drafts', done: Math.min(ids.length, i + 4), total: ids.length })
    }
    return { ok, failed }
  }

  /** Judge every brand not yet judged against the saved niche, five at a time. */
  async function judge(list: Brand[]): Promise<{ fit: number; no: number; failed: number }> {
    let fit = 0, no = 0, failed = 0
    const ids = list.map(b => b.brand_id).slice(0, 80)
    setFinding({ stage: 'Reading websites and checking fit', done: 0, total: ids.length })
    for (let i = 0; i < ids.length; i += 5) {
      const chunk = ids.slice(i, i + 5)
      try {
        const d = await api({ action: 'match', brandIds: chunk })
        for (const r of (d.results || []) as Array<{ ok: boolean; fit?: boolean }>) { if (!r.ok) failed++; else if (r.fit) fit++; else no++ }
      } catch (e) { failed += chunk.length; toast.error(e instanceof Error ? e.message : 'Fit check failed'); break }
      setFinding({ stage: 'Reading websites and checking fit', done: Math.min(ids.length, i + 5), total: ids.length })
    }
    return { fit, no, failed }
  }

  /** Find brands: SCOUT searches TRYBE, MVP judges the fit. `auto` is the
   *  daily run: it also drafts the best ones into the morning queue. */
  async function findBrands(auto = false) {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); return }
    if (!core.trim()) { toast.error('Write your core message first'); setTab('find'); return }
    if (!(await saveSettings(true))) return
    const notes: string[] = []
    setFindNotes([])
    try {
      setFinding({ stage: canSearchTrybe && hasNiche ? 'SCOUT is searching TRYBE for your keywords and categories' : 'SCOUT is reading TRYBE’s Discover Brands' })
      const res = await requestTrybeScan(brands.map(b => b.name), SCAN_READ, canSearchTrybe ? kws : [], canSearchTrybe ? cats : [])
      for (const p of res.passes || []) notes.push(passWords(p))
      if (!res.ok) {
        const why: Record<string, string> = {
          'no-access': 'SCOUT is not allowed on TRYBE yet. Press Allow SCOUT on TRYBE.',
          'not-signed-in': 'TRYBE opened its sign-in page. Sign in to TRYBE in this browser, then try again.',
          'discover-not-found': 'SCOUT could not find Discover Brands. TRYBE may have changed the page.',
          'no-rows': 'SCOUT opened Discover Brands but saw no brand rows on it.',
          timeout: 'SCOUT ran out of time reading TRYBE. What it read so far is kept.',
        }
        notes.push(why[res.error || ''] || `SCOUT could not read TRYBE: ${res.error || 'no answer'}.`)
      }
      const got = res.brands || []
      if (got.length) {
        const d = await api({ action: 'import', brands: got })
        notes.push(`SCOUT read ${got.length} brand${got.length === 1 ? '' : 's'}: ${d.added} new to MVP, ${d.already} TRYBE already shows as requested.`)
      } else if (res.ok) {
        notes.push(`No brands you have not seen yet (${res.listed ?? 0} listed on TRYBE).`)
      }
      if (res.failures?.length) notes.push(`${res.failures.length} could not be opened on TRYBE (${res.failures.slice(0, 3).map(f => f.name).join(', ')}${res.failures.length > 3 ? '...' : ''}).`)
      const d = await load()
      const all: Brand[] = d?.brands || brands
      const key = prefsKey(d?.settings?.categories || cats, d?.settings?.keywords || kws)
      const toJudge = all.filter(b => (b.status === 'new' || b.status === 'not_fit') && b.fit_prefs !== key)
      if (toJudge.length) {
        const j = await judge(toJudge)
        notes.push(hasNiche
          ? `MVP checked ${j.fit + j.no} against your niche: ${j.fit} fit, ${j.no} do not.${j.failed ? ` ${j.failed} could not be checked and are tried again next time.` : ''}`
          : `${j.fit} listed. Pick categories or keywords so MVP only lists brands that fit.`)
      }
      const after = await load()
      const list: Brand[] = ((after?.brands || []) as Brand[]).filter(b => b.status === 'new' && b.fit_prefs === key).sort((a, b) => priority(b) - priority(a))
      setSelected(new Set(list.slice(0, DAILY_FIND).map(b => b.brand_id)))
      if (auto) {
        const room = Math.max(0, DAILY_FIND - ((after?.brands || []) as Brand[]).filter(b => b.status === 'drafted').length)
        const pick = list.slice(0, room).map(b => b.brand_id)
        if (pick.length) {
          const r = await draftIds(pick)
          notes.push(`Today's drafts: ${r.ok} added to the morning queue${r.failed ? `, ${r.failed} could not be written` : ''}.`)
        } else notes.push(room ? 'No new brands that fit today, so nothing was added to the queue.' : 'The morning queue already holds today’s 20.')
        await api({ action: 'found' }).catch(() => null)
        setLastFindAt(new Date().toISOString())
        await load()
        setTab('queue')
      }
    } catch (e) {
      notes.push(e instanceof Error ? e.message : 'Finding brands failed.')
    } finally {
      setFinding(null)
      setFindNotes(notes)
    }
  }

  // THE DAILY FIND. Once a day, when this page is opened with SCOUT allowed
  // and a niche saved, MVP and SCOUT find and draft up to 20 brands that fit.
  useEffect(() => {
    if (loading || autoRan.current || access !== 'granted' || !dailyFind || running || finding) return
    if (!core.trim() || savedKey === prefsKey([], [])) return
    const last = lastFindAt ? Date.parse(lastFindAt) : 0
    if (Date.now() - last < 20 * 3600_000) return
    autoRan.current = true
    toast('Finding today’s brands that fit your niche. SCOUT opens TRYBE for a few minutes, then brings you back.', { duration: 9000 })
    void findBrands(true)
  }, [loading, access, dailyFind, lastFindAt, savedKey, core]) // eslint-disable-line react-hooks/exhaustive-deps

  async function draftSelected() {
    const ids = found.filter(b => selected.has(b.brand_id)).map(b => b.brand_id)
    if (!ids.length) { toast.message('Tick the brands to draft first.'); return }
    if (!core.trim()) { toast.error('Write your core message first'); return }
    await api({ action: 'settings', coreMessage: core, dailyCap: cap }).catch(() => null)
    const r = await draftIds(ids)
    setFinding(null)
    if (r.failed) toast.error(`${r.failed} draft${r.failed === 1 ? '' : 's'} could not be written`)
    if (r.ok) { toast.success(`${r.ok} added to the morning queue`); setTab('queue') }
    setSelected(new Set())
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
    // EVERY STOP SAYS WHY (2026-10-06: "it didn't do anything when i clicked
    // send all"). A send that could not start used to note it on a row the
    // reload then wiped, so a run could end with nothing on screen.
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); say('Send all', 'Not started: SCOUT is not allowed on TRYBE yet.', 'bad'); return }
    const list = queue.slice(0, remaining)
    if (!list.length) { say('Send all', remaining ? 'Nothing in the queue to send.' : 'Today’s cap is used. The queue waits for tomorrow.', 'warn'); return }
    stopRef.current = false
    setRunning(true)
    say('Send all', `Starting: ${list.length} request${list.length === 1 ? '' : 's'}, one at a time. Keep this tab open.`, 'info')
    let sentThisRun = 0
    let lastFailed = false
    try {
      for (let i = 0; i < list.length; i++) {
        if (stopRef.current) { say('Send all', 'Stopped.', 'warn'); break }
        const b = list[i]
        const c = await api({ action: 'claim', brandId: b.brand_id }).catch(e => ({ ok: false, error: e.message }))
        if (c.capped) { say('Send all', `Daily cap reached (${c.usedToday} of ${c.dailyCap} in the last 24 hours).`, 'warn'); toast.message('Daily cap reached'); break }
        if (!c.ok) { say(b.name, `Not started: ${c.error || 'MVP could not reserve it'}.`, 'bad'); toast.error(`${b.name}: ${c.error || 'could not start'}`); continue }
        setUsed(c.usedToday)
        setCurrent(b.brand_id)
        patch(b.brand_id, { status: 'sending', send_started_at: new Date().toISOString(), error: null })
        say(b.name, 'SCOUT is opening TRYBE to send it.', 'info')
        const res = await requestTrybeSend(c.url, c.name, c.message)
        const err = res.error ? `${res.error}${res.steps?.length ? ` (got to: ${res.steps[res.steps.length - 1]})` : ''}` : null
        const saved = await api({ action: 'result', brandId: b.brand_id, outcome: res.outcome, error: err }).then(() => true).catch(() => false)
        patch(b.brand_id, {
          status: res.outcome === 'sent' ? 'sent' : res.outcome === 'already' ? 'already' : res.outcome === 'failed' ? 'failed' : 'sending',
          error: res.outcome === 'sent' || res.outcome === 'already' ? null : (err || 'Not confirmed'),
        })
        if (res.outcome === 'sent') say(b.name, 'Sent. TRYBE closed the request box.', 'ok')
        else if (res.outcome === 'already') say(b.name, 'TRYBE already shows a request to this brand.', 'warn')
        else if (res.outcome === 'failed') say(b.name, `Not sent: ${sendWords(err) || 'SCOUT could not send it'}.`, 'bad')
        else say(b.name, `Not confirmed: ${sendWords(err) || 'TRYBE did not show the box closing'}. Check TRYBE's Pending Requests.`, 'warn')
        if (!saved) say(b.name, 'MVP could not save this result. Reload before sending again.', 'bad')
        if (res.outcome === 'failed' || res.outcome === 'already') setUsed(u => Math.max(0, u - 1))
        setCurrent(null)
        // Two failures in a row usually mean TRYBE changed or signed out: stop.
        if (res.outcome === 'failed' && lastFailed) {
          say('Send all', 'Two sends in a row failed, so SCOUT stopped.', 'bad')
          toast.error('Two sends in a row failed, so SCOUT stopped. See the run log.')
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
      say('Send all', `Done: ${sentThisRun} sent.`, sentThisRun ? 'ok' : 'warn')
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
  const busy = !!finding || running
  const sendBlocked = access !== 'granted' ? 'Allow SCOUT on TRYBE first.' : !remaining ? 'Today’s cap is used.' : !queue.length ? 'Nothing drafted yet.' : null
  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)} className="px-3.5 py-2 text-[13px] font-semibold rounded-lg"
      style={tab === id ? { background: PURPLE, color: '#fff' } : { color: 'var(--text)', border: '1px solid var(--border)' }}>{label}</button>
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5" style={{ color: 'var(--text)' }}>
      <div>
        <h1 className="text-[22px] font-bold flex items-center gap-2"><Handshake size={20} style={{ color: PURPLE }} /> TRYBE Outreach <span className="text-[11px] font-semibold rounded px-1.5 py-0.5" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>Labs</span></h1>
        <p className="text-[13px] mt-1" style={soft}>Tell MVP your niche. SCOUT finds brands on TRYBE, MVP checks each one against your niche from its website, writes a first message, and SCOUT sends the ones you approve, slowly.</p>
        {/* Not on TRYBE yet: where to join, in plain sight (Seb, 2026-10-06).
            MVP's referral link, and it says so. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5" style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.06)' }}>
          <span className="text-[13px]"><b>Not on TRYBE yet?</b> Joining is free. Sign up, then come back here signed in.</span>
          <a href={TRYBE_JOIN_URL} target="_blank" rel="sponsored noopener noreferrer" className={`${btn} ml-auto`} style={{ background: PURPLE, color: '#fff' }}>
            Join TRYBE free <ExternalLink size={12} />
          </a>
          <span className="w-full text-[11px]" style={soft}>This is MVP&rsquo;s referral link.</span>
        </div>
      </div>

      {/* Status */}
      <div className={card} style={cardStyle}>
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <span><b>{used}</b> of <b>{cap}</b> sent in the last 24 hours</span>
          <span style={soft}>{queue.length} in the morning queue, {found.length} found that fit</span>
          <span className="ml-auto">
            {access === 'granted' && <span className="inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={14} /> SCOUT can work in TRYBE</span>}
            {access === 'checking' && <span style={soft}>Checking SCOUT...</span>}
            {access === 'no-scout' && <span style={{ color: RED }}>SCOUT is not installed in this browser</span>}
            {access === 'old' && <span style={{ color: RED }}>SCOUT needs an update for TRYBE</span>}
            {access === 'not-granted' && <button onClick={() => void allow()} className={btn} style={{ background: PURPLE, color: '#fff' }}>Allow SCOUT on TRYBE</button>}
          </span>
        </div>
        {finding && (
          <p className="text-[12px] mt-2 inline-flex items-center gap-1.5" style={{ color: PURPLE }}>
            <Loader2 size={12} className="animate-spin" /> {finding.stage}{finding.total ? ` (${finding.done ?? 0} of ${finding.total})` : '...'}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <TabBtn id="find" label="Find brands" />
        <TabBtn id="queue" label={`Morning queue (${queue.length})`} />
        <TabBtn id="sent" label={`Sent (${history.length})`} />
      </div>

      {tab === 'find' && (<>
        {/* 1. Core message */}
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold">1. Your core message</p>
          <p className="text-[12px] mb-2" style={soft}>The idea of what goes out. MVP keeps its points and voice, rewrites it for each brand and its products, and keeps your line breaks and sign-off as you write them.</p>
          <textarea value={core} onChange={e => setCore(e.target.value)} rows={7} placeholder={STARTER}
            className="w-full rounded-lg border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg, transparent)' }} />
          {!core.trim() && <button onClick={() => setCore(STARTER)} className={`${btn} mt-2`} style={{ border: '1px solid var(--border)' }}>Use the starter</button>}
        </div>

        {/* 2. Niche */}
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold">2. Your niche</p>
          <p className="text-[12px] mb-3" style={soft}>Pick categories and add keywords. SCOUT searches TRYBE for them, and MVP reads each brand&rsquo;s TRYBE profile and website to check it fits before it is listed.</p>
          <p className="text-[12px] font-semibold mb-1.5">Categories</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {catOptions.map(c => {
              const on = cats.some(o => o.toLowerCase() === c.toLowerCase())
              return (
                <button key={c} onClick={() => setCats(cs => on ? cs.filter(o => o.toLowerCase() !== c.toLowerCase()) : cs.length < 12 ? [...cs, c] : cs)}
                  className="rounded-full border px-2.5 py-1 text-[12px] inline-flex items-center gap-1"
                  style={on ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)' }}>
                  {on && <Check size={11} />} {c}
                </button>
              )
            })}
          </div>
          <p className="text-[12px] font-semibold mb-1.5">Keywords</p>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {kws.map(k => (
              <span key={k} className="rounded-full px-2.5 py-1 text-[12px] inline-flex items-center gap-1" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>
                {k} <button onClick={() => setKws(ks => ks.filter(o => o !== k))} aria-label={`Remove ${k}`}><X size={11} /></button>
              </span>
            ))}
            <input value={kwInput} onChange={e => setKwInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword() } }}
              placeholder="e.g. bible journaling, kids crafts" className="rounded-lg border px-2.5 py-1 text-[12px] min-w-[14rem]" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
            <button onClick={addKeyword} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}><Plus size={12} /> Add</button>
          </div>
          {!canSearchTrybe && access === 'granted' && (
            <p className="text-[12px] mb-2" style={{ color: AMBER }}>Your SCOUT ({scoutVersion || 'unknown'}) reads TRYBE&rsquo;s plain list only. SCOUT {SCOUT_TRYBE_FIND_MIN_VERSION} also searches TRYBE for your keywords and categories. MVP still checks every brand against your niche either way.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <label className="text-[13px] flex items-center gap-2">Daily cap
              <input type="number" min={1} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} className="w-16 rounded border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
            </label>
            <label className="text-[13px] flex items-center gap-2">
              <input type="checkbox" checked={dailyFind} onChange={e => setDailyFind(e.target.checked)} className="accent-[#7C3AED]" />
              Find {DAILY_FIND} new brands every day when I open this page
            </label>
            <button onClick={() => void saveSettings()} disabled={savingSettings} className={btn} style={{ background: PURPLE, color: '#fff' }}>{savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
            {unsavedNiche && <span className="text-[12px]" style={{ color: AMBER }}>Niche not saved yet. Find brands saves it.</span>}
          </div>
        </div>

        {/* 3. Found */}
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-[14px] font-semibold">3. Brands that fit ({found.length})</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => void findBrands(false)} disabled={busy || access !== 'granted'} className={btn} style={{ border: '1px solid var(--border)' }}>
                {finding ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find brands
              </button>
              <button onClick={() => void draftSelected()} disabled={busy || !found.some(b => selected.has(b.brand_id))} className={btn} style={{ background: PURPLE, color: '#fff' }}>
                <Sparkles size={13} /> Draft {found.filter(b => selected.has(b.brand_id)).length} into the morning queue
              </button>
            </div>
          </div>
          <p className="text-[12px] mb-3" style={soft}>Be signed in to TRYBE in this browser. SCOUT opens TRYBE in a tab for a few minutes and brings you back here. Best fits first; the top {DAILY_FIND} are ticked.</p>
          {findNotes.length > 0 && (
            <ul className="text-[12px] mb-3 space-y-0.5">{findNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {unjudged.length > 0 && !finding && (
            <p className="text-[12px] mb-3" style={{ color: AMBER }}>{unjudged.length} brand{unjudged.length === 1 ? '' : 's'} not yet checked against this niche. <button onClick={() => void judge(unjudged).then(() => load())} className="underline">Check them now</button></p>
          )}
          {!found.length && <p className="text-[13px]" style={soft}>{hasNiche ? 'No brands that fit yet. Press Find brands.' : 'Pick your niche, then press Find brands.'}</p>}
          <div className="space-y-2">
            {found.map(b => (
              <label key={b.brand_id} className="flex gap-3 rounded-xl border p-3 cursor-pointer" style={{ borderColor: selected.has(b.brand_id) ? PURPLE : 'var(--border)' }}>
                <input type="checkbox" className="mt-1 accent-[#7C3AED]" checked={selected.has(b.brand_id)}
                  onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(b.brand_id); else n.delete(b.brand_id); return n })} />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-semibold">{b.name}</span>
                    {b.fit_score != null && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>Fit {b.fit_score}</span>}
                    {b.worked_with && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>You already promote them</span>}
                    {b.pay_text && <span className="text-[12px]" style={{ color: PURPLE }}>{b.pay_text}</span>}
                    {b.trybe_score != null && <span className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Star size={11} /> Score {b.trybe_score}</span>}
                    {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
                  </span>
                  {b.fit_reason && <span className="block text-[12px] mt-0.5">{b.fit_reason}</span>}
                  {b.categories && b.categories.length > 0 && <span className="block text-[11px] mt-0.5" style={soft}>{b.categories.join(' • ')}</span>}
                </span>
                <button onClick={e => { e.preventDefault(); void skip(b) }} className="self-start text-[11px] underline" style={soft}>Skip</button>
              </label>
            ))}
          </div>
          {notFit.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowNotFit(v => !v)} className="text-[12px] underline" style={soft}>{showNotFit ? 'Hide' : 'Show'} {notFit.length} that do not fit</button>
              {showNotFit && (
                <div className="mt-2 space-y-1.5">
                  {notFit.map(b => (
                    <div key={b.brand_id} className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-medium">{b.name}</span>
                      <span style={soft}>{b.fit_reason || 'Not a fit.'}</span>
                      <button onClick={() => void skip(b, true).then(() => load())} className="underline" style={{ color: PURPLE }}>Use anyway</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </>)}

      {tab === 'queue' && (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <p className="text-[14px] font-semibold">Morning queue ({queue.length})</p>
            <div className="ml-auto flex items-center gap-2">
              {running && waitUntil && <span className="text-[12px]" style={soft}>Next request in {Math.max(0, Math.ceil((waitUntil - now) / 1000))}s</span>}
              {running
                ? <button onClick={() => { stopRef.current = true }} className={btn} style={{ border: '1px solid var(--border)' }}><Square size={13} /> Stop</button>
                : <button onClick={() => void sendAll()} disabled={!!finding} className={btn} style={{ background: PURPLE, color: '#fff' }}><Send size={13} /> Send all ({Math.min(queue.length, remaining)})</button>}
            </div>
          </div>
          <p className="text-[12px] mb-3" style={soft}>
            {dailyFind
              ? <>Every day, when you open this page, MVP and SCOUT find up to {DAILY_FIND} new brands that fit your niche and draft them here.{lastFindAt ? ` Last found ${new Date(lastFindAt).toLocaleString()}.` : ''} Skim, edit or skip, then press Send all.</>
              : <>The daily find is off. Turn it on in Find brands, or find and draft brands there yourself.</>}
          </p>
          {sendBlocked && !running && <p className="text-[12px] mb-3" style={{ color: AMBER }}>{sendBlocked}</p>}
          {running && <p className="text-[12px] mb-3" style={{ color: AMBER }}>Keep this tab open. SCOUT opens TRYBE for each request and brings you back, 45 seconds to 2 minutes apart, with a longer pause every five.</p>}
          {log.length > 0 && (
            <div className="rounded-xl border p-3 mb-3 max-h-56 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[12px] font-semibold mb-1">Run log</p>
              {log.map((l, i) => (
                <p key={i} className="text-[12px]" style={{ color: l.tone === 'ok' ? GREEN : l.tone === 'bad' ? RED : l.tone === 'warn' ? AMBER : 'var(--text)' }}>
                  <span style={soft}>{new Date(l.at).toLocaleTimeString()}</span> <b>{l.name}</b>: {l.text}
                </p>
              ))}
            </div>
          )}
          {!queue.length && <p className="text-[13px]" style={soft}>Nothing drafted yet.</p>}
          <div className="space-y-3">
            {queue.map(b => <QueueRow key={b.brand_id} b={b} busy={current === b.brand_id} disabled={running} onSave={t => void saveDraft(b, t)} onSkip={() => void skip(b)} />)}
          </div>
          {brands.some(b => b.status === 'skipped') && (
            <div className="mt-4">
              <p className="text-[12px] font-semibold mb-1.5">Skipped</p>
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
      )}

      {tab === 'sent' && (
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold mb-2">Sent and tried</p>
          {!history.length && <p className="text-[13px]" style={soft}>Nothing sent yet.</p>}
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {history.map(b => (
              <div key={b.brand_id} className="py-2 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium">{b.name}</span>
                {b.status === 'sent' && <span className="inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={13} /> Sent {b.sent_at ? new Date(b.sent_at).toLocaleString() : ''}</span>}
                {b.status === 'already' && <span style={soft}>Already requested on TRYBE</span>}
                {b.status === 'failed' && (
                  <span className="inline-flex flex-wrap items-center gap-2" style={{ color: RED }}>
                    <AlertTriangle size={13} /> Not sent: {sendWords(b.error)}
                    {!running && b.draft && <button onClick={() => void requeue(b)} className="underline">Queue it again</button>}
                  </span>
                )}
                {b.status === 'sending' && current !== b.brand_id && (
                  <span className="inline-flex flex-wrap items-center gap-2" style={{ color: AMBER }}>
                    <AlertTriangle size={13} /> Not confirmed{b.error ? `: ${sendWords(b.error)}` : ''}. Is it in TRYBE&rsquo;s Pending Requests?
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
        {b.fit_score != null && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>Fit {b.fit_score}</span>}
        {b.worked_with && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>You already promote them</span>}
        {b.pay_text && <span className="text-[12px]" style={{ color: PURPLE }}>{b.pay_text}</span>}
        {b.trybe_score != null && <span className="text-[12px] inline-flex items-center gap-0.5" style={{ color: 'var(--text-soft)' }}><Star size={11} /> Score {b.trybe_score}</span>}
        {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-[12px] inline-flex items-center gap-0.5" style={{ color: 'var(--text-soft)' }}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
        <span className="ml-auto text-[11px]" style={{ color: researched ? GREEN : AMBER }}>
          {researched ? `Written from their website${b.site_products?.length ? `, ${b.site_products.length} products seen` : ''}` : `Website not read${b.site_error ? `: ${b.site_error}` : ''}`}
        </span>
      </div>
      {b.fit_reason && <p className="text-[12px] mb-1">{b.fit_reason}</p>}
      {b.categories && b.categories.length > 0 && <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-soft)' }}>{b.categories.join(' • ')}</p>}
      <textarea value={text} onChange={e => setText(e.target.value)} onBlur={() => onSave(text)} rows={8} disabled={disabled}
        className="w-full rounded-lg border p-2.5 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
      <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--text-soft)' }}>
        <span>{text.length} characters, sent as shown, line breaks included</span>
        {b.error && <span style={{ color: RED }}>Last try: {sendWords(b.error)}</span>}
        {busy && <span className="inline-flex items-center gap-1" style={{ color: PURPLE }}><Loader2 size={11} className="animate-spin" /> Sending now</span>}
        <button onClick={onSkip} disabled={disabled} className="ml-auto underline disabled:opacity-50">Skip</button>
      </div>
    </div>
  )
}
