'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EXPLAINING THE SEO PAGE (Seb, 2026-10-12: "the seo feature page needs to be
// cleaned up for ease of use.. need to have much more information to explain
// to users what each thing does and what it means to them").
//
//   InfoTip     a small "?" next to a term: what it is and why it matters,
//               opened by a click so it works on a phone too.
//   SeoSection  each part of the page under one header: what it is, what it
//               means for you, and a fold so the page is not one long wall.
//   SeoIntro    how the page works: the four steps every post takes before it
//               earns from Google, jump links to each section, every word on
//               the page in plain language, and the other SEO tools.
// The words live in lib/seo-glossary, so a term reads the same everywhere.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { HelpCircle, ChevronDown, X, BookOpen, Compass } from 'lucide-react'
import { TERMS, JOURNEY, SECTIONS, TOOLS, term, section, type JourneyId } from '@/lib/seo-glossary'

const OPEN_KEY = 'mvp.seo.sections'
const INTRO_KEY = 'mvp.seo.intro'

function readJson<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback } catch { return fallback }
}
function writeJson(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* the page works without it */ }
}

/** A "?" that explains one term. Click to open, click outside or Escape to close. */
export function InfoTip({ id, label }: { id: string; label?: string }) {
  const t = term(id)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!t) return null
  return (
    <span ref={box} className="relative inline-flex align-middle">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }} aria-expanded={open} aria-label={`What is ${label || t.word}?`}
        className="inline-flex items-center justify-center rounded-full text-[#86868b] hover:text-[#7C3AED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7C3AED]">
        <HelpCircle size={13} />
      </button>
      {open && (
        <span role="tooltip" className="absolute z-30 left-1/2 -translate-x-1/2 top-5 w-[17rem] max-w-[80vw] rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] shadow-lg p-3 text-left normal-case tracking-normal font-normal">
          <span className="block text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{t.word}</span>
          <span className="block mt-1 text-[12px] leading-snug text-[#3a3a3c] dark:text-[#d2d2d7]">{t.means}</span>
          <span className="block mt-1.5 text-[12px] leading-snug text-[#1d1d1f] dark:text-[#f5f5f7]"><b>For you:</b> {t.forYou}</span>
        </span>
      )}
    </span>
  )
}

const JOURNEY_WORD: Record<JourneyId, string> = { found: 'Found', kept: 'Kept', shown: 'Shown', clicked: 'Clicked' }

