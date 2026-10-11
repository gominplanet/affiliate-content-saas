'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Request indexing for one post, in two honest steps (Seb, 2026-10-11: "this
// still opens a blank page"). The old button opened an empty tab and steered
// it once Google's link came back; in some browsers that tab stayed blank.
// Now MVP fetches Google's link first and shows it as a real link to click.
// No link: it says why, copies the address and links Search Console's home,
// where the "Inspect any URL" bar is. A visit is only recorded when the
// creator actually opens Google's page.

import { useState } from 'react'
import { ExternalLink, Loader2, Send, Copy, Check } from 'lucide-react'
import { fetchInspectionLink, markRequested, searchConsoleHome, type InspectionLink } from '@/lib/gsc-request-client'

export default function RequestIndexingButton({ url, property, again, small, label }: {
  url: string
  property: string | null
  /** Already opened this week: the first button reads "Ask again". */
  again?: boolean
  small?: boolean
  /** The first button's words, when this is not a request (e.g. a 404 post). */
  label?: string
}) {
  const [state, setState] = useState<'idle' | 'loading' | InspectionLink>('idle')
  const [copied, setCopied] = useState(false)
  const pad = small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]'
  const primary = `inline-flex items-center gap-1 rounded-full font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 ${pad}`
  const quiet = `inline-flex items-center gap-1 rounded-full font-semibold border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/60 ${pad}`

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* the address is shown */ }
  }

  if (state === 'idle' || state === 'loading') {
    return (
      <button disabled={state === 'loading'} onClick={async () => { setState('loading'); setState(await fetchInspectionLink(url)) }} className={again ? quiet : primary}>
        {state === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
        {state === 'loading' ? 'Getting Google\'s link…' : label || (again ? 'Ask again' : 'Request indexing')}
      </button>
    )
  }

  if (state.link) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <a href={state.link} target="_blank" rel="noopener noreferrer" onClick={() => markRequested(url)} className={primary}>
          Open this post in Search Console <ExternalLink size={10} />
        </a>
        {/* If Google's page will not load for this account, the address is one click away. */}
        <button onClick={copy} className={quiet} title="Copy the post's address, to paste into Search Console's Inspect bar">{copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy address'}</button>
        <span className="text-[11px] text-[#86868b]">
          {state.indexed ? 'Google already has this post, so there is nothing to request.' : label ? 'Google\'s page for this post opens in a new tab.' : 'Wait for the page to finish testing, then press Request indexing.'}
        </span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <a href={searchConsoleHome(property)} target="_blank" rel="noopener noreferrer" onClick={() => { void copy(); markRequested(url) }} className={primary}>
        Open Search Console <ExternalLink size={10} />
      </a>
      <button onClick={copy} className={quiet}>{copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy address'}</button>
      <span className="basis-full text-[11px] text-[#ff9500]">
        {state.error} Paste the address into the "Inspect any URL" bar at the top of Search Console, then press Request indexing.
      </span>
    </span>
  )
}
