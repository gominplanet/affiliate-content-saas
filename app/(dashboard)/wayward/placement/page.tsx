'use client'

// Wayward Placement Offer builder (Labs) — Wayward has no API to CREATE a
// placement, so we AI-draft the copy from the creator's Brand Profile and hand
// back copy-paste-ready fields matching Wayward's "Post a placement" form.

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ClipboardList, Loader2, Copy, ArrowLeft, Sparkles, ExternalLink } from 'lucide-react'

const PURPLE = '#7C3AED'

interface Placement {
  title: string
  description: string
  expectations: string
  suggestedRate: number | null
  rateRationale: string
  retailers: string[]
}

export default function PlacementBuilderPage() {
  const [contentType, setContentType] = useState('')
  const [audience, setAudience] = useState('')
  const [targetRate, setTargetRate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Placement | null>(null)

  async function generate() {
    setBusy(true)
    try {
      const res = await fetch('/api/wayward/placement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, audience, targetRate: targetRate || undefined, notes }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Could not draft the placement')
      setResult(data.placement)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draft the placement')
    } finally { setBusy(false) }
  }

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {})
  }

  const Field = ({ n, title, hint, value }: { n: string; title: string; hint: string; value: string }) => (
    <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1">{n}</span>{title}</p>
          <p className="text-[11px] text-[#86868b]">{hint}</p>
        </div>
        <button onClick={() => copy(title, value)} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/5">
          <Copy size={11} /> Copy
        </button>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">{value}</pre>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/wayward" className="inline-flex items-center gap-1 text-[12px] text-[#86868b] hover:underline mb-3"><ArrowLeft size={13} /> MVP x Wayward</Link>
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList size={20} style={{ color: PURPLE }} />
        <h1 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Placement Offer Builder</h1>
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#a1a1a6] mb-5">
        Drafts your Wayward &quot;Post a placement&quot; listing from your Brand Profile. Wayward has no API to post it for you, so copy each field into their form.
      </p>

      <div className="rounded-xl border border-black/5 dark:border-white/10 p-4 flex flex-col gap-3 mb-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">Content type
            <input value={contentType} onChange={e => setContentType(e.target.value)} placeholder="e.g. dedicated YouTube review, IG reel + story"
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
          </label>
          <label className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">Target rate (USD / inclusion, optional)
            <input value={targetRate} onChange={e => setTargetRate(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="e.g. 750"
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
          </label>
        </div>
        <label className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">Audience notes (optional)
          <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. 45k engaged beauty audience, US women 25–40"
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
        </label>
        <label className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">Anything else (optional)
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="exclusivity, lead time, past wins…"
            className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
        </label>
        <button onClick={generate} disabled={busy}
          className="self-start inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? 'Drafting…' : result ? 'Regenerate' : 'Draft my placement'}
        </button>
      </div>

      {result && (
        <div className="flex flex-col gap-3">
          <Field n="01" title="Title" hint="Basics → Title" value={result.title} />
          <Field n="02" title="Description" hint="Description → About this placement" value={result.description} />
          <Field n="03" title="Expectations" hint="Expectations → Non-negotiables" value={result.expectations} />
          <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1">04</span>Suggested rate</p>
                <p className="text-[11px] text-[#86868b]">Pricing → Base price (USD per inclusion)</p>
              </div>
              {result.suggestedRate != null && (
                <button onClick={() => copy('Rate', String(result.suggestedRate))} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/5">
                  <Copy size={11} /> Copy
                </button>
              )}
            </div>
            {result.suggestedRate != null && <p className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">${result.suggestedRate.toLocaleString()}</p>}
            {result.rateRationale && <p className="text-[12px] text-[#86868b] mt-1">{result.rateRationale}</p>}
          </div>
          <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1">05</span>Supported retailers</p>
            <p className="text-[11px] text-[#86868b] mb-2">Retailers → Where you link</p>
            <div className="flex gap-2 flex-wrap">
              {result.retailers.map(r => (
                <span key={r} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.1)', color: PURPLE }}>{r}</span>
              ))}
            </div>
          </div>
          <a href="https://app.wayward.com/dashboard/creator/sponsorship-offers" target="_blank" rel="noreferrer"
            className="self-start inline-flex items-center gap-1.5 text-[13px] font-semibold hover:underline mt-1" style={{ color: PURPLE }}>
            Open Wayward → Post a placement <ExternalLink size={13} />
          </a>
        </div>
      )}
    </div>
  )
}
