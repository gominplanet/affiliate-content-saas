'use client'

// Ingest-token grab strip for the dashboard hero — sits right under the
// "Theme & Plugin" / "Scout Extension" pills. When SCOUT is installed the user
// still has to paste their MVP ingest token into the SCOUT popup to connect it;
// that token used to be buried on the AMZ+ & EPC page. This surfaces it in the
// one place a fresh SCOUT user is already looking — one click to copy.
//
// Only renders when SCOUT is actually installed (nothing to connect otherwise)
// and is dismissible once they've pasted it.

import { useEffect, useState } from 'react'
import { Copy, Check, Puzzle, X } from 'lucide-react'
import { getScoutInstallKind } from '@/lib/extension-frame'

const DISMISS_KEY = 'mvp_scout_token_strip_dismissed'

export default function ScoutTokenStrip() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1') } catch { /* ignore */ }
  }, [])

  // Only show when SCOUT is installed (store or sideload) — that's when the user
  // needs the token to connect it.
  useEffect(() => {
    let cancelled = false
    getScoutInstallKind()
      .then(s => { if (!cancelled) setInstalled(s.kind === 'store' || s.kind === 'sideload') })
      .catch(() => { if (!cancelled) setInstalled(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!installed) return
    fetch('/api/campaigns/ingest-token')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setToken((d?.token as string) ?? null))
      .catch(() => { /* non-fatal — strip just won't render */ })
  }, [installed])

  if (dismissed || !installed || !token) return null

  const masked = token.length > 14 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — the masked value is still visible to select */ }
  }
  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  return (
    <div
      className="mt-3 inline-flex items-center gap-2 flex-wrap rounded-xl border px-3 py-2"
      style={{ background: 'rgba(255,149,0,0.06)', borderColor: 'rgba(255,149,0,0.28)' }}
    >
      <Puzzle size={14} style={{ color: '#FF9500' }} className="flex-shrink-0" />
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text, #1d1d1f)' }}>SCOUT token</span>
      <code
        className="text-[12px] font-mono px-2 py-0.5 rounded"
        style={{ background: 'var(--surface, #fff)', color: 'var(--text-soft, #6e6e73)' }}
        title="Paste this into the SCOUT popup's ingest-token field"
      >
        {masked}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-md text-white transition-opacity hover:opacity-90"
        style={{ background: '#FF9500' }}
      >
        {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
      </button>
      <span className="text-[11px]" style={{ color: 'var(--text-faint, #86868b)' }}>
        Paste into the SCOUT popup to connect it.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ml-0.5 p-0.5 rounded transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-faint, #86868b)' }}
        title="Hide (I've connected SCOUT)"
      >
        <X size={13} />
      </button>
    </div>
  )
}
