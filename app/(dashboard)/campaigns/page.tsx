'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Loader2, Sparkles, ExternalLink, AlertCircle, CheckCircle, Clock } from 'lucide-react'

interface Campaign {
  id: string
  asin: string
  product_title: string | null
  campaign_name: string | null
  epc: string | null
  ends_at: string | null
  status: 'pending' | 'researching' | 'generating' | 'published' | 'failed'
  error_message: string | null
  wordpress_url: string | null
  created_at: string
}

const STATUS: Record<Campaign['status'], { label: string; bg: string; fg: string }> = {
  pending:     { label: 'Queued',      bg: 'bg-gray-100',      fg: 'text-[#6e6e73]' },
  researching: { label: 'Researching', bg: 'bg-[#0071e3]/10',  fg: 'text-[#0071e3]' },
  generating:  { label: 'Writing',     bg: 'bg-[#5856d6]/10',  fg: 'text-[#5856d6]' },
  published:   { label: 'Published',   bg: 'bg-[#34c759]/10',  fg: 'text-[#1f8a3a]' },
  failed:      { label: 'Failed',      bg: 'bg-[#ff3b30]/10',  fg: 'text-[#ff3b30]' },
}

function CampaignsInner() {
  const params = useSearchParams()
  // Phase 2 (extension) deep-links here with ?asin=&campaign=&epc=&ends=
  const [asin, setAsin] = useState(params.get('asin') ?? '')
  const [campaignName, setCampaignName] = useState(params.get('campaign') ?? '')
  const [epc, setEpc] = useState(params.get('epc') ?? '')
  const [endsAt, setEndsAt] = useState(params.get('ends') ?? '')

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [items, setItems] = useState<Campaign[] | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/list')
      const data = await res.json().catch(() => ({}))
      setItems((data.campaigns ?? []) as Campaign[])
    } catch { setItems([]) }
  }, [])

  useEffect(() => { load() }, [load])

  async function generate() {
    const clean = asin.trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(clean)) {
      setGenError('Enter a valid 10-character Amazon ASIN.')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: clean, campaignName, epc, endsAt: endsAt || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setAsin(''); setCampaignName(''); setEpc(''); setEndsAt('')
      await load()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <Header
        title="Campaigns"
        subtitle="Turn an Amazon Creator Connections campaign into a researched, SEO-optimized blog post in your voice. Paste the product ASIN — we research the web, write it, and publish."
      />

      {/* New campaign form */}
      <div className="card p-5 mb-6 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">New campaign post</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Amazon ASIN <span className="text-[#ff3b30]">*</span></label>
            <input value={asin} onChange={e => setAsin(e.target.value)} placeholder="B0XXXXXXXX" className="input-field font-mono text-sm w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Campaign name <span className="text-[#86868b]">(optional)</span></label>
            <input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g. Spring Kitchen Boost" className="input-field text-sm w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">EPC / boost</label>
              <input value={epc} onChange={e => setEpc(e.target.value)} placeholder="12%" className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Ends</label>
              <input type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="input-field text-sm w-full" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Researching + writing… (1–2 min)</>
              : <><Sparkles size={14} /> Generate campaign post</>}
          </button>
          {genError && (
            <span className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {genError}</span>
          )}
        </div>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-3 leading-relaxed">
          Pro feature. We run web research (people-also-ask, real complaints, problems solved), write a
          problem→solution + FAQ post in your brand voice, attach your Geniuslink so the campaign
          commission boost applies, and publish to WordPress.
        </p>
      </div>

      {/* Campaign list */}
      {items === null ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 max-w-md text-center">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No campaign posts yet</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Paste an ASIN above to create your first one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(c => {
            const pill = STATUS[c.status]
            const expired = c.ends_at && new Date(c.ends_at) < new Date()
            return (
              <div key={c.id} className="card p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                      {c.product_title || c.campaign_name || c.asin}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${pill.bg} ${pill.fg}`}>
                      {pill.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[#86868b] dark:text-[#8e8e93] flex-wrap">
                    <span className="font-mono">{c.asin}</span>
                    {c.campaign_name && <span>· {c.campaign_name}</span>}
                    {c.epc && <span>· {c.epc} boost</span>}
                    {c.ends_at && (
                      <span className={`inline-flex items-center gap-1 ${expired ? 'text-[#ff3b30]' : 'text-[#1f8a3a]'}`}>
                        <Clock size={10} /> {expired ? 'expired' : 'boost until'} {new Date(c.ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {c.error_message && <p className="text-[11px] text-[#ff3b30] mt-1.5 break-all">⚠ {c.error_message}</p>}
                </div>
                {c.wordpress_url && c.status === 'published' && (
                  <a href={c.wordpress_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#34c759] hover:underline flex-shrink-0 mt-0.5">
                    <CheckCircle size={12} /> View <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-[#86868b]"><Loader2 size={16} className="animate-spin inline" /></div>}>
      <CampaignsInner />
    </Suspense>
  )
}
