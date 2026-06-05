'use client'

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
import PageHero from '@/components/layout/PageHero'
import { TutorialVideo } from '@/components/TutorialVideo'
import { Loader2, Sparkles, ExternalLink, CheckCircle, Clock, Send, Trash2, Copy, RefreshCw, Puzzle, AlertCircle } from 'lucide-react'
import type { PinPreviewData } from '@/components/PinterestPreviewModal'
// Code-split the pin preview modal — only loads when the user previews a Pin.
const PinterestPreviewModal = dynamic(
  () => import('@/components/PinterestPreviewModal').then(m => ({ default: m.PinterestPreviewModal })),
  { ssr: false },
)
import { ProLock } from '@/components/ProLock'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier } from '@/lib/view-as'

interface Campaign {
  id: string
  asin: string
  cc_campaign_id: string | null
  product_title: string | null
  campaign_name: string | null
  epc: string | null
  ends_at: string | null
  status: 'pending' | 'researching' | 'generating' | 'published' | 'failed'
  error_message: string | null
  wordpress_url: string | null
  blog_post_id: string | null
  category: string | null
  hero_kind: 'ai' | 'product' | null
  /** Price snapshotted at queue time. Null if the catalog had no
   *  price for that row (Amazon sometimes ships price-less listings). */
  product_price: number | null
  created_at: string
}

type SocialKey = 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram' | 'pinterest'

const SOCIALS: { key: SocialKey; label: string; color: string; endpoint: string }[] = [
  { key: 'facebook',  label: 'Facebook',  color: '#1877f2', endpoint: '/api/blog/facebook-post' },
  { key: 'threads',   label: 'Threads',   color: '#000000', endpoint: '/api/blog/threads-post' },
  { key: 'twitter',   label: 'X',         color: '#000000', endpoint: '/api/blog/twitter-post' },
  { key: 'linkedin',  label: 'LinkedIn',  color: '#0a66c2', endpoint: '/api/blog/linkedin-post' },
  { key: 'bluesky',   label: 'Bluesky',   color: '#1185fe', endpoint: '/api/blog/bluesky-post' },
  { key: 'telegram',  label: 'Telegram',  color: '#229ED9', endpoint: '/api/blog/telegram-post' },
  // Pinterest is special-cased to the editable preview modal (not postOne).
  { key: 'pinterest', label: 'Pinterest', color: '#E60023', endpoint: '/api/blog/pinterest-post' },
]

