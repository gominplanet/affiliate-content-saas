'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Outreach (Pro, in Find products since 2026-10-08). Seb's flow, 2026-10-06:
//   1. Write the core message: the idea of what goes out. Line breaks are kept.
//   2. Pick categories and keywords. SCOUT searches TRYBE for the keywords and
//      presses the categories as TRYBE's own filters; MVP reads each brand's
//      TRYBE profile and website and judges whether it fits. "Not just blindly
//      message all brands."
//   3. The brands that fit are listed, best first, with why. Tick and draft.
//   Ready to send, its own tab: every day, when this page is opened, MVP and
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
import { Loader2, Search, Sparkles, Send, Square, ExternalLink, Check, AlertTriangle, Globe, Star, Handshake, RotateCcw, X, Trash2, Tag,
  Dumbbell, Shirt, House, UtensilsCrossed, Baby, PawPrint, Gem, Cpu, Tent, Plane, BookOpen, Church, Palette, SprayCan, Moon, Pill, HeartPulse,
  Scissors, Droplet, Coffee, Leaf, Wand2, MessageCircle, Pencil, ChevronUp, type LucideIcon } from 'lucide-react'
import { requestTrybeApi, requestTrybeAccess, requestTrybeScan, requestTrybeSend, requestTrybeHarvest, type TrybeScanPass } from '@/lib/extension-frame'
import { nextGapMs, prefsKey, CATEGORY_SUGGESTIONS, DAILY_FIND, SCAN_READ, SHORT_RUN_UNDER, SHORT_GAP_MS, MAX_DAILY_CAP } from '@/lib/trybe-outreach'
import TrybeInbox, { fetchTrybeInbox, lastIsMine, type Conversation } from '@/components/labs/TrybeInbox'
import { reportTrybeInbox } from '@/lib/trybe-alerts'
import { readDiscoveryPage, requestState, acceptRate, type BrandFlags, type RequestState } from '@/lib/trybe-invites'
import TrybeLink from '@/components/labs/TrybeLink'
import { SCOUT_TRYBE_FIND_MIN_VERSION, SCOUT_TRYBE_HARVEST_MIN_VERSION, SCOUT_TRYBE_BACKGROUND_SEND_MIN_VERSION, SCOUT_TRYBE_INBOX_MIN_VERSION, SCOUT_TRYBE_OPEN_BRAND_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'

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
  status: 'new' | 'not_fit' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already' | 'removed'
  draft: string | null
  sent_at: string | null
  send_started_at: string | null
  error: string | null
  worked_with: boolean
  fit_score?: number | null
  fit_reason?: string | null
  fit_prefs?: string | null
  /** When MVP first saw this brand's TRYBE conversation (migration 419). */
  replied_at?: string | null
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'
/** MVP's copy of every TRYBE brand (shared), and how complete it is. */
interface Directory { brands: number; withWebsite: number; websitesRead: number; lastCollectedAt: string | null; lastPartial?: { at: string; pages: number | null; totalPages: number | null } | null; categories: string[] }
/** The whole list is collected again after this long. */
const RECOLLECT_MS = 20 * 3600_000
type Tab = 'find' | 'queue' | 'sent' | 'inbox'
/** One brand from MVP's copy of TRYBE, as the live list shows it. */
interface LiveBrand {
  brand_id: string; name: string; website: string | null; categories: string[]; about: string | null
  pay_text: string | null; pay_kind?: 'flat' | 'percent' | 'both' | null; trybe_score: number | null; total_creators: number | null; match: number
  first_seen_at?: string | null
  products: string[]; website_read: boolean
  /** Where it stands on this creator's own list, if it is on it. */
  status: Brand['status'] | null; fit_score: number | null; fit_reason: string | null
}
const REQUESTS_KEY = 'mvp.trybe.requests'
interface RequestsRead { at: number; complete: boolean; pages: number; flags: Record<string, BrandFlags>; invites: BrandFlags[] }
const REQUEST_WORDS: Record<RequestState, { label: string; color: string; bg: string }> = {
  accepted: { label: 'Accepted', color: GREEN, bg: 'rgba(22,163,74,0.12)' },
  pending: { label: 'Pending', color: AMBER, bg: 'rgba(180,83,9,0.10)' },
  declined: { label: 'Declined or expired', color: RED, bg: 'rgba(220,38,38,0.10)' },
}
type LiveSort = 'match' | 'pay' | 'creators' | 'fit' | 'newest'
type LivePay = 'any' | 'flat' | 'percent'
const SORTS: Array<{ id: LiveSort; label: string; says: string }> = [
  { id: 'match', label: 'Best match', says: 'Best matches first.' },
  { id: 'pay', label: 'Highest pay', says: 'Highest pay first: flat fees by amount, then % of sales.' },
  { id: 'creators', label: 'Fewest creators', says: 'Fewest creators first: less competition for each brand.' },
  { id: 'fit', label: 'Best fit', says: 'Highest AI fit score first. Brands not scored yet come after.' },
  { id: 'newest', label: 'Newest', says: 'Newest on TRYBE first, by when MVP first saw each brand.' },
]
const PAYS: Array<{ id: LivePay; label: string }> = [
  { id: 'any', label: 'Any pay' },
  { id: 'flat', label: 'Flat fee' },
  { id: 'percent', label: '% of sales' },
]
/** On the list in a way that means it is not picked again from the live list. */
const TAKEN: Array<Brand['status']> = ['drafted', 'sending', 'sent', 'already', 'failed']
interface LogLine { at: number; name: string; text: string; tone: 'ok' | 'warn' | 'bad' | 'info' }

// The kind of core message MVP recommends (Seb, 2026-10-07): who you are and
// your numbers, what you make and why it helps the brand sell, where to see
// your work. MVP adds the hello to each brand and the sign-off.
const STARTER = `I'm an Amazon Influencer making real-life video reviews that help customers make buying decisions, and your products are right in my wheelhouse.

I'd love to bring your brand into my current catalogue of content, and I'm happy to start with one video so you can see the fit.

You can see my work on my Amazon storefront.`

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
  'request-button-not-found': 'TRYBE showed the brand but no Request to Join button',
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

/** Keywords offered to try, one click each. */
const KEYWORD_EXAMPLES = ['golf', 'bible journaling', 'dog toys', 'camping gear', 'coffee', 'kids crafts']
/** Find notes that only describe MVP's copy of TRYBE (counts, where it came
 *  from) and go to the admin only. Every other note, a problem above all, is
 *  shown to everyone: a find that failed must never look like a quiet one. */
const ADMIN_NOTE = /^(SCOUT collected |Using MVP's copy|The TRYBE list carried no websites)/
/** A fit score this high or more is a strong fit (Tick Fit 80+). */
const FIT_STRONG = 80
/** Niches shown before "Show all". */
const NICHES_SHOWN = 12

/** A picture for a TRYBE niche, from its name. Anything unknown gets a tag. */
function nicheIcon(name: string): LucideIcon {
  const n = name.toLowerCase()
  const rules: Array<[RegExp, LucideIcon]> = [
    [/skin/, Droplet], [/hair/, Scissors], [/makeup|cosmetic|beauty device/, Wand2], [/beauty|groom|personal care|hygiene/, Sparkles],
    [/supplement|nutrition|vitamin/, Pill], [/fitness|gym|weight|sport/, Dumbbell], [/health|wellness/, HeartPulse],
    [/food|beverage|drink|coffee|snack/, Coffee], [/kitchen|dining|cook/, UtensilsCrossed], [/home|decor|living|furniture/, House],
    [/fashion|apparel|cloth/, Shirt], [/jewel|accessor/, Gem], [/tech|gadget|electronic|app/, Cpu], [/baby|kid|child|parent/, Baby],
    [/pet|dog|cat/, PawPrint], [/outdoor|camp|hik/, Tent], [/travel/, Plane], [/book|education|learn/, BookOpen],
    [/faith|bible|christian|church/, Church], [/craft|hobby|art/, Palette], [/clean/, SprayCan], [/sleep/, Moon], [/eco|garden|plant|natural/, Leaf],
  ]
  return rules.find(([re]) => re.test(n))?.[1] || Tag
}

/** A brand's own website icon, else its first letter. */
function BrandMark({ name, website, size = 40 }: { name: string; website: string | null; size?: number }) {
  const [bad, setBad] = useState(false)
  let host = ''
  try { host = website ? new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname : '' } catch { host = '' }
  const box = { width: size, height: size }
  if (!host || bad) {
    return <span className="shrink-0 rounded-lg inline-flex items-center justify-center font-bold" style={{ ...box, background: 'rgba(124,58,237,0.12)', color: PURPLE, fontSize: size * 0.42 }} aria-hidden="true">{(name.trim()[0] || '?').toUpperCase()}</span>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" loading="lazy" onError={() => setBad(true)}
    className="shrink-0 rounded-lg border object-contain p-1.5" style={{ ...box, borderColor: 'var(--border)', background: '#fff' }} />
}

/** A brand's TRYBE conversation, matched by its whole name: TRYBE names a
 *  brand's chat after the brand ("NOBL", "HiStrips Team (DM)"). Only the whole
 *  name counts, and never a group: "Audien Creator Vault" is a community of
 *  400 creators, not Audien replying. The latest one wins. */
function convoFor(brand: string, convos: Conversation[]): Conversation | null {
  const n = (t: string) => t.toLowerCase().replace(/\(dm\)/g, ' ').replace(/[^a-z0-9()]+/g, ' ').replace(/\b(team|official)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const b = n(brand)
  if (b.length < 2) return null
  const hits = convos.filter(c => !/\(group\)/i.test(c.name) && n(c.name) === b)
  return hits.sort((x, y) => y.at - x.at)[0] || null
}

/** The brand's TRYBE conversation, when it counts as an answer to MVP's
 *  request: only for a request that went (sent, already requested, or not
 *  yet confirmed), and only a conversation active after it was sent. A chat
 *  from before the request is not a reply to it. */
const WENT: Array<Brand['status']> = ['sent', 'already', 'sending']
function replyConvo(b: Brand, convos: Conversation[]): Conversation | null {
  if (!WENT.includes(b.status)) return null
  const c = convoFor(b.name, convos)
  if (!c) return null
  const sentAt = Date.parse(b.send_started_at || b.sent_at || '')
  return Number.isFinite(sentAt) && c.at > 0 && c.at < sentAt ? null : c
}

/** One number tile. */
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>{label}</p>
      <p className="text-[24px] font-bold leading-tight mt-0.5 tabular-nums" style={tone ? { color: tone } : undefined}>{value}</p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{hint}</p>}
    </div>
  )
}


/** When the next send opens up, in the creator's own clock. */
function opensWords(at: string | null): string {
  if (!at) return 'Daily cap reached.'
  const t = new Date(at)
  if (!Number.isFinite(t.getTime())) return 'Daily cap reached.'
  const sameDay = t.toDateString() === new Date().toDateString()
  const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `Next one can go at ${time}${sameDay ? '' : ' tomorrow'}.`
}

export default function TrybeOutreach() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('find')
  const [core, setCore] = useState('')
  const [cap, setCap] = useState(20)
  // The cap the server holds, for the tile and Send all; `cap` is the input.
  const [savedCap, setSavedCap] = useState(20)
  const [used, setUsed] = useState(0)
  // When the next send opens up, once the cap is used: the oldest counted send
  // turning 24 hours old, never midnight (Seb, 2026-10-09).
  const [freeAt, setFreeAt] = useState<string | null>(null)
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
  const [runSize, setRunSize] = useState(0)
  const [directory, setDirectory] = useState<Directory | null>(null)
  // How MVP's copy of TRYBE is doing (counts, collection notes) is for the
  // admin only (Seb, 2026-10-07): it makes no difference to a creator.
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAllNiches, setShowAllNiches] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // The TRYBE inbox, for the unread count and which sent brands answered.
  const [inbox, setInbox] = useState<{ convos: Conversation[]; me: string[]; myName: string } | null>(null)
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [openChat, setOpenChat] = useState<{ id: string; n: number } | null>(null)
  const [editingCore, setEditingCore] = useState(false)
  const [sentFilter, setSentFilter] = useState<'all' | 'replied' | 'waiting' | 'accepted' | 'declined'>('all')
  // THE LIVE LIST (Seb, 2026-10-07): MVP's copy of TRYBE searched as the
  // filters change, no SCOUT and no website fetched.
  const [live, setLive] = useState<{ brands: LiveBrand[]; matched: number; capped: boolean; hiddenMine?: number; payUnknown?: number; payOther?: number } | null>(null)
  const [showMine, setShowMine] = useState(false)
  // SORT AND PAY FILTER (Seb, 2026-10-08 upgrade 3), done on the server so
  // the order covers every match and not just the 60 on screen.
  const [sortBy, setSortBy] = useState<LiveSort>('match')
  const [payType, setPayType] = useState<LivePay>('any')
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [livePick, setLivePick] = useState<Set<string>>(new Set())
  const [liveNonce, setLiveNonce] = useState(0)
  const liveReq = useRef(0)
  // What the server has saved, which is what the daily find goes by: never
  // the half-typed message or a box ticked a second ago.
  const [saved, setSaved] = useState<{ core: string; dailyFind: boolean } | null>(null)
  const stopRef = useRef(false)
  // Leaving the page stops a send run: nothing sends with nothing on screen.
  // Leaving also ends a read of TRYBE's brand list (Sent's request states).
  const leftRef = useRef(false)
  useEffect(() => () => { stopRef.current = true; leftRef.current = true }, [])
  const autoRan = useRef(false)

  const say = (name: string, text: string, tone: LogLine['tone']) => setLog(l => [{ at: Date.now(), name, text, tone }, ...l].slice(0, 200))

  const load = useCallback(async () => {
    try {
      const d = await api()
      setBrands(d.brands || [])
      setCore(c => c || d.settings?.coreMessage || '')
      setCap(d.settings?.dailyCap ?? 20)
      setSavedCap(d.settings?.dailyCap ?? 20)
      setUsed(d.usedToday ?? 0)
      setFreeAt(d.nextFreeAt ?? null)
      const c = d.settings?.categories || [], k = d.settings?.keywords || []
      setSavedKey(prefsKey(c, k))
      setDailyFind(d.settings?.dailyFind !== false)
      setLastFindAt(d.settings?.lastFindAt ?? null)
      setDirectory(d.directory ?? null)
      setIsAdmin(d.isAdmin === true)
      setSaved({ core: d.settings?.coreMessage || '', dailyFind: d.settings?.dailyFind !== false })
      if (!(d.settings?.coreMessage || '').trim()) setEditingCore(true)
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
  const canInbox = access === 'granted' && scoutAtLeast(scoutVersion, SCOUT_TRYBE_INBOX_MIN_VERSION)
  const scoutOpens = access === 'granted' && scoutAtLeast(scoutVersion, SCOUT_TRYBE_OPEN_BRAND_MIN_VERSION)
  const loadInbox = useCallback(async () => {
    const r = await fetchTrybeInbox().catch(() => ({ ok: false as const, error: 'SCOUT did not answer.' }))
    if (r.ok) { setInbox({ convos: r.convos, me: r.me, myName: r.myName }); setInboxError(null) } else setInboxError(r.error)
  }, [])
  useEffect(() => { if (canInbox) void loadInbox() }, [canInbox, loadInbox])
  // The tiles and Sent stay current too: every two minutes while in view, and
  // straight away when the tab comes back into view. The Inbox tab reads its
  // own list on the same rhythm.
  useEffect(() => {
    if (!canInbox) return
    const tick = () => { if (document.visibilityState === 'visible' && tab !== 'inbox') void loadInbox() }
    const t = setInterval(tick, 120_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [canInbox, loadInbox, tab])
  // ACCEPTED, PENDING, DECLINED (upgrade 1): read from TRYBE's Discover
  // Brands list, which flags each brand the signed-in creator has a pending
  // request with, or an invite from (lib/trybe-invites.ts). Every page is
  // read, so a brand missing from the flags really is no longer pending; a
  // read that stops early says so and tags only what it saw. Kept for three
  // hours in this browser: a full read is about 80 pages through SCOUT.
  const canRequests = canInbox
  const brandIdsRef = useRef<Set<string>>(new Set())
  brandIdsRef.current = new Set(brands.map(b => b.brand_id))
  const [requests, setRequests] = useState<RequestsRead | null>(null)
  const [requestsNote, setRequestsNote] = useState<string | null>(null)
  const [requestsPage, setRequestsPage] = useState<string | null>(null)
  const requestsBusy = useRef(false)
  const loadRequests = useCallback(async (force = false) => {
    if (requestsBusy.current) return
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(REQUESTS_KEY) || 'null') as RequestsRead | null
        if (c && Date.now() - c.at < 3 * 3600_000) { setRequests(c); setRequestsNote(null); return }
      } catch { /* read again below */ }
    }
    requestsBusy.current = true
    setRequestsNote(null)
    const flags: Record<string, BrandFlags> = {}
    const invites: BrandFlags[] = []
    let pages = 0, total: number | null = null, complete = false, stopped: string | null = null
    try {
      for (let p = 1; p <= 150; p++) {
        if (leftRef.current) { stopped = 'You left the page.'; break }
        setRequestsPage(total ? `page ${p} of ${total}` : `page ${p}`)
        const r = await requestTrybeApi('GET', `/backend/api/discovery/brands?limit=75&page=${p}`).catch(() => ({ ok: false as const, error: 'SCOUT did not answer.' }))
        if (!r.ok) { stopped = 'error' in r && r.error ? r.error : `TRYBE answered ${'status' in r ? r.status : 'nothing'}`; break }
        const page = readDiscoveryPage(r.json)
        pages = p
        total = page.totalPages ?? total
        for (const f of page.flags) {
          if (brandIdsRef.current.has(f.brandId)) flags[f.brandId] = f
          if (f.pendingInvite && !invites.some(x => x.brandId === f.brandId)) invites.push(f)
        }
        if (!page.listed || (total && p >= total)) { complete = true; break }
      }
      if (!complete && !stopped) stopped = 'TRYBE listed more pages than MVP reads.'
      const read: RequestsRead = { at: Date.now(), complete, pages, flags, invites: invites.slice(0, 50) }
      setRequests(read)
      if (stopped) setRequestsNote(`MVP read ${pages} page${pages === 1 ? '' : 's'} of TRYBE's brands, then stopped (${stopped}). Only brands it saw are tagged.`)
      else try { localStorage.setItem(REQUESTS_KEY, JSON.stringify(read)) } catch { /* this browser only */ }
    } finally { requestsBusy.current = false; setRequestsPage(null) }
  }, [])
  useEffect(() => { if (canRequests && tab === 'sent' && !requests) void loadRequests() }, [canRequests, tab, requests, loadRequests])
  // REPLY ALERTS (upgrade 4): every fresh read of the inbox is noted on MVP,
  // so the menu count and the Today list show it on other pages.
  const [alertsError, setAlertsError] = useState<string | null>(null)
  useEffect(() => {
    if (!inbox) return
    void reportTrybeInbox(inbox.convos).then(r => { if (!r.ok) setAlertsError(r.error); else if (!r.skipped) setAlertsError(null) })
  }, [inbox])
  // The Today list and the menu count link straight to the Inbox tab.
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('tab') === 'inbox') setTab('inbox') } catch { /* no URL */ }
  }, [])
  const onInboxConvos = useCallback((convos: Conversation[]) => setInbox(i => (i ? { ...i, convos } : { convos, me: [], myName: '' })), [])
  // A reply seen for the first time is saved, so it counts from then on even
  // when the inbox cannot be read. Each brand once per visit.
  const stampedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!inbox) return
    const fresh = brands.filter(b => !b.replied_at && !stampedRef.current.has(b.brand_id))
      .map(b => ({ b, c: replyConvo(b, inbox.convos) })).filter(x => x.c)
    if (!fresh.length) return
    for (const x of fresh) stampedRef.current.add(x.b.brand_id)
    void api({ action: 'replied', replies: fresh.map(x => ({ id: x.b.brand_id, at: x.c!.at ? new Date(x.c!.at).toISOString() : null })) })
      .then(() => { for (const x of fresh) patch(x.b.brand_id, { replied_at: x.c!.at ? new Date(x.c!.at).toISOString() : new Date().toISOString() }) })
      .catch(() => { /* before migration 419 the live count still shows */ })
  }, [inbox, brands]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!waitUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waitUntil])

  const pageKey = prefsKey(cats, kws)
  const unsavedNiche = pageKey !== savedKey
  const hasNiche = cats.length > 0 || kws.length > 0
  const canSearchTrybe = scoutAtLeast(scoutVersion, SCOUT_TRYBE_FIND_MIN_VERSION)
  // 1.41.2: SCOUT collects the whole TRYBE list and MVP searches its own copy.
  const canHarvest = scoutAtLeast(scoutVersion, SCOUT_TRYBE_HARVEST_MIN_VERSION)

  const queue = useMemo(() => brands.filter(b => b.status === 'drafted' && b.draft).sort((a, b) => priority(b) - priority(a)), [brands])
  const found = useMemo(() => brands.filter(b => b.status === 'new' && b.fit_prefs === savedKey).sort((a, b) => priority(b) - priority(a)), [brands, savedKey])
  const notFit = useMemo(() => brands.filter(b => b.status === 'not_fit' && b.fit_prefs === savedKey).sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0)), [brands, savedKey])
  const unjudged = useMemo(() => brands.filter(b => (b.status === 'new' || b.status === 'not_fit') && b.fit_prefs !== savedKey), [brands, savedKey])
  const history = useMemo(() => brands.filter(b => ['sent', 'sending', 'failed', 'already'].includes(b.status))
    .sort((a, b) => Date.parse(b.send_started_at || b.sent_at || '0') - Date.parse(a.send_started_at || a.sent_at || '0')), [brands])
  const remaining = Math.max(0, savedCap - used)

  // Categories offered: the usual ones, the ones TRYBE showed on brands found,
  // and any already picked.
  const catOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const b of brands) for (const c of b.categories || []) seen.set(c, (seen.get(c) || 0) + 1)
    const fromTrybe = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c]) => c)
    // The TRYBE category list first, once SCOUT has read it.
    const all = [...cats, ...(directory?.categories || []), ...fromTrybe, ...(directory?.categories?.length ? [] : CATEGORY_SUGGESTIONS)]
    return all.filter((c, i) => all.findIndex(o => o.toLowerCase() === c.toLowerCase()) === i)
  }, [brands, cats, directory])

  function patch(id: string, p: Partial<Brand>) { setBrands(bs => bs.map(b => b.brand_id === id ? { ...b, ...p } : b)) }

  async function saveSettings(quiet = false) {
    setSavingSettings(true)
    try {
      const d = await api({ action: 'settings', coreMessage: core, dailyCap: cap, categories: cats, keywords: kws, dailyFind })
      setCap(d.settings.dailyCap)
      setSavedCap(d.settings.dailyCap)
      setSavedKey(prefsKey(d.settings.categories || [], d.settings.keywords || []))
      // THE DAILY RUN GOES BY WHAT WAS SAVED: unticking it and saving used to
      // leave the old "on" here, and the run wrote twenty messages anyway.
      setSaved({ core: d.settings.coreMessage || '', dailyFind: d.settings.dailyFind !== false })
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

  /** Draft these brands into Ready to send, four at a time. */
  async function draftIds(ids: string[]): Promise<{ ok: number; failed: number }> {
    let ok = 0, failed = 0
    setFinding({ stage: 'Writing messages', done: 0, total: ids.length })
    for (let i = 0; i < ids.length; i += 4) {
      const chunk = ids.slice(i, i + 4)
      try {
        const d = await api({ action: 'draft', brandIds: chunk })
        for (const r of (d.results || []) as Array<{ ok: boolean }>) r.ok ? ok++ : failed++
      // The rest are counted too: a stop must not make them vanish from the total.
      } catch (e) { failed += ids.length - i; toast.error(e instanceof Error ? e.message : 'Draft failed'); break }
      setFinding({ stage: 'Writing messages', done: Math.min(ids.length, i + 4), total: ids.length })
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
      } catch (e) { failed += ids.length - i; toast.error(e instanceof Error ? e.message : 'Fit check failed'); break }
      setFinding({ stage: 'Reading websites and checking fit', done: Math.min(ids.length, i + 5), total: ids.length })
    }
    return { fit, no, failed }
  }

  /** Find brands: SCOUT searches TRYBE, MVP judges the fit. `auto` is the
   *  daily run: it also drafts the best ones into Ready to send. */
  async function findBrands(auto = false) {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); return }
    if (!core.trim()) { toast.error('Write your core message first'); setTab('find'); return }
    if (!(await saveSettings(true))) return
    const notes: string[] = []
    setFindNotes([])
    try {
      if (canHarvest) await collectAndShortlist(notes)
      else await scanTrybe(notes)
      const d = await load()
      const all: Brand[] = d?.brands || brands
      const key = prefsKey(d?.settings?.categories || cats, d?.settings?.keywords || kws)
      const toJudge = all.filter(b => (b.status === 'new' || b.status === 'not_fit') && b.fit_prefs !== key)
      if (toJudge.length) {
        const j = await judge(toJudge)
        notes.push(hasNiche
          ? `MVP checked ${j.fit + j.no} against your niche from their websites: ${j.fit} fit, ${j.no} do not.${j.failed ? ` ${j.failed} could not be checked and are tried again next time.` : ''}`
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
          notes.push(`Today's drafts: ${r.ok} added to Ready to send${r.failed ? `, ${r.failed} could not be written` : ''}.`)
        } else notes.push(room ? 'No new brands that fit today, so nothing was added to the queue.' : 'Ready to send already holds today’s 20.')
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

  /** SCOUT 1.41.2+: collect TRYBE's whole list when MVP's copy is a day old,
   *  then search MVP's copy for the niche. TRYBE's own search is not used: it
   *  does not find brands by what they sell. */
  async function collectAndShortlist(notes: string[]) {
    await collectFromTrybe(notes, false)
    setFinding({ stage: 'Searching MVP\u2019s copy of TRYBE for your niche' })
    const sl = await api({ action: 'shortlist', limit: SCAN_READ })
    notes.push(hasNiche
      ? (sl.added ? `MVP searched its copy of TRYBE for your niche and took the best ${sl.added} brands you have not seen to the fit check.` : 'MVP searched its copy of TRYBE and found no new brands matching your niche. Try more keywords or categories.')
      : `${sl.added} brands taken, highest TRYBE score first. Pick a niche to search by it.`)
  }

  /** SCOUT collects TRYBE's whole list when MVP's copy is a day old, or now
   *  when `force`. */
  async function collectFromTrybe(notes: string[], force: boolean) {
    const last = directory?.lastCollectedAt ? Date.parse(directory.lastCollectedAt) : 0
    if (force || !directory?.brands || Date.now() - last > RECOLLECT_MS) {
      setFinding({ stage: 'SCOUT is collecting every brand on TRYBE, in a tab behind this one' })
      const h = await requestTrybeHarvest()
      const items = h.items || []
      if (!items.length) {
        const why: Record<string, string> = {
          'no-access': 'SCOUT is not allowed on TRYBE yet. Press Allow SCOUT on TRYBE.',
          'not-signed-in': 'TRYBE showed its sign-in page. Sign in to TRYBE in this Chrome, then press Find brands again.',
          'no-sign-in-found': 'SCOUT opened TRYBE but could not find your TRYBE sign-in in this Chrome. Open jointrybe.com, make sure you are signed in, then press Find brands again.',
          'refused-401': 'TRYBE refused the brand list with your sign-in (401). Sign out of TRYBE and back in, then press Find brands again.',
          'refused-403': 'TRYBE refused the brand list with your sign-in (403). Sign out of TRYBE and back in, then press Find brands again.',
          'no-brands': 'SCOUT reached TRYBE but its brand list came back empty.',
          timeout: 'SCOUT ran out of time collecting the TRYBE list.',
        }
        notes.push(why[h.error || ''] || `SCOUT could not collect the TRYBE list: ${h.error || 'no answer'}.`)
        if (directory?.brands) notes.push(`Using MVP's copy from ${directory.lastCollectedAt ? new Date(directory.lastCollectedAt).toLocaleString() : 'earlier'} instead.`)
      } else {
        let saved = 0, withSite = 0
        let keys: string[] = []
        const STEP = 250
        for (let i = 0; i < items.length; i += STEP) {
          setFinding({ stage: 'Saving the TRYBE brands to MVP', done: i, total: items.length })
          const lastChunk = i + STEP >= items.length
          const d = await api({
            action: 'directory', items: items.slice(i, i + STEP),
            ...(i === 0 && h.categories ? { categories: h.categories } : {}),
            // Only a whole collection lets MVP wait a day before the next.
            ...(lastChunk ? { collected: { complete: h.complete === true, pages: h.pages, totalPages: h.totalPages } } : {}),
          })
          saved += d.saved || 0; withSite += d.withWebsite || 0
          if (!keys.length && Array.isArray(d.keys)) keys = d.keys
        }
        notes.push(`SCOUT collected ${items.length.toLocaleString()} entries from ${h.pages ?? '?'} of ${h.totalPages ?? '?'} pages (TRYBE lists ${h.total != null ? h.total.toLocaleString() : '?'}). MVP saved ${saved.toLocaleString()} brands, ${withSite.toLocaleString()} with a website.`)
        if (h.complete !== true) notes.push(`SCOUT stopped at page ${h.pages ?? '?'} of ${h.totalPages ?? '?'}${h.error ? ` (${h.error})` : ''}. What it collected is kept, and the next Find brands collects again.`)
        if (!saved) notes.push(`MVP could not read the TRYBE entries. Fields TRYBE sent: ${keys.join(', ') || 'none'}.`)
        else if (!withSite) notes.push(`The TRYBE list carried no websites, so MVP matches on the TRYBE description for now. Fields TRYBE sent: ${keys.join(', ')}.`)
      }
    } else {
      notes.push(`Using MVP's copy of TRYBE (${directory.brands.toLocaleString()} brands, collected ${new Date(directory.lastCollectedAt!).toLocaleString()}).`)
    }
  }

  /** Older SCOUT: read TRYBE's Discover screen brand by brand. */
  async function scanTrybe(notes: string[]) {
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
  }

  // THE DAILY FIND. Once a day, when this page is opened with SCOUT allowed
  // and a niche saved, MVP and SCOUT find and draft up to 20 brands that fit.
  useEffect(() => {
    if (loading || autoRan.current || access !== 'granted' || !saved || !saved.dailyFind || running || finding) return
    if (!saved.core.trim() || savedKey === prefsKey([], [])) return
    const last = lastFindAt ? Date.parse(lastFindAt) : 0
    if (Date.now() - last < RECOLLECT_MS) return
    autoRan.current = true
    toast('Finding today\u2019s brands that fit your niche. SCOUT works in a tab behind this one for a few minutes.', { duration: 9000 })
    void findBrands(true)
  }, [loading, access, saved, lastFindAt, savedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Searched again a moment after each change to the categories or keywords.
  const hasDirectory = !!directory && directory.brands > 0
  const catsKey = cats.join('|'), kwsKey = kws.join('|')
  useEffect(() => {
    if (!hasDirectory) return
    const id = ++liveReq.current
    setLiveLoading(true)
    const t = setTimeout(async () => {
      try {
        const d = await api({ action: 'browse', categories: cats, keywords: kws, limit: 60, includeMine: showMine, sort: sortBy, payType })
        if (id !== liveReq.current) return // a newer search has started
        setLive({ brands: d.brands || [], matched: d.matched ?? 0, capped: !!d.capped, hiddenMine: d.hiddenMine ?? 0, payUnknown: d.payUnknown ?? 0, payOther: d.payOther ?? 0 })
        setLiveError(null)
        // Ticks stay only on brands still listed and still free to draft.
        setLivePick(p => new Set(Array.from(p).filter(x => (d.brands || []).some((b: LiveBrand) => b.brand_id === x && !TAKEN.includes(b.status as Brand['status'])))))
      } catch (e) {
        if (id === liveReq.current) setLiveError(e instanceof Error ? e.message : 'The live search failed.')
      } finally {
        if (id === liveReq.current) setLiveLoading(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [hasDirectory, catsKey, kwsKey, liveNonce, showMine, sortBy, payType]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Draft the brands ticked in the live list into Ready to send. */
  async function draftPicked(only?: string[]) {
    const ids = only || Array.from(livePick)
    if (!ids.length) { toast.message('Tick the brands to draft first.'); return }
    if (!core.trim()) { toast.error('Write your core message first'); return }
    if (!(await saveSettings(true))) return
    try {
      setFinding({ stage: 'Putting the brands you picked on your list' })
      const a = await api({ action: 'adopt', brandIds: ids })
      const ready: string[] = a.ready || []
      const r = ready.length ? await draftIds(ready) : { ok: 0, failed: 0 }
      if (r.failed) toast.error(`${r.failed} draft${r.failed === 1 ? '' : 's'} could not be written`)
      if (r.ok) { toast.success(`${r.ok} added to Ready to send`); if (!only) setTab('queue') }
      if (!ready.length) toast.message(only ? 'That brand is already in Ready to send or sent.' : 'None of those could be drafted: they are already in your queue or sent.')
      if (!only) setLivePick(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setFinding(null)
      await load()
      setLiveNonce(n => n + 1)
    }
  }

  /** Collect TRYBE's list now, whatever its age, then show the live list. */
  async function refreshFromTrybe() {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); return }
    const notes: string[] = []
    setFindNotes([])
    try { await collectFromTrybe(notes, true) } catch (e) {
      notes.push(e instanceof Error ? e.message : 'Refreshing from TRYBE failed.')
    } finally {
      setFinding(null); setFindNotes(notes)
      await load(); setLiveNonce(n => n + 1)
    }
  }

  async function draftSelected() {
    const ids = found.filter(b => selected.has(b.brand_id)).map(b => b.brand_id)
    if (!ids.length) { toast.message('Tick the brands to draft first.'); return }
    if (!core.trim()) { toast.error('Write your core message first'); return }
    if (!(await saveSettings(true))) return
    const r = await draftIds(ids)
    setFinding(null)
    if (r.failed) toast.error(`${r.failed} draft${r.failed === 1 ? '' : 's'} could not be written`)
    if (r.ok) { toast.success(`${r.ok} added to Ready to send`); setTab('queue') }
    setSelected(new Set())
    await load()
  }

  // SAVED BEFORE IT IS SENT: Send now waits for the save in flight, and a
  // save that failed stops the send instead of sending the older copy.
  const pendingSave = useRef<Map<string, Promise<boolean>>>(new Map())
  async function saveDraft(b: Brand, text: string): Promise<boolean> {
    const inFlight = pendingSave.current.get(b.brand_id)
    if (inFlight) await inFlight
    if (text === (brands.find(x => x.brand_id === b.brand_id)?.draft ?? b.draft) && !inFlight) return true
    const job = api({ action: 'edit', brandId: b.brand_id, draft: text })
      .then(() => { patch(b.brand_id, { draft: text }); return true })
      .catch(e => { toast.error(`Not saved: ${e instanceof Error ? e.message : 'error'}`); return false })
      .finally(() => { if (pendingSave.current.get(b.brand_id) === job) pendingSave.current.delete(b.brand_id) })
    pendingSave.current.set(b.brand_id, job)
    return job
  }

  async function skip(b: Brand, undo = false) {
    const d = await api({ action: undo ? 'unskip' : 'skip', brandId: b.brand_id }).catch(e => { toast.error(e.message); return null })
    if (d?.status) patch(b.brand_id, { status: d.status })
  }

  /** Write these drafts again from the core message as it is now. */
  async function rewrite(list: Brand[]) {
    if (!list.length) return
    if (!core.trim()) { toast.error('Write your core message first'); return }
    if (!(await saveSettings(true))) return
    const r = await draftIds(list.map(b => b.brand_id))
    setFinding(null)
    if (r.failed) toast.error(`${r.failed} could not be rewritten`)
    if (r.ok) toast.success(`${r.ok} message${r.ok === 1 ? '' : 's'} rewritten`)
    await load()
  }

  /** Off the page for good: never sent, never offered again by the daily find. */
  async function remove(b: Brand) {
    const d = await api({ action: 'remove', brandId: b.brand_id }).catch(e => { toast.error(e.message); return null })
    if (d?.status) { patch(b.brand_id, { status: 'removed' }); toast.success(`${b.name} removed`) }
  }

  async function requeue(b: Brand) {
    await api({ action: 'edit', brandId: b.brand_id, draft: b.draft || '' }).catch(e => toast.error(e.message))
    await load()
  }

  async function settle(b: Brand, went: boolean) {
    await api({ action: 'reset', brandId: b.brand_id, went }).catch(e => toast.error(e.message))
    await load()
  }

  async function sendAll() { await runSends(queue.slice(0, remaining), 'Send all') }
  /** One message now, without waiting for the rest. */
  async function sendOne(b: Brand) {
    if (!remaining) { toast.error(`All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)}`); return }
    await runSends([b], 'Send now')
  }

  async function runSends(list: Brand[], label: string) {
    // EVERY STOP SAYS WHY (2026-10-06: "it didn't do anything when i clicked
    // send all"). A send that could not start used to note it on a row the
    // reload then wiped, so a run could end with nothing on screen.
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); say(label, 'Not started: SCOUT is not allowed on TRYBE yet.', 'bad'); return }
    if (!list.length) { say(label, remaining ? 'Nothing in the queue to send.' : `All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)} The queue waits until then.`, 'warn'); return }
    stopRef.current = false
    setRunSize(list.length)
    setRunning(true)
    say(label, `Starting: ${list.length} request${list.length === 1 ? '' : 's'}, one at a time. Keep this tab open.`, 'info')
    let sentThisRun = 0
    let lastFailed = false
    try {
      for (let i = 0; i < list.length; i++) {
        if (stopRef.current) { say(label, 'Stopped.', 'warn'); break }
        const b = list[i]
        const c = await api({ action: 'claim', brandId: b.brand_id }).catch(e => ({ ok: false, error: e.message }))
        if (c.capped) { setFreeAt(c.nextFreeAt ?? null); say(label, `All ${c.dailyCap} sends of the last 24 hours are used. ${opensWords(c.nextFreeAt ?? null)}`, 'warn'); toast.message('Daily cap reached'); break }
        if (!c.ok) { say(b.name, `Not started: ${c.error || 'MVP could not reserve it'}.`, 'bad'); toast.error(`${b.name}: ${c.error || 'could not start'}`); continue }
        setUsed(c.usedToday)
        if (c.nextFreeAt) setFreeAt(c.nextFreeAt)
        setCurrent(b.brand_id)
        patch(b.brand_id, { status: 'sending', send_started_at: new Date().toISOString(), error: null })
        say(b.name, 'SCOUT is opening TRYBE to send it.', 'info')
        const res = await requestTrybeSend(c.url, c.name, c.message)
        const err = res.error ? `${res.error}${res.steps?.length ? ` (got to: ${res.steps[res.steps.length - 1]})` : ''}` : null
        const recorded = await api({ action: 'result', brandId: b.brand_id, outcome: res.outcome, error: err }).then(() => true).catch(() => false)
        patch(b.brand_id, {
          status: res.outcome === 'sent' ? 'sent' : res.outcome === 'already' ? 'already' : res.outcome === 'failed' ? 'failed' : 'sending',
          error: res.outcome === 'sent' || res.outcome === 'already' ? null : (err || 'Not confirmed'),
        })
        if (res.outcome === 'sent') say(b.name, 'Sent. TRYBE closed the request box.', 'ok')
        else if (res.outcome === 'already') say(b.name, 'TRYBE already shows a request to this brand.', 'warn')
        else if (res.outcome === 'failed') say(b.name, `Not sent: ${sendWords(err) || 'SCOUT could not send it'}.`, 'bad')
        else say(b.name, `Not confirmed: ${sendWords(err) || 'TRYBE did not show the box closing'}. Check TRYBE's Pending Requests.`, 'warn')
        if (!recorded) say(b.name, 'MVP could not save this result. Reload before sending again.', 'bad')
        if (res.outcome === 'failed' || res.outcome === 'already') setUsed(u => Math.max(0, u - 1))
        setCurrent(null)
        // Two failures in a row usually mean TRYBE changed or signed out: stop.
        if (res.outcome === 'failed' && lastFailed) {
          say(label, 'Two sends in a row failed, so SCOUT stopped.', 'bad')
          toast.error('Two sends in a row failed, so SCOUT stopped. See the run log.')
          break
        }
        lastFailed = res.outcome === 'failed'
        if (res.outcome === 'sent') sentThisRun++
        if (i < list.length - 1 && !stopRef.current) {
          const gap = nextGapMs(sentThisRun, Math.random, list.length)
          setWaitUntil(Date.now() + gap); setNow(Date.now())
          const end = Date.now() + gap
          while (Date.now() < end && !stopRef.current) await new Promise(r => setTimeout(r, 500))
          setWaitUntil(null)
        }
      }
      say(label, `Done: ${sentThisRun} sent.`, sentThisRun ? 'ok' : 'warn')
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
  const sendBlocked = access !== 'granted' ? 'Allow SCOUT on TRYBE first.' : !remaining ? `All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)}` : !queue.length ? 'Nothing drafted yet.' : null

  const unread = (inbox?.convos || []).reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0)
  const sentRows = history.map(b => {
    // The chat is shown for any brand; it counts as a reply only per replyConvo.
    const c = inbox ? convoFor(b.name, inbox.convos) : null
    const answered = WENT.includes(b.status) && (!!b.replied_at || (inbox ? !!replyConvo(b, inbox.convos) : false))
    const lastMine = c && inbox ? lastIsMine(c, inbox.me, inbox.myName) : null
    // REPLIED = A CONVERSATION EXISTS (Seb, 2026-10-08: "i know for a fact
    // that brands have responded"). TRYBE opens a chat with a brand only once
    // it accepts or writes back, so a sent brand with one has answered, whoever
    // wrote last. TRYBE's list does not reliably say who wrote last, which
    // left this at zero. A reply stamped before (replied_at) stays a reply.
    const reply: 'replied' | 'none' | 'unknown' = answered ? 'replied' : !inbox ? 'unknown' : 'none'
    // Where the request stands on TRYBE, when its request list was read.
    const rqState = requests ? requestState(requests.flags[b.brand_id], inbox ? !!c : null) : null
    const rq = rqState ? { state: rqState } : null
    return { b, c, reply, lastMine, rq }
  })
  const repliedCount = sentRows.filter(r => r.reply === 'replied').length
  // Out of requests that went, not every attempt: a failed send never asked anyone.
  const wentCount = history.filter(b => WENT.includes(b.status)).length
  const weekAgo = Date.now() - 7 * 86_400_000
  // This week: stamped in the last seven days, or seen now and not yet stamped.
  const repliedWeek = sentRows.filter(r => r.reply === 'replied' && (r.b.replied_at ? Date.parse(r.b.replied_at) >= weekAgo : true)).length

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5" style={{ color: 'var(--text)' }}>
      {/* Header: what this is, whether SCOUT can work, where to join. */}
      <div className="flex flex-wrap items-start gap-3">
        <span className="shrink-0 w-11 h-11 rounded-xl inline-flex items-center justify-center" style={{ background: PURPLE, color: '#fff' }}><Handshake size={20} /></span>
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-[22px] font-bold leading-tight flex items-center gap-2">TRYBE Outreach</h1>
          <p className="text-[13px] mt-0.5" style={soft}>Find brands that fit your channel, send each a first message in your words, and answer them here.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {access === 'granted' && <span className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}><Check size={13} /> SCOUT is ready</span>}
          {access === 'checking' && <span className="text-[12px]" style={soft}>Checking SCOUT...</span>}
          {access === 'no-scout' && <span className="text-[12px] font-semibold" style={{ color: RED }}>SCOUT is not installed in this browser</span>}
          {access === 'old' && <span className="text-[12px] font-semibold" style={{ color: RED }}>SCOUT needs an update for TRYBE</span>}
          {access === 'not-granted' && <button onClick={() => void allow()} className={btn} style={{ background: PURPLE, color: '#fff' }}>Allow SCOUT on TRYBE</button>}
          {/* Not on TRYBE yet: where to join, in plain sight (Seb, 2026-10-06).
              MVP's referral link, and it says so. */}
          <a href={TRYBE_JOIN_URL} target="_blank" rel="sponsored noopener noreferrer" title="MVP's referral link"
            className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full border px-2.5 py-1" style={{ borderColor: 'rgba(124,58,237,0.35)', color: PURPLE }}>
            New to TRYBE? Join free <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* The numbers that matter today. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat label="Sent, last 24 hours" value={`${used} of ${savedCap}`} hint={remaining ? `${remaining} more can go now` : opensWords(freeAt)} />
        <Stat label="Ready to send" value={String(queue.length)} hint={queue.length ? 'Messages written' : 'Nothing written yet'} />
        <Stat label="Replied this week" value={inbox || repliedCount ? String(repliedWeek) : '...'} hint={inbox || repliedCount ? `${repliedCount} of ${wentCount} sent have replied` : inboxError ? 'Could not read TRYBE' : canInbox ? 'Reading TRYBE...' : 'Needs SCOUT on TRYBE'} tone={repliedWeek ? GREEN : undefined} />
        <Stat label="Unread" value={inbox ? String(unread) : inboxError || !canInbox ? 'n/a' : '...'} hint={inbox ? (unread ? 'Waiting in your inbox' : 'All caught up') : inboxError ? 'Could not read TRYBE' : canInbox ? 'Reading TRYBE...' : 'Needs SCOUT on TRYBE'} tone={unread ? PURPLE : undefined} />
      </div>
      {/* The menu count and Today depend on this save: a failure is said here. */}
      {alertsError && <p className="text-[12px] -mt-2 mb-3 inline-flex items-center gap-1" style={{ color: AMBER }}><AlertTriangle size={12} /> The inbox was read, but the reply alert for the menu and Today could not be saved: {alertsError}</p>}

      {finding && (
        <p className="text-[12px] inline-flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}>
          <Loader2 size={12} className="animate-spin" /> {finding.stage}{finding.total ? ` (${finding.done ?? 0} of ${finding.total})` : '...'}
        </p>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border p-1 w-fit max-w-full" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} role="tablist">
        {([['find', 'Find brands', 0], ['queue', 'Ready to send', queue.length], ['sent', 'Sent', history.length], ['inbox', 'Inbox', unread]] as Array<[Tab, string, number]>).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
            style={tab === id ? { background: PURPLE, color: '#fff' } : { color: 'var(--text)' }}>
            {label}
            {n > 0 && <span className="text-[11px] font-bold rounded-full px-1.5 min-w-[1.25rem] text-center tabular-nums" style={tab === id ? { background: 'rgba(255,255,255,0.25)' } : id === 'inbox' ? { background: PURPLE, color: '#fff' } : { background: 'rgba(124,58,237,0.12)', color: PURPLE }}>{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'find' && (<>
        {/* 1. Core message: a short preview once written, the box while editing. */}
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold">1. Your core message</p>
            {!editingCore && core.trim() && (
              <button onClick={() => setEditingCore(true)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}><Pencil size={12} /> Edit</button>
            )}
          </div>
          {!editingCore && core.trim() ? (
            <p className="text-[13px] mt-2 whitespace-pre-wrap line-clamp-3" style={soft}>{core}</p>
          ) : (<>
            <p className="text-[12px] mt-1 mb-2" style={soft}>What every brand reads, in your words. MVP sends it nearly word for word: it adds a short hello to each brand by name on top, puts the brand&rsquo;s name where yours mentions a brand, and ends with your sign-off. Say who you are, what you make, and where to see your work (your links).</p>
            <textarea value={core} onChange={e => setCore(e.target.value)} rows={8} placeholder={STARTER}
              className="w-full rounded-lg border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg, transparent)' }} />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {!core.trim() && <button onClick={() => setCore(STARTER)} className={btn} style={{ border: '1px solid var(--border)' }}>Use the starter</button>}
              <button onClick={() => void saveSettings().then(ok => { if (ok && core.trim()) { setEditingCore(false); setSaved(sv => (sv ? { ...sv, core } : sv)) } })} disabled={savingSettings || !core.trim()} className={btn} style={{ background: PURPLE, color: '#fff' }}>
                {savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save message
              </button>
              {saved?.core.trim() && <button onClick={() => { setCore(saved.core); setEditingCore(false) }} className="text-[12px] font-semibold" style={soft}>Cancel</button>}
            </div>
          </>)}
        </div>

        {/* 2. Find brands. Seb, 2026-10-07: one click on a niche shows its
            brands, but make it very visible that searching a keyword is the
            better way, because a keyword matches what each brand sells. */}
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold">2. Find brands for your channel</p>

          <div className="mt-3 rounded-2xl border-2 p-4" style={{ borderColor: PURPLE, background: 'rgba(124,58,237,0.05)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5" style={{ background: PURPLE, color: '#fff' }}>Best results</span>
              <p className="text-[15px] font-semibold">Search what you review</p>
            </div>
            <p className="text-[12px] mt-1 mb-3" style={soft}>A keyword finds brands by what they actually sell. &ldquo;golf&rdquo; brings up the golf brands a broad niche like Fitness would bury.</p>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: PURPLE }} />
                <input ref={searchRef} value={kwInput} onChange={e => setKwInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword() } }}
                  placeholder="A product or topic you make videos about" aria-label="Search brands by keyword"
                  className="w-full h-12 rounded-xl border pl-10 pr-3 text-[15px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
              </div>
              <button onClick={addKeyword} disabled={!kwInput.trim()} className="h-12 rounded-xl px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>Search</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {kws.map(k => (
                <span key={k} className="rounded-full pl-3 pr-2 py-1 text-[13px] font-medium inline-flex items-center gap-1.5" style={{ background: PURPLE, color: '#fff' }}>
                  {k} <button onClick={() => setKws(ks => ks.filter(o => o !== k))} aria-label={`Remove ${k}`} className="opacity-80 hover:opacity-100"><X size={12} /></button>
                </span>
              ))}
              {!kws.length && (<>
                <span className="text-[12px] mr-0.5" style={soft}>Try</span>
                {KEYWORD_EXAMPLES.map(k => (
                  <button key={k} onClick={() => setKws(ks => ks.some(o => o.toLowerCase() === k) ? ks : [...ks, k].slice(0, 12))}
                    className="rounded-full border px-2.5 py-1 text-[12px] hover:border-current" style={{ borderColor: 'var(--border)', color: PURPLE }}>{k}</button>
                ))}
              </>)}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-[13px] font-semibold">Or browse a niche</p>
              <p className="text-[12px]" style={soft}>One click shows the brands in it.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
              {catOptions.filter((c, i) => showAllNiches || i < NICHES_SHOWN || cats.some(o => o.toLowerCase() === c.toLowerCase())).map(c => {
                const on = cats.some(o => o.toLowerCase() === c.toLowerCase())
                const Icon = nicheIcon(c)
                return (
                  <button key={c} onClick={() => setCats(cs => on ? cs.filter(o => o.toLowerCase() !== c.toLowerCase()) : cs.length < 12 ? [...cs, c] : cs)}
                    aria-pressed={on}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors"
                    style={on ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    <Icon size={16} className="shrink-0" style={on ? undefined : { color: PURPLE }} />
                    <span className="min-w-0 leading-tight">{c}</span>
                    {on && <Check size={13} className="ml-auto shrink-0" />}
                  </button>
                )
              })}
            </div>
            {catOptions.length > NICHES_SHOWN && (
              <button onClick={() => setShowAllNiches(v => !v)} className="mt-2 text-[12px] font-semibold" style={{ color: PURPLE }}>
                {showAllNiches ? 'Show fewer niches' : `Show all ${catOptions.length} niches`}
              </button>
            )}
          </div>

          {!canHarvest && access === 'granted' && (
            <p className="text-[12px] mt-3" style={{ color: AMBER }}>Your SCOUT ({scoutVersion || 'unknown'}) reads TRYBE&rsquo;s screen a brand at a time. SCOUT {SCOUT_TRYBE_HARVEST_MIN_VERSION} collects every TRYBE brand at once so MVP can search them all by your niche. MVP checks every brand against your niche either way.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <label className="text-[13px] flex items-center gap-2">Daily cap
              <input type="number" min={1} max={MAX_DAILY_CAP} value={cap} onChange={e => setCap(Math.min(MAX_DAILY_CAP, Number(e.target.value)))} className="w-16 rounded border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>per rolling 24 hours (TRYBE allows up to {MAX_DAILY_CAP}; each send frees up 24 hours after it went)</span>
            </label>
            <label className="text-[13px] flex items-center gap-2">
              <input type="checkbox" checked={dailyFind} onChange={e => setDailyFind(e.target.checked)} className="accent-[#7C3AED]" />
              Write messages to {DAILY_FIND} new brands every day when I open this page
            </label>
            <button onClick={() => void saveSettings()} disabled={savingSettings} className={btn} style={{ background: PURPLE, color: '#fff' }}>{savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
            {unsavedNiche && <span className="text-[12px]" style={{ color: AMBER }}>The list below already uses these. Save keeps them for the daily messages.</span>}
          </div>
        </div>

        {/* 3. The live list, from MVP's copy of TRYBE */}
        {hasDirectory ? (
          <div className={card} style={cardStyle}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="text-[14px] font-semibold">3. Brands that match ({live ? live.matched.toLocaleString() : '...'}{live?.capped ? '+' : ''})</p>
              {liveLoading && <Loader2 size={13} className="animate-spin" style={{ color: PURPLE }} />}
              <div className="ml-auto flex flex-wrap gap-2">
                <button onClick={() => void refreshFromTrybe()} disabled={busy || access !== 'granted' || !canHarvest} className={btn} style={{ border: '1px solid var(--border)' }}
                  title="SCOUT collects TRYBE's list again now. It does this by itself once a day.">
                  {finding ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Refresh from TRYBE
                </button>
                <button onClick={() => setLivePick(new Set((live?.brands || []).filter(b => !TAKEN.includes(b.status as Brand['status'])).slice(0, DAILY_FIND).map(b => b.brand_id)))}
                  disabled={!live?.brands.length} className={btn} style={{ border: '1px solid var(--border)' }}>
                  <Check size={13} /> Tick the top {DAILY_FIND}
                </button>
                {/* THE STRONG FITS ONLY (Seb, 2026-10-07: "a button that selects
                    ... only the top ratings over 80"). Brands the AI check
                    scored 80 or more, still free to message. */}
                {(() => {
                  const strong = (live?.brands || []).filter(b => !TAKEN.includes(b.status as Brand['status']) && b.status !== 'not_fit' && (b.fit_score ?? 0) >= FIT_STRONG)
                  return (
                    <button onClick={() => setLivePick(new Set(strong.map(b => b.brand_id)))} disabled={!strong.length} className={btn} style={{ border: `1px solid ${strong.length ? GREEN : 'var(--border)'}`, color: strong.length ? GREEN : undefined }}
                      title={strong.length ? `Tick the ${strong.length} brands MVP's AI check scored ${FIT_STRONG} or more for your niche` : `No brand in this list has a fit score of ${FIT_STRONG} or more yet. Scores come from the daily messages and Find brands.`}>
                      <Star size={13} /> Tick Fit {FIT_STRONG}+ ({strong.length})
                    </button>
                  )
                })()}
                <button onClick={() => void draftPicked()} disabled={busy || !livePick.size} className={btn} style={{ background: PURPLE, color: '#fff' }}
                  title={running ? 'Send all is running. This unlocks when it finishes.' : finding ? `Busy: ${finding.stage}. This unlocks when it finishes.` : !livePick.size ? 'Tick the brands to write to first.' : undefined}>
                  <Sparkles size={13} /> Write {livePick.size} message{livePick.size === 1 ? '' : 's'}
                </button>
              </div>
            </div>
            <p className="text-[12px] mb-3" style={soft}>{SORTS.find(s => s.id === sortBy)?.says} Tick the brands you want and MVP writes each one a message from your core message.</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Sort brands">
                <span className="text-[11px] font-semibold uppercase tracking-wider mr-1" style={soft}>Sort</span>
                {SORTS.map(s => (
                  <button key={s.id} onClick={() => setSortBy(s.id)} aria-pressed={sortBy === s.id}
                    className="text-[12px] font-semibold rounded-full px-2.5 py-1 border"
                    style={sortBy === s.id ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)' }}>{s.label}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by pay type">
                <span className="text-[11px] font-semibold uppercase tracking-wider mr-1" style={soft}>Pay</span>
                {PAYS.map(p => (
                  <button key={p.id} onClick={() => setPayType(p.id)} aria-pressed={payType === p.id}
                    className="text-[12px] font-semibold rounded-full px-2.5 py-1 border"
                    style={payType === p.id ? { background: GREEN, borderColor: GREEN, color: '#fff' } : { borderColor: 'var(--border)' }}>{p.label}</button>
                ))}
              </div>
            </div>
            {/* Best fit with no scores would look like best match: say so. */}
            {sortBy === 'fit' && live && live.brands.length > 0 && !live.brands.some(b => b.fit_score != null) && (
              <p className="text-[12px] mb-3 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(180,83,9,0.10)', color: AMBER }}>None of these brands has a fit score yet, so they are in best match order. Scores come from the daily messages and Find brands.</p>
            )}
            {/* WHY THE BUTTON IS OFF, said where the button is (Seb, 2026-10-07:
                "what is the reason the write message is not clickable?"). The
                daily run or a collection works on the list meanwhile, and its
                progress used to show only in the status card at the top. */}
            {busy && (
              <p className="text-[12px] mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}>
                <Loader2 size={12} className="animate-spin" />
                {running
                  ? 'Send all is running. Write messages unlocks when it finishes.'
                  : <>Busy: {finding?.stage}{finding?.total ? ` (${finding.done ?? 0} of ${finding.total})` : '...'}. Write messages unlocks when this finishes.</>}
              </p>
            )}
            {isAdmin && (
              <div className="rounded-lg border border-dashed px-3 py-2 mb-3 text-[12px] space-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider">Admin only</p>
                <p>Updates as you change niches and keywords, from MVP&rsquo;s copy of every TRYBE brand: nothing is fetched from TRYBE or the websites.</p>
                {directory && (
                  <p>MVP&rsquo;s copy of TRYBE: <b>{directory.brands.toLocaleString()}</b> brands, {directory.withWebsite.toLocaleString()} with a website, {directory.websitesRead.toLocaleString()} websites read so far{directory.websitesRead < directory.withWebsite ? ' (the rest are read in the background, so website matches grow every hour)' : ''}.{directory.lastCollectedAt ? ` Collected ${new Date(directory.lastCollectedAt).toLocaleString()}.` : ''}</p>
                )}
                {findNotes.filter(n => ADMIN_NOTE.test(n)).map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}
            {findNotes.some(n => !ADMIN_NOTE.test(n)) && (
              <ul className="text-[12px] mb-3 space-y-0.5">{findNotes.filter(n => !ADMIN_NOTE.test(n)).map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
            {/* A niche alone is the quick way; a keyword is the better one. */}
            {cats.length > 0 && !kws.length && (live?.brands.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 mb-3" style={{ background: 'rgba(124,58,237,0.08)' }}>
                <Search size={14} style={{ color: PURPLE }} />
                <span className="text-[12px] flex-1 min-w-[12rem]">Showing every brand in {cats.length === 1 ? cats[0] : `${cats.length} niches`}. Add a keyword for brands that sell what you review.</span>
                <button onClick={() => { searchRef.current?.focus(); searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}
                  className="text-[12px] font-semibold rounded-lg px-2.5 py-1" style={{ background: PURPLE, color: '#fff' }}>Add a keyword</button>
              </div>
            )}
            {liveError && <p className="text-[12px] mb-3" style={{ color: RED }}>{liveError}</p>}
            {live && !live.brands.length && !liveLoading && (
              <p className="text-[13px]" style={soft}>{hasNiche ? 'No TRYBE brands match these niches and keywords yet. Try other words.' : 'Search a keyword or pick a niche to see the brands that match.'}</p>
            )}
            <div className="space-y-2">
              {(live?.brands || []).map(b => {
                const taken = TAKEN.includes(b.status as Brand['status'])
                const on = livePick.has(b.brand_id)
                const where = b.status === 'drafted' ? 'Ready to send' : b.status === 'sent' ? 'Sent' : b.status === 'sending' ? 'Sending or not confirmed' : b.status === 'already' ? 'Already requested on TRYBE' : b.status === 'failed' ? 'Last send failed: queue it again in Sent' : b.status === 'skipped' ? 'You skipped it' : b.status === 'removed' ? 'You removed it' : b.status === 'not_fit' ? 'AI said not a fit' : null
                const hits = (p: string) => kws.some(k => p.toLowerCase().includes(k.toLowerCase()))
                return (
                  <label key={b.brand_id} className={`flex gap-3 rounded-xl border p-3.5 ${taken ? 'opacity-60' : 'cursor-pointer'}`} style={{ borderColor: on ? PURPLE : 'var(--border)', background: on ? 'rgba(124,58,237,0.04)' : undefined }}>
                    <input type="checkbox" className="mt-3 accent-[#7C3AED]" checked={on} disabled={taken} aria-label={`Pick ${b.name}`}
                      onChange={e => setLivePick(p => { const n = new Set(p); if (e.target.checked) n.add(b.brand_id); else n.delete(b.brand_id); return n })} />
                    <BrandMark name={b.name} website={b.website} />
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold">{b.name}</span>
                        {where && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{where}</span>}
                        <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
                        {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {b.pay_text && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}>{b.pay_text}</span>}
                        {b.trybe_score != null && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 inline-flex items-center gap-0.5" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}><Star size={10} /> TRYBE score {b.trybe_score}</span>}
                        {b.fit_score != null && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 cursor-help" style={b.fit_score >= FIT_STRONG ? { background: 'rgba(22,163,74,0.14)', color: GREEN } : { background: 'rgba(180,83,9,0.10)', color: AMBER }}
                          title={`Fit ${b.fit_score} of 100: MVP's AI check of how well what this brand sells matches your niches and keywords, from its TRYBE profile and website. ${FIT_STRONG}+ is a strong fit.`}>Fit {b.fit_score}</span>}
                        {b.total_creators != null && (b.total_creators > 0 || sortBy === 'creators') && <span className="text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>{b.total_creators.toLocaleString()} creator{b.total_creators === 1 ? '' : 's'}</span>}
                        {sortBy === 'newest' && b.first_seen_at && <span className="text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>First seen {new Date(b.first_seen_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                      </span>
                      {b.fit_reason && <span className="block text-[12px] mt-1.5">{b.fit_reason}</span>}
                      {!b.fit_reason && b.about && <span className="block text-[12px] mt-1.5 line-clamp-2" style={soft}>{b.about}</span>}
                      {b.products.length > 0 && (
                        <span className="flex flex-wrap gap-1.5 mt-2">
                          {b.products.map(pr => (
                            <span key={pr} className="text-[11px] rounded-md border px-2 py-0.5 max-w-[16rem] truncate"
                              style={hits(pr) ? { borderColor: PURPLE, color: PURPLE, background: 'rgba(124,58,237,0.08)' } : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>{pr}</span>
                          ))}
                        </span>
                      )}
                      {b.categories.length > 0 && <span className="block text-[11px] mt-1.5" style={soft}>{b.categories.join(' • ')}</span>}
                    </span>
                    {/* One brand, one click: written straight into Ready to send. */}
                    {!taken && (
                      <button onClick={e => { e.preventDefault(); e.stopPropagation(); void draftPicked([b.brand_id]) }} disabled={busy}
                        className="self-start shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                        style={{ border: `1px solid ${PURPLE}`, color: PURPLE }} title="Write this brand a message now">
                        <MessageCircle size={12} /> Message
                      </button>
                    )}
                  </label>
                )
              })}
            </div>
            {live && (live.hiddenMine || showMine) ? (
              <p className="text-[12px] mt-3" style={soft}>
                {showMine
                  ? <>Showing brands you already messaged too. <button onClick={() => setShowMine(false)} className="font-semibold underline" style={{ color: PURPLE }}>Hide them</button></>
                  : <>{live.hiddenMine} brand{live.hiddenMine === 1 ? '' : 's'} you already messaged, wrote to or removed {live.hiddenMine === 1 ? 'is' : 'are'} hidden. <button onClick={() => setShowMine(true)} className="font-semibold underline" style={{ color: PURPLE }}>Show them</button></>}
              </p>
            ) : null}
            {/* What the pay filter left out, counted so the list is never quietly short. */}
            {live && payType !== 'any' && ((live.payUnknown ?? 0) + (live.payOther ?? 0)) > 0 && (
              <p className="text-[12px] mt-3" style={soft}>
                Pay filter: {live.payOther ? `${live.payOther.toLocaleString()} brand${live.payOther === 1 ? '' : 's'} paying ${payType === 'flat' ? '% of sales only' : 'a flat fee only'}` : ''}
                {live.payOther && live.payUnknown ? ' and ' : ''}
                {live.payUnknown ? `${live.payUnknown.toLocaleString()} that list no pay amount` : ''} {(live.payOther ?? 0) + (live.payUnknown ?? 0) === 1 ? 'is' : 'are'} hidden.{' '}
                <button onClick={() => setPayType('any')} className="font-semibold underline" style={{ color: PURPLE }}>Show any pay</button>
              </p>
            )}
            {live && live.matched > live.brands.length && (
              <p className="text-[12px] mt-3" style={soft}>Showing the best {live.brands.length} of {live.matched.toLocaleString()}{live.capped ? '+' : ''} matches. Add a keyword to narrow it down.</p>
            )}
          </div>
        ) : (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-[14px] font-semibold">3. Brands that fit ({found.length})</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => void findBrands(false)} disabled={busy || access !== 'granted'} className={btn} style={{ border: '1px solid var(--border)' }}>
                {finding ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find brands
              </button>
              <button onClick={() => void draftSelected()} disabled={busy || !found.some(b => selected.has(b.brand_id))} className={btn} style={{ background: PURPLE, color: '#fff' }}>
                <Sparkles size={13} /> Write {found.filter(b => selected.has(b.brand_id)).length} messages
              </button>
            </div>
          </div>
          <p className="text-[12px] mb-3" style={soft}>Be signed in to TRYBE in this browser. Best fits first; the top {DAILY_FIND} are ticked.</p>
          {isAdmin && directory && directory.brands > 0 && (
            <p className="text-[12px] mb-3" style={soft}>
              MVP&rsquo;s copy of TRYBE: <b>{directory.brands.toLocaleString()}</b> brands, {directory.withWebsite.toLocaleString()} with a website, {directory.websitesRead.toLocaleString()} websites read so far{directory.websitesRead < directory.withWebsite ? ' (the rest are read in the background, so website matches grow every hour)' : ''}.{directory.lastCollectedAt ? ` Collected ${new Date(directory.lastCollectedAt).toLocaleString()}.` : ''}
            </p>
          )}
          {findNotes.some(n => isAdmin || !ADMIN_NOTE.test(n)) && (
            <ul className="text-[12px] mb-3 space-y-0.5">{findNotes.filter(n => isAdmin || !ADMIN_NOTE.test(n)).map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {unjudged.length > 0 && !finding && (
            <p className="text-[12px] mb-3" style={{ color: AMBER }}>{unjudged.length} brand{unjudged.length === 1 ? '' : 's'} not yet checked against this niche. <button onClick={() => void judge(unjudged).finally(() => setFinding(null)).then(() => load())} className="underline">Check them now</button></p>
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
        )}
      </>)}

      {tab === 'queue' && (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <p className="text-[14px] font-semibold">Ready to send ({queue.length})</p>
            <div className="ml-auto flex items-center gap-2">
              {running && waitUntil && <span className="text-[12px]" style={soft}>Next request in {Math.max(0, Math.ceil((waitUntil - now) / 1000))}s</span>}
              {running
                ? <button onClick={() => { stopRef.current = true }} className={btn} style={{ border: '1px solid var(--border)' }}><Square size={13} /> Stop</button>
                : <>
                  {queue.length > 0 && <button onClick={() => void rewrite(queue)} disabled={!!finding} className={btn} style={{ border: '1px solid var(--border)' }} title="Write every message here again from your core message as it is now">
                    {finding ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Rewrite all
                  </button>}
                  <button onClick={() => void sendAll()} disabled={!!finding} className={btn} style={{ background: PURPLE, color: '#fff' }}><Send size={13} /> Send all ({Math.min(queue.length, remaining)})</button>
                </>}
            </div>
          </div>
          <p className="text-[12px] mb-3" style={soft}>
            {dailyFind
              ? <>Every day, when you open this page, MVP and SCOUT find up to {DAILY_FIND} new brands that fit your niche and write their messages here.{lastFindAt ? ` Last found ${new Date(lastFindAt).toLocaleString()}.` : ''} Skim, edit or remove, then press Send all.</>
              : <>The daily messages are off. Turn them on in Find brands, or pick brands there yourself.</>}
          </p>
          {sendBlocked && !running && queue.length > 0 && <p className="text-[12px] mb-3" style={{ color: AMBER }}>{sendBlocked}</p>}
          {running && <p className="text-[12px] mb-3" style={{ color: AMBER }}>{scoutAtLeast(scoutVersion, SCOUT_TRYBE_BACKGROUND_SEND_MIN_VERSION)
            ? `Keep this tab open. SCOUT sends each request in a TRYBE tab behind this one, ${runSize < SHORT_RUN_UNDER ? `${SHORT_GAP_MS / 1000} seconds apart` : '45 seconds to 2 minutes apart, with a longer pause every five'}. It comes to the front only if TRYBE needs it.`
            : `Keep this tab open. SCOUT opens TRYBE for each request and brings you back, ${runSize < SHORT_RUN_UNDER ? `${SHORT_GAP_MS / 1000} seconds apart` : '45 seconds to 2 minutes apart, with a longer pause every five'}.`}</p>}
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
          {!queue.length && <p className="text-[13px]" style={soft}>No messages ready yet. Pick brands in Find brands and press Write messages.</p>}
          <div className="space-y-3">
            {queue.map(b => <QueueRow key={b.brand_id} b={b} busy={current === b.brand_id} disabled={running} onSave={t => void saveDraft(b, t)} onRemove={() => void remove(b)} onRewrite={() => void rewrite([b])} rewriting={!!finding} scoutOpens={scoutOpens} onSendNow={t => void saveDraft(b, t).then(ok => { if (ok) void sendOne({ ...b, draft: t }) })} canSend={access === 'granted' && remaining > 0 && !finding} />)}
          </div>
          {/* Brands skipped before Remove existed: put back, or off the page. */}
          {brands.some(b => b.status === 'skipped') && (
            <div className="mt-4">
              <p className="text-[12px] font-semibold mb-1.5">Skipped</p>
              <div className="flex flex-wrap gap-2">
                {brands.filter(b => b.status === 'skipped').map(b => (
                  <span key={b.brand_id} className="inline-flex items-center gap-2 rounded-full border pl-3 pr-1.5 py-1 text-[12px]" style={{ borderColor: 'var(--border)' }}>
                    {b.name}
                    <button onClick={() => void skip(b, true)} title="Put it back" aria-label={`Put ${b.name} back`} className="inline-flex items-center gap-0.5 font-semibold" style={{ color: PURPLE }}><RotateCcw size={11} /> Restore</button>
                    <button onClick={() => void remove(b)} title="Remove it from this page" aria-label={`Remove ${b.name}`} className="rounded-full p-1" style={{ color: RED }}><Trash2 size={12} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'inbox' && <TrybeInbox scoutVersion={scoutVersion} allowed={access === 'granted'} openRequest={openChat} onOpened={() => setOpenChat(null)} onConvos={onInboxConvos}
        brandLink={name => { const b = brands.find(x => convoFor(x.name, [{ id: '', name, last: '', at: 0, unread: 0, raw: {} }])); return b ? { id: b.brand_id, name: b.name } : null }} scoutOpens={scoutOpens} />}

      {tab === 'sent' && (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-[14px] font-semibold">Sent and tried</p>
            {canInbox && (
              <button onClick={() => { void loadInbox(); if (canRequests) void loadRequests(true) }} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}><RotateCcw size={12} /> Check replies</button>
            )}
          </div>
          {/* WHO ANSWERED (Seb, 2026-10-07). Read from the TRYBE inbox: a brand
              whose conversation's last message is theirs has replied. A brand
              with no conversation has not answered on TRYBE yet. */}
          <p className="text-[12px] mb-3" style={soft}>
            {inbox ? `${repliedCount} of ${history.length} replied. Replies are read from your TRYBE inbox.`
              : inboxError ? `Replies could not be read from TRYBE: ${inboxError}`
              : canInbox ? 'Reading replies from your TRYBE inbox...' : 'Allow SCOUT on TRYBE to see which brands replied.'}
          </p>
          {/* ACCEPTED, PENDING, DECLINED (upgrade 1), from TRYBE's own request
              list. Not read is said as not read, never as zero accepted. */}
          {(history.length > 0 || (requests?.invites.length ?? 0) > 0) && (() => {
            if (!canRequests) return access === 'granted' ? <p className="text-[12px] mb-3" style={soft}>Accepted, pending and declined show here with SCOUT {SCOUT_TRYBE_INBOX_MIN_VERSION} or newer. Yours is {scoutVersion || 'unknown'}; Chrome updates it by itself.</p> : null
            if (!requests) return (
              <p className="text-[12px] mb-3 inline-flex items-center gap-1.5" style={soft}>
                <Loader2 size={12} className="animate-spin" /> Reading where your requests stand on TRYBE{requestsPage ? `, ${requestsPage}` : ''}. SCOUT reads TRYBE&rsquo;s brand list in a tab behind this one.
              </p>
            )
            const went = sentRows.filter(r => WENT.includes(r.b.status))
            const states = went.map(r => r.rq?.state).filter((x): x is RequestState => !!x)
            const n = (k: RequestState) => states.filter(x => x === k).length
            const rate = acceptRate(states)
            const notListed = went.filter(r => !requests.flags[r.b.brand_id]).length
            const needInbox = went.filter(r => { const f = requests.flags[r.b.brand_id]; return f && !f.pendingRequest && !inbox }).length
            return (
              <div className="text-[12px] mb-3 space-y-1">
                <p>
                  On TRYBE: <b style={{ color: GREEN }}>{n('accepted')} accepted</b>, <b style={{ color: AMBER }}>{n('pending')} pending</b>, <b style={{ color: RED }}>{n('declined')} declined or expired</b>
                  {rate != null ? `. ${rate}% of the brands that answered said yes` : ''}.{' '}
                  <span style={soft}>Read {new Date(requests.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</span>{' '}
                  {requestsPage
                    ? <span className="inline-flex items-center gap-1" style={soft}><Loader2 size={11} className="animate-spin" /> Reading again, {requestsPage}</span>
                    : <button onClick={() => void loadRequests(true)} className="font-semibold underline" style={{ color: PURPLE }}>Read again</button>}
                </p>
                {notListed > 0 && <p style={soft}>{notListed} sent {notListed === 1 ? 'brand is' : 'brands are'} not in TRYBE&rsquo;s brand list now, so {notListed === 1 ? 'it is' : 'they are'} not tagged.</p>}
                {needInbox > 0 && <p style={soft}>{needInbox} {needInbox === 1 ? 'request is' : 'requests are'} no longer pending. Accepted or declined is told from your TRYBE inbox, which could not be read.</p>}
                {requestsNote && <p style={{ color: AMBER }}>{requestsNote}</p>}
                {/* A brand that invited the creator is the warmest lead there is. */}
                {requests.invites.length > 0 && (
                  <p className="rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ background: 'rgba(22,163,74,0.10)' }}>
                    <b style={{ color: GREEN }}>{requests.invites.length} {requests.invites.length === 1 ? 'brand has' : 'brands have'} invited you on TRYBE:</b>
                    {requests.invites.slice(0, 8).map(f => <span key={f.brandId} className="inline-flex items-center gap-1">{f.name || 'A brand'} <TrybeLink brandId={f.brandId} name={f.name} scout={scoutOpens} /></span>)}
                    {requests.invites.length > 8 && <span style={soft}>and {requests.invites.length - 8} more</span>}
                  </p>
                )}
              </div>
            )
          })()}
          {(inbox || requests) && history.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([
                ['all', `All (${history.length})`],
                ...(inbox ? [['replied', `Replied (${repliedCount})`], ['waiting', `No reply yet (${sentRows.filter(r => r.reply !== 'replied').length})`]] : []),
                ...(requests ? [['accepted', `Accepted (${sentRows.filter(r => r.rq?.state === 'accepted').length})`], ['declined', `Declined (${sentRows.filter(r => r.rq?.state === 'declined').length})`]] : []),
              ] as Array<[typeof sentFilter, string]>).map(([id, label]) => (
                <button key={id} onClick={() => setSentFilter(id)} className="rounded-full border px-3 py-1 text-[12px] font-semibold"
                  style={sentFilter === id ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)' }}>{label}</button>
              ))}
            </div>
          )}
          {!history.length && <p className="text-[13px]" style={soft}>Nothing sent yet.</p>}
          <div className="space-y-2">
            {sentRows.filter(r => sentFilter === 'all' || (sentFilter === 'accepted' || sentFilter === 'declined' ? r.rq?.state === sentFilter : sentFilter === 'replied' ? r.reply === 'replied' : r.reply !== 'replied')).map(({ b, c, reply, lastMine, rq }) => (
              <div key={b.brand_id} className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: reply === 'replied' ? 'rgba(22,163,74,0.45)' : 'var(--border)' }}>
                <BrandMark name={b.name} website={b.website} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="text-[14px] font-semibold">{b.name}</span>
                    <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
                    {rq && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: REQUEST_WORDS[rq.state].bg, color: REQUEST_WORDS[rq.state].color }} title="Where this request stands in your TRYBE requests">{REQUEST_WORDS[rq.state].label}</span>}
                    {reply === 'replied' && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>Replied{b.replied_at ? ` ${new Date(b.replied_at).toLocaleDateString()}` : ''}</span>}
                    {reply === 'replied' && lastMine === true && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>You wrote last</span>}
                    {reply === 'none' && (b.status === 'sent' || b.status === 'already') && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>No reply yet</span>}
                    {c && c.unread > 0 && <span className="text-[11px] font-bold rounded-full px-1.5 text-white" style={{ background: PURPLE }}>{c.unread} new</span>}
                  </div>
                  <div className="text-[12px] mt-1">
                    {b.status === 'sent' && <span className="inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={12} /> Request sent {b.sent_at ? new Date(b.sent_at).toLocaleString() : ''}</span>}
                    {b.status === 'already' && <span style={soft}>Already requested on TRYBE</span>}
                    {b.status === 'failed' && (
                      <span className="inline-flex flex-wrap items-center gap-2" style={{ color: RED }}>
                        <AlertTriangle size={12} /> Not sent: {sendWords(b.error)}
                        {!running && b.draft && <button onClick={() => void requeue(b)} className="underline">Queue it again</button>}
                        {!running && <button onClick={() => void remove(b)} className="underline">Remove</button>}
                      </span>
                    )}
                    {b.status === 'sending' && current !== b.brand_id && (
                      <span className="inline-flex flex-wrap items-center gap-2" style={{ color: AMBER }}>
                        <AlertTriangle size={12} /> Not confirmed{b.error ? `: ${sendWords(b.error)}` : ''}. Is it in TRYBE&rsquo;s Pending Requests?
                        <button onClick={() => void settle(b, true)} className="underline">Yes, it went</button>
                        <button onClick={() => void settle(b, false)} className="underline">No, queue it again</button>
                      </span>
                    )}
                    {b.status === 'sending' && current === b.brand_id && <span className="inline-flex items-center gap-1" style={soft}><Loader2 size={12} className="animate-spin" /> Sending now</span>}
                  </div>
                  {c?.last && <p className="text-[12px] mt-1.5 rounded-lg px-2.5 py-1.5 line-clamp-2" style={{ background: 'var(--surface-2, rgba(0,0,0,0.04))' }}>{c.last}</p>}
                </div>
                {c && (
                  <button onClick={() => { setOpenChat(o => ({ id: c.id, n: (o?.n ?? 0) + 1 })); setTab('inbox') }}
                    className="self-start shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                    style={reply === 'replied' ? { background: PURPLE, color: '#fff' } : { border: `1px solid ${PURPLE}`, color: PURPLE }}>
                    <MessageCircle size={12} /> Open chat
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QueueRow({ b, busy, disabled, onSave, onRemove, onRewrite, rewriting, onSendNow, canSend, scoutOpens }: {
  b: Brand; busy: boolean; disabled: boolean; onSave: (t: string) => void; onRemove: () => void; onRewrite: () => void; rewriting: boolean; scoutOpens: boolean
  /** Saves the text shown, then sends it: never an older copy. */
  onSendNow: (text: string) => void; canSend: boolean
}) {
  const [text, setText] = useState(b.draft || '')
  // COMPACT UNTIL OPENED (Seb, 2026-10-07): a short preview per brand, the
  // full box only for the one being edited.
  const [open, setOpen] = useState(false)
  useEffect(() => { setText(b.draft || '') }, [b.draft])
  const researched = !!(b.site_summary || (b.site_products && b.site_products.length))
  const soft = { color: 'var(--text-soft)' }
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: busy ? PURPLE : 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-3">
        <BrandMark name={b.name} website={b.website} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold">{b.name}</span>
            {b.worked_with && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>You already promote them</span>}
            {b.pay_text && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}>{b.pay_text}</span>}
            <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
            {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
            {busy && <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: PURPLE }}><Loader2 size={11} className="animate-spin" /> Sending now</span>}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: researched ? GREEN : AMBER }}>
            {researched ? 'Written knowing their website' : `Website not read${b.site_error ? `: ${b.site_error}` : ''}`}
          </p>
          {!open && (
            <button onClick={() => setOpen(true)} className="block w-full text-left mt-2 rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap line-clamp-3" style={{ background: 'var(--surface-2, rgba(0,0,0,0.04))' }} title="Open to read or edit">
              {text || 'No message yet.'}
            </button>
          )}
          {open && (<>
            <textarea value={text} onChange={e => setText(e.target.value)} onBlur={() => onSave(text)} rows={10} disabled={disabled} autoFocus
              className="w-full mt-2 rounded-lg border p-2.5 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
            <p className="text-[11px] mt-1" style={soft}>{text.length} characters, sent as shown, line breaks included. Changes save when you click away.</p>
          </>)}
          {b.error && <p className="text-[11px] mt-1" style={{ color: RED }}>Last try: {sendWords(b.error)}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[12px]">
            <button onClick={() => { if (open) onSave(text); setOpen(o => !o) }} className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--text)' }}>
              {open ? <><ChevronUp size={12} /> Done</> : <><Pencil size={11} /> Edit</>}
            </button>
            <button onClick={onRewrite} disabled={disabled || rewriting} className="inline-flex items-center gap-1 font-semibold disabled:opacity-50" style={{ color: PURPLE }} title="Write it again from your core message as it is now"><RotateCcw size={11} /> Rewrite</button>
            <button onClick={onRemove} disabled={disabled} className="inline-flex items-center gap-1 font-semibold disabled:opacity-50" style={{ color: RED }}><Trash2 size={11} /> Remove</button>
            <button onClick={() => onSendNow(text)} disabled={disabled || !canSend || !text.trim()} className="ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }} title="Send just this one now">
              <Send size={11} /> Send now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
