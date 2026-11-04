'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NEW LOOK'S PAGE PARTS (Teal Pop, lib/look; Seb, 2026-11-03: "Go for drop,
// then product research, then thumbnails, then continue down the list").
//
// One header card, one row of steps and one row of round tabs, shared by every
// page drawn in the new look, so each page reads the same way: which part of
// MVP it is (the section, in its menu colour), what the page does in a line,
// the buttons that start the job, then the steps in the order they happen.
// PageHero draws TealHeader by itself in the new look, so a page that only
// uses PageHero gets the header card with no change of its own.

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import Link from 'next/link'
import { useLook } from './shell-nav-context'

const sora = { fontFamily: 'var(--font-sora), var(--font-jakarta), sans-serif' } as const

/** The header card: section, title, a line on what it does, buttons, chips, art. */
export function TealHeader({ eyebrow, color, tint, title, line, actions, chips, art, guide, icon, banner }: {
  /** The menu section the page sits in ("Make videos"). */
  eyebrow?: string | null
  /** The section's colour and its pale wash (shell-nav-context). */
  color?: string
  tint?: string
  title: ReactNode
  line?: ReactNode
  /** The buttons that start the job. */
  actions?: ReactNode
  /** Small facts under the buttons: counts as read, the account in use. */
  chips?: ReactNode
  /** Right-hand art. Without it, the page's own menu icon on the section's wash. */
  art?: ReactNode
  /** The page's guide link, top right. */
  guide?: ReactNode
  /** The page's menu icon, drawn large in the default art. */
  icon?: ReactNode
  /** The page's picture (lib/banner-art), shown in place of the icon. */
  banner?: string | null
}) {
  return (
    <header className="relative rounded-[22px] border p-6 sm:p-8 mb-5 flex flex-wrap items-center gap-6" style={{ background: 'var(--surface)', borderColor: 'var(--border-2)' }}>
      {guide && <div className="absolute top-4 right-4 z-10">{guide}</div>}
      <div className="flex-[1_1_380px] min-w-0 flex flex-col gap-3">
        {eyebrow && <p className="text-[12.5px] font-bold uppercase tracking-[0.08em]" style={{ color: color ?? 'var(--text-3)' }}>{eyebrow}</p>}
        <h1 className="text-[30px] sm:text-[40px] font-extrabold leading-[1.06]">{title}</h1>
        {line && <div className="text-[15.5px] leading-relaxed max-w-[620px]" style={{ color: 'var(--text-2)' }}>{line}</div>}
        {actions && <div className="mt-1 flex flex-wrap items-center gap-2.5">{actions}</div>}
        {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
      </div>
      {art ?? <TealArt tint={tint} color={color} icon={icon} banner={banner} />}
    </header>
  )
}

/** The default art: the page's picture (lib/banner-art) on its section's
 *  wash, or, for a page without one yet, its icon drawn large with the look's
 *  teal and orange bars. */
export function TealArt({ tint, color, icon, banner }: { tint?: string; color?: string; icon?: ReactNode; banner?: string | null }) {
  const box = 'hidden sm:block relative flex-[1_1_240px] max-w-[440px] min-h-[180px] self-stretch rounded-[18px] overflow-hidden'
  if (banner) {
    return (
      <div aria-hidden="true" className={box} style={{ background: tint ?? 'var(--surface-2)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={banner} alt="" decoding="async" className="absolute inset-0 m-auto w-[88%] h-[88%] object-contain" />
      </div>
    )
  }
  const big = isValidElement(icon) ? cloneElement(icon as ReactElement<{ size?: number; strokeWidth?: number }>, { size: 44, strokeWidth: 1.8 }) : null
  return (
    <div aria-hidden="true" className={box} style={{ background: tint ?? 'var(--surface-2)' }}>
      {/* [&_svg] sizes an icon a server page already drew, which cloneElement cannot resize. */}
      <span className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 w-[92px] h-[92px] rounded-[24px] flex items-center justify-center shadow-sm [&_svg]:w-11 [&_svg]:h-11" style={{ background: 'var(--bg-sidebar, #fff)', color: color ?? 'var(--accent)' }}>
        {big}
      </span>
      <span className="absolute left-[24%] right-[24%] bottom-[20%] h-2.5 rounded-full" style={{ background: '#14B8A6' }} />
      <span className="absolute left-[24%] w-[28%] bottom-[11%] h-2.5 rounded-full" style={{ background: '#FB923C' }} />
    </div>
  )
}

/** The main button of a page in the new look: round, teal, bold. */
export const tealMain = 'inline-flex items-center gap-2 rounded-full px-5 py-3 text-[15px] font-extrabold text-white transition-colors bg-[color:var(--accent)] hover:bg-[rgb(var(--brand-strong-rgb))] disabled:opacity-60 disabled:cursor-not-allowed'
/** A second button beside it: round, outlined. */
export const tealLine = 'inline-flex items-center gap-2 rounded-full border-[1.5px] px-5 py-3 text-[15px] font-bold transition-colors hover:border-[color:var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed'
export const tealLineStyle = { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--surface)' } as const

/** A small fact under the header buttons. `tone` brand for a count worth a
 *  look, plain for the rest. */
export function TealChip({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'brand' | 'plain' | 'good' | 'bad'; title?: string }) {
  const style = tone === 'brand' ? { background: 'rgb(var(--brand-rgb) / 0.12)', color: 'var(--accent-text)' }
    : tone === 'good' ? { background: 'var(--earn-bg)', color: 'var(--earn)' }
      : tone === 'bad' ? { background: 'var(--fix-bg)', color: 'var(--fix)' }
        : { background: 'var(--surface-2)', color: 'var(--text-2)' }
  return <span title={title} className="rounded-full px-3 py-1 text-[12.5px] font-bold" style={style}>{children}</span>
}

/** The steps of a job, numbered because they happen in that order. */
export function TealSteps({ steps, className = 'mb-5' }: { steps: Array<[string, string]>; className?: string }) {
  return (
    <section aria-label="How it works" className={`grid gap-3 ${steps.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'} ${className}`}>
      {steps.map(([t, d], i) => (
        <div key={t} className="flex items-start gap-3 rounded-2xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border-2)' }}>
          <span className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold" style={{ background: 'var(--accent)', ...sora }}>{i + 1}</span>
          <span><span className="block font-extrabold">{t}</span><span className="block text-[13.5px]" style={{ color: 'var(--text-3)' }}>{d}</span></span>
        </div>
      ))}
    </section>
  )
}

export type TealTab<K extends string> = {
  key: K
  label: ReactNode
  icon?: ReactNode
  /** Shown only once read: null while it loads. */
  count?: number | null
  /** A tab that is another page: a link, not a switch. */
  href?: string
  title?: string
}

/** Round tabs with an icon and a count. A tab with `href` is a link. */
export function TealTabs<K extends string>({ tabs, value, onChange, label, className = 'mb-4' }: {
  tabs: TealTab<K>[]
  value: K | null
  onChange?: (k: K) => void
  label: string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex flex-wrap items-center gap-2 ${className}`}>
      {tabs.map((t) => {
        const on = value === t.key
        const cls = 'inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-4 py-2 text-[14px] font-bold transition-colors hover:border-[color:var(--accent)] whitespace-nowrap'
        const style = on ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : { borderColor: 'var(--border-2)', background: 'var(--surface)', color: 'var(--text)' }
        const inner = <>{t.icon}{t.label}{typeof t.count === 'number' && <span className="tabular-nums" style={{ opacity: on ? 0.9 : 0.6 }}>{t.count}</span>}</>
        return t.href
          ? <Link key={t.key} href={t.href} role="tab" aria-selected={on} title={t.title} className={cls} style={style}>{inner}</Link>
          : <button key={t.key} type="button" role="tab" aria-selected={on} title={t.title} onClick={() => onChange?.(t.key)} className={cls} style={style}>{inner}</button>
      })}
    </div>
  )
}

/** A section heading in the new look. */
export function TealH2({ children, note, right }: { children: ReactNode; note?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
      <div>
        <h2 className="text-[20px] font-extrabold">{children}</h2>
        {note && <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>{note}</p>}
      </div>
      {right}
    </div>
  )
}

/** One thing in the new look and another in the old: lets a page drawn on the
 *  server (which cannot ask the shell) pick its header. */
export function ByLook({ teal, classic }: { teal: ReactNode; classic: ReactNode }) {
  return <>{useLook() === 'teal' ? teal : classic}</>
}
