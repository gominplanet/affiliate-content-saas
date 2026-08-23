'use client'

/**
 * CC Campaigns — the Creator Connections intelligence browser.
 *
 * Every live campaign with the decision data on the card: commission + est
 * $/sale, how full it is (spots left), whether the brand actually pays out
 * (budget being spent), demand + rating, days left, and a one-click "Make blog
 * post". This is MVP's answer to Logie-style CC research, fused straight into
 * the content engine (browse → publish in one place).
 */

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import {
  Loader2, ExternalLink, Search, ShieldCheck, ShieldAlert, ShieldQuestion,
  Users, Star, TrendingUp, Clock, FileText, CheckCircle2, Lock, Mail, Radar, Grid3x3, Handshake, ShoppingBag,
  Bookmark, BookmarkCheck,
} from 'lucide-react'
import { requestCcSmartScan, requestFindCampaign, requestAcceptCampaign, requestMyCcCampaigns } from '@/lib/extension-frame'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { type Tier } from '@/lib/tier'
import { campaignRules } from '@/lib/cc-smart-rules'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import SmartScanPanel from '@/components/campaigns/SmartScanPanel'
import EpcLibraryPanel from '@/components/campaigns/EpcLibraryPanel'

interface Trust { score: number; tier: 'reliable' | 'mixed' | 'risky' | 'unknown'; spendRatio: number | null; reasons: string[] }
interface Campaign {
  campaignId: string
  name: string | null
  brand: string | null
  repAsin: string | null
  asinCount: number
  image: string | null
  commissionPct: number | null
  perSale: number | null
  priceNow: number | null
  discountPct: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  videoCount: number | null
  endsAt: string | null
  daysLeft: number | null
  spotsLeft: number | null
  totalSlots: number | null
  pctFilled: number | null
  isFull: boolean
  budgetRemaining: number | null
  trust: Trust
  score: number
  detailsUrl: string
}

const SORTS = [
  { key: 'score', label: 'Best opportunities' },
  { key: 'commission', label: 'Highest commission' },
  { key: 'perSale', label: 'Highest $ / sale' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'demand', label: 'Most in demand' },
] as const

