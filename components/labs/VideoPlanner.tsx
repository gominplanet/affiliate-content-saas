'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Plan this video (Labs). The open campaigns you joined, a "Plan this video"
// button on each, and the plans written so far. A plan says "made" only when a
// video for that product is actually on the channel (lib/video-plan.ts).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, ClipboardList, Copy, Trash2, CheckCircle2, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { planText, type VideoPlan } from '@/lib/video-plan'

type Campaign = { asin: string; campaignId: string | null; brand: string | null; product: string | null; imageUrl: string | null; endsAt: string | null; daysLeft: number | null; state: string; commissionPct: number | null }
type SavedPlan = { id?: string; asin: string; brand: string | null; product: string | null; ends_at: string | null; plan: VideoPlan; created_at?: string; made: { title: string | null; youtubeVideoId: string | null; publishedAt: string | null } | null }

export default function VideoPlanner() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [campError, setCampError] = useState<string | null>(null)
  const [plans, setPlans] = useState<SavedPlan[] | null>(null)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const loadPlans = useCallback(async () => {
    try {
      const j = await (await fetch('/api/video-plan', { cache: 'no-store' })).json()
      setPlans(j.plans ?? []); setPlansError(j.error ?? null)
    } catch (e) { setPlans([]); setPlansError(String(e)) }
  }, [])
  useEffect(() => {
    loadPlans()
    fetch('/api/campaigns/library', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j.error) setCampError(j.error)
      setCampaigns(((j.rows ?? []) as Campaign[]).filter((c) => c.state === 'due').sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)))
    }).catch((e) => { setCampError(String(e)); setCampaigns([]) })
  }, [loadPlans])

  const planned = useMemo(() => new Set((plans ?? []).map((p) => p.asin)), [plans])

  async function plan(c: Campaign) {
    setBusy(c.asin)
    try {
      const r = await fetch('/api/video-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', asin: c.asin, campaignId: c.campaignId, brand: c.brand, product: c.product, endsAt: c.endsAt }) })
      const j = await r.json()
      if (!r.ok) { toast.error(j.error || 'The plan could not be written'); return }
      if (j.saved === false) toast.warning(j.error || 'Written but not saved')
      else toast.success(j.productPage ? 'Plan written' : 'Plan written. Amazon did not show MVP the product page, so it lists what to check.')
      setPlans((p) => [j.plan, ...(p ?? [])]); setOpenId(j.plan.id ?? j.plan.asin)
    } finally { setBusy(null) }
  }

  async function remove(id: string) {
    await fetch('/api/video-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    loadPlans()
  }

  const card = 'rounded-2xl border p-5 flex flex-col gap-3'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>Labs · Creator Connections</p>
        <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Plan this video</h1>
        <p className="text-[13px] max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          Pick a campaign you joined and MVP writes the video plan: the angle, titles, your opening line, what to show, the shots, the Short to cut, the thumbnail, and when to film and post so it earns before the campaign ends.
        </p>
      </header>

      {plansError && <p className="text-[12.5px] text-[#ff3b30]">{plansError}</p>}
      {plans && plans.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Your plans</h2>
          {plans.map((p) => {
            const key = p.id ?? p.asin
            const open = openId === key
            return (
              <div key={key} className={card} style={cardStyle}>
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => setOpenId(open ? null : key)} className="min-w-0 text-left flex-1">
                    <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{p.product || p.asin}</p>
                    <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                      {p.brand ? `${p.brand} · ` : ''}{p.plan.dates.postBy ? `Film by ${p.plan.dates.shootBy}, post by ${p.plan.dates.postBy}` : 'No deadline'}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.made
                      ? <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#10b981]"><CheckCircle2 size={13} /> Made</span>
                      : <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>No video yet</span>}
                    <button onClick={() => setOpenId(open ? null : key)} aria-label={open ? 'Close' : 'Open'} style={{ color: 'var(--text-faint)' }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                  </div>
                </div>
                {p.made && (
                  <p className="text-[12px] text-[#10b981]">
                    On your channel: {p.made.youtubeVideoId ? <a className="underline" href={`https://www.youtube.com/watch?v=${p.made.youtubeVideoId}`} target="_blank" rel="noopener noreferrer">{p.made.title || 'your video'}</a> : (p.made.title || 'your video')}
                  </p>
                )}
                {open && <PlanBody p={p} onDelete={p.id ? () => remove(p.id!) : undefined} />}
              </div>
            )
          })}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Open campaigns with no video yet</h2>
        {campError && <p className="text-[12.5px] text-[#ff3b30]">Your campaigns could not load: {campError}</p>}
        {campaigns === null && <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}><Loader2 size={13} className="inline animate-spin" /> Loading your joined campaigns…</p>}
        {campaigns && campaigns.length === 0 && !campError && (
          <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>No open campaign is waiting for a video. Join one from <Link href="/joined-campaigns" className="underline">Joined Campaigns</Link> or the campaign finder.</p>
        )}
        {campaigns && campaigns.length > 0 && (
          <ul className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
            {campaigns.slice(0, 40).map((c) => (
              <li key={c.asin} className="px-4 py-3 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-10 h-10 rounded object-contain bg-white flex-shrink-0" /> : <div className="w-10 h-10 rounded flex-shrink-0" style={{ background: 'var(--border)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{c.product || c.asin}</p>
                  <p className="text-[11.5px]" style={{ color: c.daysLeft != null && c.daysLeft <= 7 ? '#ff9500' : 'var(--text-faint)' }}>
                    {c.brand ? `${c.brand} · ` : ''}{c.daysLeft == null ? 'no end date' : c.daysLeft === 0 ? 'ends today' : `${c.daysLeft} days left`}{c.commissionPct ? ` · ${c.commissionPct}% commission` : ''}
                  </p>
                </div>
                <button onClick={() => plan(c)} disabled={!!busy} className={`${btn} ${planned.has(c.asin) ? 'border' : 'text-white bg-[#7C3AED]'}`} style={planned.has(c.asin) ? { borderColor: 'var(--border)', color: 'var(--text)' } : undefined}>
                  {busy === c.asin ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />}
                  {busy === c.asin ? 'Writing the plan…' : planned.has(c.asin) ? 'Plan again' : 'Plan this video'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PlanBody({ p, onDelete }: { p: SavedPlan; onDelete?: () => void }) {
  const v = p.plan
  const h = 'text-[11px] font-semibold uppercase tracking-wide'
  return (
    <div className="flex flex-col gap-3 text-[13px]" style={{ color: 'var(--text-soft)' }}>
      {v.dates.note && <p className="text-[12.5px] text-[#ff9500]">{v.dates.note}</p>}
      <div><p className={h} style={{ color: 'var(--text-faint)' }}>Angle</p><p style={{ color: 'var(--text)' }}>{v.angle}</p></div>
      <div><p className={h} style={{ color: 'var(--text-faint)' }}>Titles</p><ul className="list-disc pl-5">{v.titles.map((t) => <li key={t}>{t}</li>)}</ul></div>
      <div><p className={h} style={{ color: 'var(--text-faint)' }}>Your opening line</p><p style={{ color: 'var(--text)' }}>&ldquo;{v.hook}&rdquo;</p></div>
      <div className="flex flex-col gap-2">
        <p className={h} style={{ color: 'var(--text-faint)' }}>What to show, in order</p>
        {v.outline.map((s) => (
          <div key={s.section}><p className="font-semibold" style={{ color: 'var(--text)' }}>{s.section}</p><ul className="list-disc pl-5">{s.points.map((x) => <li key={x}>{x}</li>)}</ul></div>
        ))}
      </div>
      <div><p className={h} style={{ color: 'var(--text-faint)' }}>Shots</p><ul className="list-disc pl-5">{v.shots.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <div><p className={h} style={{ color: 'var(--text-faint)' }}>The Short to cut</p><p>{v.short.moment}{v.short.why ? `. ${v.short.why}` : ''}</p></div>
      <div><p className={h} style={{ color: 'var(--text-faint)' }}>Thumbnail</p><p><b style={{ color: 'var(--text)' }}>{v.thumbnail.text}</b>{v.thumbnail.idea ? `: ${v.thumbnail.idea}` : ''}</p></div>
      {v.questions.length > 0 && <div><p className={h} style={{ color: 'var(--text-faint)' }}>Questions to answer</p><ul className="list-disc pl-5">{v.questions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={() => navigator.clipboard.writeText(planText(p.product || p.asin, v)).then(() => toast.success('Plan copied'), () => toast.error('Copy failed'))}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><Copy size={13} /> Copy the plan</button>
        <Link href="/co-pilot" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white bg-[#7C3AED]">Filmed it: open Co-Pilot <ArrowRight size={12} /></Link>
        {onDelete && <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px]" style={{ color: 'var(--text-faint)' }}><Trash2 size={13} /> Delete</button>}
      </div>
    </div>
  )
}
