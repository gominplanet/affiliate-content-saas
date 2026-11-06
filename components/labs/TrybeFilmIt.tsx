'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FILM IT (Seb, 2026-10-22: "small sentences, very, very short and sweet, so
// people can just like memorize one sentence, shoot it, go for it"; and
// 2026-11-06: "we are needing to make sure that we're able to make proper
// scripts"). The script, opened for filming: one line at a time in big type,
// read on the phone propped next to the camera, with the line before and the
// line after quieter, then the B-roll as a shot list to tick off. Arrow keys,
// a tap on either side, or the buttons move through it. Nothing is sent
// anywhere; ticks last for this filming only.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Check, Clapperboard, Camera } from 'lucide-react'

export interface FilmScript {
  title: string
  /** The words to say, one short sentence a line, the hook first. */
  say: string[]
  /** The B-roll shots to film. */
  broll: string[]
  /** What the first two seconds show. */
  shot?: string | null
  /** What it answers in the brief. */
  forBrief?: string | null
}

export default function TrybeFilmIt({ script, onClose }: { script: FilmScript; onClose: () => void }) {
  const lines = script.say
  const steps = lines.length + (script.broll.length ? 1 : 0)
  const [at, setAt] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const box = useRef<HTMLDivElement>(null)
  const next = useCallback(() => setAt((n) => Math.min(steps - 1, n + 1)), [steps])
  const back = useCallback(() => setAt((n) => Math.max(0, n - 1)), [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', k)
    box.current?.focus()
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = was }
  }, [next, back, onClose])

  const onBroll = at >= lines.length
  const line = onBroll ? null : lines[at]
  const pct = steps > 1 ? (at / (steps - 1)) * 100 : 100
  const label = at === 0 ? 'The hook' : at === lines.length - 1 ? 'The close' : `Line ${at + 1}`

  // On the page itself, above everything the dashboard draws (its sidebar
  // and top bar), whatever box it is opened from.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Film it: ${script.title}`} className="fixed inset-0 flex flex-col outline-none" style={{ zIndex: 1001, background: '#0B1213', color: '#F4F8F8' }}>
      {/* Top: what it is, where you are, close. */}
      <div className="flex items-center gap-3 px-4 sm:px-8 pt-4 pb-3">
        <Clapperboard size={18} style={{ color: '#5EEAD4' }} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold truncate">{script.title}</p>
          <p className="text-[11.5px]" style={{ color: '#8FA3A5' }}>{onBroll ? 'B-roll shot list' : at === 0 || at === lines.length - 1 ? `${label}, line ${at + 1} of ${lines.length}` : `Line ${at + 1} of ${lines.length}`}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2" style={{ background: 'rgba(255,255,255,0.08)' }}><X size={18} /></button>
      </div>
      <div className="h-1 mx-4 sm:mx-8 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#2DD4BF', transition: 'width 220ms ease' }} />
      </div>

      {/* The line, big. A tap on the left goes back, on the right goes on. */}
      {!onBroll ? (
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 sm:px-16 text-center select-none">
          <button type="button" aria-label="Previous line" onClick={back} className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize" />
          <button type="button" aria-label="Next line" onClick={next} className="absolute inset-y-0 right-0 w-1/3 cursor-e-resize" />
          {at > 0 && <p className="text-[15px] sm:text-[18px] mb-6 max-w-[900px] leading-snug" style={{ color: '#5C6F71' }}>{lines[at - 1]}</p>}
          <p className="font-bold max-w-[1000px]" style={{ fontFamily: 'var(--font-sora), var(--font-jakarta), system-ui, sans-serif', fontSize: 'clamp(30px, 6vw, 72px)', lineHeight: 1.12, letterSpacing: '-0.02em', textWrap: 'balance' as never }}>{line}</p>
          {at === 0 && script.shot && <p className="text-[14px] sm:text-[16px] mt-6 max-w-[760px] inline-flex items-start gap-2 text-left" style={{ color: '#5EEAD4' }}><Camera size={16} className="mt-1 shrink-0" /> First 2 seconds: {script.shot}</p>}
          {at < lines.length - 1 && <p className="text-[15px] sm:text-[18px] mt-6 max-w-[900px] leading-snug" style={{ color: '#5C6F71' }}>{lines[at + 1]}</p>}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8">
          <div className="max-w-[760px] mx-auto">
            <p className="text-[22px] sm:text-[28px] font-bold" style={{ fontFamily: 'var(--font-sora), var(--font-jakarta), system-ui, sans-serif' }}>Now the B-roll</p>
            <p className="text-[14px] mt-1" style={{ color: '#8FA3A5' }}>Film each shot on its own, a few seconds each. Tick it when it is in the can.</p>
            <ul className="mt-6 flex flex-col gap-2.5">
              {script.broll.map((b, i) => {
                const on = done.has(i)
                return (
                  <li key={i}>
                    <button type="button" onClick={() => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                      className="w-full text-left flex items-start gap-3 rounded-2xl px-4 py-3.5" style={{ background: on ? 'rgba(45,212,191,0.14)' : 'rgba(255,255,255,0.05)', border: `1px solid ${on ? 'rgba(45,212,191,0.5)' : 'rgba(255,255,255,0.08)'}` }}>
                      <span className="mt-0.5 w-6 h-6 rounded-lg shrink-0 inline-flex items-center justify-center" style={{ background: on ? '#2DD4BF' : 'rgba(255,255,255,0.08)', color: '#0B1213' }}>{on && <Check size={15} />}</span>
                      <span className="text-[16px] sm:text-[18px] leading-snug" style={{ color: on ? '#8FA3A5' : '#F4F8F8', textDecoration: on ? 'line-through' : undefined }}>{b}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="text-[13px] mt-5" style={{ color: '#8FA3A5' }}>{done.size} of {script.broll.length} filmed.{script.forBrief ? ` This video answers the brief: ${script.forBrief}.` : ''}</p>
          </div>
        </div>
      )}

      {/* Bottom: back and on. */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-8 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button type="button" onClick={back} disabled={at === 0} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.08)' }}><ChevronLeft size={16} /> Back</button>
        <span className="text-[12px] hidden sm:inline" style={{ color: '#5C6F71' }}>Arrow keys or a tap on either side move through it</span>
        {at < steps - 1
          ? <button type="button" onClick={next} className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-[14px] font-bold" style={{ background: '#2DD4BF', color: '#0B1213' }}>{at === lines.length - 1 && script.broll.length ? 'B-roll' : 'Next line'} <ChevronRight size={16} /></button>
          : <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-[14px] font-bold" style={{ background: '#2DD4BF', color: '#0B1213' }}><Check size={16} /> Done</button>}
      </div>
    </div>,
    document.body,
  )
}
