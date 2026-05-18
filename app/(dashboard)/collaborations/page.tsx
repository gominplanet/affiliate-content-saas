'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { Loader2, Sparkles, Copy, CheckCircle, AlertCircle } from 'lucide-react'

interface CollabRow {
  id: string
  brand_name: string
  platforms: string[]
  generated_email: string
  created_at: string
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/10">
      {[true, false].map(v => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === v
              ? 'bg-[#0071e3] text-white'
              : 'bg-white dark:bg-[#1c1c1e] text-[#6e6e73] dark:text-[#ebebf0]'
          }`}
        >
          {v ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
}

export default function CollaborationsPage() {
  const [brandName, setBrandName] = useState('')
  const [amazonStorefront, setAmazonStorefront] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')

  const [allPlatforms, setAllPlatforms] = useState<string[]>([])
  const [platforms, setPlatforms] = useState<Set<string>>(new Set())
  const [bannerAds, setBannerAds] = useState(false)
  const [bannerAdsAmount, setBannerAdsAmount] = useState('')
  const [freeSample, setFreeSample] = useState(true)
  const [productionFee, setProductionFee] = useState(false)
  const [productionFeeAmount, setProductionFeeAmount] = useState('')
  const [shareAddress, setShareAddress] = useState(false)
  const [collabsDone, setCollabsDone] = useState('')
  const [extraNotes, setExtraNotes] = useState('')

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<CollabRow[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/collaborations/list')
      const d = await res.json().catch(() => ({}))
      if (Array.isArray(d.platforms)) setAllPlatforms(d.platforms)
      if (d.prefill) {
        setWebsiteUrl(p => p || d.prefill.websiteUrl || '')
        setYoutubeUrl(p => p || d.prefill.youtubeUrl || '')
      }
      setHistory((d.collaborations ?? []) as CollabRow[])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { load() }, [load])

  function togglePlatform(p: string) {
    setPlatforms(prev => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p); else n.add(p)
      return n
    })
  }

  async function generate() {
    if (!brandName.trim()) { setGenError('Enter the brand name you want to pitch.'); return }
    setGenerating(true); setGenError(null); setEmail('')
    try {
      const res = await fetch('/api/collaborations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName, amazonStorefront, websiteUrl, youtubeUrl,
          platforms: [...platforms],
          bannerAds, bannerAdsAmount, freeSample, productionFee, productionFeeAmount, shareAddress,
          collabsDone, extraNotes,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Generation failed')
      setEmail(d.email || '')
      load()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function copyEmail(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  const lbl = 'block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1'

  return (
    <>
      <Header
        title="Collaborations"
        subtitle="Fill this out and we'll research the brand and write a pitch email that sells your work — ready to copy and send. Pro feature."
      />

      <div className="card p-5 mb-5 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">1 · Your channels & the brand</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={lbl}>Brand name <span className="text-[#ff3b30]">*</span></label>
            <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="The brand you want to collaborate with" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Amazon storefront</label>
            <input value={amazonStorefront} onChange={e => setAmazonStorefront(e.target.value)} placeholder="amazon.com/shop/yourstore" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Website / blog</label>
            <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="yourblog.com" className="input-field text-sm w-full" />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Your YouTube channel</label>
            <input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} placeholder="youtube.com/@yourchannel" className="input-field text-sm w-full" />
          </div>
        </div>
      </div>

      <div className="card p-5 mb-5 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">2 · Your offer</p>

        <label className={lbl}>Which platforms do you want to offer for this collaboration?</label>
        {allPlatforms.length === 0 ? (
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-4">
            No connected channels found. Connect socials in Setup and add your blog/YouTube in Brand Profile — they&apos;ll appear here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {allPlatforms.map(p => {
              const on = platforms.has(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                    on ? 'bg-[#0071e3] text-white' : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
                  }`}
                >
                  {on && <CheckCircle size={11} />} {p}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Sell a banner ad on your blog to this brand?</span>
            <YesNo value={bannerAds} onChange={setBannerAds} />
          </div>
          {bannerAds && (
            <div>
              <label className={lbl}>How much for the banner ad?</label>
              <input value={bannerAdsAmount} onChange={e => setBannerAdsAmount(e.target.value)} placeholder="e.g. $500 / month" className="input-field text-sm w-full sm:w-64" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Want a free sample in exchange for a review?</span>
            <YesNo value={freeSample} onChange={setFreeSample} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Charging a production fee for this review?</span>
            <YesNo value={productionFee} onChange={setProductionFee} />
          </div>
          {productionFee && (
            <div>
              <label className={lbl}>How much are you charging?</label>
              <input value={productionFeeAmount} onChange={e => setProductionFeeAmount(e.target.value)} placeholder="e.g. $350 per video" className="input-field text-sm w-full sm:w-64" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Share your shipping address in the email?</span>
            <YesNo value={shareAddress} onChange={setShareAddress} />
          </div>
          {shareAddress && (
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
              Pulled from the private shipping details in your Brand Profile.
            </p>
          )}
        </div>
      </div>

      <div className="card p-5 mb-5 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">3 · Track record & extras</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className={lbl}>How many collaborations have you done?</label>
            <input value={collabsDone} onChange={e => setCollabsDone(e.target.value)} placeholder="e.g. 12 brand collabs, 40+ sponsored reviews" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Anything else that should be in the email? (optional)</label>
            <textarea value={extraNotes} onChange={e => setExtraNotes(e.target.value)} rows={3} placeholder="Audience size/demographics, standout results, why this brand specifically, deadlines…" className="input-field text-sm w-full resize-none" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Researching + writing… (up to ~1 min)</>
              : <><Sparkles size={14} /> Generate pitch email</>}
          </button>
          {genError && <span className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {genError}</span>}
        </div>
      </div>

      {email && (
        <div className="card p-5 mb-6 max-w-3xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your pitch email</p>
            <button
              onClick={() => copyEmail(email)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 transition-colors"
            >
              {copied ? <><CheckCircle size={12} className="text-[#34c759]" /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          </div>
          <textarea
            value={email}
            onChange={e => setEmail(e.target.value)}
            rows={16}
            className="w-full text-sm text-[#1d1d1f] dark:text-[#f5f5f7] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 font-mono leading-relaxed resize-y focus:outline-none focus:border-[#0071e3]/50"
          />
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">Edit anything before you send — your changes are kept when you copy.</p>
        </div>
      )}

      {history.length > 0 && (
        <div className="max-w-3xl">
          <p className="text-xs font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide mb-2">Past pitches</p>
          <div className="flex flex-col gap-2">
            {history.map(h => (
              <div key={h.id} className="card p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{h.brand_name}</span>
                  <button
                    onClick={() => copyEmail(h.generated_email)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#0071e3] hover:underline"
                  >
                    <Copy size={11} /> Copy
                  </button>
                </div>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                  {h.platforms?.length ? h.platforms.join(' · ') + '  ·  ' : ''}
                  {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
