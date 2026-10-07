'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Handshake, RefreshCw, X } from 'lucide-react'
import { getScoutInstallKind, setLiftoffAuto, requestTrybeAccess } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL, SCOUT_COMMENT_POST_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'
import { usesStudioUpload } from '@/lib/studio-upload'

/**
 * SCOUT IS NOT OPTIONAL (Seb, 2026-10-06: "make sure users download and
 * activate scout.. this is imperative").
 *
 * SCOUT uploads bulk videos through YouTube Studio and posts first comments
 * from the member's own Chrome, at no cost to the one YouTube quota every MVP
 * account shares. In the week this was written, 386 of 411 first comments
 * went through the API instead, because SCOUT only started its background
 * work when the member opened Liftoff, and most never did.
 *
 * On every dashboard page this:
 *   1. finds SCOUT in this Chrome and says plainly what is missing, until it
 *      is installed, current, and working in the background;
 *   2. switches SCOUT's background work on (unless the member turned it off on
 *      the Liftoff page) and, when first comments are due, asks SCOUT to come
 *      back and post them;
 *   3. tells MVP what it found (app/api/scout/seen), so admin can see who has it.
 *
 * Each state reads differently from the others and from success, which shows
 * nothing at all. Hidden for this visit only by the X; it returns on the next.
 */

type Phase =
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'phone' }
  | { kind: 'not-chrome' }
  | { kind: 'missing' }
  | { kind: 'old'; version: string | null; sideload: boolean }
  | { kind: 'bg-off' }
  | { kind: 'bg-failed'; why: string }
  /** Working, but not yet allowed on TRYBE (an optional permission). */
  | { kind: 'trybe' }

const HIDE_KEY = 'mvp_scout_required_hidden'
const ARMED_KEY = 'mvp_scout_armed_at'
const SEEN_KEY = 'mvp_scout_seen_at'

function sessionGet(k: string): string | null { try { return window.sessionStorage.getItem(k) } catch { return null } }
function sessionSet(k: string, v: string) { try { window.sessionStorage.setItem(k, v) } catch { /* this page only */ } }

/** Tell MVP what this Chrome has, at most once an hour per tab session. */
function reportSeen(install: 'store' | 'sideload' | 'none', version: string | null, background: boolean | null) {
  const last = Number(sessionGet(SEEN_KEY) || 0)
  const sig = `${install}|${version}|${background}`
  if (Date.now() - last < 3_600_000 && sessionGet(`${SEEN_KEY}_sig`) === sig) return
  // MARKED SENT ONLY ONCE SAVED. Marked before, a save that failed (the
  // columns not there yet, a dropped connection) kept this tab quiet for an
  // hour, and every member read "not seen yet" while using MVP in Chrome.
  void fetch('/api/scout/seen', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ install, version, background }),
  }).then((r) => {
    if (r.ok) { sessionSet(SEEN_KEY, String(Date.now())); sessionSet(`${SEEN_KEY}_sig`, sig) }
  }).catch(() => { /* the banner does not depend on it; the next look tries again */ })
}

/** First comments due now, or soon: SCOUT is asked to come back for them, so
 *  they post from this Chrome instead of through the shared quota. */
async function armForDueComments(): Promise<void> {
  if (Date.now() - Number(sessionGet(ARMED_KEY) || 0) < 10 * 60_000) return
  sessionSet(ARMED_KEY, String(Date.now()))
  try {
    const r = await fetch('/api/youtube/first-comment/scout', { cache: 'no-store' })
    const d = await r.json().catch(() => null) as { on?: boolean; comments?: unknown[]; nextAt?: string | null } | null
    if (!r.ok || !d?.on) return
    if (Array.isArray(d.comments) && d.comments.length > 0) { await setLiftoffAuto(true, 1); return }
    const at = d.nextAt ? Date.parse(d.nextAt) : NaN
    if (Number.isFinite(at)) await setLiftoffAuto(true, Math.max(1, Math.min(1440, Math.ceil((at - Date.now()) / 60_000))))
  } catch { /* the cron still posts it, later */ }
}