function TrustBadge({ t }: { t: Trust }) {
  const map = {
    reliable: { icon: <ShieldCheck size={13} />, label: 'Pays out', cls: 'text-[#1c7a35] bg-[#34c759]/15' },
    mixed: { icon: <ShieldQuestion size={13} />, label: 'Mixed', cls: 'text-[#8a6d00] bg-[#ffcc00]/15' },
    risky: { icon: <ShieldAlert size={13} />, label: 'Risky', cls: 'text-[#b3261e] bg-[#ff3b30]/12' },
    unknown: { icon: <ShieldQuestion size={13} />, label: 'Unknown', cls: 'text-[var(--text-3)] bg-[var(--surface-2)]' },
  }[t.tier]
  return (
    <span title={t.reasons.join(' · ')} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${map.cls}`}>
      {map.icon} {map.label}
    </span>
  )
}

interface CampaignStatus { accepted?: boolean; messaged?: boolean; posted?: boolean; url?: string | null }

function useMakePost(c: Campaign, presetUrl: string | null, onActed?: () => void) {
  const [gen, setGen] = useState(false)
  const [postUrl, setPostUrl] = useState<string | null>(presetUrl)
  const makePost = useCallback(async () => {
    if (!c.repAsin) { toast.error('No product ASIN on this campaign yet.'); return }
    setGen(true)
    // Persistent toast for the whole run — the CC engine (scrape → research →
    // write → fact-check → hero image → publish) takes ~1-2 min. Keeping the
    // toast up (and the card in its generating state) tells the user it's
    // working rather than looking hung. The request itself runs at 600s server
    // side now, so it finishes instead of timing out.
    const toastId = `cc-gen-${c.repAsin}`
    toast.loading('Writing your post… (~1-2 min — keep this tab open)', { id: toastId, duration: Infinity })
    try {
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: c.repAsin, campaignName: c.name || undefined, endsAt: c.endsAt || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.error) {
        toast.error(j?.error || `Failed (${res.status})`, { id: toastId, duration: 8_000 })
        return
      }
      setPostUrl(j.wordpressUrl || j.url || null)
      toast.success('Blog post published.', { id: toastId, duration: 6_000 })
      onActed?.() // refresh per-ASIN status so "Hide posted" sees this immediately
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate', { id: toastId, duration: 8_000 })
    } finally { setGen(false) }
  }, [c.repAsin, c.name, c.endsAt])
  return { gen, postUrl, makePost }
}

function CampaignCard({ c, status, onMessage, onActed, saved, onToggleSave, socialOnly = false }: { c: Campaign; status?: CampaignStatus; onMessage: (c: Campaign) => void; onActed?: () => void; saved?: boolean; onToggleSave?: () => void; socialOnly?: boolean }) {
  const { gen, postUrl, makePost } = useMakePost(c, status?.url ?? null, onActed)
  const endingSoon = c.daysLeft != null && c.daysLeft <= 1

  // In-app Accept: SCOUT opens the campaign's Amazon page (the user's logged-in
  // session) and clicks Accept — no tab-hopping. On success we record it via the
  // upserting mark-accepted route so the badge sticks even with no prior row.
  const [accepting, setAccepting] = useState(false)
  const [acceptedLocal, setAcceptedLocal] = useState(false)
  const isAccepted = !!status?.accepted || acceptedLocal
  const doAccept = useCallback(async () => {
    if (!c.repAsin) { toast.error('No product ASIN on this campaign yet.'); return }
    setAccepting(true)
    const tId = `cc-accept-${c.campaignId}`
    toast.loading('Accepting on Amazon via SCOUT…', { id: tId, duration: Infinity })
    try {
      const res = await requestAcceptCampaign(c.detailsUrl)
      if (!res.ok) {
        const msg = res.error === 'not-installed'
          ? 'SCOUT extension not detected. Install/enable it and open Amazon Creator Connections, then try again.'
          : res.error === 'timeout'
            ? 'SCOUT timed out. Make sure you’re logged into Amazon, then try again.'
            : res.reason || res.error || 'Couldn’t accept automatically — use “Open on Amazon”.'
        toast.error(msg, { id: tId, duration: 8_000 })
        return
      }
      // Record it (upsert — carries the catalog ids so status sticks).
      void fetch('/api/campaigns/mark-accepted', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: c.repAsin, campaignId: c.campaignId, detailsUrl: c.detailsUrl, brand: c.brand, commissionPct: c.commissionPct, productTitle: c.name }),
      }).catch(() => {})
      setAcceptedLocal(true)
      toast.success(res.already ? 'Already accepted — you’re in.' : 'Accepted. You can message the brand or make a post.', { id: tId, duration: 6_000 })
      onActed?.() // refresh per-ASIN status so "Hide joined" sees this immediately
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Accept failed', { id: tId, duration: 8_000 })
    } finally { setAccepting(false) }
  }, [c.repAsin, c.campaignId, c.detailsUrl, c.brand, c.commissionPct, c.name, onActed])
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="w-20 h-20 rounded-lg bg-[var(--surface-2)] border border-[var(--border-2)] flex items-center justify-center overflow-hidden flex-shrink-0">
          {c.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={c.image} alt="" className="w-full h-full object-contain p-1" />
            : <span className="text-[10px] text-[var(--text-3)]">No image</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <TrustBadge t={c.trust} />
            {c.isFull && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#b3261e] bg-[#ff3b30]/12">FULL</span>}
            {endingSoon && !c.isFull && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#b3261e] bg-[#ff3b30]/12">Ends {c.daysLeft === 0 ? 'today' : 'tomorrow'}</span>}
            {status?.posted && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#1c7a35] bg-[#34c759]/15 inline-flex items-center gap-0.5"><CheckCircle2 size={10} /> Posted</span>}
            {isAccepted && !status?.posted && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#7C3AED] bg-[#7C3AED]/12">Accepted</span>}
            {status?.messaged && !isAccepted && !status?.posted && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#8a6d00] bg-[#ffcc00]/15">Messaged</span>}
          </div>
          <p className="text-[11px] text-[var(--text-3)] truncate">{c.brand || 'Unknown brand'}</p>
          <p className="text-sm font-medium text-[var(--text)] leading-snug line-clamp-2">{c.name || c.repAsin}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5">
          <p className="text-[var(--text-3)] text-[10px]">Commission</p>
          <p className="font-semibold text-[var(--text)]">{c.commissionPct != null ? `${c.commissionPct}%` : '—'}</p>
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5">
          <p className="text-[var(--text-3)] text-[10px]">Est. $ / sale</p>
          <p className="font-semibold text-[#1c7a35]">{c.perSale != null ? `$${c.perSale.toFixed(2)}` : '—'}</p>
        </div>
      </div>

      {/* Spots */}
      {c.totalSlots != null && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-[var(--text-3)] mb-1">
            <span>{c.spotsLeft != null ? `${c.spotsLeft.toLocaleString()} of ${c.totalSlots.toLocaleString()} spots left` : 'Spots'}</span>
            {c.pctFilled != null && <span>{c.pctFilled}% full</span>}
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${c.pctFilled ?? 0}%`, background: c.isFull ? '#ff3b30' : (c.pctFilled ?? 0) > 80 ? '#ff9500' : '#34c759' }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-[var(--text-3)] flex-wrap">
        {c.monthlySold != null && <span className="inline-flex items-center gap-1"><TrendingUp size={12} /> {c.monthlySold.toLocaleString()}+/mo</span>}
        {c.rating != null && <span className="inline-flex items-center gap-1"><Star size={12} /> {c.rating}{c.reviewCount ? ` (${c.reviewCount.toLocaleString()})` : ''}</span>}
        {c.videoCount != null && <span className="inline-flex items-center gap-1"><Users size={12} /> {c.videoCount} vids</span>}
        {c.daysLeft != null && c.daysLeft > 1 && <span className="inline-flex items-center gap-1"><Clock size={12} /> {c.daysLeft}d left</span>}
      </div>

      <div className="flex flex-col gap-2 mt-auto pt-1">
        {/* Accept — SCOUT clicks Accept on Amazon in the user's session, no
            tab-hopping. Once accepted, a subtle confirmation replaces it. */}
        {isAccepted ? (
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#7C3AED]">
            <Handshake size={13} /> Accepted on Amazon
          </div>
        ) : (
          <button onClick={doAccept} disabled={accepting || c.isFull} className="btn-secondary w-full flex items-center gap-1.5 text-xs justify-center disabled:opacity-50"
            title={c.isFull ? 'Campaign is full — no spot to accept' : 'Accept this campaign on Amazon via SCOUT — no tab-hopping'}>
            {accepting ? <Loader2 size={13} className="animate-spin" /> : <Handshake size={13} />} {accepting ? 'Accepting via SCOUT…' : 'Accept campaign'}
          </button>
        )}
        <div className="flex items-center gap-2">
          {/* Amazon Influencer tier: no blog — the primary action is Save (→ Social
              Influencer). Accept + Message stay below (they're Creator Connections). */}
          {socialOnly ? (
            saved ? (
              <a href="/amazon/social" className="btn-primary flex items-center gap-1.5 text-xs flex-1 justify-center" style={{ background: '#d97706', borderColor: '#d97706' }}>
                <BookmarkCheck size={13} /> Make the post →
              </a>
            ) : (
              <button onClick={onToggleSave} disabled={!c.repAsin} className="btn-primary flex items-center gap-1.5 text-xs flex-1 justify-center disabled:opacity-50" style={{ background: '#d97706', borderColor: '#d97706' }}
                title="Save this product to make a social post in Social Influencer">
                <Bookmark size={13} /> Save for a post
              </button>
            )
          ) : postUrl ? (
            <a href={postUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 text-xs flex-1 justify-center">
              <CheckCircle2 size={13} className="text-[#34c759]" /> View post
            </a>
          ) : (
            <button onClick={() => makePost()} disabled={gen || c.isFull} className="btn-primary flex items-center gap-1.5 text-xs flex-1 justify-center disabled:opacity-50"
              title={c.isFull ? 'Campaign is full — no bounty to earn' : 'Scrape, write and publish a blog post for this product (~1 min)'}>
              {gen ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} {gen ? 'Publishing…' : 'Make blog post'}
            </button>
          )}
          <button onClick={() => onMessage(c)} disabled={c.isFull} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-50" title="Draft + send a pitch to the brand via SCOUT">
            <Mail size={13} />
          </button>
          {!socialOnly && onToggleSave && (
            <button
              onClick={onToggleSave}
              title={saved ? 'Saved — click to remove' : 'Save to Saved Campaigns'}
              className="btn-secondary flex items-center gap-1.5 text-xs"
              style={saved ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.10)', color: '#b26a00' } : undefined}
            >
              {saved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
            </button>
          )}
          {/* View the actual product on Amazon (the /dp page) so the user can
              check it out before committing — distinct from the campaign link. */}
          {c.repAsin && (
            <a href={`https://www.amazon.com/dp/${c.repAsin}`} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 text-xs" title="View the product on Amazon">
              <ShoppingBag size={13} />
            </a>
          )}
          <a href={c.detailsUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 text-xs" title="Open the campaign on Amazon Creator Connections">
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  )
}

export default function CcCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [sort, setSort] = useState<string>('score')
  const [q, setQ] = useState('')
  const [minCommission, setMinCommission] = useState(0)
  const [payingOnly, setPayingOnly] = useState(false)
  const [hasSpots, setHasSpots] = useState(true)
  // Hide campaigns the user has already acted on (client-side, over the loaded
  // pages — status comes from statusByAsin, no API change needed).
  const [hideJoined, setHideJoined] = useState(false)
  const [hidePosted, setHidePosted] = useState(false)
  // "Joined only" — inverse of Hide joined: surface only accepted campaigns.
  // Mutually exclusive with the hide filters.
  const [joinedOnly, setJoinedOnly] = useState(false)
  const [syncingJoined, setSyncingJoined] = useState(false)
  // Joined-only is a LIVE view backed by SCOUT (queries the creator's real Amazon
  // joined list on demand), so it scales to accounts with 100k+ joins instead of
  // trying to mirror them all into our catalog.
  const [joinedHasMore, setJoinedHasMore] = useState(false)
  const [joinedPages, setJoinedPages] = useState(12)
  // CC access gate: the shared catalog stays locked until SCOUT confirms this
  // user's own Creator Connections grid renders (proof they have the invite).
  const [locked, setLocked] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null)
  // Browse (intelligence catalog) vs Smart-Scan (live SCOUT sweep of your grid).
  const [mode, setMode] = useState<'browse' | 'scan' | 'epc'>('browse')
  // Your campaigns inbox → per-ASIN status (accepted / messaged / posted) so the
  // cards show what you've already acted on. Also the covered-ASIN skip list.
  const [statusByAsin, setStatusByAsin] = useState<Record<string, CampaignStatus>>({})
  const [coveredAsins, setCoveredAsins] = useState<string[]>([])
  const [msgModal, setMsgModal] = useState<MessageBrandCampaign | null>(null)
  // ASINs the user has saved — drives the Save/Saved toggle on each card. Writes
  // to the shared cc_saved_finds shelf via /api/campaigns/saved (same store as
  // the dashboard digest + the Saved Campaigns page).
  const [savedAsins, setSavedAsins] = useState<Set<string>>(new Set())
  // Amazon Influencer tier: no blog, so a campaign's action is Save (→ Social
  // Influencer) rather than "Make blog post". Accept + Message stay (CC actions).
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch { realTier = 'trial'; apply() }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])
  useEffect(() => {
    fetch('/api/campaigns/saved').then((r) => r.json()).then((d) => {
      if (d?.ok && Array.isArray(d.saved)) setSavedAsins(new Set(d.saved.map((s: { asin: string }) => s.asin.toUpperCase())))
    }).catch(() => {})
  }, [])
  const toggleSave = useCallback(async (c: Campaign) => {
    if (!c.repAsin) { toast.error('No product ASIN on this campaign yet.'); return }
    const asin = c.repAsin.toUpperCase()
    const wasSaved = savedAsins.has(asin)
    setSavedAsins((prev) => { const n = new Set(prev); if (wasSaved) n.delete(asin); else n.add(asin); return n })
    try {
      if (wasSaved) {
        await fetch(`/api/campaigns/saved?asin=${asin}`, { method: 'DELETE' })
      } else {
        await fetch('/api/campaigns/saved', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asin: c.repAsin, source: 'campaign', campaignId: c.campaignId, title: c.name, brand: c.brand,
            imageUrl: c.image, commissionPct: c.commissionPct, price: c.priceNow, monthlySales: c.monthlySold,
            rating: c.rating, hasVideo: (c.videoCount ?? 0) > 0, marketplace: 'us', detailsUrl: c.detailsUrl,
          }),
        })
        toast.success('Saved to your Saved Campaigns.')
      }
    } catch {
      setSavedAsins((prev) => { const n = new Set(prev); if (wasSaved) n.add(asin); else n.delete(asin); return n }) // revert
    }
  }, [savedAsins])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/list', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json().catch(() => ({}))
      const rows = Array.isArray(j?.campaigns) ? j.campaigns : []
      const map: Record<string, CampaignStatus> = {}
      const covered: string[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of rows as any[]) {
        const asin = String(r.asin || '').toUpperCase()
        if (!asin) continue
        covered.push(asin)
        // A user can have MORE than one campaigns row per ASIN (e.g. an accept
        // row + a separate generate row). OR the flags across them so a
        // published row anywhere wins — otherwise a stale 'pending' row could
        // mask a real post and "Hide posted" wouldn't fire.
        const cur = map[asin]
        map[asin] = {
          accepted: !!cur?.accepted || !!r.accepted_at,
          messaged: !!cur?.messaged || !!r.messaged_at,
          posted: !!cur?.posted || (r.status === 'published' && !!r.wordpress_url),
          url: cur?.url || (r.wordpress_url ?? null),
        }
      }
      // Universal "posted" overlay — posts made through ANY flow (not just CC),
      // keyed by ASIN with the live URL. Makes the Posted badge + View-post link
      // light up for Blog-Post-Generator posts too, matching the Hide-posted
      // filter. Best-effort; if it fails the campaigns-table status still stands.
      try {
        const pr = await fetch('/api/cc/posted-asins', { cache: 'no-store' })
        if (pr.ok) {
          const pj = await pr.json().catch(() => ({}))
          const posted = (pj?.posted ?? {}) as Record<string, string>
          for (const [asin, url] of Object.entries(posted)) {
            const cur = map[asin]
            map[asin] = {
              accepted: !!cur?.accepted,
              messaged: !!cur?.messaged,
              posted: true,
              url: cur?.url || (url || null),
            }
          }
        }
      } catch { /* non-fatal */ }
      setStatusByAsin(map); setCoveredAsins(covered)
    } catch { /* non-fatal */ }
  }, [])

  const fetchPage = useCallback(async (page: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), sort, ...(q ? { q } : {}), ...(minCommission ? { minCommission: String(minCommission) } : {}), ...(payingOnly ? { payingOnly: '1' } : {}), ...(hasSpots && !joinedOnly ? { hasSpots: '1' } : {}), ...(joinedOnly ? { joinedOnly: '1' } : { ...(hideJoined ? { hideJoined: '1' } : {}), ...(hidePosted ? { hidePosted: '1' } : {}) }) })
      const res = await fetch(`/api/cc/campaigns?${p.toString()}`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (res.status === 403 && j?.needsCcVerify) { setLocked(true); if (!append) setCampaigns([]); return }
      if (!res.ok || !j.ok) { toast.error(j?.error || 'Failed to load campaigns'); return }
      setLocked(false)
      setCampaigns((prev) => append ? [...prev, ...j.campaigns] : j.campaigns)
      setNextPage(j.nextPage)
      setTotal(j.total ?? 0)
    } finally { setLoadingMore(false); setLoading(false) }
  }, [sort, q, minCommission, payingOnly, hasSpots, hideJoined, hidePosted, joinedOnly])

  // Map a SCOUT joined campaign (from Amazon's real active list) onto the card
  // shape. Fields Amazon doesn't return on the list stay null (rendered
  // conditionally). Marked as joined on Amazon, so the card shows "Accepted".
  const mapJoined = useCallback((mc: import('@/lib/extension-frame').MyCcCampaign): Campaign => ({
    campaignId: mc.campaignId,
    name: mc.name ?? null,
    brand: mc.brand ?? null,
    repAsin: mc.asin ?? null,
    asinCount: mc.asinCount ?? (mc.asin ? 1 : 0),
    image: mc.image ?? null,
    commissionPct: mc.commissionPct ?? null,
    perSale: null, priceNow: null, discountPct: null,
    rating: mc.rating ?? null, reviewCount: mc.reviewCount ?? null,
    monthlySold: null, videoCount: null,
    endsAt: null, daysLeft: null, spotsLeft: null, totalSlots: null, pctFilled: null,
    isFull: false, budgetRemaining: null,
    trust: { score: 0, tier: 'unknown', spendRatio: null, reasons: ['Joined on Amazon'] },
    score: 0,
    detailsUrl: `https://affiliate-program.amazon.com/p/connect/request?campaignId=${encodeURIComponent(mc.campaignId)}&type=affiliate-plus&status=active`,
  }), [])

  // LIVE joined view: ask SCOUT to query the creator's Amazon joined list (keyword
  // = the search box) and render those campaigns directly. No catalog filter, so
  // it mirrors Amazon exactly and works at any scale.
  const fetchJoinedLive = useCallback(async (pages: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const res = await requestMyCcCampaigns({ keyword: q.trim(), maxPages: pages })
      if (!res.ok) {
        const msg = res.error === 'not-installed'
          ? 'SCOUT isn’t detected. Install/enable it and open Amazon, then try again.'
          : res.error === 'timeout' ? 'Amazon took too long — try again.'
            : res.reason === 'no-creator-id' ? 'SCOUT couldn’t read your Creator Connections session. Open Amazon (logged in) and retry.'
              : (res.reason || res.error || 'Couldn’t read your joined campaigns.')
        toast.error(msg)
        if (!append) setCampaigns([])
        return
      }
      setLocked(false)
      const mapped = res.campaigns.map(mapJoined)
      setCampaigns(mapped)
      setTotal(res.total ?? mapped.length)
      setNextPage(null)
      setJoinedHasMore(!!res.hasMore)
      // These are all joined → mark accepted so the cards read "Accepted on Amazon".
      setStatusByAsin((prev) => {
        const n = { ...prev }
        for (const m of mapped) if (m.repAsin) n[m.repAsin] = { ...(n[m.repAsin] || {}), accepted: true }
        return n
      })
    } finally { setLoadingMore(false); setLoading(false) }
  }, [q, mapJoined])

  // "Verify my CC access" — SCOUT opens the user's own Creator Connections grid;
  // real campaigns back = proven invite, which we stamp server-side to unlock.
  const verifyCcAccess = useCallback(async () => {
    if (verifying) return
    setVerifying(true); setVerifyMsg('SCOUT is opening your Creator Connections grid to confirm your access — this can take a minute…')
    try {
      const res = await requestCcSmartScan(campaignRules('wide'))
      if (!res.ok) {
        setVerifyMsg(res.error === 'not-installed'
          ? 'SCOUT isn’t connected — install it and paste your token, then try again.'
          : res.error === 'timeout'
            ? 'That ran long and timed out — try again in a moment.'
            : 'We couldn’t confirm a Creator Connections grid for your account. Open your Creator Connections tab once, then try again.')
        return
      }
      if (!(res.matches && res.matches.length > 0)) {
        setVerifyMsg('Your grid opened but had no live campaigns to confirm against right now. Try again when opportunities are showing.')
        return
      }
      const stamp = await fetch('/api/campaigns/cc-verify', { method: 'POST' }).then(r => r.json()).catch(() => null)
      if (stamp?.verified) { setLocked(false); setVerifyMsg(null); toast.success('Creator Connections access confirmed.'); fetchPage(1, false) }
      else setVerifyMsg('Verified your grid, but couldn’t save it just now. Please try again.')
    } catch {
      setVerifyMsg('Verification failed unexpectedly — reload and try again.')
    } finally { setVerifying(false) }
  }, [verifying, fetchPage])

  // Browse mode: debounced reload when any catalog filter changes.
  useEffect(() => {
    if (joinedOnly) return
    const t = setTimeout(() => void fetchPage(1, false), 250)
    return () => clearTimeout(t)
  }, [joinedOnly, fetchPage])

  // Joined-only is a LIVE SCOUT search — each run opens an Amazon tab, so it must
  // ONLY re-run on the keyword (fetchJoinedLive depends on q) and the toggle. The
  // commission / paying / spots filters don't apply to it and must NOT re-trigger
  // it (that was firing a needless, sometimes-empty search). Longer debounce.
  useEffect(() => {
    if (!joinedOnly) return
    const t = setTimeout(() => { setJoinedPages(12); void fetchJoinedLive(12, false) }, 700)
    return () => clearTimeout(t)
  }, [joinedOnly, fetchJoinedLive])

  // Your accepted/messaged/posted status, loaded once (refreshed after actions).
  useEffect(() => { loadStatus() }, [loadStatus])

  // Pull EVERY campaign the creator has joined straight from Amazon (via SCOUT)
  // and record them, so "Joined only" shows all of them — including ones joined
  // directly on Amazon, not just accepted through MVP.
  const syncJoined = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    setSyncingJoined(true)
    const tId = 'cc-sync-joined'
    if (!silent) toast.loading('Reading your accepted campaigns from Amazon…', { id: tId, duration: Infinity })
    try {
      const res = await requestMyCcCampaigns()
      if (!res.ok) {
        // Auto-sync stays silent on failure (no SCOUT, not logged in, etc.) —
        // it's a background nicety, not something the user asked for right now.
        if (silent) return
        const msg = res.error === 'not-installed'
          ? 'SCOUT extension not detected. Install/enable it and open Amazon, then try again.'
          : res.reason === 'no-creator-id'
            ? 'SCOUT needs to see your Creator Connections page once first — open it, then try again.'
            : res.error === 'timeout' ? 'Amazon took too long. Try again.' : (res.reason || res.error || 'Couldn’t read your campaigns.')
        toast.error(msg, { id: tId, duration: 8_000 })
        return
      }
      // Mark a successful reach so the auto-sync throttle can back off.
      try { localStorage.setItem('cc-joined-autosync', String(Date.now())) } catch { /* no-op */ }
      if (!res.campaigns.length) {
        // Surface the SCOUT diagnostic so an unexpected empty result is debuggable
        // (which filter variants Amazon answered, HTTP status + ad counts) instead
        // of a silent zero. Full object also goes to the console.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const diag = (res as any).diag
        if (diag) { try { console.log('[SCOUT] joined-sync diagnostic:', diag) } catch { /* no-op */ } }
        if (!silent) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (diag?.variants || []) as any[]
          const line = v.length ? v.map((x) => `${x.label}: ${x.status ?? '-'}/${x.ads ?? 0}${x.err ? ` (${x.err})` : ''}`).join(' · ') : ''
          toast.success(
            diag
              ? `No accepted campaigns returned. SCOUT reached Amazon (id ${diag.creatorId || '?'}). Variants — ${line || 'none tried'}. Open the console for the full diagnostic and send it to support.`
              : 'No accepted campaigns found on Amazon yet.',
            { id: tId, duration: 12_000 },
          )
        }
        return
      }
      const r = await fetch('/api/campaigns/sync-joined', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // reconcile OFF: this sync only fetches a WINDOW of large accounts (the live
        // "Joined only" view is the complete picture now). Additive-only marking, so
        // a partial fetch never wrongly clears joined markers used by Hide joined.
        body: JSON.stringify({ campaigns: res.campaigns, reconcile: false }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) { if (!silent) toast.error(j?.error || 'Sync failed.', { id: tId, duration: 8_000 }); return }
      // Always log the SCOUT diagnostic (Amazon's reported total, pages fetched)
      // so a short count is inspectable even on a "successful" sync.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diag = (res as any).diag
      if (diag) { try { console.log('[SCOUT] joined-sync diagnostic:', diag) } catch { /* no-op */ } }
      if (!silent) {
        const n = j.synced ?? res.campaigns.length
        const total = typeof diag?.total === 'number' ? diag.total : null
        const short = total != null && n < total
        toast.success(
          short
            ? `Synced ${n} of ${total} joined campaigns. If that's short, sync again — Amazon paginates large lists.`
            : `Synced ${n} joined campaign${n === 1 ? '' : 's'} from Amazon.`,
          { id: tId, duration: short ? 9_000 : 6_000 },
        )
      }
      await loadStatus()
      void fetchPage(1, false)
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : 'Sync failed', { id: tId, duration: 8_000 })
    } finally { setSyncingJoined(false) }
  }, [loadStatus, fetchPage])

  // (Auto-sync-on-load removed: "Joined only" is now a live SCOUT view, so there's
  // nothing to pre-warm, and on large accounts a background sync would pull a big
  // slice on every visit. The manual "Sync joined from Amazon" button remains for
  // populating Hide-joined markers on Browse all.)

  return (
    <>
      <PageHero
        title="CC Campaigns"
        subtitle="Every live Creator Connections campaign with the numbers that matter — commission, $ per sale, spots left, whether the brand actually pays out — and one click to turn it into a blog post."
      />

      {locked ? (
        <div className="card p-8 max-w-lg flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
            <Lock size={22} className="text-[#7C3AED]" />
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--text)] mb-1">Creator Connections access required</p>
            <p className="text-xs text-[var(--text-3)] max-w-md leading-relaxed">
              These campaigns are only shown to creators who actually have the Amazon Creator Connections invite. SCOUT will open your own Creator Connections grid and confirm it — most creators don&apos;t have the invite yet, and if you don&apos;t, this stays locked. No campaign data is shown until it&apos;s confirmed.
            </p>
          </div>
          <button onClick={verifyCcAccess} disabled={verifying} className="btn-primary flex items-center gap-2 text-sm">
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {verifying ? 'Verifying…' : 'Verify my CC access'}
          </button>
          {verifyMsg && <p className="text-xs text-[var(--text-3)] max-w-md">{verifyMsg}</p>}
          <p className="text-[11px] text-[var(--text-3)]">
            No Creator Connections invite? Use <a href="/amz-finder" className="text-[#7C3AED] hover:underline">AMZ Research</a> or <a href="/deal-radar" className="text-[#7C3AED] hover:underline">Deal Radar</a> instead.
          </p>
        </div>
      ) : (<>

      {/* Browse (intelligence catalog) vs Smart-Scan (live SCOUT sweep). */}
      <div className="flex rounded-lg border border-[var(--border-2)] overflow-hidden w-fit mb-5">
        {([['browse', 'Browse all', Grid3x3], ['scan', 'Smart-Scan (live)', Radar], ['epc', 'EPC library', TrendingUp]] as const).map(([m, label, Ic]) => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-2 text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${mode === m ? 'bg-[#7C3AED] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}>
            <Ic size={13} /> {label}
          </button>
        ))}
      </div>

      {mode === 'scan' ? (
        <SmartScanPanel coveredAsins={coveredAsins} onMessageBrand={setMsgModal} onSavedChange={loadStatus} />
      ) : mode === 'epc' ? (
        <EpcLibraryPanel tier={tier} />
      ) : (<>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand or product…" className="input-field w-full pl-9 text-sm" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-field text-sm w-auto">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={minCommission} onChange={(e) => setMinCommission(Number(e.target.value))} className="input-field text-sm w-auto">
          <option value={0}>Any commission</option>
          <option value={5}>5%+</option>
          <option value={10}>10%+</option>
          <option value={15}>15%+</option>
          <option value={20}>20%+</option>
        </select>
        <button onClick={() => setPayingOnly((v) => !v)} disabled={joinedOnly} title={joinedOnly ? 'Payout history isn’t returned for your joined campaigns, so this filter only applies to Browse all.' : undefined} className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${payingOnly && !joinedOnly ? 'border-[#34c759] text-[#1c7a35] bg-[#34c759]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Paying brands only
        </button>
        <button onClick={() => setHasSpots((v) => !v)} disabled={joinedOnly} title={joinedOnly ? 'Spots-left isn’t returned for your joined campaigns, so this filter only applies to Browse all.' : undefined} className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${hasSpots && !joinedOnly ? 'border-[#7C3AED] text-[#7C3AED] bg-[#7C3AED]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Has open spots
        </button>
        <button onClick={() => setJoinedOnly((v) => { const nv = !v; if (nv) { setHideJoined(false); setHidePosted(false) } return nv })} title="Live view of the campaigns you've joined on Amazon (via SCOUT). Type in the search box to find any of them by brand, product, or ASIN." className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${joinedOnly ? 'border-[#0a84ff] text-[#0a84ff] bg-[#0a84ff]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Joined only
        </button>
        <button onClick={() => setHideJoined((v) => { const nv = !v; if (nv) setJoinedOnly(false); return nv })} title="Hide campaigns you've already accepted" className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${hideJoined ? 'border-[#ff9500] text-[#ff9500] bg-[#ff9500]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Hide joined
        </button>
        <button onClick={() => setHidePosted((v) => { const nv = !v; if (nv) setJoinedOnly(false); return nv })} title="Hide campaigns you've already made a post for" className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${hidePosted ? 'border-[#ff9500] text-[#ff9500] bg-[#ff9500]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
          Hide posted
        </button>
        {!joinedOnly && (
          <button onClick={() => syncJoined()} disabled={syncingJoined} title="Save the campaigns you've joined on Amazon (via SCOUT) so Hide joined works across Browse all" className="px-3 py-2 rounded-lg border border-[var(--border-2)] text-xs font-medium text-[var(--text-3)] hover:text-[var(--text)] inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors">
            {syncingJoined ? <Loader2 size={13} className="animate-spin" /> : <Handshake size={13} />}
            {syncingJoined ? 'Syncing…' : 'Sync joined from Amazon'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)] py-10"><Loader2 size={16} className="animate-spin" /> Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--text-3)]">
          {joinedOnly
            ? (q.trim()
                ? `None of your joined Amazon campaigns match “${q.trim()}”. Try a different keyword, or clear the search.`
                : 'No joined campaigns came back from Amazon. Make sure SCOUT is installed and you’re logged into Amazon, then try again.')
            : 'No live campaigns match these filters. Try clearing filters, or check back after the next catalog import.'}
        </div>
      ) : (() => {
        // Hide-joined / hide-posted are client-side over the loaded pages, using
        // this user's per-ASIN status. Applied here so the count + empty state
        // reflect what's actually shown. In the LIVE joined view we also apply the
        // commission filter client-side (its cards carry commissionPct) — the SCOUT
        // search deliberately doesn't re-run on filter changes, so the numeric
        // filter is honored here instead, instantly and without another Amazon tab.
        const visible = campaigns.filter((c) => {
          if (joinedOnly && minCommission && (c.commissionPct == null || c.commissionPct < minCommission)) return false
          if (!hideJoined && !hidePosted) return true
          const st = c.repAsin ? statusByAsin[c.repAsin] : undefined
          if (hideJoined && st?.accepted) return false
          if (hidePosted && st?.posted) return false
          return true
        })
        const hiddenCount = campaigns.length - visible.length
        if (visible.length === 0) {
          return (
            <div className="card p-8 text-center text-sm text-[var(--text-3)]">
              {joinedOnly && minCommission
                ? `None of the loaded joined campaigns are at ${minCommission}%+ commission. Lower the commission filter, or Load more.`
                : 'Every loaded campaign is hidden by your “Hide joined / Hide posted” filters. Turn one off, or Load more.'}
            </div>
          )
        }
        return (
        <>
          <p className="text-xs text-[var(--text-3)] mb-3">
            {joinedOnly
              ? <>{total.toLocaleString()} joined campaign{total === 1 ? '' : 's'}{joinedHasMore && <span> · showing first {visible.length.toLocaleString()} — narrow your keyword or Load more</span>}</>
              : <>{total.toLocaleString()} live campaign{total === 1 ? '' : 's'}</>}
            {hiddenCount > 0 && <span> · {hiddenCount.toLocaleString()} hidden</span>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((c) => (
              <CampaignCard key={c.campaignId} c={c}
                status={c.repAsin ? statusByAsin[c.repAsin] : undefined}
                onActed={loadStatus}
                saved={c.repAsin ? savedAsins.has(c.repAsin.toUpperCase()) : false}
                onToggleSave={() => toggleSave(c)}
                socialOnly={tier === 'amazon'}
                onMessage={(cc) => {
                  if (!cc.repAsin) { toast.error('No product ASIN on this campaign yet.'); return }
                  setMsgModal({ product: cc.name || cc.repAsin, asin: cc.repAsin, commissionPct: cc.commissionPct ?? 0, detailsUrl: cc.detailsUrl, brandLabel: cc.brand || undefined })
                }} />
            ))}
          </div>
          {joinedOnly ? (joinedHasMore && (
            <div className="flex justify-center mt-6">
              <button onClick={() => { const p = joinedPages + 12; setJoinedPages(p); void fetchJoinedLive(p, true) }} disabled={loadingMore} className="btn-secondary flex items-center gap-2">
                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null} Load more
              </button>
            </div>
          )) : (nextPage && (
            <div className="flex justify-center mt-6">
              <button onClick={() => fetchPage(nextPage, true)} disabled={loadingMore} className="btn-secondary flex items-center gap-2">
                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null} Load more
              </button>
            </div>
          ))}
        </>
        )
      })()}
      </>)}
      </>)}

      {msgModal && (
        <MessageBrandModal
          campaign={msgModal}
          onClose={() => setMsgModal(null)}
          onSent={() => { setMsgModal(null); loadStatus() }}
          onFindCampaign={() => requestFindCampaign(msgModal.brandLabel || msgModal.product || '', msgModal.asin || '')}
        />
      )}
    </>
  )
}
