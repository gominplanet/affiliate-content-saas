'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOOKS WINNING ON TRYBE (Huntr's "Winning Hooks"; Seb 2026-10-14): the
// opening lines of this week's Top 100 videos, kept by MVP (lib/trybe-hooks),
// one press away in Make videos. Every video plan reads them too. Read once a
// visit; not read yet or failed is said, never an empty list.

import { useState } from 'react'
import { Flame, Loader2, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { toast } from 'sonner'

interface Hook { hook: string; brandName: string | null; rank: number | null }
let kept: { at: string | null; hooks: Hook[] } | null = null

export default function TrybeTopHooks() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(kept)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const soft = { color: 'var(--text-soft)' }

  async function toggle() {
    setOpen((o) => !o)
    if (data || loading) return
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'top_hooks' }), signal: AbortSignal.timeout(20_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      kept = { at: d.at ?? null, hooks: (d.hooks || []) as Hook[] }
      setData(kept)
    } catch (e) { setError(e instanceof Error ? e.message : 'MVP could not read the hooks.') }
    finally { setLoading(false) }
  }

  return (
    <div className="mt-2">
      <button onClick={() => void toggle()} aria-expanded={open} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ border: '1px solid var(--border)' }}
        title="The opening lines of this week's Top 100 videos on TRYBE, for every brand. Your video ideas learn from them too.">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Flame size={12} style={{ color: '#EA580C' }} />} Hooks winning on TRYBE
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {error && <p style={{ color: '#B45309' }}>{error}</p>}
          {data && !data.hooks.length && <p style={soft}>Not read yet. MVP keeps them each time the MVP team reads TRYBE&rsquo;s Top 100; they show here after the next read.</p>}
          {data && data.hooks.length > 0 && (<>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>Top 100 openings{data.at ? `, read ${new Date(data.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}: learn the style, never copy the words</p>
            <ol className="mt-1.5 space-y-1">
              {data.hooks.slice(0, 12).map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[11px] font-bold tabular-nums w-7 shrink-0" style={soft}>{h.rank ? `#${h.rank}` : ''}</span>
                  <span className="flex-1 min-w-0">&ldquo;{h.hook}&rdquo;{h.brandName && <span style={soft}> · {h.brandName}</span>}</span>
                  <button onClick={() => { void navigator.clipboard?.writeText(h.hook).then(() => toast.success('Copied: make it yours before you film it')).catch(() => toast.error('Could not copy')) }} aria-label="Copy" style={soft}><Copy size={12} /></button>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-[11px]" style={soft}>Your video ideas already learn from these: the question, the claim, the problem shown first.</p>
          </>)}
        </div>
      )}
    </div>
  )
}