export default function ScoutRequired({ tier }: { tier: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [hidden, setHidden] = useState(true)
  const [busy, setBusy] = useState(false)
  const applies = usesStudioUpload(tier)
  const running = useRef(false)

  const check = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
      // A phone cannot run a Chrome extension, so there is nothing to ask.
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) { setPhase({ kind: 'phone' }); return }
      const found = await getScoutInstallKind()
      if (found.kind === 'none') {
        reportSeen('none', null, null)
        // Chrome, Edge and Brave install from the Chrome Web Store; Safari and
        // Firefox cannot.
        setPhase({ kind: /Chrome\//.test(ua) ? 'missing' : 'not-chrome' })
        return
      }
      if (!scoutAtLeast(found.version, SCOUT_COMMENT_POST_MIN_VERSION)) {
        reportSeen(found.kind, found.version, null)
        setPhase({ kind: 'old', version: found.version, sideload: found.kind === 'sideload' })
        return
      }
      let off = false
      try { off = window.localStorage.getItem('mvp_liftoff_bg') === 'off' } catch { /* default on */ }
      if (off) { reportSeen(found.kind, found.version, false); setPhase({ kind: 'bg-off' }); return }
      const st = await setLiftoffAuto(true)
      if (!st || !st.ok || !st.on || !st.hasAlarms) {
        reportSeen(found.kind, found.version, false)
        const why = !st ? 'SCOUT did not answer'
          : st.error === 'bad-origin' ? 'SCOUT does not recognise this address'
          : st.error === 'no-reply' ? 'SCOUT did not answer'
          : !st.hasAlarms ? 'this SCOUT cannot wake itself'
          : 'SCOUT said no'
        setPhase({ kind: 'bg-failed', why })
        return
      }
      reportSeen(found.kind, found.version, true)
      void armForDueComments()
      // TRYBE, ASKED ONCE OF EVERY SCOUT USER (Seb, 2026-10-07: "every scout
      // user to approve TRYBE"). Kept an optional permission: made required,
      // Chrome would switch SCOUT off for every current user until they
      // accepted it. So it is one click here instead. A SCOUT too old to know
      // TRYBE ('old') is not asked; Chrome updates it and it is asked then.
      const t = await requestTrybeAccess(false).catch(() => null)
      setPhase({ kind: t?.state === 'not-granted' ? 'trybe' : 'ok' })
    } finally {
      running.current = false
    }
  }, [])

  useEffect(() => {
    if (!applies) return
    setHidden(sessionGet(HIDE_KEY) === '1')
    void check()
    // Back from the Web Store tab with SCOUT just added: look again.
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [applies, check])

  if (!applies || hidden) return null
  if (phase.kind === 'checking' || phase.kind === 'ok' || phase.kind === 'phone') return null

  const urgent = phase.kind === 'missing' || phase.kind === 'bg-failed'
  // Asking for TRYBE is an invitation, not a fault: purple, not orange or red.
  const accent = urgent ? '#ff3b30' : phase.kind === 'trybe' ? '#7C3AED' : '#ff9500'

  function hide() { sessionSet(HIDE_KEY, '1'); setHidden(true) }

  async function turnOn() {
    setBusy(true)
    try { window.localStorage.setItem('mvp_liftoff_bg', 'on') } catch { /* this visit */ }
    await check()
    setBusy(false)
  }

  async function allowTrybe() {
    setBusy(true)
    try { await requestTrybeAccess(true) } catch { /* the check below says how it stands */ }
    await check()
    setBusy(false)
  }

  async function again() {
    setBusy(true)
    await check()
    setBusy(false)
  }

  const what = 'SCOUT uploads your bulk videos through YouTube Studio and posts and pins your first comments from this Chrome'
  let text: ReactNode
  let action: ReactNode = null
  const btn = 'flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60'
  const quiet = 'flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold border disabled:opacity-60'
  const store = (label: string) => (
    <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className={btn} style={{ background: accent }}>
      {label} <ArrowRight size={12} />
    </a>
  )

  if (phase.kind === 'missing') {
    text = <><b>SCOUT is not installed in this Chrome.</b> {what}, without using YouTube&rsquo;s shared daily allowance. Without it, bulk uploads wait and first comments post up to three hours late.</>
    action = <>{store('Add SCOUT to Chrome')}<button onClick={again} disabled={busy} className={quiet} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> I added it</button></>
  } else if (phase.kind === 'not-chrome') {
    text = <><b>SCOUT runs in Google Chrome.</b> {what}. Open MVP in Chrome on your computer and add SCOUT there, so your uploads and comments keep going.</>
    action = store('Get SCOUT')
  } else if (phase.kind === 'old') {
    text = phase.sideload
      ? <><b>Your SCOUT is an old manual copy{phase.version ? ` (${phase.version})` : ''} that Chrome cannot update.</b> Add SCOUT from the Chrome Web Store, then remove the old copy in Chrome&rsquo;s Extensions page.</>
      : <><b>Your SCOUT{phase.version ? ` (${phase.version})` : ''} is too old to upload and post comments.</b> Chrome updates it by itself; restarting Chrome usually gets the new version sooner.</>
    action = <>{phase.sideload ? store('Add SCOUT from the Web Store') : null}<button onClick={again} disabled={busy} className={quiet} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Check again</button></>
  } else if (phase.kind === 'bg-off') {
    text = <><b>SCOUT&rsquo;s background work is off in this Chrome.</b> Your bulk uploads and first comments only go out while Liftoff is open, and comments post up to three hours late.</>
    action = <button onClick={turnOn} disabled={busy} className={btn} style={{ background: accent }}>Turn it on <ArrowRight size={12} /></button>
  } else if (phase.kind === 'trybe') {
    text = <><b>One more step: allow SCOUT on TRYBE.</b> TRYBE is a free marketplace where brands pay creators for videos. With this allowed, MVP can find TRYBE brands that fit your niche and SCOUT can send your requests. One click, once; Chrome asks you to confirm.</>
    action = <button onClick={allowTrybe} disabled={busy} className={btn} style={{ background: accent }}>Allow SCOUT on TRYBE <ArrowRight size={12} /></button>
  } else {
    text = <><b>SCOUT is installed but is not working in the background</b> ({phase.why}). Reload this page. If this keeps showing, remove SCOUT and add it again from the Chrome Web Store.</>
    action = <><button onClick={again} disabled={busy} className={quiet} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Try again</button>{store('Chrome Web Store')}</>
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2.5 border-b px-6 py-2 text-[12px]"
      style={{ borderColor: 'var(--border)', backgroundColor: `${accent}14` }}
    >
      {phase.kind === 'trybe'
        ? <Handshake size={14} style={{ color: accent }} className="flex-shrink-0" />
        : <AlertTriangle size={14} style={{ color: accent }} className="flex-shrink-0" />}
      <span className="flex-1 min-w-[16rem]" style={{ color: 'var(--text)' }}>{text}</span>
      <span className="ml-auto flex items-center gap-2">{action}</span>
      <button onClick={hide} aria-label="Hide until your next visit" title="Hide until your next visit" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
        <X size={14} />
      </button>
    </div>
  )
}