/** One part of the page: what it is, what it means for you, and a fold. */
export function SeoSection({ id, index, children, defaultOpen = true, badge }: {
  id: string
  /** Its place on the page, 1 first. */
  index: number
  children: React.ReactNode
  defaultOpen?: boolean
  /** A short state next to the title, e.g. "3 to fix". */
  badge?: { text: string; tone: 'good' | 'warn' | 'bad' | 'info' } | null
}) {
  const info = section(id)
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    const saved = readJson<Record<string, boolean>>(OPEN_KEY, {})
    if (typeof saved[id] === 'boolean') setOpen(saved[id])
  }, [id])
  const toggle = () => setOpen((v) => { const next = !v; writeJson(OPEN_KEY, { ...readJson<Record<string, boolean>>(OPEN_KEY, {}), [id]: next }); return next })
  const tone = badge?.tone === 'good' ? '#34c759' : badge?.tone === 'bad' ? '#ff3b30' : badge?.tone === 'warn' ? '#ff9500' : '#7C3AED'

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 mb-6">
      <div className="flex items-start gap-3 mb-3">
        <span className="mt-0.5 w-7 h-7 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[13px] font-bold grid place-items-center flex-shrink-0 tabular-nums">{index}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${id}-title`} className="text-[17px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]" style={{ textWrap: 'balance' } as React.CSSProperties}>{info.title}</h2>
            {badge && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ color: tone, background: `${tone}1a` }}>{badge.text}</span>}
            <span className="hidden sm:inline-flex gap-1">
              {info.helps.map((h) => <span key={h} className="text-[10px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-black/[0.04] dark:bg-white/[0.06] text-[#6e6e73] dark:text-[#a1a1a6]">{JOURNEY_WORD[h]}</span>)}
            </span>
            <button onClick={toggle} aria-expanded={open} aria-controls={`${id}-body`}
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-[#6e6e73] dark:text-[#a1a1a6] hover:text-[#7C3AED]">
              {open ? 'Hide' : 'Show'} <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2 text-[12.5px] leading-relaxed max-w-4xl">
            <p className="text-[#4b4b4f] dark:text-[#b0b0b5]"><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">What this is: </span>{info.what}</p>
            <p className="text-[#4b4b4f] dark:text-[#b0b0b5]"><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">What it means for you: </span>{info.forYou}</p>
          </div>
        </div>
      </div>
      {open && <div id={`${id}-body`} className="flex flex-col gap-4">{children}</div>}
    </section>
  )
}

/** How this page works: the path to visitors, the sections, the words, the tools. */
export function SeoIntro() {
  const [collapsed, setCollapsed] = useState(false)
  const [glossary, setGlossary] = useState(false)
  const [tools, setTools] = useState(false)
  useEffect(() => { setCollapsed(readJson<boolean>(INTRO_KEY, false)) }, [])
  const setC = (v: boolean) => { setCollapsed(v); writeJson(INTRO_KEY, v) }
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const nav = (
    <nav aria-label="Sections of this page" className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s, i) => (
        <button key={s.id} onClick={() => jump(s.id)}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-2.5 py-1 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/60 hover:text-[#7C3AED]">
          <span className="tabular-nums text-[#7C3AED] font-bold">{i + 1}</span> {s.title}
        </button>
      ))}
    </nav>
  )

  if (collapsed) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {nav}
        <button onClick={() => setC(false)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline"><Compass size={13} /> How this page works</button>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Compass size={18} className="mt-0.5 text-[#7C3AED] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">How this page works</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#4b4b4f] dark:text-[#b0b0b5] max-w-3xl">
            Google sends readers to a post only after four things happen, in this order. This page shows where each of your posts is stuck, and every section helps with one or more of these steps. You do not need to know SEO: each section says what it is and what it means for you, and every <HelpCircle size={12} className="inline -mt-0.5" /> explains a word.
          </p>
        </div>
        <button onClick={() => setC(true)} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0" aria-label="Hide the explanation"><X size={16} /></button>
      </div>

      <ol className="mt-4 grid gap-2 grid-cols-2 lg:grid-cols-4">
        {JOURNEY.map((j, i) => (
          <li key={j.id} className="rounded-xl border border-black/[0.07] dark:border-white/10 bg-[#7C3AED]/[0.03] px-3 py-2.5">
            <p className="text-[13px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#7C3AED] tabular-nums">{i + 1}.</span> {j.title}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-[#4b4b4f] dark:text-[#b0b0b5]">{j.says}</p>
            <p className="mt-1 text-[11px] text-[#86868b]">Measured by: {j.measure}</p>
          </li>
        ))}
      </ol>

      <p className="mt-4 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">Jump to</p>
      {nav}

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => setGlossary((v) => !v)} aria-expanded={glossary} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/60">
          <BookOpen size={13} /> Words used on this page <ChevronDown size={12} className={glossary ? 'rotate-180' : ''} />
        </button>
        <button onClick={() => setTools((v) => !v)} aria-expanded={tools} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/60">
          What the other SEO tools do <ChevronDown size={12} className={tools ? 'rotate-180' : ''} />
        </button>
      </div>

      {glossary && (
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {TERMS.map((t) => (
            <div key={t.id}>
              <dt className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{t.word}</dt>
              <dd className="mt-0.5 text-[12px] leading-snug text-[#4b4b4f] dark:text-[#b0b0b5]">{t.means} <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">{t.forYou}</span></dd>
            </div>
          ))}
        </dl>
      )}
      {tools && (
        <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <li key={t.href} className="text-[12px] leading-snug text-[#4b4b4f] dark:text-[#b0b0b5]">
              <Link href={t.href} className="font-semibold text-[#7C3AED] hover:underline">{t.label}</Link>: {t.says}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
