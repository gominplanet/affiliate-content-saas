// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Paste box on the Passport Links page: drop any Amazon product link (or an
// amzn.to / geni.us short link) and get a ready-to-share Passport Link back
// instantly. Calls POST /api/passport/link { url }, which resolves the link to
// an ASIN and mints (or reuses) the creator's geo-routing short link.

'use client'

import { useState } from 'react'
import { Link2, Loader2, Check, Copy, ArrowRight } from 'lucide-react'

export default function PassportQuickLink({ onCreated }: { onCreated?: () => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function create() {
    const url = input.trim()
    if (!url || busy) return
    setBusy(true); setError(null); setResult(null); setCopied(false)
    try {
      const res = await fetch('/api/passport/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) { setError(j.error || 'Could not create the link.'); return }
      setResult(j.url as string)
      onCreated?.()
    } catch { setError('Network error. Please try again.') } finally { setBusy(false) }
  }

  async function copy() {
    if (!result) return
    try { await navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={15} style={{ color: '#7C3AED' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Create a Passport Link</h2>
      </div>
      <p className="text-[12.5px] mb-3" style={{ color: 'var(--text-3)' }}>
        Paste any Amazon product link (or an amzn.to / geni.us short link) and get a geo-routing link back. It sends every visitor to their own country&apos;s Amazon with your tag there.
      </p>

      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <input
          type="url" inputMode="url" autoComplete="off" spellCheck={false}
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') create() }}
          placeholder="https://www.amazon.com/dp/B0..."
          className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-[13px] focus:outline-none"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <button onClick={create} disabled={busy || !input.trim()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50 flex-shrink-0"
          style={{ background: 'linear-gradient(45deg, #6D28D9 0%, #7C3AED 100%)' }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <>Create link <ArrowRight size={14} /></>}
        </button>
      </div>

      {error && <p className="text-[12px] mt-2" style={{ color: '#ef4444' }}>{error}</p>}

      {result && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border p-2.5"
          style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.06)' }}>
          <a href={result} target="_blank" rel="noopener noreferrer"
            className="flex-1 min-w-0 truncate text-[13px] font-semibold" style={{ color: '#7C3AED' }}>{result}</a>
          <button onClick={copy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold flex-shrink-0"
            style={{ background: copied ? 'rgba(16,185,129,0.15)' : 'var(--surface-2)', color: copied ? '#10B981' : 'var(--text-soft)' }}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
      )}
    </div>
  )
}
