'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NEW TRYBE'S PARTS (Seb, 2026-11-06: "not only at what it can do, but at
// how it looks and the user experience"). One set of pieces for the brand
// page, the TRYBE home and the brand table: every colour from the look's own
// variables (the teal look and the classic one, light and dark), numbers in
// Sora with even widths, grades shown by a bar or a dot as well as a word, so
// nothing depends on colour alone.

import type { CSSProperties, ReactNode } from 'react'
import type { Grade } from '@/lib/trybe-dossier'

/** What each grade looks like: a bar colour that reads on light and dark, and its word. */
export const GRADE: Record<Grade, { color: string; soft: string; word: string }> = {
  strong: { color: '#10B981', soft: 'rgba(16,185,129,0.14)', word: 'Strong' },
  fair: { color: '#F59E0B', soft: 'rgba(245,158,11,0.16)', word: 'Fair' },
  weak: { color: '#EF4444', soft: 'rgba(239,68,68,0.14)', word: 'Weak' },
  unknown: { color: 'var(--text-3)', soft: 'var(--surface-2)', word: 'Not read' },
}

export const ui = {
  text: { color: 'var(--text)' } as CSSProperties,
  soft: { color: 'var(--text-3)' } as CSSProperties,
  mid: { color: 'var(--text-2)' } as CSSProperties,
  num: { fontFamily: 'var(--font-sora), var(--font-jakarta), system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' } as CSSProperties,
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18 } as CSSProperties,
  well: { background: 'var(--surface-2)', borderRadius: 14 } as CSSProperties,
  accent: 'var(--accent)',
  accentText: 'var(--accent-text, var(--accent))',
}

/** A labelled block with its own heading and an optional right side. */
export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[15px] font-bold" style={{ ...ui.text, ...ui.num, letterSpacing: '-0.01em' }}>{title}</h3>
        {aside && <div className="text-[12px]" style={ui.soft}>{aside}</div>}
      </div>
      {children}
    </section>
  )
}

/** A small rounded label. */
export function Tag({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'good' | 'warn' | 'bad' | 'accent'; title?: string }) {
  const s: CSSProperties = tone === 'good' ? { background: GRADE.strong.soft, color: 'var(--text)' }
    : tone === 'warn' ? { background: GRADE.fair.soft, color: 'var(--text)' }
    : tone === 'bad' ? { background: GRADE.weak.soft, color: 'var(--text)' }
    : tone === 'accent' ? { background: 'rgb(var(--brand-rgb) / 0.12)', color: 'var(--accent-text, var(--accent))' }
    : { background: 'var(--surface-2)', color: 'var(--text-2)' }
  const dot = tone === 'good' ? GRADE.strong.color : tone === 'warn' ? GRADE.fair.color : tone === 'bad' ? GRADE.weak.color : null
  return (
    <span title={title} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold whitespace-nowrap" style={s}>
      {dot && <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
      {children}
    </span>
  )
}

/** A horizontal bar from 0 to 100 in its grade's colour; dashed when not read. */
export function Meter({ score, grade, height = 6 }: { score: number | null; grade: Grade; height?: number }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: 'var(--surface-2)', outline: score == null ? '1px dashed var(--border-2, var(--border))' : undefined }}
      role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? undefined} aria-label={GRADE[grade].word}>
      {score != null && <div className="h-full rounded-full" style={{ width: `${Math.max(4, score)}%`, background: GRADE[grade].color, transition: 'width 600ms ease' }} />}
    </div>
  )
}

