'use client'

// Wayward Placement Offer builder. Wayward has no API to CREATE a placement, so
// MVP asks the right questions (mostly tick-boxes, prefilled from the creator's
// Brand Profile) and composes copy-paste-ready copy for every field of Wayward's
// "Post a placement" form. The creator pastes each field into Wayward.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ClipboardList, Loader2, Copy, ArrowLeft, Sparkles, ExternalLink, Check } from 'lucide-react'

const PURPLE = '#7C3AED'

interface Placement {
  title: string
  description: string
  expectations: string
  suggestedRate: number | null
  rateRationale: string
  retailers: string[]
  endsOn: string
}

// Tick-box option sets, mapped to Wayward's "worth mentioning" prompts.
const CONTENT_TYPES = [
  'Dedicated blog post / review', 'Roundup / listicle inclusion', 'YouTube dedicated video',
  'YouTube integration (60–90s)', 'Instagram Reel', 'Instagram Story frames', 'TikTok video',
  'Email newsletter feature', 'Pinterest pin',
]
const HOOKS = [
  'High-intent, ready-to-buy audience', 'Evergreen — keeps earning after publish', 'Ranks on Google (SEO)',
  'Hands-on, authentic review', 'Seasonal / timely moment', 'Highly engaged niche community',
  'Trusted product recommendations', 'Multi-platform reach',
]
const AUTONOMY = [
  'Full editorial control — I write it in my voice',
  'Collaborative — I share a draft for feedback',
  'Brand approval before publish',
]
const GUARANTEES = [
  'No performance guarantees (best effort)',
  'Guaranteed live for a minimum period',
]
const EXCLUSIVITY = [
  'No exclusivity', 'Category exclusivity during the campaign', 'Category exclusivity for 30 days',
]
const LEAD_TIMES = ['1 week', '2 weeks', '3 weeks', '1 month', 'Flexible']
const RETAILERS = ['Amazon', 'Walmart', 'DTC', 'Other']

// NOTE: these presentational components live at MODULE scope on purpose. Defining
// them inside the page component would give them a new identity on every render,
// so React would remount the whole form on each keystroke/tick — losing input
// focus and jumping the scroll to the top.
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium border transition ${active ? 'text-white' : 'text-[#4b4b4f] dark:text-[#b0b0b5] border-black/10 dark:border-white/15 hover:border-[#7C3AED]/40'}`}
      style={active ? { backgroundColor: PURPLE, borderColor: PURPLE } : undefined}>
      {active && <Check size={12} />}{children}
    </button>
  )
}
function Radio({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map(o => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`text-left inline-flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] border transition ${value === o ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#1d1d1f] dark:text-[#f5f5f7]' : 'border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5] hover:border-[#7C3AED]/40'}`}>
          <span className={`mt-0.5 shrink-0 h-3.5 w-3.5 rounded-full border ${value === o ? 'border-[#7C3AED]' : 'border-black/25 dark:border-white/30'} flex items-center justify-center`}>
            {value === o && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PURPLE }} />}
          </span>
          {o}
        </button>
      ))}
    </div>
  )
}
function Section({ n, title, sub, children }: { n: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
      <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1.5">{n}</span>{title}</p>
      <p className="text-[12px] text-[#86868b] mb-3">{sub}</p>
      {children}
    </div>
  )
}
function Field({ n, title, hint, value, onCopy }: { n: string; title: string; hint: string; value: string; onCopy: (label: string, text: string) => void }) {
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1">{n}</span>{title}</p>
          <p className="text-[11px] text-[#86868b]">Paste into: {hint}</p>
        </div>
        <button onClick={() => onCopy(title, value)} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/5">
          <Copy size={11} /> Copy
        </button>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">{value}</pre>
    </div>
  )
}

