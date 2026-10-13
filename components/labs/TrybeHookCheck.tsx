'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CHECK MY HOOK (Seb, 2026-10-13, after Lukas Pakter, TRYBE's co-founder).
// Paste a script: MVP says, by fixed rules, what would cost it the first two
// seconds (lib/trybe-hook), and on request writes three new openings that
// pass the same rules. The check itself costs nothing and runs as you type.

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Wand2, Copy, Check, CircleCheck, AlertTriangle, XCircle } from 'lucide-react'
import { checkHook } from '@/lib/trybe-hook'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

export default function TrybeHookCheck() {
  const [script, setScript] = useState('')
  const [brand, setBrand] = useState('')
  const [lines, setLines] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const result = useMemo(() => (script.trim().length >= 6 ? checkHook(script, brand) : null), [script, brand])

  async function fix() {
    setBusy(true); setErr(null); setLines(null)
    try {
      const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hook_fix', script, brandName: brand }), signal: AbortSignal.timeout(60_000) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      setLines(d.lines || [])
    } catch (e) { setErr(e instanceof Error ? e.message : 'MVP could not rewrite it.') }
    finally { setBusy(false) }
  }

  const copy = async (i: number, t: string) => {
    try { await navigator.clipboard.writeText(t); setCopied(i); setTimeout(() => setCopied(null), 2000) } catch { toast.error('Could not copy.') }
  }

  const soft = { color: 'var(--text-soft)' }
  const field = 'w-full rounded-xl border px-3 py-2 text-[13.5px] bg-transparent'
  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-[22px] font-bold tracking-tight">Check my hook</h2>
      <p className="text-[13.5px] mt-0.5 max-w-[70ch]" style={soft}>Paste the words of your video. MVP checks the opening the way TRYBE&rsquo;s co-founder does: does it talk to the viewer, does it sound like an ad, does it get to the point.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_16rem]">
        <textarea value={script} onChange={(e) => { setScript(e.target.value); setLines(null) }} rows={5} placeholder="If you've ever thrown out half a pack of meat because it went bad..." className={field} style={{ borderColor: 'var(--border)' }} />
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-semibold" style={soft}>The brand (optional)
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" className={`${field} mt-1`} style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          </label>
          <button onClick={() => void fix()} disabled={busy || !result} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Write 3 better openings
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4">
          <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Your opening</p>
          <p className="text-[15px] font-semibold mt-0.5">&ldquo;{result.opening}&rdquo;</p>
          <p className="text-[12px] mt-0.5 tabular-nums" style={soft}>{result.words} words · &ldquo;I&rdquo; {result.iCount} times, &ldquo;you&rdquo; {result.youCount} times in the script</p>
          <ul className="mt-2 space-y-1.5">
            {result.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[13.5px]" style={{ color: n.tone === 'good' ? GREEN : n.tone === 'bad' ? RED : AMBER }}>
                {n.tone === 'good' ? <CircleCheck size={15} className="mt-0.5 shrink-0" /> : n.tone === 'bad' ? <XCircle size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                <span style={{ color: 'var(--text)' }}>{n.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && <p className="mt-3 text-[13px]" style={{ color: AMBER }}>{err}</p>}
      {lines && lines.length > 0 && (
        <div className="mt-4">
          <p className="text-[12px] font-bold uppercase tracking-wider" style={soft}>Three new openings</p>
          <ul className="mt-1.5 space-y-1.5">
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <span className="flex-1 text-[14px] font-semibold">&ldquo;{l}&rdquo;</span>
                <button onClick={() => void copy(i, l)} className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}>{copied === i ? <Check size={12} /> : <Copy size={12} />} {copied === i ? 'Copied' : 'Copy'}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