/** The verdict as a ring: the score inside, the grade colour around. */
export function ScoreRing({ score, size = 112, label }: { score: number | null; size?: number; label?: string }) {
  const stroke = Math.max(8, Math.round(size / 11))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const grade: Grade = score == null ? 'unknown' : score >= 70 ? 'strong' : score >= 45 ? 'fair' : 'weak'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score == null ? 'Not enough read for a score' : `Score ${score} of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {score != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GRADE[grade].color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 700ms ease' }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold leading-none" style={{ ...ui.num, ...ui.text, fontSize: size * 0.3 }}>{score ?? '?'}</span>
        {label && <span className="text-[10.5px] font-semibold uppercase mt-1" style={{ ...ui.soft, letterSpacing: '0.08em' }}>{label}</span>}
      </div>
    </div>
  )
}

/** A big number with its label and a line under it. */
export function Figure({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Grade }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-semibold uppercase" style={{ ...ui.soft, letterSpacing: '0.07em' }}>{label}</span>
      <span className="text-[22px] font-bold leading-tight flex items-center gap-2" style={{ ...ui.num, ...ui.text }}>
        {tone && tone !== 'unknown' && <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full" style={{ background: GRADE[tone].color }} />}
        {value}
      </span>
      {sub && <span className="text-[12px] leading-snug" style={ui.soft}>{sub}</span>}
    </div>
  )
}

/** A line over time with the area under it, a faint grid and the last point marked. */
export function AreaChart({ points, height = 120, unit = '', ariaLabel }: { points: Array<{ at: string; value: number }>; height?: number; unit?: string; ariaLabel: string }) {
  const W = 600, H = height, P = 6
  if (points.length < 2) return null
  const xs = points.map((p) => Date.parse(p.at))
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const vmax = Math.max(1, ...points.map((p) => p.value))
  const X = (t: number) => P + ((t - x0) / Math.max(1, x1 - x0)) * (W - P * 2)
  const Y = (v: number) => H - P - (v / vmax) * (H - P * 2 - 14)
  // A step line: a count holds until the next one is read.
  let d = `M ${X(xs[0])} ${Y(points[0].value)}`
  for (let i = 1; i < points.length; i++) d += ` L ${X(xs[i])} ${Y(points[i - 1].value)} L ${X(xs[i])} ${Y(points[i].value)}`
  const area = `${d} L ${X(xs[xs.length - 1])} ${H - P} L ${X(xs[0])} ${H - P} Z`
  const last = points[points.length - 1]
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <figure className="w-full" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id="trybe-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={P} x2={W - P} y1={P + f * (H - P * 2)} y2={P + f * (H - P * 2)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <path d={area} fill="url(#trybe-area)" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={X(xs[xs.length - 1])} cy={Y(last.value)} r="4.5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between text-[11px] mt-1" style={{ ...ui.soft, ...ui.num }}>
        <span>{fmt(x0)}</span>
        <span>{last.value}{unit ? ` ${unit}` : ''} on {fmt(x1)}</span>
      </figcaption>
    </figure>
  )
}

/** A thin trend line for a row, no axes. */
export function Spark({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const max = Math.max(1, ...values), min = Math.min(...values)
  const X = (i: number) => (i / (values.length - 1)) * (width - 2) + 1
  const Y = (v: number) => height - 2 - ((v - min) / Math.max(1, max - min)) * (height - 4)
  const d = values.map((v, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx={X(values.length - 1)} cy={Y(values[values.length - 1])} r="2.25" fill="var(--accent)" />
    </svg>
  )
}

/** A button in the new TRYBE: solid in the look's colour, or quiet. */
export function Btn({ children, onClick, kind = 'quiet', disabled, title, href }: { children: ReactNode; onClick?: () => void; kind?: 'solid' | 'quiet'; disabled?: boolean; title?: string; href?: string }) {
  const cls = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-[filter,background] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
  const style: CSSProperties = kind === 'solid'
    ? { background: 'var(--accent)', color: '#fff', outlineColor: 'var(--accent)' }
    : { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2, var(--border))', outlineColor: 'var(--accent)' }
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} hover:brightness-105`} style={style} title={title}>{children}</a>
  return <button type="button" onClick={onClick} disabled={disabled} className={`${cls} hover:brightness-105`} style={style} title={title}>{children}</button>
}