/** Compact one-click fan-out pills for a published campaign post. */
function CampaignSocialPills({ postId, connected }: { postId: string; connected: Record<SocialKey, boolean> }) {
  const [posting, setPosting] = useState<SocialKey | null>(null)
  const [posted, setPosted] = useState<Set<SocialKey>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [publishingAll, setPublishingAll] = useState(false)
  const [pinData, setPinData] = useState<PinPreviewData | null>(null)

  const available = SOCIALS.filter(s => connected[s.key])
  if (available.length === 0) {
    return (
      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/5">
        Connect a social (Facebook · Threads · X · LinkedIn · Bluesky · Telegram · Pinterest) in{' '}
        <a href="/setup?tab=integrations" className="text-[#7C3AED] hover:underline">Setup</a> to fan this post out.
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
      // Pinterest always goes through the editable preview, never bulk.
      if (s.key === 'pinterest') continue
      setPosting(s.key)
      await postOne(s)
    }
    setPosting(null)
    setPublishingAll(false)
  }

  // Pinterest: open the same editable preview modal as Library & Social Push.
  async function openPinterest() {
    setPosting('pinterest')
    setErr(null)
    try {
      const res = await fetch('/api/blog/pinterest-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not build pin preview')
      setPinData({ ...data, postId })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Pinterest preview failed')
    } finally {
      setPosting(null)
    }
  }

  async function publishPinned(description: string, title: string): Promise<{ ok: boolean; error?: string }> {
    if (!pinData) return { ok: false, error: 'No pin data' }
    try {
      const res = await fetch('/api/blog/pinterest-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId, title, description,
          imageBase64: pinData.imageBase64,
          mediaType: pinData.mediaType,
          fallbackImageUrl: pinData.fallbackImageUrl,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: d.error || `Pinterest failed (${res.status})` }
      setPosted(p => new Set(p).add('pinterest'))
      setPinData(null)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Pinterest publish failed' }
    }
  }

  return (
    <>
    <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mr-1">Publish to</span>
      {available.length > 1 && (
        <button
          onClick={publishAll}
          disabled={publishingAll || posting !== null}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-70 transition-all"
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
            onClick={() => !isPosted && (s.key === 'pinterest' ? openPinterest() : push(s))}
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
    {pinData && (
      <PinterestPreviewModal
        data={pinData}
        onPublish={publishPinned}
        onClose={() => setPinData(null)}
      />
    )}
    </>
  )
}

const STATUS: Record<Campaign['status'], { label: string; bg: string; fg: string }> = {
  pending:     { label: 'Queued',      bg: 'bg-gray-100',      fg: 'text-[#6e6e73]' },
  researching: { label: 'Researching', bg: 'bg-[#7C3AED]/10',  fg: 'text-[#7C3AED]' },
  generating:  { label: 'Writing',     bg: 'bg-[#5856d6]/10',  fg: 'text-[#5856d6]' },
  published:   { label: 'Published',   bg: 'bg-[#34c759]/10',  fg: 'text-[#1f8a3a]' },
  failed:      { label: 'Failed',      bg: 'bg-[#ff3b30]/10',  fg: 'text-[#ff3b30]' },
}

/** Human-readable "X hours ago" / "X days ago" / "yesterday" for the
 *  catalog freshness label. Falls back to the raw locale date when the
 *  timestamp is more than 30 days old (means the admin upload is
 *  seriously overdue and the user should see the actual date, not "a
 *  month ago"). */
function formatFreshness(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days <= 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

function CampaignsInner() {
  const [items, setItems] = useState<Campaign[] | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [genRow, setGenRow] = useState<string | null>(null)
  const [extToken, setExtToken] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedIds, setCopiedIds] = useState(false)
  const [tab, setTab] = useState<'cc' | 'epc'>('cc')
  const [connected, setConnected] = useState<Record<SocialKey, boolean>>({
    facebook: false, threads: false, twitter: false, linkedin: false, bluesky: false, telegram: false, pinterest: false,
  })
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [catBusy, setCatBusy] = useState<string | null>(null)
  // Creator Campaigns is Pro-only. Non-Pro users see the whole page but
  // greyed + non-interactive (ProLock). Default locked until tier loads
  // so we never flash interactive controls to a non-Pro user.
  const supabase = createBrowserClient()
  const [isPro, setIsPro] = useState(false)

  // ── Amazon CC export (.zip) importer ───────────────────────────────
  const [impKw, setImpKw] = useState('')
  const [impMinComm, setImpMinComm] = useState(10)
  const [impMinDays, setImpMinDays] = useState(120)
  // Price bounds — both optional. NaN (empty input) means "no bound on
  // that side", which the search route translates to a null param the
  // RPC reads as "any price". Default to NaN so a stock search behaves
  // exactly as before for users who never touch the price fields.
  const [impMinPrice, setImpMinPrice] = useState<number>(NaN)
  const [impMaxPrice, setImpMaxPrice] = useState<number>(NaN)
  const [impNeedBudget, setImpNeedBudget] = useState(true)
  const [impCap, setImpCap] = useState(500)
  const [impPhase, setImpPhase] = useState<'idle' | 'parsing' | 'ready' | 'pushing'>('idle')
  const [impScanned, setImpScanned] = useState(0)
  const [impMatches, setImpMatches] = useState<{ asin: string; campaignId: string; campaignName: string; brand: string; epc: string; endsAt: string; commission: number; price: number | null }[]>([])
  const [impMsg, setImpMsg] = useState<string | null>(null)
  const [impErr, setImpErr] = useState<string | null>(null)
  // Catalog freshness — surfaced by /api/campaigns/catalog/search so we
  // can show "Catalog last refreshed X ago" under the search button.
  // Lets the user know whether to expect this week's deals or last
  // week's, without exposing the admin status route to non-admins.
  const [catalogFreshAt, setCatalogFreshAt] = useState<string | null>(null)

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
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
        const t = effectiveTier(data?.tier as string)
        setIsPro(t === 'pro' || t === 'admin')
      } catch { /* stay locked */ }
    })()
  }, [supabase])

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

  // Distinct Campaign Ids across the queue, for pasting into Amazon's
  // "Submit accepted campaigns" bulk-accept box (comma/space/newline OK).
  const ccIds = useMemo(() => {
    const seen = new Set<string>()
    for (const c of items ?? []) {
      const id = (c.cc_campaign_id || '').trim()
      if (id) seen.add(id)
    }
    return [...seen]
  }, [items])

  function copyCampaignIds() {
    if (ccIds.length === 0) return
    navigator.clipboard.writeText(ccIds.join('\n')).then(() => {
      setCopiedIds(true); setTimeout(() => setCopiedIds(false), 1800)
    }).catch(() => {})
  }

  // Search the centralized catalog (populated weekly by the admin via
  // /admin/creator-campaigns). The user picks filters; we run the same
  // dedupe/cap/order logic that the legacy zip parser did, server-side
  // instead of in the browser. The old per-user .zip upload path was
  // removed 2026-06-05 — it was wired but unreachable from the UI for
  // months, so users were uploading their own export when the catalog
  // could have answered for them. Pull it back from git history if the
  // admin upload ever needs a backup.
  async function runCatalogSearch() {
    setImpErr(null); setImpMsg(null); setImpMatches([]); setImpScanned(0)
    setImpPhase('parsing')
    try {
      const params = new URLSearchParams({
        keyword: impKw.trim(),
        minCommission: String(isNaN(impMinComm) ? 0 : impMinComm),
        minDays: String(isNaN(impMinDays) ? 0 : impMinDays),
        // Only attach price params when the user actually typed a
        // number. Sending an empty string leaves the RPC to default
        // those bounds to null = "no bound" rather than = 0.
        ...(isNaN(impMinPrice) ? {} : { minPrice: String(impMinPrice) }),
        ...(isNaN(impMaxPrice) ? {} : { maxPrice: String(impMaxPrice) }),
        needBudget: impNeedBudget ? '1' : '0',
        limit: String(impCap),
      })
      const res = await fetch(`/api/campaigns/catalog/search?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Search failed')
      const matches = (data.matches ?? []) as typeof impMatches
      setImpMatches(matches)
      setImpScanned(data.totalScanned ?? 0)
      setCatalogFreshAt((data.lastRefresh as string | null) ?? null)
      setImpPhase('ready')
      const refreshIso = (data.lastRefresh as string | null) ?? null
      setImpMsg(
        matches.length === 0
          ? (refreshIso
              ? 'No matches with these filters. Try widening: lower the commission, shorter days-left, or untick the budget toggle.'
              : 'The catalog hasn\'t been imported yet. Check back in a few hours or ping support.')
          : `${matches.length.toLocaleString()} matches ready to queue (from a shared catalog of ${data.uniqueAsins.toLocaleString()} unique products).`,
      )
    } catch (e) {
      // Catalog timeouts come back as "canceling statement due to
      // statement timeout" from Postgres. That's intimidating + opaque
      // to a creator — translate it to a useful hint so they know what
      // to try (narrow the keyword, raise the commission, or just
      // retry).
      const raw = e instanceof Error ? e.message : 'Search failed.'
      const friendly = /statement timeout|canceling statement/i.test(raw)
        ? 'The catalog took too long to scan for that search. Try narrowing the keyword (e.g. "wireless headphones" instead of just blank), raising the min commission, or hitting Search again — the second run is usually faster because Postgres warms its caches.'
        : raw
      setImpErr(friendly)
      setImpPhase('idle')
    }
  }

  async function pushImported() {
    if (impMatches.length === 0) return
    setImpPhase('pushing'); setImpErr(null)
    try {
      const res = await fetch('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaigns: impMatches.map(m => ({
            asin: m.asin, campaignId: m.campaignId, campaignName: m.campaignName, epc: m.epc, endsAt: m.endsAt,
            // Snapshot the price at queue time. The catalog could refresh
            // (and the price could shift) between now and when the user
            // actually writes the post — we want the queue row to show
            // what they saw when they decided to add it.
            price: m.price,
          })),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Import failed')
      setImpMsg(`Queued ${d.inserted} — ${d.skipped} already in your queue.`)
      setImpMatches([])
      setImpPhase('idle')
      await load()
    } catch (e) {
      setImpErr(e instanceof Error ? e.message : 'Import failed')
      setImpPhase('ready')
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
      toast.error(e instanceof Error ? e.message : 'Generation failed')
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
      if (data.warning) toast.warning(data.warning)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set category')
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
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  function toggleSel(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const allSelected = !!items && items.length > 0 && selected.size === items.length

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set((items ?? []).map(c => c.id)))
  }

  async function deleteSelected() {
    if (selected.size === 0 || !items) return
    const ids = [...selected]
    if (!confirm(`Delete ${ids.length} campaign post${ids.length === 1 ? '' : 's'}?\n\nThis also removes their WordPress posts and cannot be undone.`)) return
    setBulkDeleting(true)
    const failed: string[] = []
    // Sequential — each delete also hits the WordPress API; keep it gentle
    // and tolerant so one failure doesn't abort the rest.
    for (const id of ids) {
      try {
        const res = await fetch('/api/campaigns/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: id }),
        })
        if (!res.ok) { failed.push(id); continue }
        setItems(prev => (prev ?? []).filter(x => x.id !== id))
      } catch {
        failed.push(id)
      }
    }
    setSelected(new Set(failed))
    setBulkDeleting(false)
    if (failed.length) toast.warning(`${failed.length} of ${ids.length} could not be deleted — left selected so you can retry.`)
  }

  return (
    <>
      <PageHero
        title="Creator Campaigns"
        subtitle="Bring Amazon Creator Connections campaigns in two ways — they land in one queue. One click each to research, write, and publish in your brand voice."
      />

      <TutorialVideo sectionKey="campaigns" />

      <ProLock
        locked={!isPro}
        title="Creator Campaigns is a Pro feature"
        description="Built for Amazon influencers & associates: pull your Amazon Creator Connections campaigns, scout them by commission & EPC, and turn the best ones into published reviews in one click. Upgrade to Pro to unlock it."
      >

      {/* Intake method tabs — both feed the same queue below */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-white/10 max-w-3xl">
        {([
          { k: 'cc' as const, label: 'Creator Connections' },
          { k: 'epc' as const, label: 'EPC' },
        ]).map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.k
                ? 'border-[#7C3AED] text-[#7C3AED]'
                : 'border-transparent text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* EPC — scout via the browser extension */}
      {tab === 'epc' && (
      <div className="card p-5 mb-6 max-w-3xl">
        <div className="flex items-center gap-2 mb-2">
          <Puzzle size={14} className="text-[#5856d6]" />
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Scout campaigns with the browser extension</p>
        </div>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed mb-3">
          Install the MVP Affiliate extension, open the <strong>EPC</strong> section of Amazon
          Creator Connections, select the campaigns you want, and they land here as queued posts —
          one click each to research, write, and publish. The extension only scouts the EPC side
          (the .zip importer on the Creator Connections tab covers the rest). Paste the token below
          into the extension once to link it to your account.
        </p>

        <a
          href="/mvp-cc-scout.zip"
          download
          className="inline-flex items-center gap-1.5 px-3 py-2 mb-3 rounded-lg text-xs font-semibold text-white bg-[#5856d6] hover:bg-[#4a48c0] transition-colors"
        >
          <Puzzle size={12} /> Download extension (.zip)
        </a>

        <details className="mb-3 group">
          <summary className="text-[11px] font-medium text-[#7C3AED] cursor-pointer select-none">
            How to install (1 min — no Chrome Web Store needed)
          </summary>
          <ol className="list-decimal ml-5 mt-2 space-y-1 text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
            <li>Download the .zip above and <strong>unzip it</strong> (you&apos;ll get a folder).</li>
            <li>Open <code className="font-mono">chrome://extensions</code> in Chrome.</li>
            <li>Turn on <strong>Developer mode</strong> (top-right toggle).</li>
            <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
            <li>Pin the extension, paste the token below into it, then open the <strong>EPC</strong> section of Amazon Creator Connections.</li>
          </ol>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
            Chrome may show a &ldquo;disable developer-mode extensions&rdquo; notice on restart — that&apos;s normal for
            tools installed outside the Web Store; just close it. Keep the folder where it is (deleting it removes the extension).
          </p>
        </details>

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

      )}

      {/* Creator Connections — search the shared catalog (no per-user upload).
          The catalog is refreshed weekly from /admin/creator-campaigns.
          Every user just hits Search. The old per-user .zip upload was
          removed 2026-06-05; see runCatalogSearch above for the new
          single-path flow. */}
      {tab === 'cc' && (
      <div className="card p-5 mb-6 max-w-3xl">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-[#7C3AED]" />
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Search Amazon Creator Connections</p>
        </div>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed mb-3">
          Pick your filters and hit <strong>Search catalog</strong> — we pull the matching campaigns from
          the centralized Amazon Creator Connections weekly export. Keyword matches the campaign &amp;
          brand name (e.g. &quot;vacuum&quot;). Leave it blank to pull everything that fits the other
          filters.
        </p>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed mb-3">
          <strong>Why fewer queue than match:</strong> Amazon lists the same product under many separate
          campaigns, so thousands of matching rows are usually only a few hundred actual products. We keep
          one campaign per product (the highest commission) so you don&apos;t get duplicate posts.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Brand / campaign keyword</label>
            <input value={impKw} onChange={e => setImpKw(e.target.value)} placeholder="e.g. vacuum (optional)" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Min commission %</label>
            <input type="number" value={impMinComm} onChange={e => setImpMinComm(parseFloat(e.target.value))} className="input-field text-sm w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Min days left</label>
            <input type="number" value={impMinDays} onChange={e => setImpMinDays(parseFloat(e.target.value))} className="input-field text-sm w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Queue cap</label>
            <select value={impCap} onChange={e => setImpCap(parseInt(e.target.value, 10))} className="input-field text-sm w-full">
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value={200}>Top 200</option>
              <option value={500}>Top 500</option>
              <option value={1000}>Top 1000</option>
            </select>
          </div>
          {/* Price range filters were live here briefly, but Amazon's
              Creator Connections weekly export does NOT ship a price
              column — so the catalog has nothing to filter on and the
              inputs only confused users. The schema, RPC params, and
              wiring all stay in place so this row can come back in 30
              seconds once price-lookup-at-queue-time lands (we already
              have services/amazon.fetchAmazonProduct on tap for the
              Deals Hub). Hidden, not deleted. */}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          <input type="checkbox" checked={impNeedBudget} onChange={e => setImpNeedBudget(e.target.checked)} />
          Only campaigns with budget &amp; open slots remaining
        </label>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={runCatalogSearch}
            disabled={impPhase === 'parsing' || impPhase === 'pushing'}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${impPhase === 'parsing' || impPhase === 'pushing' ? 'bg-gray-200 text-[#86868b] cursor-default' : 'text-white bg-[#7C3AED] hover:bg-[#6D28D9]'}`}
          >
            {impPhase === 'parsing' ? <><Loader2 size={14} className="animate-spin" /> Searching…</> : <><Sparkles size={14} /> Search catalog</>}
          </button>
          {impPhase === 'ready' && impMatches.length > 0 && (
            <button
              onClick={pushImported}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] transition-colors"
            >
              <Sparkles size={14} /> Queue {impMatches.length}
            </button>
          )}
          {impPhase === 'pushing' && (
            <span className="text-xs text-[#86868b] flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Queuing…</span>
          )}
          {impPhase === 'parsing' && (
            <span className="text-xs text-[#86868b]">Scanned {impScanned.toLocaleString()} rows…</span>
          )}
          {impMsg && <span className="text-xs text-[#1f8a3a]">{impMsg}</span>}
          {impErr && <span className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {impErr}</span>}
        </div>
        {/* Catalog freshness — tells the user whether this week's deals
            are loaded yet. Filled in after the first search returns. */}
        {catalogFreshAt && (
          <p className="mt-3 text-[11px] text-[#86868b] dark:text-[#8e8e93]">
            Catalog last refreshed{' '}
            <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
              {formatFreshness(catalogFreshAt)}
            </span>
            . We re-import the Amazon Creator Connections weekly export from the admin panel.
          </p>
        )}
      </div>
      )}

      {/* Bulk-accept helper: copy every Campaign Id for Amazon's
          "Submit accepted campaigns" box. */}
      {items && items.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 max-w-3xl">
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
            {ccIds.length > 0 ? (
              <>Paste these into Amazon Creator Connections → <strong>Submit accepted campaigns</strong> to accept them all at once.</>
            ) : (
              <>No Campaign Ids yet — only campaigns imported from the <strong>.zip</strong> after this update carry them. Re-import to capture IDs.</>
            )}
          </p>
          <button
            onClick={copyCampaignIds}
            disabled={ccIds.length === 0}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {copiedIds
              ? <><CheckCircle size={12} className="text-[#34c759]" /> Copied {ccIds.length}</>
              : <><Copy size={12} /> Copy {ccIds.length} campaign ID{ccIds.length === 1 ? '' : 's'}</>}
          </button>
        </div>
      )}

      {/* Select-all + bulk delete */}
      {items && items.length > 0 && (
        <div className="flex items-center gap-4 mb-2 max-w-3xl">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-[#86868b] dark:text-[#8e8e93] cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="accent-[#7C3AED]"
            />
            {allSelected ? 'Clear selection' : `Select all (${items.length})`}
          </label>
          {selected.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={bulkDeleting}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#ff3b30] hover:underline disabled:opacity-50"
            >
              {bulkDeleting
                ? <><Loader2 size={12} className="animate-spin" /> Deleting…</>
                : <><Trash2 size={12} /> Delete {selected.size} selected</>}
            </button>
          )}
        </div>
      )}

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
              <div key={c.id} className={`card p-4 ${selected.has(c.id) ? 'ring-1 ring-[#7C3AED]' : ''}`}>
               <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleSel(c.id)}
                  className="mt-1 shrink-0 accent-[#7C3AED]"
                  aria-label="Select campaign"
                />
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
                    {/* Price chip — only show when we actually captured
                        one (Amazon ships some price-less listings). */}
                    {typeof c.product_price === 'number' && c.product_price > 0 && (
                      <span>· ${c.product_price.toFixed(2)}</span>
                    )}
                    {c.epc && <span>· {c.epc} boost</span>}
                    {c.ends_at && (
                      <span className={`inline-flex items-center gap-1 ${expired ? 'text-[#ff3b30]' : 'text-[#1f8a3a]'}`}>
                        <Clock size={10} /> {expired ? 'expired' : 'boost until'} {new Date(c.ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {c.hero_kind === 'ai' && (
                      <span className="inline-flex items-center gap-1 text-[#7C3AED]" title="Featured image: AI-generated 16:9 hero">
                        <Sparkles size={10} /> AI hero
                      </span>
                    )}
                    {c.hero_kind === 'product' && (
                      <span className="inline-flex items-center gap-1 text-[#ff9500]" title="MVP couldn't generate an AI hero this time — used the product photo letterboxed to 16:9 instead.">
                        <AlertCircle size={10} /> Product photo (no AI hero)
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
                  <a
                    href={`https://www.amazon.com/dp/${c.asin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open this product on Amazon"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#86868b] hover:text-[#7C3AED] transition-colors"
                  >
                    Product Page <ExternalLink size={10} />
                  </a>
                  {(c.status === 'pending' || c.status === 'failed') && (
                    <button
                      onClick={() => generateRow(c)}
                      disabled={genRow === c.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
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
      </ProLock>
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
