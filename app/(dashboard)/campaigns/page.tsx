'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Loader2, Sparkles, ExternalLink, AlertCircle, CheckCircle, Clock, Send, Trash2, Copy, RefreshCw, Puzzle } from 'lucide-react'

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
  blog_post_id: string | null
  category: string | null
  created_at: string
}

type SocialKey = 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'

const SOCIALS: { key: SocialKey; label: string; color: string; endpoint: string }[] = [
  { key: 'facebook', label: 'Facebook', color: '#1877f2', endpoint: '/api/blog/facebook-post' },
  { key: 'threads',  label: 'Threads',  color: '#000000', endpoint: '/api/blog/threads-post' },
  { key: 'twitter',  label: 'X',        color: '#000000', endpoint: '/api/blog/twitter-post' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2', endpoint: '/api/blog/linkedin-post' },
  { key: 'bluesky',  label: 'Bluesky',  color: '#1185fe', endpoint: '/api/blog/bluesky-post' },
  { key: 'telegram', label: 'Telegram', color: '#229ED9', endpoint: '/api/blog/telegram-post' },
]

/** Compact one-click fan-out pills for a published campaign post. */
function CampaignSocialPills({ postId, connected }: { postId: string; connected: Record<SocialKey, boolean> }) {
  const [posting, setPosting] = useState<SocialKey | null>(null)
  const [posted, setPosted] = useState<Set<SocialKey>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [publishingAll, setPublishingAll] = useState(false)

  const available = SOCIALS.filter(s => connected[s.key])
  if (available.length === 0) {
    return (
      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/5">
        Connect a social (Facebook · Threads · X · LinkedIn · Bluesky · Telegram) in{' '}
        <a href="/setup?tab=integrations" className="text-[#0071e3] hover:underline">Setup</a> to fan this post out.
      </p>
    )
  }

  async function postOne(s: typeof SOCIALS[number]): Promise<boolean> {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `${s.label} failed`)
      setPosted(p => new Set(p).add(s.key))
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${s.label} failed`)
      return false
    }
  }

  async function push(s: typeof SOCIALS[number]) {
    setPosting(s.key)
    setErr(null)
    await postOne(s)
    setPosting(null)
  }

  async function publishAll() {
    setPublishingAll(true)
    setErr(null)
    for (const s of available) {
      if (posted.has(s.key)) continue
      setPosting(s.key)
      await postOne(s)
    }
    setPosting(null)
    setPublishingAll(false)
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mr-1">Publish to</span>
      {available.length > 1 && (
        <button
          onClick={publishAll}
          disabled={publishingAll || posting !== null}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-70 transition-all"
        >
          {publishingAll ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          Publish all
        </button>
      )}
      {available.map(s => {
        const isPosted = posted.has(s.key)
        const isPosting = posting === s.key
        return (
          <button
            key={s.key}
            onClick={() => !isPosted && push(s)}
            disabled={isPosting || isPosted}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
              isPosted
                ? 'text-white'
                : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300'
            } disabled:opacity-70`}
            style={isPosted ? { background: s.color } : undefined}
          >
            {isPosting ? <Loader2 size={10} className="animate-spin" /> : isPosted ? <CheckCircle size={10} /> : null}
            {s.label}
          </button>
        )
      })}
      {err && <span className="text-[10px] text-[#ff3b30] ml-1">{err}</span>}
    </div>
  )
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
  const [deleting, setDeleting] = useState<string | null>(null)
  const [genRow, setGenRow] = useState<string | null>(null)
  const [extToken, setExtToken] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [connected, setConnected] = useState<Record<SocialKey, boolean>>({
    facebook: false, threads: false, twitter: false, linkedin: false, bluesky: false, telegram: false,
  })
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [catBusy, setCatBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/list')
      const data = await res.json().catch(() => ({}))
      setItems((data.campaigns ?? []) as Campaign[])
      if (data.connected) setConnected(data.connected)
      if (Array.isArray(data.categoryOptions)) setCategoryOptions(data.categoryOptions)
    } catch { setItems([]) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/campaigns/ingest-token')
      .then(r => r.json()).then(d => d.token && setExtToken(d.token)).catch(() => {})
  }, [])

  async function regenToken() {
    setTokenBusy(true)
    try {
      const res = await fetch('/api/campaigns/ingest-token', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (data.token) setExtToken(data.token)
    } finally { setTokenBusy(false) }
  }

  function copyToken() {
    if (!extToken) return
    navigator.clipboard.writeText(extToken).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

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

  async function generateRow(c: Campaign) {
    setGenRow(c.id)
    // Optimistic: flip the row to "researching" so the user sees progress.
    setItems(prev => (prev ?? []).map(x => x.id === c.id ? { ...x, status: 'researching' as const } : x))
    try {
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: c.asin,
          campaignId: c.id,
          campaignName: c.campaign_name ?? undefined,
          epc: c.epc ?? undefined,
          endsAt: c.ends_at ?? undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Generation failed')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenRow(null)
      await load()
    }
  }

  async function setCategory(c: Campaign, category: string) {
    setCatBusy(c.id)
    setItems(prev => (prev ?? []).map(x => x.id === c.id ? { ...x, category: category || null } : x))
    try {
      const res = await fetch('/api/campaigns/set-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: c.id, category }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not set category')
      if (data.warning) alert(data.warning)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not set category')
      await load()
    } finally {
      setCatBusy(null)
    }
  }

  async function remove(c: Campaign) {
    const label = c.product_title || c.campaign_name || c.asin
    if (!confirm(`Delete this campaign post?\n\n"${label}"\n\nThis removes the WordPress post and cannot be undone.`)) return
    setDeleting(c.id)
    try {
      const res = await fetch('/api/campaigns/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: c.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      setItems(prev => (prev ?? []).filter(x => x.id !== c.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <>
      <Header
        title="CC Campaigns"
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

      {/* Browser extension connect */}
      <div className="card p-5 mb-6 max-w-3xl">
        <div className="flex items-center gap-2 mb-2">
          <Puzzle size={14} className="text-[#5856d6]" />
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Scout campaigns with the browser extension</p>
        </div>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed mb-3">
          Install the MVP Affiliate extension, open Amazon Creator Connections, select the campaigns
          you want, and they land here as queued posts — one click each to research, write, and publish.
          Paste this token into the extension once to link it to your account.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate font-mono text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]">
            {extToken ?? '••••••••••••••••••••••••'}
          </code>
          <button
            onClick={copyToken}
            disabled={!extToken}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 disabled:opacity-50 transition-colors"
          >
            {copied ? <><CheckCircle size={12} className="text-[#34c759]" /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
          <button
            onClick={regenToken}
            disabled={tokenBusy}
            title="Regenerate — invalidates the old token"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#86868b] hover:text-[#ff3b30] disabled:opacity-50 transition-colors"
          >
            {tokenBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
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
              <div key={c.id} className="card p-4">
               <div className="flex items-start gap-3">
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
                  {c.status === 'published' && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-[11px] font-medium ${c.category ? 'text-[#86868b] dark:text-[#8e8e93]' : 'text-[#ff9500]'}`}>
                        {c.category ? 'Category' : '⚠ Choose a category'}
                      </span>
                      <select
                        value={c.category ?? ''}
                        disabled={catBusy === c.id}
                        onChange={e => setCategory(c, e.target.value)}
                        className={`text-[11px] rounded-md border px-2 py-1 bg-white dark:bg-[#1c1c1e] disabled:opacity-50 ${
                          c.category
                            ? 'border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
                            : 'border-[#ff9500]/40 text-[#ff9500]'
                        }`}
                      >
                        <option value="">— Select —</option>
                        {c.category && !categoryOptions.some(o => o.toLowerCase() === c.category!.toLowerCase()) && (
                          <option value={c.category}>{c.category}</option>
                        )}
                        {categoryOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      {catBusy === c.id && <Loader2 size={11} className="animate-spin text-[#86868b]" />}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 mt-0.5">
                  {(c.status === 'pending' || c.status === 'failed') && (
                    <button
                      onClick={() => generateRow(c)}
                      disabled={genRow === c.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
                    >
                      {genRow === c.id
                        ? <><Loader2 size={12} className="animate-spin" /> Starting…</>
                        : <><Sparkles size={12} /> {c.status === 'failed' ? 'Retry' : 'Generate post'}</>}
                    </button>
                  )}
                  {c.wordpress_url && c.status === 'published' && (
                    <a href={c.wordpress_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#34c759] hover:underline">
                      <CheckCircle size={12} /> View <ExternalLink size={10} />
                    </a>
                  )}
                  <button
                    onClick={() => remove(c)}
                    disabled={deleting === c.id}
                    title="Delete post"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#86868b] hover:text-[#ff3b30] disabled:opacity-50 transition-colors"
                  >
                    {deleting === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
               </div>
               {c.status === 'published' && c.blog_post_id && (
                 <CampaignSocialPills postId={c.blog_post_id} connected={connected} />
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