export default function PlacementBuilderPage() {
  // Answers
  const [contentTypes, setContentTypes] = useState<string[]>([])
  const [audience, setAudience] = useState('')
  const [audienceSize, setAudienceSize] = useState('')
  const [includePast, setIncludePast] = useState(false)
  const [pastNote, setPastNote] = useState('')
  const [hooks, setHooks] = useState<string[]>([])
  const [autonomy, setAutonomy] = useState(AUTONOMY[0])
  const [guarantee, setGuarantee] = useState(GUARANTEES[0])
  const [exclusivity, setExclusivity] = useState(EXCLUSIVITY[0])
  const [leadTime, setLeadTime] = useState('2 weeks')
  const [pastExamplesUrl, setPastExamplesUrl] = useState('')
  const [rate, setRate] = useState('')
  const [endsOn, setEndsOn] = useState<'always' | 'date'>('always')
  const [endDate, setEndDate] = useState('')
  const [retailers, setRetailers] = useState<string[]>(['Amazon'])
  const [notes, setNotes] = useState('')

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Placement | null>(null)
  const [noProfile, setNoProfile] = useState(false)

  // Prefill audience from the creator's Brand Profile (MVP already knows them).
  useEffect(() => {
    fetch('/api/wayward/placement').then(r => r.json()).then(d => {
      if (!d?.ok) return
      if (!d.brand?.hasProfile) setNoProfile(true)
      if (d.brand?.audience) setAudience((prev) => prev || d.brand.audience)
    }).catch(() => {})
  }, [])

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  async function generate() {
    if (!contentTypes.length) { toast.error('Pick at least one content type.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/wayward/placement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypes, audience, audienceSize,
          includePastPerformance: includePast, pastPerformanceNote: pastNote,
          hooks, editorialAutonomy: autonomy, performanceGuarantee: guarantee,
          exclusivity, leadTime, pastExamplesUrl,
          rate: rate || undefined, endsOn, endDate: endDate || undefined,
          retailers, notes,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Could not draft the placement')
      setResult(data.placement)
      setTimeout(() => document.getElementById('placement-result')?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draft the placement')
    } finally { setBusy(false) }
  }

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {})
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/wayward" className="inline-flex items-center gap-1 text-[12px] text-[#86868b] hover:underline mb-3"><ArrowLeft size={13} /> MVP x Wayward</Link>
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList size={20} style={{ color: PURPLE }} />
        <h1 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Placement Offer Builder</h1>
      </div>
      <p className="text-sm text-[#6e6e73] dark:text-[#a1a1a6] mb-4">
        Answer a few tick-box questions and MVP writes your whole Wayward &quot;Post a placement&quot; listing for you. Wayward has no API to post it, so you copy each finished field into their form.
      </p>

      {/* How it works — the Wayward process, explained. */}
      <div className="rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/[0.04] p-4 mb-5">
        <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: PURPLE }}>How a Wayward placement works</p>
        <ol className="grid sm:grid-cols-3 gap-3 text-[12px]">
          {[
            ['1', 'You open a placement', 'A future post where you’ll feature a brand. Set the terms, price and retailers.'],
            ['2', 'Brands pitch you', 'Matching brands send a product and a short pitch against your listing.'],
            ['3', 'You accept & publish', 'Approve the ones you like, add the link, publish. You’re paid per inclusion through Wayward.'],
          ].map(([n, t, d]) => (
            <li key={n} className="rounded-lg border border-black/5 dark:border-white/10 p-3 bg-white/60 dark:bg-white/[0.03]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[11px] font-bold mb-1" style={{ backgroundColor: PURPLE }}>{n}</span>
              <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{t}</p>
              <p className="text-[#86868b] mt-0.5 leading-snug">{d}</p>
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-[#6e6e73] dark:text-[#a1a1a6] mt-3">This builder handles step 1 — it writes a strong listing so the right brands pitch you.</p>
      </div>

      {noProfile && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 mb-4 text-[12px] text-amber-800 dark:text-amber-300">
          Tip: set up your <Link href="/brand" className="font-semibold underline">Brand Profile</Link> first so MVP can tailor the copy to your niche and voice.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* 01 Content type */}
        <Section n="01" title="What will you make?" sub="Content type(s) for this placement. Pick all that apply.">
          <div className="flex flex-wrap gap-2">
            {CONTENT_TYPES.map(c => <Chip key={c} active={contentTypes.includes(c)} onClick={() => toggle(contentTypes, setContentTypes, c)}>{c}</Chip>)}
          </div>
        </Section>

        {/* 02 Audience */}
        <Section n="02" title="Who’s your audience?" sub="Prefilled from your Brand Profile — tweak it for this placement.">
          <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. US women 25–40 into clean beauty & skincare"
            className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
          <input value={audienceSize} onChange={e => setAudienceSize(e.target.value)} placeholder="Reach / size (optional) — e.g. 45k IG, 20k monthly blog readers"
            className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
        </Section>

        {/* 03 Hook */}
        <Section n="03" title="Why is this placement worth it?" sub="The hook brands care about. Pick the ones that fit.">
          <div className="flex flex-wrap gap-2">
            {HOOKS.map(h => <Chip key={h} active={hooks.includes(h)} onClick={() => toggle(hooks, setHooks, h)}>{h}</Chip>)}
          </div>
        </Section>

        {/* 04 Past performance */}
        <Section n="04" title="Mention past performance?" sub="Only include real results. Leave off if you’d rather not share numbers.">
          <label className="inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
            <input type="checkbox" checked={includePast} onChange={e => setIncludePast(e.target.checked)} className="h-4 w-4 rounded accent-[#7C3AED]" />
            Yes, reference past wins
          </label>
          {includePast && (
            <input value={pastNote} onChange={e => setPastNote(e.target.value)} placeholder="e.g. last skincare feature drove 300+ clicks and $2k in sales"
              className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
          )}
        </Section>

        {/* 05 Expectations (non-negotiables) */}
        <Section n="05" title="Your non-negotiables" sub="Wayward’s Expectations field. These become terms a brand must agree to.">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-semibold text-[#86868b] mb-1.5">Editorial autonomy</p>
              <Radio options={AUTONOMY} value={autonomy} onChange={setAutonomy} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868b] mb-1.5">Performance guarantees</p>
              <Radio options={GUARANTEES} value={guarantee} onChange={setGuarantee} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868b] mb-1.5">Exclusivity</p>
              <Radio options={EXCLUSIVITY} value={exclusivity} onChange={setExclusivity} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868b] mb-1.5">Lead time (how much notice you need)</p>
              <div className="flex flex-wrap gap-2">
                {LEAD_TIMES.map(l => <Chip key={l} active={leadTime === l} onClick={() => setLeadTime(l)}>{l}</Chip>)}
              </div>
            </div>
          </div>
          <input value={pastExamplesUrl} onChange={e => setPastExamplesUrl(e.target.value)} placeholder="Links to past examples (optional) — always helps brands say yes"
            className="mt-3 w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
        </Section>

        {/* 06 Pricing */}
        <Section n="06" title="Your rate" sub="What you receive per accepted product inclusion (USD). Leave blank and MVP suggests one.">
          <div className="flex items-center gap-2">
            <span className="text-[#86868b]">$</span>
            <input value={rate} onChange={e => setRate(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="e.g. 750"
              className="w-32 px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
            <span className="text-[12px] text-[#86868b]">per product inclusion</span>
          </div>
          <div className="mt-3">
            <p className="text-[11px] font-semibold text-[#86868b] mb-1.5">Ends on</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip active={endsOn === 'always'} onClick={() => setEndsOn('always')}>Always open</Chip>
              <Chip active={endsOn === 'date'} onClick={() => setEndsOn('date')}>Set an end date</Chip>
              {endsOn === 'date' && (
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
              )}
            </div>
          </div>
        </Section>

        {/* 07 Retailers */}
        <Section n="07" title="Supported retailers" sub="Brands can only pitch products with listings on the retailers you pick.">
          <div className="flex flex-wrap gap-2">
            {RETAILERS.map(r => <Chip key={r} active={retailers.includes(r)} onClick={() => toggle(retailers, setRetailers, r)}>{r}</Chip>)}
          </div>
        </Section>

        {/* Extra */}
        <Section n="08" title="Anything else? (optional)" sub="Anything a brand should know that the boxes above didn’t cover.">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. I only feature products I’d genuinely use; happy to bundle 2 products for a rate"
            className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border border-black/10 dark:border-white/15 outline-none focus:border-[#7C3AED]" />
        </Section>

        <button onClick={generate} disabled={busy}
          className="self-start inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? 'Writing your placement…' : result ? 'Regenerate' : 'Write my placement'}
        </button>
      </div>

      {result && (
        <div id="placement-result" className="flex flex-col gap-3 mt-8">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Copy these into Wayward</h2>
          </div>
          <p className="text-[12px] text-[#86868b] -mt-1">Open Wayward → Sponsorship Offers → Post a placement, then paste each field below into the matching step.</p>

          <Field n="01" title="Title" hint="Basics → Title" value={result.title} onCopy={copy} />
          <Field n="02" title="Description" hint="Description → About this placement" value={result.description} onCopy={copy} />
          <Field n="03" title="Expectations" hint="Expectations → Non-negotiables" value={result.expectations} onCopy={copy} />

          <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1">04</span>Your rate</p>
                <p className="text-[11px] text-[#86868b]">Paste into: Pricing → Base price (USD per inclusion)</p>
              </div>
              {result.suggestedRate != null && (
                <button onClick={() => copy('Rate', String(result.suggestedRate))} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-[#7C3AED]/40 text-[#7C3AED] hover:bg-[#7C3AED]/5">
                  <Copy size={11} /> Copy
                </button>
              )}
            </div>
            {result.suggestedRate != null && <p className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">${result.suggestedRate.toLocaleString()} <span className="text-[12px] font-normal text-[#86868b]">per inclusion</span></p>}
            {result.rateRationale && <p className="text-[12px] text-[#86868b] mt-1">{result.rateRationale}</p>}
            <p className="text-[12px] text-[#86868b] mt-2">Ends on: <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">{result.endsOn}</strong></p>
          </div>

          <div className="rounded-xl border border-black/5 dark:border-white/10 p-4">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><span className="text-[#86868b] mr-1">05</span>Supported retailers</p>
            <p className="text-[11px] text-[#86868b] mb-2">Tick these in: Retailers → Supported retailers</p>
            <div className="flex gap-2 flex-wrap">
              {result.retailers.map(r => (
                <span key={r} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.1)', color: PURPLE }}>{r}</span>
              ))}
            </div>
          </div>

          <a href="https://app.wayward.com/dashboard/creator/sponsorship-offers" target="_blank" rel="noreferrer"
            className="self-start inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white mt-1" style={{ backgroundColor: PURPLE }}>
            Open Wayward → Post a placement <ExternalLink size={13} />
          </a>
        </div>
      )}
    </div>
  )
}
