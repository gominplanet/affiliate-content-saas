'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE HAS TO BE OPEN FIRST (Seb, 2026-10-20: "As soon as I open the tribe
// feature, nothing happens. No inbox, no make videos, no nothing, because I
// don't already have a window that's open under my tribe account ... we need
// to have a very visible button before anything happens, maybe even a pop-up").
//
// Everything on TRYBE goes through the creator's own TRYBE tab (lib/trybe-tab).
// Until one is open and signed in, a card at the top says so with one button,
// and a pop-up says it once a visit. With SCOUT 1.53.5 the button opens TRYBE
// in a tab next to MVP's, behind it; before that, a new tab the usual way.
// Both go away by themselves once TRYBE is open.

import { useEffect, useState } from 'react'
import { ExternalLink, Handshake, X, Loader2 } from 'lucide-react'
import { requestTrybeTabOpen } from '@/lib/extension-frame'
import { TRYBE_OPEN_URL, type TrybeTabState } from '@/lib/trybe-tab'

const PURPLE = '#7C3AED'
const SEEN_KEY = 'mvp.trybe.tabGate.shown'

export default function TrybeTabGate({ state, inBackground, onCheck }: {
  state: TrybeTabState | 'checking'
  /** SCOUT can open TRYBE behind MVP's tab (1.53.5+). */
  inBackground: boolean
  /** Look again at whether TRYBE is open. */
  onCheck: () => void
}) {
  const needed = state === 'closed' || state === 'signed-out' || state === 'unknown'
  const [pop, setPop] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    if (!needed) { setPop(false); return }
    let shown = false
    try { shown = sessionStorage.getItem(SEEN_KEY) === '1' } catch { /* show it */ }
    if (!shown) { setPop(true); try { sessionStorage.setItem(SEEN_KEY, '1') } catch { /* this visit only */ } }
  }, [needed])

  // While it is needed, look again every few seconds: signing in happens in
  // another tab, and this page should notice without a reload.
  useEffect(() => {
    if (!needed) return
    const t = window.setInterval(onCheck, 5000)
    return () => window.clearInterval(t)
  }, [needed, onCheck])

  if (!needed) return null

  const signedOut = state === 'signed-out'
  const title = signedOut ? 'Sign in to TRYBE to start' : 'Open TRYBE to start'
  const text = signedOut
    ? 'Your TRYBE tab is open but signed out. Sign in there, then come back to this tab. MVP reads your inbox, brands and videos through that tab.'
    : 'MVP talks to TRYBE through a TRYBE tab in this Chrome: your inbox, brands, videos and every request it sends. Open it once, sign in, and leave it open in the background while you work.'

  async function open() {
    setSaid(null)
    if (!inBackground) { window.open(TRYBE_OPEN_URL, '_blank', 'noopener'); return }
    setBusy(true)
    const r = await requestTrybeTabOpen(signedOut)
    setBusy(false)
    if (!r.open) { setSaid(`SCOUT could not open TRYBE (${r.error || 'no answer'}). Use the link: `); return }
    setSaid(signedOut ? 'There it is: sign in on the TRYBE tab, then come back here.' : 'TRYBE is open in the tab next to this one. Leave it open; this page notices once you are signed in.')
    window.setTimeout(onCheck, 2500)
  }

  const button = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button onClick={() => void open()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: PURPLE }}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} {signedOut && inBackground ? 'Go to the TRYBE tab' : 'Open TRYBE'}
      </button>
      {said && <span className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>{said}{said.endsWith(': ') && <a href={TRYBE_OPEN_URL} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: PURPLE }}>open jointrybe.com</a>}</span>}
    </span>
  )

  return (
    <>
      <section className="rounded-2xl border-2 p-5 flex flex-col gap-3" style={{ borderColor: PURPLE, background: 'rgba(124,58,237,0.06)' }} role="alert">
        <p className="text-[18px] font-bold inline-flex items-center gap-2"><Handshake size={18} style={{ color: PURPLE }} /> {title}</p>
        <p className="text-[13.5px] max-w-3xl leading-relaxed" style={{ color: 'var(--text)' }}>{text}</p>
        {button}
      </section>

      {pop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} role="dialog" aria-modal="true" aria-label={title}>
          <div className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-3" style={{ background: 'var(--surface)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
            <div className="flex items-start gap-2">
              <p className="text-[18px] font-bold flex-1 inline-flex items-center gap-2"><Handshake size={18} style={{ color: PURPLE }} /> {title}</p>
              <button onClick={() => setPop(false)} aria-label="Not now" className="p-1" style={{ color: 'var(--text-soft)' }}><X size={16} /></button>
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text)' }}>{text}</p>
            {button}
            <button onClick={() => setPop(false)} className="self-start text-[12.5px] underline" style={{ color: 'var(--text-soft)' }}>Not now</button>
          </div>
        </div>
      )}
    </>
  )
}
