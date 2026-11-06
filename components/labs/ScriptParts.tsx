// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SCRIPT AGENT'S CARDS (Seb, 2026-11-06: "this agent should be the one
// doing the work"): who buys it, and each video scene by scene. The same
// cards show in Video Scripts and in TRYBE's scripts.
'use client'

import type { ReactNode } from 'react'
import { Clapperboard, Copy, Check, Target, Type, Users, Heart, HelpCircle, Quote } from 'lucide-react'
import WhyThisHook from '@/components/labs/WhyThisHook'
import { HOOK_STYLE_WORDS, type VideoIdea, type BuyerRead } from '@/lib/trybe-playbook'
import { secondsOf } from '@/lib/product-scripts'

const PURPLE = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'

/** Who buys it, what they love, their doubts, and their own words. The
 *  quotes are only those found in the reviews MVP read. */
export function BuyersCard({ b, fromReviews }: { b: BuyerRead; fromReviews: boolean }) {
  if (!b.who.length && !b.loves.length && !b.doubts.length && !b.words.length) return null
  const col = (icon: React.ReactNode, title: string, items: string[], color?: string) => items.length ? (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: color || 'var(--text-soft)' }}>{icon} {title}</p>
      <ul className="mt-1 space-y-0.5 text-[13px] list-disc pl-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  ) : null
  return (
    <section className="rounded-xl border px-4 py-3" style={{ borderColor: 'rgb(var(--brand-rgb) / 0.25)', background: 'rgb(var(--brand-rgb) / 0.05)' }}>
      <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Who buys it, and why</p>
      <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{fromReviews ? 'Read from the reviews MVP read for this product.' : 'No reviews were read for this product (the line above says why), so this comes from the listing itself.'}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {col(<Users size={11} />, 'Who buys it', b.who)}
        {col(<Heart size={11} />, 'What they love', b.loves, GREEN)}
        {col(<HelpCircle size={11} />, 'Their doubts', b.doubts, AMBER)}
      </div>
      {b.words.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: 'var(--text-soft)' }}><Quote size={11} /> In their own words, as written in the reviews</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{b.words.map((w, i) => <span key={i} className="rounded-full border px-2 py-0.5 text-[12.5px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>&ldquo;{w}&rdquo;</span>)}</div>
        </div>
      )}
    </section>
  )
}

export function ScriptVideoCard({ v, n, copied, onCopy, onFilm, footer }: { v: VideoIdea; n: number; copied: boolean; onCopy: () => void; onFilm: () => void; footer?: ReactNode }) {
  const say = v.say?.length ? v.say : [v.hook, ...v.beats, v.cta].filter(Boolean)
  const shots = v.broll || []
  const secs = secondsOf(say)
  // Under a minute is fine, shorter is better (Seb, 2026-11-06).
  const fits = secs <= 60
  return (
    <li className="rounded-xl border px-3.5 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[12px] font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>{n}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold">{v.angle || HOOK_STYLE_WORDS[v.style]}</span>
            <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: PURPLE }}>{HOOK_STYLE_WORDS[v.style]}</span>
            {v.opener && <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ background: GREEN, color: '#fff' }} title="This hook starts with one of MVP's proven openers">Proven opener</span>}
            <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 border" style={{ borderColor: fits ? GREEN : AMBER, color: fits ? GREEN : AMBER }} title="Counted from the words to say, at a normal speaking pace">about {secs} seconds{fits ? '' : ', over a minute'}</span>
          </div>
          {(v.who || v.when) && (
            <p className="mt-1 text-[12.5px]"><Target size={12} className="inline -mt-0.5 mr-1" style={{ color: PURPLE }} /><b>For</b> {v.who || 'the buyer'}{v.when ? <>, <b>when</b> {v.when}</> : null}</p>
          )}
          {v.onScreen && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: 'var(--text-soft)' }}><Type size={11} /> On screen, first 2 seconds</span>
              <span className="rounded-md px-2 py-0.5 text-[13px] font-extrabold" style={{ background: '#FFFFFF', color: '#0B1416', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.12)' }}>{v.onScreen}</span>
            </p>
          )}
          {v.shot && <p className="mt-1 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>First 2 seconds: {v.shot}</p>}
          {/* SCENE BY SCENE: the words to say, and what the camera shows under them. */}
          <p className="mt-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Scene by scene</p>
          <ol className="mt-1 divide-y rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {say.map((l, j) => (
              <li key={j} className="grid grid-cols-[auto,1fr] gap-x-2.5 px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                <span className="w-5 h-5 mt-0.5 rounded-full inline-flex items-center justify-center text-[10.5px] font-bold" style={{ background: 'rgb(var(--brand-rgb) / 0.10)', color: PURPLE }}>{j + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug font-medium">&ldquo;{l}&rdquo;</span>
                  {shots[j] && <span className="block text-[12.5px] leading-snug" style={{ color: 'var(--text-soft)' }}>Show: {shots[j]}</span>}
                </span>
              </li>
            ))}
          </ol>
          {shots.length > say.length && <p className="mt-1 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>Extra shots: {shots.slice(say.length).join('; ')}</p>}
          <WhyThisHook v={v} />
          {footer}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <button type="button" onClick={onFilm} className="inline-flex items-center gap-1 text-[11.5px] font-bold rounded-full px-2.5 py-1" style={{ background: 'var(--accent)', color: '#fff' }} title="Open the script for filming: one line at a time, big, then the shots to tick off">
            <Clapperboard size={12} /> Film it
          </button>
          <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: PURPLE }}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </li>
  )
}
