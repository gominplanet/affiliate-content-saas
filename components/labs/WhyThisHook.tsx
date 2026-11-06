// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
'use client'

import { Fragment } from 'react'
import type { VideoIdea } from '@/lib/trybe-playbook'

const PURPLE = 'var(--accent)'

/** WHY THIS HOOK (Seb, 2026-11-06): who the video calls out, the moment, the
 *  place, the problem in the buyer's words, and the whys dug down to the
 *  real reason the hook opens on. Nothing shows on plans made before. */
export default function WhyThisHook({ v }: { v: VideoIdea }) {
  const rows: Array<[string, string]> = ([['Who', v.who], ['When', v.when], ['Where', v.where], ['In their words', v.what]] as Array<[string, string | undefined]>)
    .filter((r): r is [string, string] => !!r[1])
  if (!rows.length && !v.why?.length && !v.objection) return null
  return (
    <details className="mt-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'rgb(var(--brand-rgb) / 0.25)', background: 'rgb(var(--brand-rgb) / 0.05)' }}>
      <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Why this hook works</summary>
      {rows.length > 0 && (
        <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 text-[12.5px]" style={{ gridTemplateColumns: 'auto 1fr' }}>
          {rows.map(([k, t]) => (<Fragment key={k}><dt className="font-bold" style={{ color: 'var(--text-soft)' }}>{k}</dt><dd>{t}</dd></Fragment>))}
        </dl>
      )}
      {v.why && v.why.length > 0 && (<>
        <span className="block mt-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>Dug down to the real reason</span>
        <ol className="mt-1 space-y-1">
          {v.why.map((w, j) => {
            const last = j === v.why!.length - 1
            return (
              <li key={j} className="flex items-start gap-2 text-[12.5px]">
                <span className="shrink-0 w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold" style={last ? { background: 'var(--accent)', color: '#fff' } : { background: 'rgb(var(--brand-rgb) / 0.12)', color: PURPLE }}>{j + 1}</span>
                <span className={last ? 'font-semibold' : ''}>{w}{last && <span className="ml-1.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 align-middle" style={{ background: 'rgb(var(--brand-rgb) / 0.12)', color: PURPLE }}>The hook opens here</span>}</span>
              </li>
            )
          })}
        </ol>
      </>)}
      {v.objection && <span className="block mt-2 text-[12.5px]"><b>The doubt it answers:</b> {v.objection}</span>}
    </details>
  )
}
