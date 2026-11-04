'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRODUCT'S TITLES, PICKED BEFORE THE VIDEO IS ADDED (Seb, 2026-11-04:
// "before the user actually ... clicks to add to the queue, that the user
// actually choose the top 5 title they want from the list"). From the
// product box (an ASIN, a link, or a name) MVP suggests ten titles
// (lib/review-edit-callouts); the creator ticks up to five, or types their
// own, and those go on the video (lib/review-edit calloutTimes). Where the
// titles came from is said, so ones written from a web search are checked.

import { useState, type ReactNode } from 'react'
import { Loader2, Sparkles, Check, X, Plus } from 'lucide-react'
import { MAX_CALLOUTS, MAX_CALLOUT_CHARS, cleanCallouts } from '@/lib/review-edit'

const soft = { color: 'var(--text-3)' }
const FROM: Record<string, string> = { amazon: 'the Amazon listing', page: 'the product’s own page', web: 'a web search, so check each one against the product' }

export default function CalloutPicker({ product, value, onChange, disabled = false }: {
  /** What is in the product box: an ASIN, a link, or a name. */
  product: string
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}) {
  const [ideas, setIdeas] = useState<string[] | null>(null)
  const [about, setAbout] = useState<{ product: string; from: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [own, setOwn] = useState('')
  const full = value.length >= MAX_CALLOUTS

  const suggest = async () => {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/review-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'product_titles', product }) })
      const d = await r.json().catch(() => ({})) as { titles?: string[]; product?: string; from?: string; error?: string }
      if (!r.ok || !d.titles?.length) { setError(d.error || 'MVP could not suggest titles. Type your own.'); return }
      setIdeas(d.titles)
      setAbout({ product: d.product || '', from: d.from || '' })
    } catch { setError('MVP did not answer. Try again.') } finally { setBusy(false) }
  }
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((v) => v !== t) : full ? value : cleanCallouts([...value, t]))
  const addOwn = () => { if (own.trim() && !full) { onChange(cleanCallouts([...value, own])); setOwn('') } }
  const chip = (t: string, on: boolean, extra?: ReactNode) => (
    <button key={t} type="button" onClick={() => toggle(t)} disabled={disabled || (!on && full)} aria-pressed={on}
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold text-left disabled:opacity-50"
      style={on ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : { borderColor: 'var(--border-2)', color: 'var(--text-2)', background: 'var(--surface)' }}>
      {on && <Check size={12} className="shrink-0" />}{t}{extra}
    </button>
  )
  const mine = value.filter((v) => !ideas?.includes(v))

  return (
    <div className="flex flex-col gap-1.5" aria-label="Product titles on the video">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>Product titles on the video</span>
        <button type="button" onClick={() => void suggest()} disabled={disabled || busy || !product.trim()}
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold underline disabled:opacity-50 disabled:no-underline" style={{ color: 'var(--accent-text)' }}
          title={product.trim() ? undefined : 'Put the product’s ASIN or link in the box first'}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {busy ? 'Reading the product' : ideas ? 'Suggest again' : 'Suggest 10 titles'}
        </button>
        <span className="text-[12px]" style={soft}>{value.length} of {MAX_CALLOUTS} picked{!product.trim() && !ideas ? '. Add the product’s ASIN or link above for suggestions.' : ''}</span>
      </div>
      {error && <p className="text-[12px]" style={{ color: '#B45309' }}>{error}</p>}
      {ideas && about && <p className="text-[12px]" style={soft}>{about.product ? `${about.product}: ` : ''}written from {FROM[about.from] || 'the product'}. Pick up to {MAX_CALLOUTS}.</p>}
      {ideas && <div className="flex flex-wrap gap-1.5">{ideas.map((t) => chip(t, value.includes(t)))}</div>}
      {mine.length > 0 && <div className="flex flex-wrap gap-1.5">{mine.map((t) => chip(t, true, <X size={12} className="shrink-0 opacity-80" aria-label={`Take ${t} off`} />))}</div>}
      <div className="flex items-center gap-1.5 max-w-md">
        <input value={own} onChange={(e) => setOwn(e.target.value.slice(0, MAX_CALLOUT_CHARS))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn() } }}
          disabled={disabled || full} placeholder={full ? `${MAX_CALLOUTS} picked` : 'Or type your own'}
          className="flex-1 min-w-0 rounded-lg border px-2 py-1 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border-2)', color: 'var(--text)' }} />
        <button type="button" onClick={addOwn} disabled={disabled || full || !own.trim()} aria-label="Add this title" className="rounded-lg border p-1 disabled:opacity-50" style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }}><Plus size={14} /></button>
      </div>
      {value.length > 0 && <p className="text-[12px]" style={soft}>Each shows for a few seconds when you talk about it, or spread through the video if you never do. Their style, colour, size and place are in Your look, under Product titles.</p>}
    </div>
  )
}
