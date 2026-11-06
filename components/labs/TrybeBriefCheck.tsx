'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CHECK IT AGAINST THE BRIEF BEFORE IT GOES (Seb, 2026-11-06: "proper
// uploads"). A video that misses what the brand asked for is rejected, and a
// rejection is unpaid. When MVP has read the brand's brief (Make videos does,
// to write its scripts), what it asks for and what it rules out are shown as
// a checklist next to the video, before Send. The ticks are the creator's own
// check, for this upload only; nothing is sent or blocked by them.

import { useEffect, useState } from 'react'
import { ClipboardCheck, Ban } from 'lucide-react'

interface Plan { product?: string | null; plan?: { wants?: string[]; avoid?: string[]; brief?: 'text' | 'link_only' | 'none'; product?: string } | null }

const cache = new Map<string, Promise<Plan | null>>()
function latestPlan(brandId: string): Promise<Plan | null> {
  let p = cache.get(brandId)
  if (!p) {
    p = fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ideas', brandId }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => ((j?.plans || []) as Plan[]).find((x) => (x.plan?.wants?.length || 0) + (x.plan?.avoid?.length || 0) > 0) ?? null)
      .catch(() => null)
    cache.set(brandId, p)
  }
  return p
}

export default function TrybeBriefCheck({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  useEffect(() => { let live = true; setPlan(undefined); setTicked(new Set()); void latestPlan(brandId).then((p) => { if (live) setPlan(p) }); return () => { live = false } }, [brandId])
  if (plan === undefined) return null
  if (!plan) return <p className="text-[12px] mt-2" style={{ color: 'var(--text-3)' }}>No brief checklist for {brandName} yet. Make videos reads its brief when it writes your scripts, and the checklist shows here.</p>
  const wants = plan.plan?.wants || []
  const avoid = plan.plan?.avoid || []
  return (
    <div className="mt-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--surface-2)' }}>
      <p className="text-[12.5px] font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--text)' }}><ClipboardCheck size={14} /> Check it against {brandName}&rsquo;s brief before you send</p>
      {wants.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {wants.map((w, i) => (
            <li key={i}>
              <label className="flex items-start gap-2 text-[12.5px] cursor-pointer" style={{ color: 'var(--text)' }}>
                <input type="checkbox" className="mt-0.5" style={{ accentColor: 'var(--accent)' }} checked={ticked.has(i)} onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n })} />
                <span style={{ textDecoration: ticked.has(i) ? 'line-through' : undefined, opacity: ticked.has(i) ? 0.6 : 1 }}>{w}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {avoid.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {avoid.map((a, i) => <li key={i} className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}><Ban size={13} className="mt-0.5 shrink-0" style={{ color: '#EF4444' }} /> Not this: {a}</li>)}
        </ul>
      )}
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
        {wants.length ? `${ticked.size} of ${wants.length} checked. ` : ''}From the brief MVP read when it wrote your scripts{plan.product ? ` for ${plan.product}` : ''}{plan.plan?.brief === 'link_only' ? '. Its full brief is a document MVP could not open: check that too' : ''}.
      </p>
    </div>
  )
}
