'use client'

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createBrowserClient } from '@/lib/supabase/client'
import PageHero from '@/components/layout/PageHero'
import { useConfirm } from '@/components/ui/useConfirm'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { CapBannerHost, dispatchCapReached } from '@/components/CapReachedBanner'
import { SOCIAL_CAP } from '@/lib/social-cap'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import type { SchedulableSocial } from '@/lib/schedule-types'
import { SocialPill } from '@/components/content/SocialPill'
import { OrphanPostShare } from '@/components/content/OrphanPostShare'
import { ManualEdit } from '@/components/content/ManualEdit'
import { RewriteFeedbackModal } from '@/components/content/RewriteFeedbackModal'
import { errText } from '@/lib/err-text'
import { generateBlogRequest } from '@/lib/blog-generate-client'
import { GenerateButton } from '@/components/content/GenerateButton'
import { InstagramPublishModal } from '@/components/content/InstagramPublishModal'
import { renderThumbnailOverlay, pickWeightedStyleIndex } from '@/lib/thumbnail-overlay'
import { effectiveTier } from '@/lib/view-as'
import { metaEnabled } from '@/lib/feature-flags'
import {
  Youtube, Wand2, ExternalLink, CheckCircle, AlertCircle,
  RefreshCw, Loader2, ChevronRight, Sparkles, X, Facebook, Pin, MessageCircle, Save, Upload, Search, Calendar,
} from 'lucide-react'
import type { PinPreviewData } from '@/components/PinterestPreviewModal'

// COST CONTROL (2026-06-12): master switch for every multi-video bulk
// GENERATION action (bulk generate, bulk schedule, bulk rewrite). Off by
// default — an unattended bulk run was the single biggest Anthropic cost
// (the overnight-$60 spike). Bulk DELETE and bulk CATEGORY stay on (no AI
// cost). Set to true to bring the bulk generation buttons back.
const BULK_GENERATION_ENABLED = false

// Audit perf fix 2026-06-06: lazy-load the vertical-direct modals just
// like the other rarely-opened modals. They include ShortVideoUpload
// (tus client, file upload) and bring ~30-50KB into the initial bundle
// for every Library user even when no one clicks a vertical row.
const TikTokDirectModal = dynamic(
  () => import('@/components/TikTokDirectModal').then(m => ({ default: m.TikTokDirectModal })),
  { ssr: false },
)
// From-link generator — create a post from a product link/ASIN, no video.
const FromLinkModal = dynamic(
  () => import('@/components/content/FromLinkModal').then(m => ({ default: m.FromLinkModal })),
  { ssr: false },
)
const InstagramDirectModal = dynamic(
  () => import('@/components/InstagramDirectModal').then(m => ({ default: m.InstagramDirectModal })),
  { ssr: false },
)
// Interaction-gated modals are code-split (next/dynamic, client-only) so they
// stay out of the heavy content-page initial bundle and only load when opened.
const PinterestPreviewModal = dynamic(
  () => import('@/components/PinterestPreviewModal').then(m => ({ default: m.PinterestPreviewModal })),
  { ssr: false },
)
const SocialPreviewModal = dynamic(
  () => import('@/components/content/SocialPreviewModal').then(m => ({ default: m.SocialPreviewModal })),
  { ssr: false },
)
const BulkScheduleModal = dynamic(
  () => import('@/components/content/BulkScheduleModal').then(m => ({ default: m.BulkScheduleModal })),
  { ssr: false },
)
// Bulk-schedule the GENERATION + cascade for N ungenerated videos — the
// content-calendar use case. Different from BulkScheduleModal (which
// queues social pushes for already-live posts).
const BulkScheduleVideosModal = dynamic(
  () => import('@/components/content/BulkScheduleVideosModal'),
  { ssr: false },
)
// ScheduleModal — single-row schedule (blog publish + social cascade).
// Lazy-loaded for the same reason as the other modals: keep the heavy
// content page initial JS lean.
const ScheduleModal = dynamic(
  () => import('@/components/content/ScheduleModal'),
  { ssr: false },
)

// Shape returned by /api/blog/scheduled-list — flat enough that we don't
// need a separate type module.
//
// `kind` differentiates 'social' rows (a queued push to a specific
// platform) from 'blog_publish' rows (a queued draft-flip on the
// underlying WP post — only present in draft-flip schedule mode).
// `platform` is REQUIRED for kind='social' and null for 'blog_publish'.
// `parent_id` links a social child to its parent blog_publish row so
// the UI can group cascades visually + cascade-cancel.
interface ScheduledItem {
  id: string
  blog_post_id: string
  kind: 'social' | 'blog_publish'
  parent_id: string | null
  platform: 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram' | null
  scheduled_at: string
  body_text: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  attempts: number
  error_message: string | null
  external_id: string | null
  created_at: string
  blog_posts?: { title: string | null; wordpress_url: string | null } | null
}

// ── Readiness gate ────────────────────────────────────────────────────────────
interface ReadinessCheck {
  brandReady: boolean
  wpReady: boolean
  videosReady: boolean
}

/**
 * Small paginator used by the Posts tab to chunk the Recent + Older
 * lists into 20-card pages. Renders Prev / Next + a compact page-number
 * strip that elides the middle when there are many pages — "1 · 2 3 4 5
 * · 12" — so the bar stays one row even on small libraries that have
 * grown past ~10 pages.
 *
 * Pure UI — no data fetching. The parent owns page state.
 * 2026-06-07.
 */
function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  // Build the list of page numbers to actually render. Always show
  // first + last; show 2 neighbors around the current page; insert
  // "…" gaps where we skip.
  const visible: Array<number | 'gap'> = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      visible.push(i)
    } else if (visible[visible.length - 1] !== 'gap') {
      visible.push('gap')
    }
  }
  const btn = 'min-w-[28px] h-7 px-2 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center justify-center gap-1 py-2 mt-1 select-none">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className={`${btn} border border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40 hover:text-[#7C3AED] text-[#1d1d1f] dark:text-[#f5f5f7]`}
      >
        ← Prev
      </button>
      {visible.map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-[#86868b]">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`${btn} ${p === page
              ? 'bg-[#7C3AED] text-white border border-[#7C3AED]'
              : 'border border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40 hover:text-[#7C3AED] text-[#1d1d1f] dark:text-[#f5f5f7]'
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className={`${btn} border border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40 hover:text-[#7C3AED] text-[#1d1d1f] dark:text-[#f5f5f7]`}
      >
        Next →
      </button>
    </div>
  )
}

function SetupGate({ checks }: { checks: ReadinessCheck }) {
  return (
    <div className="max-w-lg">
      <div className="card p-7">
        <div className="w-12 h-12 rounded-full bg-[#ff9500]/10 flex items-center justify-center mb-4">
          <AlertCircle size={22} className="text-[#ff9500]" />
        </div>
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Finish setup to generate posts</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">Complete these steps before your first blog post.</p>
        <div className="flex flex-col gap-3">
          <GateItem done={checks.brandReady} label="Brand profile" desc="Set your brand name, niche, tone, and writing sample" href="/brand" />
          <GateItem done={checks.wpReady} label="WordPress connected" desc="Connect your WordPress site in Setup" href="/setup" />
          <GateItem done={checks.videosReady} label="YouTube videos synced" desc="Videos will sync automatically once your channel is linked" href="/setup" />
        </div>
      </div>
    </div>
  )
}

function GateItem({ done, label, desc, href }: { done: boolean; label: string; desc: string; href: string }) {
  return (
    <a href={done ? '#' : href} className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${done ? 'bg-[#34c759]/5 border-[#34c759]/20 cursor-default' : 'bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-[#34c759]' : 'bg-gray-100'}`}>
        {done ? <CheckCircle size={15} className="text-white" /> : <ChevronRight size={13} className="text-[#86868b] dark:text-[#8e8e93]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-[#34c759]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>{label}</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">{desc}</p>
      </div>
    </a>
  )
}

// Master list of available categories — mirrors the NICHES constant on the
// Brand page. Kept in sync manually; if you add one there, add it here.
// User's brand-niche subset is visually emphasized in the dropdown.
const ALL_CATEGORIES = [
  'Home & Kitchen', 'Electronics & Tech', 'Outdoor & Sports', 'Beauty & Personal Care',
  'Health & Wellness', 'Pet Supplies', 'Tools & Home Improvement', 'Toys & Games',
  'Books & Education', 'Fashion & Apparel', 'Garden & Outdoors', 'Automotive',
  'Baby & Kids', 'Office & Productivity', 'Food & Grocery', 'Travel & Luggage',
  'Arts & Crafts', 'Musical Instruments', 'Software & Apps', 'Finance & Investing',
] as const

// errText moved to lib/err-text.ts (2026-06-07).

/**
 * The link to open when the user clicks "Visit Link or Product".
 *
 * Reads the video's metadata and returns the FIRST real affiliate /
 * product link the creator is talking about, in priority order:
 *   1. First Geniuslink (geni.us) in the description — the creator's own.
 *   2. First Amazon short link (amzn.to) in the description.
 *   3. First full Amazon product URL (/dp/ or /gp/product/) in the
 *      description.
 *   4. The product_url the generate route already resolved + persisted.
 *   5. A bare Amazon /dp link derived from an ASIN in the title/desc
 *      (B0-prefixed to avoid matching random 10-char words).
 * Returns null when nothing product-like is found (general videos).
 */
function deriveProductUrl(video: Record<string, unknown>): string | null {
  const desc = (video.description as string) || ''
  const title = (video.title as string) || ''
  // Trim trailing punctuation/brackets the regex may grab off a URL.
  const clean = (u: string) => u.replace(/[.,;:)\]>"']+$/, '')

  const patterns = [
    /https?:\/\/(?:www\.)?geni\.us\/[^\s)>\]"']+/i,
    /https?:\/\/(?:www\.)?amzn\.to\/[^\s)>\]"']+/i,
    /https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:dp|gp\/product)\/[A-Z0-9]{10}[^\s)>\]"']*/i,
  ]
  for (const re of patterns) {
    const m = desc.match(re)
    if (m) return clean(m[0])
  }

  const stored = (video.product_url as string | null)?.trim()
  if (stored) return stored

  const asin =
    desc.toUpperCase().match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/)?.[1] ||
    title.toUpperCase().match(/\b(B0[A-Z0-9]{8})\b/)?.[1] ||
    desc.toUpperCase().match(/\b(B0[A-Z0-9]{8})\b/)?.[1] ||
    null
  return asin ? `https://www.amazon.com/dp/${asin}` : null
}

/**
 * Optional per-video product reference photo. When set, the blog in-body
 * image generator (and IG image, later) uses it as the Kontext reference
 * so the rendered product matches the real thing — more reliable than
 * scraping Amazon. Uploads to the product-images bucket (migration 051)
 * at {user_id}/{videoId}.{ext} and persists the URL on youtube_videos.
 */
function ProductPhotoUpload({ videoId, initialUrl }: { videoId: string; initialUrl: string | null }) {
  const supabase = createBrowserClient()
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { setErr('Pick an image file'); return }
    if (file.size > 10 * 1024 * 1024) { setErr('Max 10 MB'); return }
    setBusy(true); setErr(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/${videoId}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('product-images').upload(path, file, {
        cacheControl: '3600', upsert: true, contentType: file.type || 'image/jpeg',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
      // Cache-bust so a replaced photo (same path) refreshes in the UI.
      const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updErr } = await supabase.from('youtube_videos').update({ product_image_url: publicUrl }).eq('id', videoId)
      if (updErr) throw new Error(updErr.message || 'Save failed')
      setUrl(publicUrl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true); setErr(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('youtube_videos').update({ product_image_url: null }).eq('id', videoId)
      setUrl(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Product reference" className="w-7 h-7 rounded object-cover border border-gray-200 dark:border-white/10" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            title="Replace the product photo MVP uses to render the exact product"
            className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg text-white whitespace-nowrap bg-[#FF2D78] hover:bg-[#ff4790] hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Replace photo
          </button>
          <Button variant="ghost" size="sm" onClick={remove} disabled={busy} className="text-[11px] text-[#86868b] hover:text-[#ff3b30] hover:bg-transparent">
            Remove
          </Button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title="Upload a clean product photo so MVP builds an exact representation of the product"
          className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg text-white whitespace-nowrap bg-[#FF2D78] hover:bg-[#ff4790] hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Upload product photo
        </button>
      )}
      {err && <span className="text-[10px] text-[#ff3b30]">{err}</span>}
    </div>
  )
}

/**
 * Per-video category dropdown shown next to "Generate post".
 *
 * Before publish: writes to youtube_videos.selected_category so the next
 * generate honors it (overrides the AI's category pick).
 * After publish: same write, plus pushes the new category to WordPress on
 * the existing post via /api/blog/update-category.
 *
 * Saving is debounced/auto on change — no separate save button. We surface
 * a tiny inline status (✓ Saved / Error) for trust.
 */
function CategoryPicker({
  videoId,
  initial,
  brandNiches,
  customCategories,
  onCustomCategoryAdded,
  hasPublishedPost,
}: {
  videoId: string
  initial: string | null
  brandNiches: string[]
  customCategories: string[]
  onCustomCategoryAdded: (next: string[]) => void
  hasPublishedPost: boolean
}) {
  const [value, setValue] = useState<string>(initial ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const ADD_NEW = '__add_new__'

  // Brand-niche set lookups for fast highlighting
  const brandNicheSet = new Set(brandNiches.map(n => n.toLowerCase()))
  const customSet = new Set(customCategories.map(c => c.toLowerCase()))

  // Group options: brand niches → custom categories → remaining master niches
  const userNiches = ALL_CATEGORIES.filter(c => brandNicheSet.has(c.toLowerCase()))
  const otherNiches = ALL_CATEGORIES.filter(c => !brandNicheSet.has(c.toLowerCase()) && !customSet.has(c.toLowerCase()))

  async function save(next: string) {
    setValue(next)
    setStatus('saving')
    setErrorMsg(null)
    try {
      const res = await fetch('/api/blog/update-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, category: next || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
      if (data.warning) setErrorMsg(data.warning) // partial success (WP push failed)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  /** Prompt the user for a new category name → save to brand_profiles → assign. */
  async function addCustomCategory() {
    const name = window.prompt('Add a new category (e.g. "Smart Home Locks"):')?.trim()
    if (!name) return
    setStatus('saving')
    setErrorMsg(null)
    try {
      const res = await fetch('/api/brand/add-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add category')
      onCustomCategoryAdded((data.customCategories as string[]) ?? customCategories)
      // Auto-select the newly added (or existing) category for this video
      await save(name)
      if (data.warning) setErrorMsg(data.warning)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add category')
    }
  }

  function handleChange(next: string) {
    if (next === ADD_NEW) {
      // Reset the visible select to current value, then trigger the prompt
      addCustomCategory()
      return
    }
    save(next)
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={e => handleChange(e.target.value)}
        className="text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 dark:hover:border-white/20 focus:border-[#7C3AED] focus:outline-none max-w-[180px]"
        title={hasPublishedPost ? 'Change the category on this published post' : 'Pick a category before generating'}
      >
        <option value="">— Category —</option>
        {userNiches.length > 0 && (
          <optgroup label="Your brand niches">
            {userNiches.map(c => <option key={c} value={c}>{c}</option>)}
          </optgroup>
        )}
        {customCategories.length > 0 && (
          <optgroup label="Your custom categories">
            {customCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </optgroup>
        )}
        {otherNiches.length > 0 && (
          <optgroup label="Other categories">
            {otherNiches.map(c => <option key={c} value={c}>{c}</option>)}
          </optgroup>
        )}
        <option value={ADD_NEW}>+ Add new category…</option>
      </select>
      {status === 'saving' && <Loader2 size={11} className="animate-spin text-[#86868b]" />}
      {status === 'saved' && !errorMsg && <CheckCircle size={11} className="text-[#34c759]" />}
      {status === 'error' && errorMsg && (
        <span className="text-[10px] text-[#ff3b30] max-w-[160px] truncate" title={errorMsg}>
          ⚠ {errorMsg}
        </span>
      )}
      {errorMsg && status !== 'error' && (
        <span className="text-[10px] text-[#ff9500] max-w-[160px] truncate" title={errorMsg}>
          ⚠
        </span>
      )}
    </div>
  )
}

// ── GenerateButton + GenStatus + GEN_STEPS moved to components/content/GenerateButton.tsx (2026-06-07).

// ── Manual word editor ────────────────────────────────────────────────────────
// Expands an inline editor with the published article's text. Structure
// (headings, links — incl. affiliate links) is preserved; the user edits
// the wording. Save persists to blog_posts.content AND the live WP post.
// ── ManualEdit moved to components/content/ManualEdit.tsx (2026-06-07).

// ── InstagramPublishModal + InstagramPublishModalShell moved to components/content/InstagramPublishModal.tsx (2026-06-07).

// ── Video card ────────────────────────────────────────────────────────────────
// React.memo wraps the impl so a parent re-render (toast, modal open,
// search keystroke, a sibling row's loading state) doesn't bubble down
// to every card. A card now only re-renders when ITS OWN props change.
// Big snappiness win on the 20-card paginated Posts tab. 2026-06-07.
const VideoCard = memo(function VideoCardImpl({
  video, post, wpSiteUrl, fbConnected, pinterestConnected, threadsConnected, linkedInConnected, twitterConnected, blueskyConnected, telegramConnected, instagramConnected, tiktokConnected, fbAccounts, igAccounts, userTier, brandNiches, customCategories, brandDisclaimer, brandFacebookGroups, failedSchedulePlatforms, onCustomCategoryAdded,
  onGenerated, onDismiss, onDelete, onPinPreview,
}: {
  video: Record<string, unknown>
  post?: { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; scheduledFor?: string | null; scheduleMode?: string | null; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string; instagramReelId?: string; instagramStoryId?: string } | null
  /** Platforms whose MOST RECENT scheduled push for this post FAILED.
   *  Drives the ⚠ on the social pill so the user can spot broken
   *  cascades at a glance. Populated by the parent Library load(). */
  failedSchedulePlatforms?: ReadonlySet<string>
  wpSiteUrl: string
  fbConnected: boolean
  pinterestConnected: boolean
  threadsConnected: boolean
  linkedInConnected: boolean
  twitterConnected: boolean
  blueskyConnected: boolean
  telegramConnected: boolean
  instagramConnected: boolean
  tiktokConnected: boolean
  fbAccounts: Array<{ id: string; externalId: string; displayName: string | null; isDefault: boolean }>
  igAccounts: Array<{ id: string; externalId: string; displayName: string | null; isDefault: boolean }>
  userTier: Tier
  brandNiches: string[]
  customCategories: string[]
  brandDisclaimer: string
  brandFacebookGroups: Array<{ name: string; url: string }>
  onCustomCategoryAdded: (next: string[]) => void
  onGenerated: (videoId: string, url: string, title: string, postId: string) => void
  onDismiss: () => void
  onDelete: (postId: string) => void
  onPinPreview: (data: PinPreviewData) => void
}) {
  const publishAllUnlocked = userTier === 'pro' || userTier === 'admin'
  const thumb = video.thumbnail_url as string
  const title = video.title as string
  const views = video.view_count as number | null
  const publishedAt = video.published_at as string
  const id = video.id as string

  const [deleting, setDeleting] = useState(false)
  const [fbPosting, setFbPosting] = useState(false)
  const [fbPosted, setFbPosted] = useState(!!post?.facebookPostId)
  // Schedule modal — only relevant for un-generated rows (post == null);
  // once a row has a live post, the user uses WP's own "Edit schedule"
  // workflow instead. Open via the Schedule button next to Publish to all.
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // Connected social channels for the cascade list. Only the channels
  // the cron worker can publish to are included (no IG/Pinterest/TikTok
  // — they use their own direct-publish routes).
  const connectedChannels = useMemo<ReadonlySet<SchedulableSocial>>(() => {
    const s = new Set<SchedulableSocial>()
    if (fbConnected) s.add('facebook')
    if (threadsConnected) s.add('threads')
    if (twitterConnected) s.add('twitter')
    if (linkedInConnected) s.add('linkedin')
    if (blueskyConnected) s.add('bluesky')
    if (telegramConnected) s.add('telegram')
    return s
  }, [fbConnected, threadsConnected, twitterConnected, linkedInConnected, blueskyConnected, telegramConnected])

  // ── Schedule pill state ────────────────────────────────────────────────
  // A post is "still scheduled" when scheduled_for exists AND is in the
  // future. Once the time passes, treat it as a normal published post
  // (WP would have flipped it; if it didn't, the user will notice from
  // Visit post). Computed once per render — no live-tick is needed since
  // a stale "Scheduled" pill on a 5-second-overdue post is harmless.
  const scheduledForDate = post?.scheduledFor ? new Date(post.scheduledFor) : null
  const isScheduledPending = !!(scheduledForDate && !isNaN(scheduledForDate.getTime()) && scheduledForDate.getTime() > Date.now())
  const scheduledLabel = isScheduledPending && scheduledForDate
    ? scheduledForDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  // Per-post Facebook Page choice (Pro multi-account). Defaults to the
  // user's default page. The picker renders whenever the user has at least
  // one connected Page (Pro loads the list) so it's discoverable/testable —
  // even with a single page (you can confirm which Page you're posting to).
  const [selectedFbAccountId, setSelectedFbAccountId] = useState<string | null>(null)
  const effectiveFbAccountId = selectedFbAccountId
    ?? fbAccounts.find(a => a.isDefault)?.id
    ?? fbAccounts[0]?.id
    ?? null
  const showFbAccountPicker = fbAccounts.length >= 1
  // Remember the user's last Page choice across reloads (persisted globally,
  // applied once the account list arrives and only if the id is still valid).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mvp_fb_account_choice')
      if (saved && fbAccounts.some(a => a.id === saved)) setSelectedFbAccountId(saved)
    } catch { /* ignore */ }
  }, [fbAccounts])
  const { confirm, ConfirmHost } = useConfirm()
  const [pinLoading, setPinLoading] = useState(false)
  const [pinPosted, setPinPosted] = useState(!!post?.pinterestPinId)
  const [thPosting, setThPosting] = useState(false)
  const [thPosted, setThPosted] = useState(!!post?.threadsPostId)
  const [liPosting, setLiPosting] = useState(false)
  const [liPosted, setLiPosted] = useState(!!post?.linkedInPostId)
  const [twPosting, setTwPosting] = useState(false)
  const [twPosted, setTwPosted] = useState(!!post?.twitterPostId)
  const [bsPosting, setBsPosting] = useState(false)
  const [bsPosted, setBsPosted] = useState(!!post?.blueskyPostUri)
  const [tgPosting, setTgPosting] = useState(false)
  const [tgPosted, setTgPosted] = useState(!!post?.telegramMessageId)
  const [igModalOpen, setIgModalOpen] = useState(false)
  const [igPosting, setIgPosting] = useState(false)
  const [igReelPosted, setIgReelPosted] = useState(!!post?.instagramReelId)
  const [igStoryPosted, setIgStoryPosted] = useState(!!post?.instagramStoryId)
  // TikTok direct (vertical-row) modal state. Open it on TT-pill click;
  // ttDirectPosted flips when the publish status webhook fires.
  const [ttModalOpen, setTtModalOpen] = useState(false)
  const [ttDirectPosted, setTtDirectPosted] = useState(
    !!(video.tiktok_publish_status === 'published'),
  )
  // IG direct (vertical-row) modal state. Mirrors TikTok — opens its own
  // modal, NOT the existing post-based InstagramPublishModal. The two
  // surfaces serve different jobs (vertical direct vs horizontal post).
  const [igDirectModalOpen, setIgDirectModalOpen] = useState(false)
  const [igDirectPosted, setIgDirectPosted] = useState(
    !!(video.instagram_reel_id || video.instagram_story_id),
  )
  const [igStorySticker, setIgStorySticker] = useState<string | null>(null) // shown after Story publish

  /** Which social preview modal is open (null = none). Only one at a time. */
  const [previewPlatform, setPreviewPlatform] = useState<null | 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'>(null)

  // ── Publish All ───────────────────────────────────────────────────────────
  const [publishingAll, setPublishingAll] = useState(false)
  const [publishAllStep, setPublishAllStep] = useState('')
  const [publishAllError, setPublishAllError] = useState<string | null>(null)

  async function handlePublishAll() {
    setPublishingAll(true)
    setPublishAllError(null)

    let currentPostId = post?.postId

    // Step 1: Generate blog post if it doesn't exist yet
    if (!currentPostId) {
      setPublishAllStep('Generating blog post…')
      try {
        const res = await generateBlogRequest({ videoId: id })
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        if (!res.ok) {
          if (data.limitReached) {
            dispatchCapReached(
              data.error || 'You\'ve hit your posts cap for this period.',
              {
                cap: data.cap || 'posts',
                currentTier: data.currentTier,
                upgrade: data.upgrade,
              },
            )
            return
          }
          throw new Error(errText(data.error) || 'Blog generation failed')
        }
        currentPostId = data.postId as string
        onGenerated(id, data.wordpressUrl as string, data.title as string, data.postId as string)
      } catch (err) {
        setPublishAllError(err instanceof Error ? err.message : 'Blog generation failed')
        setPublishingAll(false)
        return
      }
    }

    // Step 2: Fire all connected & unposted social platforms in parallel
    setPublishAllStep('Publishing to social media…')
    const tasks: Promise<void>[] = []
    // Collect per-platform failures so a silent server-side reject (expired
    // token, a platform needing a reconnect, Meta review gate, etc.) SURFACES to
    // the user instead of vanishing — previously every error was swallowed, so a
    // connected-but-failing platform (e.g. Threads missing its user id) looked
    // like it just "didn't post" with no explanation.
    const failures: string[] = []
    const addTask = (cond: boolean, label: string, url: string, onOk: () => void, extra?: Record<string, unknown>) => {
      if (!cond) return
      tasks.push(
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId, ...(extra || {}) }) })
          .then(async (r) => {
            if (r.ok) { onOk(); return }
            const d = await r.json().catch(() => ({} as { error?: string }))
            failures.push(`${label} (${d.error || `HTTP ${r.status}`})`)
          })
          .catch((e) => { failures.push(`${label} (${e instanceof Error ? e.message : 'network error'})`) }),
      )
    }

    addTask(fbConnected && !fbPosted, 'Facebook', '/api/blog/facebook-post', () => setFbPosted(true), { socialAccountId: effectiveFbAccountId ?? undefined })
    addTask(linkedInConnected && !liPosted, 'LinkedIn', '/api/blog/linkedin-post', () => setLiPosted(true))
    addTask(threadsConnected && !thPosted, 'Threads', '/api/blog/threads-post', () => setThPosted(true))
    addTask(twitterConnected && !twPosted, 'X', '/api/blog/twitter-post', () => setTwPosted(true))
    addTask(blueskyConnected && !bsPosted, 'Bluesky', '/api/blog/bluesky-post', () => setBsPosted(true))
    addTask(telegramConnected && !tgPosted, 'Telegram', '/api/blog/telegram-post', () => setTgPosted(true))

    // Pinterest — two-step (preview builds the pin image + description, then
    // post). Auto-runs here using the configured board, skipping the manual
    // confirm modal. Needs a board set + a pinnable image (falls into failures
    // with the reason if either is missing).
    if (pinterestConnected && !pinPosted) {
      tasks.push((async () => {
        try {
          const pv = await fetch('/api/blog/pinterest-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          const d = await pv.json().catch(() => ({} as Record<string, unknown>))
          if (!pv.ok) throw new Error((d.error as string) || `preview failed (HTTP ${pv.status})`)
          const pp = await fetch('/api/blog/pinterest-post', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId: currentPostId, title: d.title, description: d.description, imageBase64: d.imageBase64, mediaType: d.mediaType, fallbackImageUrl: d.fallbackImageUrl }),
          })
          const r = await pp.json().catch(() => ({} as { error?: string }))
          if (!pp.ok) throw new Error(r.error || `Pinterest rejected the pin (HTTP ${pp.status})`)
          setPinPosted(true)
        } catch (e) {
          failures.push(`Pinterest (${e instanceof Error ? e.message : 'error'})`)
        }
      })())
    }

    await Promise.allSettled(tasks)
    if (failures.length) setPublishAllError(`Couldn't post to ${failures.join(', ')}`)
    setPublishingAll(false)
    setPublishAllStep('')
  }

  // Note: Instagram is excluded from Publish All because it requires
  // per-post setup (vertical video upload + Reel/Story choice). Users
  // trigger it explicitly via the Instagram pill on each card.
  const connectedSocialCount = [fbConnected, linkedInConnected, threadsConnected, twitterConnected, blueskyConnected, telegramConnected].filter(Boolean).length

  const hasSocialsToPost = (fbConnected && !fbPosted) || (linkedInConnected && !liPosted) || (threadsConnected && !thPosted) || (twitterConnected && !twPosted) || (blueskyConnected && !bsPosted) || (telegramConnected && !tgPosted)
  // Hide Publish-to-all while the post is queued — the socials are
  // already scheduled to fire after the blog goes live. Re-enabled
  // once the schedule time passes (then the row reads as a normal
  // published post that may still have untouched channels). Same logic
  // gates the Schedule button further down.
  const showPublishAll = connectedSocialCount > 0 && (!post || hasSocialsToPost) && !isScheduledPending

  // Every social pill opens a preview + confirm modal first. The modal
  // (SocialPreviewModal) performs the actual publish on confirm, so these
  // handlers only need to open it. This is enforced for all platforms — there
  // is no "publish straight away" path for individual pills anymore.
  function handleBlueskyPost() {
    if (!post?.postId) return
    setPreviewPlatform('bluesky')
  }

  function handleTelegramPost() {
    if (!post?.postId) return
    setPreviewPlatform('telegram')
  }

  function handleTwitterPost() {
    if (!post?.postId) return
    setPreviewPlatform('twitter')
  }

  function handleLinkedInPost() {
    if (!post?.postId) return
    setPreviewPlatform('linkedin')
  }

  function handleFacebookPost() {
    if (!post?.postId) return
    setPreviewPlatform('facebook')
  }

  function handleThreadsPost() {
    if (!post?.postId) return
    setPreviewPlatform('threads')
  }

  async function handlePinPreview() {
    if (!post?.postId) return
    setPinLoading(true)
    try {
      const res = await fetch('/api/blog/pinterest-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.postId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed to generate pin preview'); return }
      onPinPreview({ postId: post.postId, ...d })
    } catch { toast.error('Failed to generate pin preview') }
    finally { setPinLoading(false) }
  }

  async function handleDelete() {
    if (!post?.postId) return
    if (!(await confirm({
      title: 'Delete this post from WordPress and remove it here?',
      description: 'The post is moved to WordPress\' trash (restorable for ~30 days) and unlinked from this video.',
      confirmLabel: 'Delete post',
      destructive: true,
    }))) return
    setDeleting(true)
    try {
      const res = await fetch('/api/blog/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: post.postId }) })
      if (res.ok) onDelete(post.postId)
    } finally { setDeleting(false) }
  }

  return (
    <div className="card p-4 flex gap-4 items-start">
      {thumb && (
        <div className="w-28 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100" style={{ height: '72px' }}>
          {/* loading="lazy" — only fetch the YouTube thumbnail when this
              card actually scrolls into view. Cuts initial bandwidth on
              the Posts tab from ~20 thumbs/page to ~4-5 (the ones above
              the fold). decoding="async" lets the browser skip the main
              thread for image decoding. 2026-06-07 perf pass. */}
          <img src={thumb} alt={title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug line-clamp-2 mb-1">{title}</p>
        <div className="flex items-center gap-3 text-xs text-[#86868b] dark:text-[#8e8e93] mb-3 flex-wrap">
          {views != null && <span>{views.toLocaleString()} views</span>}
          <span>{new Date(publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          {/* Scheduled pill — purple-tinted "Scheduled · Sat Jun 6 at
              10:20 AM" badge. Renders only when the post has been queued
              via /api/blog/schedule-publish AND the scheduled time
              hasn't passed yet. Once it goes live, the badge disappears
              and the row reads as a normal published post. */}
          {scheduledLabel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[rgba(124,58,237,0.15)] text-[#7C3AED] border border-[rgba(124,58,237,0.3)]">
              <Calendar size={10} /> Scheduled · {scheduledLabel}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {/* Publish All — shown when ≥1 social platform is connected and unpublished.
              Locked behind Pro tier; non-Pro users see the button but it links to /pricing. */}
          {/* Action row — Publish all (when relevant) + the yellow Visit
              and pink Upload-product-photo buttons.
              ── VERTICAL videos: hidden. The Vertical Videos workflow is
                "Short → TikTok / IG" via the modal pills below; we do NOT
                want a blog-post-generation entry point cluttering the row
                or tempting users into the long-form path for a Short. */}
          {video.is_vertical !== true && (
            <div className="flex items-center gap-2 flex-wrap">
              {showPublishAll && (publishingAll ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#7C3AED] to-[#5856d6] text-white opacity-80">
                  <Loader2 size={12} className="animate-spin" />
                  {publishAllStep || 'Working…'}
                </div>
              ) : publishAllUnlocked ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handlePublishAll}
                  leftIcon={<Sparkles size={12} />}
                  title={post ? 'Post to all connected platforms that haven\'t been posted yet' : 'Generate blog post and publish to all connected platforms'}
                >
                  {post ? 'Publish to all' : 'Generate + publish all'}
                </Button>
              ) : (
                <Link
                  href="/pricing"
                  title="Publish All is a Pro feature — click to upgrade"
                  className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg text-white whitespace-nowrap bg-gradient-to-br from-[#7C3AED] to-[#7b61ff] opacity-90 hover:opacity-100 hover:shadow-md transition-all"
                >
                  <Sparkles size={12} />
                  {post ? 'Publish to all' : 'Generate + publish all'}
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-yellow-300 text-[#1d1d1f]">Pro</span>
                </Link>
              ))}
              {/* Schedule — opens the ScheduleModal in one of two modes:
                    - FRESH (no post yet, no schedule pending): generates
                      the post + queues a cascade via /api/blog/schedule-publish
                    - CASCADE-ONLY (post already live): queues only social
                      pushes via /api/blog/schedule-cascade-only. This is
                      the "amplify a live post later" + "retry a failed
                      social cascade" path.
                  Hidden when a schedule is already pending so the user
                  can't double-queue while waiting for go-live. */}
              {!isScheduledPending && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  title={post
                    ? 'Schedule a social cascade for this already-live post'
                    : 'Generate now, publish later — pick a date/time and which socials to push'}
                  className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg whitespace-nowrap border transition-colors hover:bg-[rgba(124,58,237,0.10)]"
                  style={{ borderColor: 'var(--border-bright, rgba(255,255,255,0.14))', color: 'var(--text, #F5F5F7)' }}
                >
                  <Calendar size={12} /> {post ? 'Schedule socials' : 'Schedule'}
                </button>
              )}
              {/* Visit Link or Product — opens the first affiliate / product
                  link found in the video's description (Geniuslink, amzn.to,
                  Amazon URL, or an ASIN-derived link). Lets the creator
                  confirm what's being promoted before publishing. */}
              {(() => {
                const link = deriveProductUrl(video)
                if (!link) return null
                return (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the first product / affiliate link from the video description"
                    className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg text-[#1d1d1f] whitespace-nowrap bg-[#FFC200] hover:bg-[#FFD000] hover:shadow-md transition-all"
                  >
                    <ExternalLink size={12} /> Visit Link or Product
                  </a>
                )
              })()}
              {/* Pink — upload the exact product photo the AI uses as a
                  visual reference so in-body images match the real product. */}
              <ProductPhotoUpload
                videoId={id}
                initialUrl={(video.product_image_url as string | null) ?? null}
              />
              {publishAllError && (
                <span className="text-xs text-[#ff3b30] line-clamp-1">{publishAllError}</span>
              )}
              {/* Explain why IG isn't in Publish-all (it needs media + a
                  Reel/Story/Image choice) so users don't think it's broken. */}
              {instagramConnected && post && (
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  Instagram posts a video or image, so it&apos;s not in Publish-all — share it from the Instagram button.
                </span>
              )}
            </div>
          )}

          {/* Manage row — Generate / View / Rewrite (via GenerateButton),
              Edit in WP, Delete or Ignore. Text-link styling, low emphasis.
              ── VERTICAL videos: hidden. Short-form vertical workflow is
                Post-to-TikTok / Post-to-IG only; the blog-post manage
                actions (Generate, Rewrite, Edit in WP, Delete the WP post)
                don't apply when there's no blog post in this flow. */}
          {video.is_vertical !== true && (
          <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
            <GenerateButton videoId={id} youtubeVideoId={(video.youtube_video_id as string) || undefined} existingPost={post} userTier={userTier} onDone={(url, t, pid) => onGenerated(id, url, t, pid)} />
            <CategoryPicker
              videoId={id}
              initial={(video.selected_category as string | null) ?? null}
              brandNiches={brandNiches}
              customCategories={customCategories}
              onCustomCategoryAdded={onCustomCategoryAdded}
              hasPublishedPost={!!post}
            />
            {post ? (
              <>
                <ManualEdit postId={post.postId} />
                <button onClick={handleDelete} disabled={deleting} className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors disabled:opacity-60">
                  {deleting ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            ) : (
              <button onClick={onDismiss} className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors">
                <X size={11} /> Ignore
              </button>
            )}
          </div>
          )}

          {/* Publish-to row — uniform pills, one per connected platform.
              ── HORIZONTAL videos: all connected socials get a pill (the
              long-form review path produces blog content that fits FB,
              Pinterest, LinkedIn, etc.).
              ── VERTICAL videos (Shorts): we DELIBERATELY restrict the row
              to TikTok + Instagram. Short-form vertical content doesn't
              translate well to LinkedIn / X / Threads / Bluesky / Telegram
              / Pinterest, and stuffing those pills onto every Short row
              clutters the workflow. TikTok uses the DIRECT video flow
              (no blog post needed); IG uses the existing modal which
              requires a generated post. */}
          {(() => {
            const isVertical = video.is_vertical === true
            if (isVertical) {
              // Vertical: render the compact Shorts-only publish row.
              // Even with NO blog post yet, the TikTok direct flow works —
              // the only requirement is the vertical MP4 being uploaded.
              if (!tiktokConnected && !instagramConnected) return null
              return (
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mr-1">Post Short to</span>
                  {tiktokConnected && (
                    <SocialPill
                      brand="#000000"
                      icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" /></svg>}
                      label="TikTok"
                      postedLabel="On TikTok"
                      posted={ttDirectPosted}
                      loading={false}
                      onClick={() => setTtModalOpen(true)}
                      locked={!tierAllowsSocial(userTier, 'tiktok')}
                    />
                  )}
                  {instagramConnected && (
                    <SocialPill
                      brand="#E1306C"
                      icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>}
                      label="Instagram"
                      postedLabel={igDirectPosted ? 'On Instagram' : 'Post Reel'}
                      posted={igDirectPosted}
                      loading={false}
                      onClick={() => setIgDirectModalOpen(true)}
                      locked={!tierAllowsSocial(userTier, 'instagram')}
                    />
                  )}
                </div>
              )
            }
            // Horizontal: original logic — only render when a post exists +
            // at least one non-vertical social is connected.
            const showAny = !!post && (fbConnected || pinterestConnected || threadsConnected || linkedInConnected || twitterConnected || blueskyConnected || telegramConnected)
            if (!showAny) return null
            return null  // continue to the original block below
          })()}
          {/* Original horizontal pill block — only renders when not vertical
              AND a post exists AND at least one social is connected. */}
          {video.is_vertical !== true && post && (fbConnected || pinterestConnected || threadsConnected || linkedInConnected || twitterConnected || blueskyConnected || telegramConnected) && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mr-1">Publish to</span>
              {fbConnected && (
                <SocialPill
                  brand="#1877F2"
                  icon={<Facebook size={11} />}
                  label="Facebook" postedLabel="On Facebook"
                  posted={fbPosted} loading={fbPosting} onClick={handleFacebookPost}
                  locked={!tierAllowsSocial(userTier, 'facebook')}
                  scheduleFailed={failedSchedulePlatforms?.has('facebook')}
                />
              )}
              {fbConnected && showFbAccountPicker && (
                <select
                  value={effectiveFbAccountId ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    setSelectedFbAccountId(v)
                    try { localStorage.setItem('mvp_fb_account_choice', v) } catch { /* ignore */ }
                  }}
                  title="Which Facebook Page to publish to"
                  className="text-[10px] px-1.5 py-1 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none max-w-[150px]"
                >
                  {fbAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.displayName || 'Facebook Page'}</option>
                  ))}
                </select>
              )}
              {pinterestConnected && (
                <SocialPill
                  brand="#E60023"
                  icon={<Pin size={11} />}
                  label="Pinterest" postedLabel="Pinned"
                  posted={pinPosted} loading={pinLoading} onClick={handlePinPreview}
                  locked={!tierAllowsSocial(userTier, 'pinterest')}
                />
              )}
              {threadsConnected && (
                <SocialPill
                  brand="#000000"
                  icon={<MessageCircle size={11} />}
                  label="Threads" postedLabel="On Threads"
                  posted={thPosted} loading={thPosting} onClick={handleThreadsPost}
                  locked={!tierAllowsSocial(userTier, 'threads')}
                  scheduleFailed={failedSchedulePlatforms?.has('threads')}
                />
              )}
              {linkedInConnected && (
                <SocialPill
                  brand="#0A66C2"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>}
                  label="LinkedIn" postedLabel="On LinkedIn"
                  posted={liPosted} loading={liPosting} onClick={handleLinkedInPost}
                  locked={!tierAllowsSocial(userTier, 'linkedin')}
                  scheduleFailed={failedSchedulePlatforms?.has('linkedin')}
                />
              )}
              {twitterConnected && (
                <SocialPill
                  brand="#000000"
                  icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>}
                  label="X" postedLabel="On X"
                  posted={twPosted} loading={twPosting} onClick={handleTwitterPost}
                  locked={!tierAllowsSocial(userTier, 'twitter')}
                  scheduleFailed={failedSchedulePlatforms?.has('twitter')}
                />
              )}
              {blueskyConnected && (
                <SocialPill
                  brand="#1185fe"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>}
                  label="Bluesky" postedLabel="On Bluesky"
                  posted={bsPosted} loading={bsPosting} onClick={handleBlueskyPost}
                  locked={!tierAllowsSocial(userTier, 'bluesky')}
                  scheduleFailed={failedSchedulePlatforms?.has('bluesky')}
                />
              )}
              {telegramConnected && (
                <SocialPill
                  brand="#229ED9"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>}
                  label="Telegram" postedLabel="On Telegram"
                  posted={tgPosted} loading={tgPosting} onClick={handleTelegramPost}
                  locked={!tierAllowsSocial(userTier, 'telegram')}
                  scheduleFailed={failedSchedulePlatforms?.has('telegram')}
                />
              )}
              {instagramConnected && (
                <SocialPill
                  brand="#E1306C"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>}
                  label="Instagram" postedLabel={igReelPosted && igStoryPosted ? 'On Instagram' : igReelPosted ? 'Reel posted' : 'Story posted'}
                  posted={igReelPosted || igStoryPosted}
                  loading={igPosting}
                  onClick={() => setIgModalOpen(true)}
                  locked={!tierAllowsSocial(userTier, 'instagram')}
                />
              )}
              {/* TikTok pill — clicking opens the dedicated /tiktok-publish
                  screen in a new tab. The screen handles every TikTok-mandated
                  control (live privacy dropdown, Music Usage Confirmation,
                  commercial-content toggle, etc.). Not a modal — the screen
                  must NOT share UI with the IG/Pinterest composer per
                  TikTok's app-review guidelines. */}
              {tiktokConnected && post?.postId && (
                <SocialPill
                  brand="#000000"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" /></svg>}
                  label="TikTok"
                  postedLabel="On TikTok"
                  posted={false}
                  loading={false}
                  onClick={() => window.open(`/tiktok-publish/${post.postId}`, '_blank', 'noopener')}
                  locked={!tierAllowsSocial(userTier, 'tiktok')}
                />
              )}
            </div>
          )}

          {/* Social preview/edit modal — shown when previewBeforePublish is on
              and the user clicks a non-Instagram social pill. Single instance
              keyed on `previewPlatform`; the platform config (endpoint, brand
              color, label) is resolved inline. */}
          {previewPlatform && post?.postId && (() => {
            const cfg = {
              facebook: { endpoint: '/api/blog/facebook-post', color: '#1877f2', label: 'Facebook',  onPublished: () => setFbPosted(true) },
              threads:  { endpoint: '/api/blog/threads-post',  color: '#000000', label: 'Threads',   onPublished: () => setThPosted(true) },
              twitter:  { endpoint: '/api/blog/twitter-post',  color: '#000000', label: 'X',         onPublished: () => setTwPosted(true) },
              linkedin: { endpoint: '/api/blog/linkedin-post', color: '#0a66c2', label: 'LinkedIn',  onPublished: () => setLiPosted(true) },
              bluesky:  { endpoint: '/api/blog/bluesky-post',  color: '#1185fe', label: 'Bluesky',   onPublished: () => setBsPosted(true) },
              telegram: { endpoint: '/api/blog/telegram-post', color: '#229ED9', label: 'Telegram',  onPublished: () => setTgPosted(true) },
            }[previewPlatform]
            // 3 hashtags for the Facebook Group copy block: brand niches first,
            // padded with evergreen affiliate tags.
            const fbHashtags = (() => {
              const tags = (brandNiches || []).slice(0, 3).map(n => '#' + n.toLowerCase().replace(/[^a-z0-9]+/g, ''))
              for (const e of ['#amazonfinds', '#founditonamazon', '#musthave']) {
                if (tags.length >= 3) break
                if (!tags.includes(e)) tags.push(e)
              }
              return tags.slice(0, 3).join(' ')
            })()
            const fbPageLabel = fbAccounts.find(a => a.id === effectiveFbAccountId)?.displayName
              || fbAccounts.find(a => a.isDefault)?.displayName
              || fbAccounts[0]?.displayName
              || 'your connected Page'
            const fbExtras = previewPlatform === 'facebook'
              ? {
                  shareUrl: post.url,
                  shareHashtags: fbHashtags,
                  shareDisclaimer: brandDisclaimer || '#ad #sponsored',
                  facebookGroups: brandFacebookGroups,
                  publishTargetLabel: fbPageLabel,
                }
              : {}
            return (
              <SocialPreviewModal
                platform={cfg.label}
                platformKey={previewPlatform}
                brandColor={cfg.color}
                endpoint={cfg.endpoint}
                postId={post.postId}
                onClose={() => setPreviewPlatform(null)}
                onPublished={cfg.onPublished}
                extraBody={previewPlatform === 'facebook' && effectiveFbAccountId ? { socialAccountId: effectiveFbAccountId } : undefined}
                {...fbExtras}
              />
            )
          })()}

          {/* TikTok direct modal — opens when user clicks the TikTok pill on
              a vertical row. Reads the video by id (no blog post needed).
              Has all the TikTok-audit-required controls inline. */}
          {ttModalOpen && (
            <TikTokDirectModal
              videoId={id}
              onClose={() => setTtModalOpen(false)}
              onPosted={() => setTtDirectPosted(true)}
            />
          )}
          {/* IG direct modal — opens when user clicks the IG pill on a
              vertical row. Reads the video by id (no blog post needed). */}
          {igDirectModalOpen && (
            <InstagramDirectModal
              videoId={id}
              onClose={() => setIgDirectModalOpen(false)}
              onPosted={() => setIgDirectPosted(true)}
            />
          )}

          {/* Instagram publish modal — opens when user clicks the IG pill */}
          {igModalOpen && post?.postId && (
            <InstagramPublishModal
              postId={post.postId}
              videoDbId={id}
              videoKind={video.is_vertical === true ? 'vertical' : 'horizontal'}
              alreadyReeled={igReelPosted}
              alreadyStoried={igStoryPosted}
              igAccounts={igAccounts}
              onClose={() => setIgModalOpen(false)}
              onPublishStart={() => setIgPosting(true)}
              onPublishEnd={() => setIgPosting(false)}
              onReelPosted={() => setIgReelPosted(true)}
              onStoryPosted={(affiliateUrl) => {
                setIgStoryPosted(true)
                setIgStorySticker(affiliateUrl)
              }}
            />
          )}

          {/* Post-Story sticker prompt — shown after a Story publish completes */}
          {igStorySticker && (
            <div className="rounded-xl border border-[#E1306C]/30 bg-[#E1306C]/5 p-3 flex items-start gap-3">
              <AlertCircle size={14} className="text-[#E1306C] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Story posted — add the affiliate link sticker on your phone (5 sec)</p>
                <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-2 leading-relaxed">
                  Instagram&apos;s API doesn&apos;t expose link stickers. Open Instagram → your Story → tap sticker icon → Link sticker → paste:
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-[11px] font-mono px-2 py-1 rounded bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#7C3AED] truncate max-w-[260px]">
                    {igStorySticker}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(igStorySticker); }}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-[#E1306C] text-white hover:opacity-90"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => setIgStorySticker(null)}
                    className="text-[11px] text-[#86868b] hover:text-[#1d1d1f]"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>{/* end flex-col wrapper */}
      </div>
      {/* Schedule modal — rendered at the row root so its z-50 overlay
          covers the whole viewport. Mounted only when opened so unopened
          rows pay zero cost. */}
      <ScheduleModal
        videoId={id}
        videoTitle={title}
        connectedChannels={connectedChannels}
        existingPostId={post?.postId ?? null}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onScheduled={(result) => {
          // The modal's POST returned ok + the schedule-publish route
          // wrote a blog_posts row with scheduled_for set. Push the
          // new post into the parent's posts map so this row's badge
          // appears immediately (no full reload needed). We hand the
          // schedule fields to onGenerated which merges them in.
          //
          // The parent's onGenerated signature only takes (videoId,
          // url, title, postId) so the scheduledFor/scheduleMode hop
          // through a quick window-level patch below — kept inline so
          // we don't have to widen every onGenerated caller.
          setScheduleOpen(false)
          // Defer to the next tick so onClose's setState has flushed.
          // The patch event handler in the parent's posts state writer
          // merges scheduled_for + schedule_mode in alongside the
          // standard generate-completion fields.
          window.dispatchEvent(new CustomEvent('mvp-schedule-applied', {
            detail: {
              videoId: id,
              scheduledFor: result.scheduledFor,
              scheduleMode: result.mode,
            },
          }))
        }}
      />
      <ConfirmHost />
    </div>
  )
})

// Display label + brand color for each schedulable platform — used by the
// Scheduled list. Kept in sync with the cron worker's switch statement.
const PLATFORM_META: Record<NonNullable<ScheduledItem['platform']>, { label: string; color: string }> = {
  facebook: { label: 'Facebook', color: '#1877f2' },
  threads:  { label: 'Threads',  color: '#000000' },
  twitter:  { label: 'X',        color: '#000000' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2' },
  bluesky:  { label: 'Bluesky',  color: '#1185fe' },
  telegram: { label: 'Telegram', color: '#229ED9' },
}

const STATUS_PILL: Record<ScheduledItem['status'], { label: string; bg: string; fg: string }> = {
  pending:    { label: 'Pending',    bg: 'bg-[#ff9500]/10', fg: 'text-[#9a5d00]' },
  processing: { label: 'Publishing', bg: 'bg-[#7C3AED]/10', fg: 'text-[#7C3AED]' },
  completed:  { label: 'Published',  bg: 'bg-[#34c759]/10', fg: 'text-[#1f8a3a]' },
  failed:     { label: 'Failed',     bg: 'bg-[#ff3b30]/10', fg: 'text-[#ff3b30]' },
  cancelled:  { label: 'Cancelled',  bg: 'bg-gray-100',     fg: 'text-[#86868b]' },
}

function ScheduledList({
  items, loading, error, onRefresh, onCancel,
}: {
  items: ScheduledItem[] | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onCancel: (id: string) => void
}) {
  // History filter (2026-06-07 UX fix). The Scheduled tab kept showing
  // completed rows forever, which made users think a fired schedule was
  // "stuck". Default to pending-only with a toggle to see history. Same
  // mental model as Gmail's "Unread"/"All" split.
  const [showHistory, setShowHistory] = useState(false)
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading scheduled posts…
      </div>
    )
  }
  if (error) {
    return (
      <div className="card p-6 max-w-md flex flex-col items-center text-center gap-3">
        <AlertCircle size={20} className="text-[#ff3b30]" />
        <p className="text-xs text-[#ff3b30]">{error}</p>
        <button onClick={onRefresh} className="text-xs text-[#7C3AED] hover:underline">Retry</button>
      </div>
    )
  }
  if (!items || items.length === 0) {
    return (
      <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No scheduled posts yet</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] max-w-sm leading-relaxed">
          When you publish to a social, tick <strong>Schedule for later</strong> in the preview modal
          to queue it for a future time. The cron worker fires automatically — no need to keep the
          app open.
        </p>
      </div>
    )
  }

  // Apply the pending/all filter BEFORE grouping so a parent that's
  // already published doesn't show with hidden pending children.
  const filteredItems = showHistory ? items : items.filter(i => i.status === 'pending' || i.status === 'processing')

  // ── Cascade grouping (P1.3 — per-row schedule cascade view) ──────────
  // Visually group child rows under their parent so the user can see the
  // tree at a glance: a kind='blog_publish' parent first, then every
  // kind='social' row whose parent_id points at it indented below.
  // Standalone rows (no parent_id, no children) stay flat at top-level.
  // Sort the top-level by pending-first, then most recent.
  const childrenByParent = new Map<string, ScheduledItem[]>()
  const topLevel: ScheduledItem[] = []
  for (const it of filteredItems) {
    if (it.parent_id) {
      const arr = childrenByParent.get(it.parent_id) ?? []
      arr.push(it)
      childrenByParent.set(it.parent_id, arr)
    } else {
      topLevel.push(it)
    }
  }
  // Sort top-level: pending first (oldest-due at top), then by recent.
  const sortedTopLevel = topLevel.sort((a, b) => {
    const aPending = a.status === 'pending' ? 0 : 1
    const bPending = b.status === 'pending' ? 0 : 1
    if (aPending !== bPending) return aPending - bPending
    return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
  })
  // Build the flat-with-indent render list: each top-level row followed
  // by its children (sorted by scheduled_at ascending so the cascade
  // reads chronologically — parent at t, child1 at t+5min, etc.).
  const sorted: Array<{ item: ScheduledItem; indent: boolean }> = []
  for (const tl of sortedTopLevel) {
    sorted.push({ item: tl, indent: false })
    const kids = childrenByParent.get(tl.id) ?? []
    kids.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    for (const k of kids) sorted.push({ item: k, indent: true })
  }
  // Orphan children — children whose parent isn't in the items array
  // (could happen if the parent expired off the 100-row limit). Show at
  // the bottom so they're not lost.
  for (const [parentId, kids] of childrenByParent.entries()) {
    if (!topLevel.find(t => t.id === parentId)) {
      for (const k of kids) sorted.push({ item: k, indent: false })
    }
  }

  const pendingCount = items.filter(i => i.status === 'pending').length
  const historyCount = items.length - pendingCount
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs">
          <p className="text-[#6e6e73] dark:text-[#ebebf0]">
            {pendingCount} pending{showHistory ? ` · ${items.length} shown` : ` · ${historyCount} in history`}
          </p>
          {historyCount > 0 && (
            <button
              onClick={() => setShowHistory(s => !s)}
              className="text-[#7C3AED] hover:underline"
            >
              {showHistory ? 'Hide history' : `Show history (${historyCount})`}
            </button>
          )}
        </div>
        <button onClick={onRefresh} className="text-xs text-[#7C3AED] hover:underline inline-flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {filteredItems.length === 0 && pendingCount === 0 && !showHistory && (
        <div className="card p-6 text-center">
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">No pending posts.</p>
          {historyCount > 0 && (
            <button
              onClick={() => setShowHistory(true)}
              className="mt-2 text-xs text-[#7C3AED] hover:underline"
            >
              Show {historyCount} from history
            </button>
          )}
        </div>
      )}
      {sorted.map(({ item, indent }) => {
        // kind='blog_publish' rows have platform=null (they're the WP
        // publish-itself row in draft-flip mode, not a social push).
        // Render those with the WordPress brand label + icon stand-in.
        const meta = item.kind === 'blog_publish'
          ? { label: 'WordPress', color: '#21759b' }
          : PLATFORM_META[item.platform ?? 'linkedin']  // fallback impossible — kind=social ensures platform is non-null
        const pill = STATUS_PILL[item.status]
        const when = new Date(item.scheduled_at)
        const dt = when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        return (
          <div
            key={item.id}
            className={`card p-4 flex items-start gap-3 ${indent ? 'ml-8 border-l-2 border-l-[#7C3AED]/40' : ''}`}
            title={indent ? 'Child of the parent above — fires after the parent publishes' : undefined}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
              style={{ background: meta.color }}
            >
              {meta.label.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {item.kind === 'blog_publish' ? 'Publish to WordPress' : meta.label}
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${pill.bg} ${pill.fg}`}>
                  {pill.label}
                </span>
                <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                  {item.status === 'pending' ? 'Scheduled for ' : ''}{dt}
                </span>
              </div>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] truncate mb-1">
                {item.blog_posts?.title ?? 'Untitled post'}
              </p>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] line-clamp-2 italic">
                &ldquo;{item.body_text.slice(0, 150)}{item.body_text.length > 150 ? '…' : ''}&rdquo;
              </p>
              {item.error_message && (
                <p className="text-[11px] text-[#ff3b30] mt-2 break-all">⚠ {item.error_message}</p>
              )}
            </div>
            {item.status === 'pending' && (
              <button
                onClick={() => onCancel(item.id)}
                className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

const DISMISSED_KEY = 'affiliateos_dismissed_videos'
function getDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) } catch { return new Set() }
}
function saveDismissed(set: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])) } catch {}
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContentPage() {
  const supabase = createBrowserClient()
  const { confirm, ConfirmHost } = useConfirm()
  const [videos, setVideos] = useState<Record<string, unknown>[]>([])
  const [posts, setPosts] = useState<Record<string, { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; scheduledFor?: string | null; scheduleMode?: string | null; /** Real WP/DB publish timestamp — used to sort the Recent section by blog publish date instead of video publish date. 2026-06-07. */ publishedAt?: string | null; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string; instagramReelId?: string; instagramStoryId?: string }>>({})
  // Per-post map of platforms whose MOST RECENT scheduled push failed.
  // Drives the ⚠ warning next to the social pill in VideoCard. Filled
  // by load() from scheduled_posts. 2026-06-07 UX fix — previously the
  // user only saw failed scheduled pushes in the bell or by clicking
  // into the Scheduled tab.
  const [failedSchedules, setFailedSchedules] = useState<Record<string, Set<string>>>({})
  const [wpSiteUrl, setWpSiteUrl] = useState('')
  const [fbConnected, setFbConnected] = useState(false)
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [threadsConnected, setThreadsConnected] = useState(false)
  const [linkedInConnected, setLinkedInConnected] = useState(false)
  const [twitterConnected, setTwitterConnected] = useState(false)
  const [blueskyConnected, setBlueskyConnected] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [instagramConnected, setInstagramConnected] = useState(false)
  const [tiktokConnected, setTiktokConnected] = useState(false)
  /** Connected Facebook Pages for the per-post account picker (Pro). Empty
   *  for non-Pro users or those with a single page — the picker only shows
   *  when there's a real choice to make. */
  const [fbAccounts, setFbAccounts] = useState<Array<{ id: string; externalId: string; displayName: string | null; isDefault: boolean }>>([])
  const [igAccounts, setIgAccounts] = useState<Array<{ id: string; externalId: string; displayName: string | null; isDefault: boolean }>>([])
  const [userTier, setUserTier] = useState<Tier>('trial')
  const [brandNiches, setBrandNiches] = useState<string[]>([])
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [brandDisclaimer, setBrandDisclaimer] = useState('')
  const [brandFacebookGroups, setBrandFacebookGroups] = useState<Array<{ name: string; url: string }>>([])
  const [checks, setChecks] = useState<ReadinessCheck | null>(null)
  const [syncing, setSyncing] = useState(false)
  // Pro multi-channel: connected channels for the "sync a specific channel"
  // picker. Only rendered when the user has more than one.
  const [ytChannels, setYtChannels] = useState<Array<{ id: string; channelId: string; channelTitle: string; isDefault: boolean }>>([])
  const [fromLinkOpen, setFromLinkOpen] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ pulled: number; pages: number } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pinPreview, setPinPreview] = useState<PinPreviewData | null>(null)
  const [pinPublishingFor, setPinPublishingFor] = useState<string | null>(null)
  // Rows (by postId) whose pin has been published this session — drives the
  // "Pinned" state on the OrphanPostShare Pinterest pill for video-less posts.
  const [pinnedPostIds, setPinnedPostIds] = useState<Set<string>>(new Set())
  const [fixingCategories, setFixingCategories] = useState(false)
  const [fixCatResult, setFixCatResult] = useState<string | null>(null)
  // Category-fix preview modal — dryRun the recategorize endpoint so the
  // user sees exactly which posts go where before any WP write happens.
  const [catPreview, setCatPreview] = useState<{ title: string; category: string }[] | null>(null)
  const [catPreviewLoading, setCatPreviewLoading] = useState(false)
  const [catApplying, setCatApplying] = useState(false)
  // Affiliate-link repair — dryRun finds posts with a broken affiliate link
  // (e.g. a dead amazon.com/dp/UNDERWATER) and previews old→new before writing.
  const [affPreview, setAffPreview] = useState<{ postId: string; title: string; oldUrl: string; newUrl: string }[] | null>(null)
  const [affSelected, setAffSelected] = useState<Set<string>>(new Set())
  const [affPreviewLoading, setAffPreviewLoading] = useState(false)
  const [affApplying, setAffApplying] = useState(false)
  const [activeTab, setActiveTab] = useState<'horizontal' | 'vertical' | 'posts' | 'scheduled'>('horizontal')

  // Deep-link: /content?tab=posts (the sidebar "Social Push" link) opens the
  // "Published Posts & Social Push" tab directly. Read once on mount (after
  // hydration, to avoid an SSR mismatch); then keep ?tab in sync with the
  // active tab so the sidebar active-state + shareable links stay accurate.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'posts' || t === 'vertical' || t === 'scheduled' || t === 'horizontal') setActiveTab(t)
  }, [])
  useEffect(() => {
    const url = activeTab === 'horizontal' ? '/content' : `/content?tab=${activeTab}`
    window.history.replaceState(null, '', url)
  }, [activeTab])
  // Scheduled posts list (loaded on demand when the Scheduled tab opens)
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[] | null>(null)
  const [scheduledLoading, setScheduledLoading] = useState(false)
  const [scheduledError, setScheduledError] = useState<string | null>(null)
  const [allBlogPosts, setAllBlogPosts] = useState<{ id: number; title: string; link: string; date: string; thumbnail: string | null; videoId: string | null; rewriteCount?: number; mvpId?: string | null; posted?: string[]; pinnedPersisted?: boolean }[]>([])
  // SEO score per post (slug → score) for the Library card badge. Loaded once
  // when the Posts tab opens, from the same /api/seo/overview the SEO hub uses.
  const [seoScores, setSeoScores] = useState<Record<string, number>>({})
  const [seoScoresLoaded, setSeoScoresLoaded] = useState(false)
  useEffect(() => {
    if (activeTab !== 'posts' || seoScoresLoaded) return
    setSeoScoresLoaded(true)
    ;(async () => {
      try {
        const res = await fetch('/api/seo/overview')
        const d = await res.json()
        if (!Array.isArray(d?.posts)) return
        const map: Record<string, number> = {}
        for (const p of d.posts) if (p?.slug) map[p.slug] = p.score as number
        setSeoScores(map)
      } catch { /* badge is best-effort */ }
    })()
  }, [activeTab, seoScoresLoaded])
  const [rewritingPostId, setRewritingPostId] = useState<number | null>(null)
  // Row-level Rewrite modal (Posts tab). Tracks the post we're about
  // to rewrite + the feedback typed by the Pro user. Modal renders at
  // the bottom of the page.
  const [rewriteModal, setRewriteModal] = useState<{ wpPostId: number; videoId: string; used: number } | null>(null)
  const [rewriteModalFeedback, setRewriteModalFeedback] = useState('')
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsLoaded, setPostsLoaded] = useState(false)
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null)
  const [refreshingImagesId, setRefreshingImagesId] = useState<number | null>(null)
  const [imgToast, setImgToast] = useState<string | null>(null)
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set())
  // Search box for the Posts tab — filters the published list by title.
  const [postSearch, setPostSearch] = useState('')
  // Pagination — Posts tab. Render-only optimization: the full set still
  // loads, we just slice what hits the DOM. Before this, 127 VideoCards
  // mounted on every Posts-tab visit (4000+ DOM nodes once you count
  // their buttons + dropdowns + social pills) and the tab took ~1.5s
  // to become interactive. 2026-06-07.
  const [recentPage, setRecentPage] = useState(1)
  const POSTS_PER_PAGE = 20
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkRewriting, setBulkRewriting] = useState(false)
  const [bulkRewriteProgress, setBulkRewriteProgress] = useState<{ done: number; total: number } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set())
  const [bulkGenerating, setBulkGenerating] = useState(false)
  // Bulk Schedule Videos — generate + schedule for un-generated videos
  // (content calendar use case). Different from `bulkScheduleOpen` below
  // which schedules SOCIAL pushes for already-live posts.
  const [bulkScheduleVideosOpen, setBulkScheduleVideosOpen] = useState(false)
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState<{ done: number; total: number } | null>(null)
  // Bulk Set Category — inline picker shown when the user clicks the
  // "Set category" button in the action bar.
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false)
  const [bulkCategoryApplying, setBulkCategoryApplying] = useState(false)
  const [bulkCategoryProgress, setBulkCategoryProgress] = useState<{ done: number; total: number } | null>(null)
  // Bulk Schedule — modal opens with date picker + platform multi-select.
  // (Schedules SOCIAL pushes for the selected ALREADY-LIVE posts.)
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false)
  // Library filters/sort (applied to the current videos tab — horizontal or vertical)
  const [videoSort, setVideoSort] = useState<'newest' | 'oldest' | 'views' | 'title'>('newest')
  const [videoSearch, setVideoSearch] = useState('')
  const [videoChannel, setVideoChannel] = useState<string>('') // '' = all channels
  const [videoGenFilter, setVideoGenFilter] = useState<'all' | 'ungenerated' | 'generated'>('all')
  // When on, dismissed (hidden) videos are revealed so they can be brought
  // back — otherwise a dismissed video is invisible with no way to recover it.
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => { setDismissed(getDismissed()) }, [])

  // Load connected YouTube channels (Pro multi-channel) so the Sync control can
  // offer a per-channel pull. Single-channel users get one entry → no picker.
  useEffect(() => {
    fetch('/api/youtube/channels')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.channels) setYtChannels(d.channels) })
      .catch(() => { /* non-fatal — falls back to the plain Sync button */ })
  }, [])

  // Reset pagination when the Posts-tab search changes — otherwise the
  // user can be sitting on page 4 of "all posts", type a query that
  // returns 8 matches, and see an empty page.
  useEffect(() => {
    setRecentPage(1)
  }, [postSearch])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const uid = user.id

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // Supabase caps a single .select() at 1,000 rows. Channels with more
    // synced videos than that would silently get truncated, so we page
    // through with .range() until we've pulled everything.
    //
    // EXPLICIT COLUMN LIST — we drop `transcript` (50KB+ per video, only
    // used downstream by the AI re-write modal which fetches on demand)
    // and `description` (kept in WP) from the initial pull. For a 500-
    // video creator that's a 25MB→3MB savings on each dashboard load.
    async function fetchAllVideos(): Promise<Record<string, unknown>[]> {
      const PAGE = 1000
      // COLS audit (fixed bug where the read returned 0 rows for every
      // user despite the sync writing thousands):
      //   - DROPPED: status (only on blog_posts), tags (only
      //     generated_tags exists here), face_model_id (doesn't exist),
      //     last_fetched_at (doesn't exist; transcript_fetched_at does
      //     but isn't used by the Library page).
      //   - ADDED: is_vertical — CRITICAL, this is what splits
      //     horizontal/vertical tabs. Was previously missing from the
      //     SELECT so every row landed as "undefined", which the !==
      //     true filter treated as horizontal but never as vertical
      //     (and the SELECT itself was already erroring on the bad
      //     columns, so the bug compounded).
      //
      // Every column in this list is verified against
      // lib/types/database.ts — if you add one here, make sure the
      // regenerated Supabase types include it or the SELECT will error
      // and silently empty the entire Library again.
      const COLS = [
        'id','user_id','youtube_video_id','title','thumbnail_url',
        'published_at','selected_category','product_url',
        'duration_seconds','view_count','is_vertical',
        'instagram_video_url','instagram_image_url','instagram_story_image_url',
        // Vertical-kanban (2026-06-06): tiktok_posted_at + instagram_posted_at
        // drive the "vertical video moved to Posts tab" filter. Migrations
        // 082 + 083 stamp these the moment a direct push succeeds.
        'tiktok_posted_at','instagram_posted_at',
        'created_at','updated_at',
      ].join(',')
      // Safety cap: load the newest MAX_VIDEOS only (ordered desc), so a
      // pathological catalogue can't pull tens of thousands of rows into the
      // browser on every Library visit. Real channels sit well under this; if
      // a user ever exceeds it they get the most-recent slice + a notice. The
      // full fix (server-side pagination/virtualization) is the deferred,
      // preview-tested follow-up — this is the guardrail until then.
      const MAX_VIDEOS = 2500
      const all: Record<string, unknown>[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastError: any = null
      let truncated = false
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from('youtube_videos')
          .select(COLS)
          .eq('user_id', uid)
          .order('published_at', { ascending: false })
          .range(from, from + PAGE - 1)
        if (error) {
          // Stash for the toast below. Previously a silent break, which
          // hid this exact class of bug for an unknown number of users.
          lastError = error
          console.error('[library] youtube_videos SELECT failed:', error)
          break
        }
        const chunk = (data as unknown as Record<string, unknown>[]) ?? []
        all.push(...chunk)
        if (chunk.length < PAGE) break
        if (all.length >= MAX_VIDEOS) { truncated = true; break }
      }
      if (truncated) {
        toast(`Showing your ${MAX_VIDEOS.toLocaleString()} most recent videos. Older ones aren't listed here yet.`)
      }
      if (lastError && all.length === 0) {
        // Surface to the user instead of silently rendering empty state.
        // If the read partially succeeded (some pages OK, later one
        // failed), we keep what we got and don't toast — the user sees
        // partial data, which is better than blank.
        toast.error(`Couldn't load your Library: ${lastError.message || 'unknown DB error'}. Refresh the page or contact support.`)
      }
      return all
    }

    const [vids, { data: brand }, { data: integration }, { data: blogPosts }, liveResp, { data: seoCache }] = await Promise.all([
      fetchAllVideos(),
      sb.from('brand_profiles').select('name,author_name,niches,tone,custom_categories,affiliate_disclaimer,facebook_groups').eq('user_id', user.id).single(),
      sb.from('integrations').select('wordpress_url,wordpress_username,wordpress_app_password,setup_status,facebook_page_id,pinterest_access_token,pinterest_board_id,threads_access_token,linkedin_access_token,linkedin_person_id,twitter_access_token,twitter_handle,bluesky_handle,bluesky_app_password,telegram_channel_id,instagram_access_token,instagram_user_id,tiktok_access_token,tiktok_open_id,tier').eq('user_id', user.id).single(),
      // `scheduled_for` + `schedule_mode` were added in migration 104.
      // Cast to any because the supabase-generated types haven't been
      // regenerated yet — same pattern as other post-migration selects
      // in the codebase. Drop after `gen types` runs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from('blog_posts') as any).select('id,video_id,wordpress_url,title,wordpress_post_id,body_images_count,scheduled_for,schedule_mode,published_at,created_at,facebook_post_id,pinterest_pin_id,threads_post_id,linkedin_post_id,twitter_post_id,bluesky_post_uri,telegram_message_id,instagram_reel_id,instagram_story_id').eq('user_id', user.id).eq('status', 'published'),
      // Which posts still exist (published) on the live WP site — to reconcile
      // away phantoms (deleted/trashed posts still linger in blog_posts).
      fetch('/api/blog/live-post-ids').then(r => r.ok ? r.json() : null).catch(() => null),
      // Indexing status per published post — refreshed nightly by the cron
      // /api/cron/refresh-indexing and on-demand by the SEO page's Check button.
      // Lets us show a ✓ / ⏳ / ✗ badge on the Content page so users don't have
      // to leave to know whether Google has indexed each post.
      sb.from('post_seo').select('post_id,indexed_state,coverage_state').eq('user_id', user.id),
    ])

    const b = brand as Record<string, unknown> | null
    const i = integration as Record<string, unknown> | null

    setChecks({
      brandReady: !!(b?.name && (b.niches as string[] || []).length > 0),
      // WordPress check: setup_status='site_ready' is the honest signal
      // post-fix — oauth-callback now writes 'wp_auth_failed' instead of
      // 'site_ready' when the credentials test fails. Falls back to the
      // legacy truthy-check for users who connected BEFORE setup_status
      // was a thing (those rows have setup_status=null but a working AP).
      wpReady: i?.setup_status
        ? i.setup_status === 'site_ready'
        : !!(i?.wordpress_url && i?.wordpress_username),
      videosReady: vids.length > 0,
    })
    setWpSiteUrl((i?.wordpress_url as string) || '')
    // Meta (Facebook/Threads/Instagram) hidden from the public while under
    // review — but visible to admins + the reviewer test account so the flows
    // stay testable.
    const metaOn = metaEnabled({ tier: (i as Record<string, unknown>)?.tier as string | null, email: user?.email })
    setFbConnected(metaOn && !!(i as Record<string, unknown>)?.facebook_page_id)
    setPinterestConnected(!!(i as Record<string, unknown>)?.pinterest_access_token)
    setThreadsConnected(metaOn && !!(i as Record<string, unknown>)?.threads_access_token)
    setLinkedInConnected(!!(i as Record<string, unknown>)?.linkedin_access_token && !!(i as Record<string, unknown>)?.linkedin_person_id)
    setTwitterConnected(!!(i as Record<string, unknown>)?.twitter_access_token)
    setBlueskyConnected(!!(i as Record<string, unknown>)?.bluesky_handle && !!(i as Record<string, unknown>)?.bluesky_app_password)
    setTelegramConnected(!!(i as Record<string, unknown>)?.telegram_channel_id)
    setInstagramConnected(metaOn && !!(i as Record<string, unknown>)?.instagram_access_token && !!(i as Record<string, unknown>)?.instagram_user_id)
    setTiktokConnected(!!(i as Record<string, unknown>)?.tiktok_access_token && !!(i as Record<string, unknown>)?.tiktok_open_id)
    const resolvedTier = effectiveTier((i as Record<string, unknown>)?.tier as string)
    setUserTier(resolvedTier)
    // Pro multi-account: load connected Facebook Pages + Instagram accounts so
    // the per-post pickers can offer a choice. Token-stripped; best-effort.
    if (resolvedTier === 'pro' || resolvedTier === 'admin') {
      fetch('/api/social-accounts?platform=facebook')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d?.accounts)) setFbAccounts(d.accounts) })
        .catch(() => {})
      fetch('/api/social-accounts?platform=instagram')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d?.accounts)) setIgAccounts(d.accounts) })
        .catch(() => {})
    }
    setBrandNiches(((b?.niches as string[] | null) ?? []))
    setCustomCategories(((b?.custom_categories as string[] | null) ?? []))
    setBrandDisclaimer((b?.affiliate_disclaimer as string | null) ?? '')
    setBrandFacebookGroups(Array.isArray(b?.facebook_groups) ? (b!.facebook_groups as Array<{ name: string; url: string }>) : [])
    setVideos(vids)

    // Reconcile against the LIVE site: a post deleted/trashed in WordPress still
    // lingers in blog_posts, which would otherwise leave its source video stuck
    // showing "published" with a link to a 404. null = couldn't read the site →
    // keep everything (a transient error must never hide real posts).
    const liveIds: Set<number> | null = (liveResp && Array.isArray(liveResp.liveIds)) ? new Set<number>(liveResp.liveIds) : null

    // Map post_seo by post_id so each video card knows its Google indexing status.
    const seoByPostId = new Map<string, { indexed: boolean | null; coverage: string | null }>()
    for (const r of (seoCache ?? []) as Array<{ post_id: string; indexed_state: string | null; coverage_state: string | null }>) {
      const indexed = r.indexed_state === 'indexed' ? true : r.indexed_state === 'not_indexed' ? false : null
      seoByPostId.set(r.post_id, { indexed, coverage: r.coverage_state })
    }

    const postMap: Record<string, { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; scheduledFor?: string | null; scheduleMode?: string | null; publishedAt?: string | null; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string; instagramReelId?: string; instagramStoryId?: string }> = {}
    for (const p of blogPosts as Record<string, unknown>[] ?? []) {
      if (liveIds && p.wordpress_post_id != null && !liveIds.has(p.wordpress_post_id as number)) continue  // deleted/trashed in WordPress
      if (p.video_id && p.wordpress_url) {
        const idx = seoByPostId.get(p.id as string)
        postMap[p.video_id as string] = {
          url: p.wordpress_url as string,
          title: p.title as string,
          postId: p.id as string,
          wpPostId: p.wordpress_post_id as number | undefined,
          indexed: idx?.indexed ?? null,
          coverage: idx?.coverage ?? null,
          // Body-image diagnostic — null = generation hasn't completed yet
          // (or wasn't requested), 0 = ran but produced nothing (real failure
          // worth chasing), >0 = that many in-body images were inserted.
          // Lets the GenerateButton render a small badge so the user can see
          // at a glance whether their "Include photos" tick actually produced
          // images, instead of needing to open the post.
          bodyImagesCount: (p.body_images_count as number | null | undefined) ?? null,
          // Schedule fields (migration 104) — null unless the post was
          // queued via /api/blog/schedule-publish. The Library uses
          // them to render the "Scheduled · Sat Jun 6 at 10:20 AM" pill
          // and hide the Schedule/Publish-to-all buttons on rows that
          // are already queued.
          scheduledFor: (p.scheduled_for as string | null | undefined) ?? null,
          scheduleMode: (p.schedule_mode as string | null | undefined) ?? null,
          // Real publish timestamp — used by the Recent section sort so
          // newest-published lands first. Falls back to created_at for
          // pre-2026-06 posts where published_at was never written.
          publishedAt: (p.published_at as string | null | undefined) ?? (p.created_at as string | null | undefined) ?? null,
          facebookPostId: p.facebook_post_id as string | undefined,
          pinterestPinId: p.pinterest_pin_id as string | undefined,
          threadsPostId: p.threads_post_id as string | undefined,
          linkedInPostId: p.linkedin_post_id as string | undefined,
          twitterPostId: p.twitter_post_id as string | undefined,
          blueskyPostUri: p.bluesky_post_uri as string | undefined,
          telegramMessageId: p.telegram_message_id as string | undefined,
          instagramReelId: p.instagram_reel_id as string | undefined,
          instagramStoryId: p.instagram_story_id as string | undefined,
        }
      }
    }
    setPosts(postMap)

    // ── Failed-schedule map (2026-06-07) ──────────────────────────────
    // Pull every social-cascade row from scheduled_posts and find the
    // MOST RECENT attempt per (blog_post_id, platform). If the most
    // recent is 'failed', the row's social pill gets a ⚠ in the UI.
    // A later successful retry on the same channel clears it. Limited
    // to last 30 days so the query stays cheap as history grows.
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: schedRows } = await (sb as any)
        .from('scheduled_posts')
        .select('blog_post_id,platform,status,updated_at')
        .eq('user_id', user.id)
        .gte('updated_at', thirtyDaysAgo)
        .order('updated_at', { ascending: false })
        .limit(500)
      // Dedup: keep only the FIRST row per (blog_post_id, platform) —
      // that's the most recent attempt thanks to the order desc.
      const seen = new Set<string>()
      const failedMap: Record<string, Set<string>> = {}
      for (const r of ((schedRows ?? []) as Array<{ blog_post_id: string; platform: string | null; status: string }>)) {
        if (!r.blog_post_id || !r.platform) continue
        const key = `${r.blog_post_id}|${r.platform}`
        if (seen.has(key)) continue
        seen.add(key)
        if (r.status === 'failed') {
          if (!failedMap[r.blog_post_id]) failedMap[r.blog_post_id] = new Set()
          failedMap[r.blog_post_id].add(r.platform)
        }
      }
      setFailedSchedules(failedMap)
    } catch (e) {
      console.warn('[library] failed-schedule lookup failed (non-fatal)', e instanceof Error ? e.message : String(e))
    }

    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // Load the active tab's data on ANY activation — the tab's onClick, the
  // sidebar "Social Push" deep-link (?tab=posts), or a restored ?tab=. The
  // loaders were previously wired ONLY to the tab onClick, so a programmatic
  // tab switch opened the tab but never fetched (showed "No posts live yet").
  useEffect(() => {
    if (activeTab === 'posts' && !postsLoaded && !postsLoading) loadWpPosts()
    if (activeTab === 'scheduled' && scheduledItems === null && !scheduledLoading) loadScheduled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // ── Active-tab-aware refresh + auto-refresh on visibility ────────────────
  // Why both: each tab loads from a different source. `load()` reloads
  // videos from Supabase; `loadWpPosts()` reloads published posts from
  // WordPress; `loadScheduled()` reloads scheduled items. The Refresh
  // button used to only call `load()`, so clicking it while on the Posts
  // tab silently did nothing visible — 151 posts in, 151 posts out. Now
  // it fans out per active tab so the visible data actually updates.
  //
  // Auto-refresh on visibilitychange (debounced 30s) covers the common
  // "I left this tab open, scheduled a post elsewhere, came back" case
  // without burning the API on every quick alt-tab.
  const refreshActiveTabRef = useRef<() => void>(() => {})
  const lastAutoRefreshRef = useRef<number>(0)
  refreshActiveTabRef.current = () => {
    load() // always reload underlying videos — drives the Horizontal/Vertical tabs
    if (activeTab === 'posts' && !postsLoading) loadWpPosts()
    if (activeTab === 'scheduled' && !scheduledLoading) loadScheduled()
  }
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastAutoRefreshRef.current < 30_000) return // 30s throttle
      lastAutoRefreshRef.current = now
      refreshActiveTabRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Listen for "mvp-schedule-applied" — emitted by ScheduleModal after a
  // successful schedule. Merges the schedule fields into the parent's
  // posts state so the Library row's "Scheduled · X" badge appears
  // immediately, no refresh required. The schedule-publish route already
  // wrote the blog_posts row; this is purely a UI-state sync so the
  // user sees the result without paying for a full load() reload.
  useEffect(() => {
    function onScheduleApplied(e: Event) {
      const detail = (e as CustomEvent<{ videoId: string; scheduledFor: string; scheduleMode: string }>).detail
      if (!detail?.videoId || !detail.scheduledFor) return
      setPosts((prev) => {
        const existing = prev[detail.videoId]
        // If the row hadn't been loaded yet (e.g. user generated +
        // scheduled before load() finished), seed a minimal entry so
        // the row knows it's scheduled. load() will overwrite with the
        // full shape on the next refresh.
        const next = existing ?? { url: '', title: '' }
        return {
          ...prev,
          [detail.videoId]: {
            ...next,
            scheduledFor: detail.scheduledFor,
            scheduleMode: detail.scheduleMode,
          },
        }
      })
    }
    window.addEventListener('mvp-schedule-applied', onScheduleApplied)
    return () => window.removeEventListener('mvp-schedule-applied', onScheduleApplied)
  }, [])

  async function handlePublishPin(description: string, title: string): Promise<{ ok: boolean; error?: string }> {
    if (!pinPreview) return { ok: false, error: 'No pin to publish' }
    setPinPublishingFor(pinPreview.postId)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 70_000)
    try {
      const res = await fetch('/api/blog/pinterest-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: pinPreview.postId,
          postUrl: pinPreview.postUrl,
          title,
          description,
          imageBase64: pinPreview.imageBase64,
          mediaType: pinPreview.mediaType,
          fallbackImageUrl: pinPreview.fallbackImageUrl,
        }),
        signal: ctrl.signal,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: d.error || `Pinterest rejected the pin (${res.status})` }
      setPosts((prev) => {
        const next = { ...prev }
        for (const vid in next) {
          if (next[vid].postId === pinPreview.postId) {
            next[vid] = { ...next[vid], pinterestPinId: d.pinId }
          }
        }
        return next
      })
      // Mark this row pinned so the OrphanPostShare Pinterest pill flips to
      // "Pinned" (video-less rows publish at the page level, so they otherwise
      // never learn the pin succeeded).
      setPinnedPostIds(prev => new Set(prev).add(pinPreview.postId))
      setPinPreview(null)
      return { ok: true }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      return { ok: false, error: aborted ? 'Timed out talking to Pinterest. Try again.' : (e instanceof Error ? e.message : 'Publish failed') }
    } finally {
      clearTimeout(timer)
      setPinPublishingFor(null)
    }
  }

  /** Load the user's scheduled posts list. Called when they open the Scheduled tab. */
  async function loadScheduled() {
    setScheduledLoading(true)
    setScheduledError(null)
    try {
      const res = await fetch('/api/blog/scheduled-list')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load scheduled posts')
      setScheduledItems((data.scheduled ?? []) as ScheduledItem[])
    } catch (err) {
      setScheduledError(err instanceof Error ? err.message : 'Failed to load scheduled posts')
    } finally {
      setScheduledLoading(false)
    }
  }

  /** Cancel a pending scheduled post. */
  async function cancelScheduled(id: string) {
    if (!(await confirm({
      title: 'Cancel this scheduled post?',
      description: 'It won\'t publish. You can reschedule it from the post list afterwards.',
      confirmLabel: 'Cancel post',
      destructive: true,
    }))) return
    try {
      const res = await fetch('/api/blog/scheduled-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Cancel failed')
      // Reflect locally — flip status to cancelled
      setScheduledItems(items => items?.map(i => i.id === id ? { ...i, status: 'cancelled' as const } : i) ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  async function loadWpPosts() {
    setPostsLoading(true)
    try {
      // Fetch WP posts + Supabase video_id map in parallel
      const [res, { data: { user } }] = await Promise.all([
        fetch('/api/wordpress/posts'),
        supabase.auth.getUser(),
      ])
      const data = await res.json()
      if (!res.ok || data.error) {
        setFixCatResult(`Failed to load posts: ${data.error || res.status}`)
        setPostsLoaded(true)
        return
      }

      // Map each WP post → its owning blog_posts row (UUID + videoId + rewrite
      // count). Fetch ALL the user's rows (tiny projection) so we can match by
      // wordpress_url too — the URL survives a rebuild that mints a NEW WP post
      // id, whereas a stale wordpress_post_id would orphan the row. The UUID
      // (`mvpId`) lets social pushes target the blog_posts row directly instead
      // of relying on the WP id alone (the "Post not found" cause on video-less
      // guide/comparison/link posts).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // Also pull the per-platform "posted" markers so video-less rows
      // (OrphanPostShare) can show their pills as already-published on load,
      // not just within the publishing session.
      const { data: sbPosts } = await supabase
        .from('blog_posts')
        .select('id,wordpress_post_id,wordpress_url,video_id,rewrite_count,facebook_post_id,threads_post_id,linkedin_post_id,twitter_post_id,bluesky_post_uri,telegram_message_id,pinterest_pin_id')
        .eq('user_id', user?.id ?? '')

      const sbMap: Record<number, string> = {}
      const rewriteMap: Record<number, number> = {}
      const idByWpId: Record<number, string> = {}
      const idByUrl: Record<string, string> = {}
      // Persisted posted-platform list + pinned flag, keyed by WP id and by URL.
      type SbRow = { id: string; wordpress_post_id: number | null; wordpress_url: string | null; video_id: string | null; rewrite_count: number | null; facebook_post_id?: string | null; threads_post_id?: string | null; linkedin_post_id?: string | null; twitter_post_id?: string | null; bluesky_post_uri?: string | null; telegram_message_id?: string | null; pinterest_pin_id?: string | null }
      const postedFor = (p: SbRow): string[] => {
        const s: string[] = []
        if (p.facebook_post_id) s.push('facebook')
        if (p.threads_post_id) s.push('threads')
        if (p.linkedin_post_id) s.push('linkedin')
        if (p.twitter_post_id) s.push('twitter')
        if (p.bluesky_post_uri) s.push('bluesky')
        if (p.telegram_message_id) s.push('telegram')
        return s
      }
      const postedByWpId: Record<number, string[]> = {}
      const postedByUrl: Record<string, string[]> = {}
      const pinnedByWpId: Record<number, boolean> = {}
      const pinnedByUrl: Record<string, boolean> = {}
      const normUrl = (u: string | null | undefined) => (u || '').replace(/\/+$/, '').toLowerCase()
      for (const p of (sbPosts ?? []) as SbRow[]) {
        if (p.wordpress_post_id && p.video_id) sbMap[p.wordpress_post_id] = p.video_id
        if (p.wordpress_post_id) {
          rewriteMap[p.wordpress_post_id] = (p.rewrite_count as number) ?? 0
          if (p.id) idByWpId[p.wordpress_post_id] = p.id
          postedByWpId[p.wordpress_post_id] = postedFor(p)
          pinnedByWpId[p.wordpress_post_id] = !!p.pinterest_pin_id
        }
        if (p.id && p.wordpress_url) {
          const key = normUrl(p.wordpress_url)
          idByUrl[key] = p.id
          postedByUrl[key] = postedFor(p)
          pinnedByUrl[key] = !!p.pinterest_pin_id
        }
      }

      // Merge: prefer Supabase map, fall back to WP API result. rewriteCount
      // powers the "X of 3 rebuilds" counter; mvpId is the blog_posts UUID
      // (by WP id, else by URL) used for social pushes.
      const merged = (data.posts ?? []).map((p: { id: number; videoId: string | null; link?: string }) => {
        const urlKey = normUrl(p.link)
        return {
          ...p,
          videoId: sbMap[p.id] ?? p.videoId ?? null,
          rewriteCount: rewriteMap[p.id] ?? 0,
          mvpId: idByWpId[p.id] ?? idByUrl[urlKey] ?? null,
          // Persisted social state for the OrphanPostShare pills.
          posted: postedByWpId[p.id] ?? postedByUrl[urlKey] ?? [],
          pinnedPersisted: pinnedByWpId[p.id] ?? pinnedByUrl[urlKey] ?? false,
        }
      })

      setAllBlogPosts(merged)
      setPostsLoaded(true)
    } catch (e) {
      setFixCatResult(`Failed to load posts: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPostsLoading(false)
    }
  }

  async function rewritePost(wpPostId: number, videoId: string, rewriteFeedback?: string) {
    setRewritingPostId(wpPostId)
    try {
      const res = await generateBlogRequest({
        videoId,
        ...(rewriteFeedback?.trim() ? { rewriteFeedback: rewriteFeedback.trim() } : {}),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(data.error || 'Rewrite limit reached.', {
            cap: data.cap || 'rewrites',
            currentTier: data.currentTier,
            upgrade: data.upgrade,
          })
        } else {
          setFixCatResult(`Rewrite failed: ${data.error || res.status}`)
        }
      } else {
        setFixCatResult(`Rewritten: "${data.title}"`)
        setAllBlogPosts(prev => prev.map(p =>
          p.id === wpPostId ? { ...p, title: data.title, link: data.wordpressUrl ?? p.link } : p
        ))
      }
    } catch {
      setFixCatResult('Rewrite failed.')
    } finally {
      setRewritingPostId(null)
    }
  }

  // Re-run JUST the image step on a published post (for posts that shipped
  // text-only). Grabs real HD frames via the extension when available, else
  // falls back to the product photo, server-side.
  async function refreshImages(wpPostId: number, ytVideoId: string | null) {
    setRefreshingImagesId(wpPostId)
    setImgToast(null)
    try {
      // Frame capture used to live here too — same story as Generate:
      // the route now pulls storyboard frames server-side, no extension /
      // background tab needed.
      void ytVideoId
      const res = await fetch('/api/blog/refresh-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordpressPostId: wpPostId }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      setImgToast(res.ok ? `Added ${data.count} image${data.count === 1 ? '' : 's'} — refresh the post to see them.` : (data.error || 'Image refresh failed'))
      // 2026-06-08: bump the local bodyImagesCount so the orange "needs images"
      // warning badge disappears without a full page reload. Same fix pattern
      // as the Co-Pilot auto-refresh (commit cd57807) — DB write success
      // should be reflected in the UI without a manual refresh.
      if (res.ok && typeof data.count === 'number') {
        setPosts(prev => {
          const next = { ...prev }
          for (const [vid, p] of Object.entries(next)) {
            if (p.wpPostId === wpPostId) {
              next[vid] = { ...p, bodyImagesCount: data.count }
              break
            }
          }
          return next
        })
      }
    } catch (e) {
      setImgToast(e instanceof Error ? e.message : 'Image refresh failed')
    } finally {
      setRefreshingImagesId(null)
    }
  }

  async function deletePostFromList(wpPostId: number) {
    if (!(await confirm({
      title: 'Delete this post from WordPress?',
      description: 'The post will be removed from your blog and unlinked here. WordPress moves it to its trash where you can restore for ~30 days.',
      confirmLabel: 'Delete post',
      destructive: true,
    }))) return
    setDeletingPostId(wpPostId)
    try {
      await fetch('/api/blog/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpPostId }),
      })
      setAllBlogPosts(prev => prev.filter(p => p.id !== wpPostId))
    } finally {
      setDeletingPostId(null)
    }
  }

  async function bulkDeleteSelected() {
    if (selectedPostIds.size === 0) return
    if (!(await confirm({
      title: `Delete ${selectedPostIds.size} post${selectedPostIds.size !== 1 ? 's' : ''}?`,
      description: 'These posts will be moved to WordPress\' trash (restorable for ~30 days) and unlinked here. This cannot be undone from MVP.',
      confirmLabel: 'Delete posts',
      destructive: true,
    }))) return
    setBulkDeleting(true)
    const ids = [...selectedPostIds]
    let deleted = 0
    for (const wpPostId of ids) {
      try {
        await fetch('/api/blog/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpPostId }),
        })
        setAllBlogPosts(prev => prev.filter(p => p.id !== wpPostId))
        deleted++
      } catch { /* continue */ }
    }
    setSelectedPostIds(new Set())
    setFixCatResult(`Deleted ${deleted} post${deleted !== 1 ? 's' : ''}.`)
    setBulkDeleting(false)
  }

  async function bulkRewriteSelected() {
    const toRewrite = allBlogPosts.filter(p => selectedPostIds.has(p.id) && p.videoId)
    const skipped = selectedPostIds.size - toRewrite.length
    if (toRewrite.length === 0) {
      setFixCatResult('No selected posts have a linked video — cannot rewrite.')
      return
    }
    setBulkRewriting(true)
    setBulkRewriteProgress({ done: 0, total: toRewrite.length })
    let success = 0
    let failed = 0
    let firstError = ''
    for (let i = 0; i < toRewrite.length; i++) {
      const post = toRewrite[i]
      setBulkRewriteProgress({ done: i, total: toRewrite.length })
      try {
        const res = await generateBlogRequest({ videoId: post.videoId })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setAllBlogPosts(prev => prev.map(p =>
            p.id === post.id ? { ...p, title: data.title, link: data.wordpressUrl ?? p.link } : p
          ))
          success++
        } else {
          failed++
          if (!firstError) firstError = data.error || `HTTP ${res.status}`
        }
      } catch (e) {
        failed++
        if (!firstError) firstError = e instanceof Error ? e.message : 'Network error'
      }
    }
    setBulkRewriteProgress(null)
    setBulkRewriting(false)
    setSelectedPostIds(new Set())
    const parts = [`${success} rewritten`]
    if (failed > 0) parts.push(`${failed} failed${firstError ? ` (${firstError})` : ''}`)
    if (skipped > 0) parts.push(`${skipped} skipped (no video link)`)
    setFixCatResult(parts.join(' · '))
  }

  function toggleVideoSelect(id: string) {
    setSelectedVideoIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function bulkGenerateSelected() {
    const toGenerate = visibleVideos.filter(v =>
      selectedVideoIds.has(v.id as string) && !posts[v.id as string]
    )
    if (!toGenerate.length) return
    setBulkGenerating(true)
    setBulkGenerateProgress({ done: 0, total: toGenerate.length })
    let success = 0; let failed = 0; let skipped = 0; let firstError = ''
    for (let i = 0; i < toGenerate.length; i++) {
      const video = toGenerate[i]
      setBulkGenerateProgress({ done: i, total: toGenerate.length })
      try {
        const res = await generateBlogRequest({ videoId: video.id })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setPosts(prev => ({ ...prev, [video.id as string]: { url: data.wordpressUrl ?? '', title: data.title ?? '', postId: data.postId } }))
          success++
        } else if (
          // Review-worthiness gate: short clip, no product, thin transcript.
          // In bulk this is a SKIP, not a failure — these are exactly the
          // videos that used to flood the blog with contentless posts.
          data.reason === 'not_reviewable'
          || /short clip with no product attached/i.test(String(data.error || ''))
        ) {
          skipped++
        } else {
          failed++
          if (!firstError) firstError = data.error || `HTTP ${res.status}`
        }
      } catch (e) {
        failed++
        if (!firstError) firstError = e instanceof Error ? e.message : 'Network error'
      }
    }
    setBulkGenerateProgress(null)
    setBulkGenerating(false)
    setSelectedVideoIds(new Set())
    if (failed > 0 || skipped > 0) {
      const parts = [`${success} generated`]
      if (skipped > 0) parts.push(`${skipped} skipped (short clips with no product — add the product link to the video description to include them)`)
      if (failed > 0) parts.push(`${failed} failed${firstError ? ` (${firstError})` : ''}`)
      setFixCatResult(parts.join(' · '))
    }
  }

  /**
   * Bulk Set Category — applies the same category to every selected video.
   * For videos that already have a published post, the change pushes to
   * WordPress via /api/blog/update-category (same as the per-card picker).
   */
  async function bulkSetCategory(category: string) {
    const ids = visibleVideos.filter(v => selectedVideoIds.has(v.id as string)).map(v => v.id as string)
    if (!ids.length) return
    setBulkCategoryApplying(true)
    setBulkCategoryProgress({ done: 0, total: ids.length })
    let success = 0; let failed = 0; let firstError = ''
    for (let i = 0; i < ids.length; i++) {
      setBulkCategoryProgress({ done: i, total: ids.length })
      try {
        const res = await fetch('/api/blog/update-category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: ids[i], category }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) success++
        else { failed++; if (!firstError) firstError = data.error || `HTTP ${res.status}` }
      } catch (e) {
        failed++
        if (!firstError) firstError = e instanceof Error ? e.message : 'Network error'
      }
    }
    setBulkCategoryProgress(null)
    setBulkCategoryApplying(false)
    setBulkCategoryOpen(false)
    setFixCatResult(`Category "${category}" applied to ${success}${failed > 0 ? ` · ${failed} failed${firstError ? ` (${firstError})` : ''}` : ''}`)
    // Refresh video rows so the picker shows the new category
    await load()
  }

  async function backfillVideoLinks() {
    setBackfilling(true)
    setFixCatResult(null)
    try {
      const res = await fetch('/api/blog/backfill-video-links', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setFixCatResult(`Backfill failed: ${data.error}`); return }
      if (data.linked === 0) {
        setFixCatResult(data.message || 'All posts already have video links.')
      } else {
        setFixCatResult(`Linked ${data.linked} posts to videos (${data.skipped} couldn't be matched). Reload to see Rewrite buttons.`)
        // Reload posts so videoIds populate
        setPostsLoaded(false)
        await loadWpPosts()
      }
    } catch { setFixCatResult('Backfill failed.') }
    finally { setBackfilling(false) }
  }

  function toggleSelect(id: number) {
    setSelectedPostIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function syncVideos(channelId?: string) {
    setSyncing(true)
    setSyncProgress({ pulled: 0, pages: 0 })
    try {
      // Loop through every page of the channel feed so large channels
      // (1,000+ videos) come down in one click instead of needing the
      // user to click "Load more" 20 times. Hard cap at 100 pages
      // (~5,000 videos) as a safety belt.
      let token: string | null = null
      let pulled = 0
      let pages = 0
      do {
        const res: Response = await fetch('/api/youtube/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(token ? { pageToken: token } : {}), ...(channelId ? { channelId } : {}) }),
        })
        const data: { synced?: number; nextPageToken?: string | null; error?: string; code?: string } =
          await res.json().catch(() => ({}))
        if (data.error) {
          // Throw with the code so the outer catch can branch on it for a
          // useful toast action (e.g. "Open Setup" when channel id is
          // missing).
          const err = new Error(data.error) as Error & { code?: string }
          err.code = data.code
          throw err
        }
        pulled += Number(data.synced || 0)
        pages += 1
        setSyncProgress({ pulled, pages })
        token = data.nextPageToken ?? null
      } while (token && pages < 100)
      setNextPageToken(null)
      await load()
      // Success toast — without this the user has no way to know the sync
      // worked, especially if it pulled 0 new videos (e.g. nothing new on
      // the channel since the last sync).
      if (pulled === 0) {
        toast.success('Synced. No new videos on your channel since last time.')
      } else {
        toast.success(`Synced ${pulled} video${pulled === 1 ? '' : 's'} from YouTube.`)
      }
    } catch (err: unknown) {
      // Previously this catch was empty and swallowed every error — users
      // hit "Sync videos", nothing happened, no toast, and they couldn't
      // tell whether their channel id was missing, the API key was bad, or
      // the network blipped. Now every failure surfaces with a useful
      // action where applicable.
      const e = err as Error & { code?: string }
      const msg = e?.message || 'Sync failed. Try again in a moment.'
      if (e?.code === 'no_channel_id') {
        toast.error(msg, {
          action: { label: 'Connect YouTube', onClick: () => { window.location.href = '/connect-youtube' } },
        })
      } else if (e?.code === 'youtube_quota') {
        toast.error('YouTube API daily quota hit. Try again after midnight Pacific time.')
      } else if (e?.code === 'channel_not_found') {
        toast.error('YouTube channel not found. Reconnect your channel under Set Up → YouTube.', {
          action: { label: 'Fix it', onClick: () => { window.location.href = '/connect-youtube' } },
        })
      } else {
        toast.error(msg)
      }
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  /**
   * Step 1 of the recategorize flow — runs the bulk-categorize endpoint
   * in dryRun mode and surfaces the proposed mapping in a modal. Nothing
   * is written to WP yet.
   */
  async function previewFixCategories() {
    setCatPreviewLoading(true)
    setFixCatResult(null)
    try {
      const res = await fetch('/api/blog/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const data = await res.json()
      if (data.error) {
        setFixCatResult(`Error: ${data.error}`)
      } else if (!Array.isArray(data.preview) || data.preview.length === 0) {
        setFixCatResult(data.message || 'All posts already have a real niche category.')
      } else {
        setCatPreview(data.preview as { title: string; category: string }[])
      }
    } catch {
      setFixCatResult('Something went wrong.')
    } finally {
      setCatPreviewLoading(false)
    }
  }

  /**
   * Step 2 — the user has reviewed the preview and clicked Apply.
   * This time we hit the endpoint without dryRun so WP gets updated.
   */
  async function applyFixCategories() {
    setCatApplying(true)
    setFixingCategories(true)
    try {
      const res = await fetch('/api/blog/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.error) {
        setFixCatResult(`Error: ${data.error}`)
      } else if (data.fixed === 0) {
        setFixCatResult(data.message || 'All posts already had categories.')
      } else {
        const partial = data.partial ? ` — ${data.partial}` : ''
        setFixCatResult(`Done — ${data.fixed} post${data.fixed !== 1 ? 's' : ''} re-categorized (${data.skipped} were already fine)${partial}.`)
      }
    } catch {
      setFixCatResult('Something went wrong.')
    } finally {
      setCatApplying(false)
      setFixingCategories(false)
      setCatPreview(null)
    }
  }

  /**
   * Step 1 of affiliate-link repair — dryRun finds posts whose buy link is
   * broken (e.g. a title word was mistaken for an ASIN → dead Amazon page)
   * and surfaces old→new in a modal. Nothing is written yet.
   */
  // Track which mode triggered the preview so the apply step + UI copy
  // can show the right wording ("Fix" vs "Re-route to per-site groups").
  // 2026-06-09 — added when the regroup mode landed on the route.
  const [affMode, setAffMode] = useState<'broken' | 'regroup'>('broken')
  async function previewFixAffiliate(mode: 'broken' | 'regroup' = 'broken') {
    setAffMode(mode)
    setAffPreviewLoading(true)
    setFixCatResult(null)
    try {
      const res = await fetch('/api/blog/fix-affiliate-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, mode }),
      })
      const data = await res.json()
      if (data.error) {
        setFixCatResult(`Error: ${data.error}`)
      } else if (!Array.isArray(data.preview) || data.preview.length === 0) {
        const tail = data.unresolved ? ` (${data.unresolved} couldn't be auto-resolved — check those manually).` : ''
        setFixCatResult(`No broken affiliate links found across ${data.total ?? 0} posts.${tail}`)
      } else {
        const rows = data.preview as { postId: string; title: string; oldUrl: string; newUrl: string }[]
        setAffPreview(rows)
        setAffSelected(new Set(rows.map(r => r.postId))) // default: all checked
      }
    } catch {
      setFixCatResult('Something went wrong.')
    } finally {
      setAffPreviewLoading(false)
    }
  }

  /** Step 2 — apply ONLY the fixes the user kept checked. */
  async function applyFixAffiliate() {
    if (!affPreview) return
    const fixes = affPreview
      .filter(r => affSelected.has(r.postId))
      .map(({ postId, oldUrl, newUrl }) => ({ postId, oldUrl, newUrl }))
    if (fixes.length === 0) return
    setAffApplying(true)
    try {
      const res = await fetch('/api/blog/fix-affiliate-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixes, mode: affMode }),
      })
      const data = await res.json()
      if (data.error) {
        setFixCatResult(`Error: ${data.error}`)
      } else if (data.fixed === 0) {
        setFixCatResult('No affiliate links needed fixing.')
      } else {
        const failed = Array.isArray(data.errors) && data.errors.length ? ` — ${data.errors.length} failed` : ''
        setFixCatResult(`Done — fixed the affiliate link on ${data.fixed} post${data.fixed !== 1 ? 's' : ''}${failed}.`)
      }
    } catch {
      setFixCatResult('Something went wrong.')
    } finally {
      setAffApplying(false)
      setAffPreview(null)
    }
  }

  async function loadMore() {
    if (!nextPageToken) return
    setLoadingMore(true)
    try {
      const res = await fetch('/api/youtube/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageToken: nextPageToken }),
      })
      const data = await res.json().catch(() => ({}))
      setNextPageToken(data.nextPageToken ?? null)
      await load()
    } catch { /* non-fatal */ } finally {
      setLoadingMore(false)
    }
  }

  function dismissVideo(videoId: string) {
    const next = new Set(dismissed)
    next.add(videoId)
    setDismissed(next)
    saveDismissed(next)
  }

  function unhideAllVideos() {
    setDismissed(new Set())
    saveDismissed(new Set())
    setShowHidden(false)
  }

  const allReady = checks?.brandReady && checks?.wpReady
  // When "Show hidden" is on, include dismissed videos so they can be found
  // and brought back; otherwise hide them as before.
  // Memoised so the per-render filter/sort chain over up to ~2,500 videos only
  // recomputes when its real inputs change — not on every keystroke elsewhere.
  const visibleVideos = useMemo(
    () => videos.filter(v => showHidden || !dismissed.has(v.id as string)),
    [videos, showHidden, dismissed],
  )
  // Split videos by orientation. is_vertical comes from YouTube sync (duration
  // ≤ 180s OR #Shorts in title). For backwards-compat rows where is_vertical
  // is null, default to horizontal (the existing behavior pre-migration).
  const horizontalVideos = useMemo(() => visibleVideos.filter(v => v.is_vertical !== true), [visibleVideos])
  const verticalVideos = useMemo(() => visibleVideos.filter(v => v.is_vertical === true), [visibleVideos])
  // ── Kanban filters (2026-06-06 IA shift) ────────────────────────────────
  // The Library reads as a workflow now: a video lives in "Horizontal
  // Videos" / "Vertical Videos" until it gets touched (post generated or
  // social push succeeded), then graduates to "Posts". This way the TODO
  // tabs only show what's actually waiting on the user, and "Posts" is
  // the working surface for everything in flight or done.
  //   - Horizontal Videos = videos.is_vertical=false AND no blog post yet
  //   - Vertical Videos   = videos.is_vertical=true AND not yet pushed to
  //                         TikTok or Instagram (tiktok_posted_at +
  //                         instagram_posted_at both null)
  //   - Posts             = videos that DON'T match either filter above,
  //                         plus orphan blog posts (no source video)
  const horizontalTodo = useMemo(() => horizontalVideos.filter(v => !posts[v.id as string]), [horizontalVideos, posts])
  const verticalTodo = useMemo(() => verticalVideos.filter(v => !v.tiktok_posted_at && !v.instagram_posted_at), [verticalVideos])
  // Generated horizontal videos go in Posts. Touched verticals go in Posts.
  // Union for the Posts tab's rich VideoCard render.
  const horizontalDone = useMemo(() => horizontalVideos.filter(v => !!posts[v.id as string]), [horizontalVideos, posts])
  const verticalDone = useMemo(() => verticalVideos.filter(v => !!v.tiktok_posted_at || !!v.instagram_posted_at), [verticalVideos])
  // Which set the current tab shows. Vertical tab gets Shorts only.
  const currentTabVideos = activeTab === 'vertical' ? verticalTodo : horizontalTodo
  const generatedCount = Object.keys(posts).length

  // Unique channel list, derived from the current tab's videos — drives the
  // channel filter dropdown. Sorted alphabetically for stable UI.
  const tabChannels = useMemo(() => Array.from(new Set(
    currentTabVideos.map(v => (v.channel_title as string) || '').filter(Boolean)
  )).sort((a, b) => a.localeCompare(b)), [currentTabVideos])

  // Apply search + channel + generated filter, then sort. Pure derivation —
  // the underlying `videos` array is never mutated. Memoised over its inputs.
  const search = videoSearch.trim().toLowerCase()
  const displayVideos = useMemo(() => currentTabVideos
    .filter(v => {
      if (videoChannel && (v.channel_title as string) !== videoChannel) return false
      if (videoGenFilter !== 'all') {
        const has = !!posts[v.id as string]
        if (videoGenFilter === 'generated' && !has) return false
        if (videoGenFilter === 'ungenerated' && has) return false
      }
      if (search) {
        const hay = `${v.title || ''} ${v.channel_title || ''} ${v.description || ''}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })
    .sort((a, b) => {
      switch (videoSort) {
        case 'oldest':
          return new Date(a.published_at as string).getTime() - new Date(b.published_at as string).getTime()
        case 'views':
          return ((b.view_count as number) || 0) - ((a.view_count as number) || 0)
        case 'title':
          return ((a.title as string) || '').localeCompare((b.title as string) || '')
        case 'newest':
        default:
          return new Date(b.published_at as string).getTime() - new Date(a.published_at as string).getTime()
      }
    }), [currentTabVideos, videoChannel, videoGenFilter, posts, search, videoSort])
  const filtersActive = !!(search || videoChannel || videoGenFilter !== 'all' || videoSort !== 'newest')

  // Posts-tab search query (lowercased; HTML entities stripped at match time
  // for a forgiving title match). Drives the single merged Published Posts
  // stream below.
  const postQuery = postSearch.trim().toLowerCase()
  const videoIdsInLibrary = useMemo(() => new Set(videos.map(v => v.id as string)), [videos])
  // "Orphans" = posts whose source video isn't in the current youtube_videos
  // list (comparisons, buying guides, link posts, older/deleted-video reviews).
  // These render as the lightweight card in the merged stream; library-video
  // posts render as the rich VideoCard. The split avoids double-listing a
  // single post. `filteredPosts` also backs the bulk-select toolbar (no-
  // thumbnail / select-all → delete / rewrite), which targets standalone posts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orphanPosts = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => allBlogPosts.filter((p: any) => !p.videoId || !videoIdsInLibrary.has(p.videoId)),
    [allBlogPosts, videoIdsInLibrary],
  )
  const filteredPosts = useMemo(() => postQuery
    ? orphanPosts.filter(p => (p.title || '').replace(/<[^>]+>/g, '').toLowerCase().includes(postQuery))
    : orphanPosts, [orphanPosts, postQuery])

  return (
    <>
      <PageHero
        title="Blog Post Generator"
        subtitle={
          loading ? 'Loading…' :
          activeTab === 'scheduled'
            ? `Queued posts that will fire automatically. The cron runs every minute, your computer can be off.`
            : activeTab === 'posts'
            ? `Everything live on your blog — reviews, comparisons, buying guides and link posts, from any source. Manage social fan-out from each card. ${allBlogPosts.length} post${allBlogPosts.length !== 1 ? 's' : ''} live.`
            : activeTab === 'vertical'
              ? `Shorts to Instagram Reels & Stories. Click the Instagram pill on a card to publish. ${verticalVideos.length} vertical video${verticalVideos.length !== 1 ? 's' : ''}.`
              : horizontalVideos.length > 0
                ? `Long-form videos to blog posts + Instagram image posts. Click Generate Post to start. ${horizontalVideos.length} video${horizontalVideos.length !== 1 ? 's' : ''} · ${generatedCount} published.`
                : 'Hit Sync to pull every YouTube video into your generation queue.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setFromLinkOpen(true)}
              leftIcon={<Sparkles size={14} />}
              title="No video? Create a post from a product link or ASIN — MVP researches, writes and publishes it."
            >
              New post from a link
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={previewFixCategories}
              loading={catPreviewLoading}
              disabled={catPreviewLoading || fixingCategories}
              title="Preview which category each post will be assigned to before applying"
            >
              {catPreviewLoading ? 'Loading preview…' : 'Fix Categories'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => previewFixAffiliate('broken')}
              loading={affPreviewLoading && affMode === 'broken'}
              disabled={affPreviewLoading || affApplying}
              title="Scan published posts for broken affiliate links and repair them"
            >
              {affPreviewLoading && affMode === 'broken' ? 'Scanning links…' : 'Fix Affiliate Links'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => previewFixAffiliate('regroup')}
              loading={affPreviewLoading && affMode === 'regroup'}
              disabled={affPreviewLoading || affApplying}
              title="Re-wrap every geni.us link in your published posts so it routes through the per-site Geniuslink group (e.g. gominreviews) instead of MVP-YOUTUBE. Use this once after the per-site group routing fix to clean up legacy links."
            >
              {affPreviewLoading && affMode === 'regroup' ? 'Scanning links…' : 'Re-route Geniuslinks'}
            </Button>
            {(activeTab === 'horizontal' || activeTab === 'vertical') && (
              <>
                {/* Pro multi-channel: pull videos from a specific connected
                    channel (e.g. a secondary channel) onto this blog. */}
                {ytChannels.length > 1 && (
                  <select
                    defaultValue=""
                    disabled={syncing}
                    onChange={(e) => { const id = e.target.value; if (id) { void syncVideos(id); e.currentTarget.value = '' } }}
                    title="Pull videos from one of your connected channels"
                    className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none max-w-[190px]"
                  >
                    <option value="">Sync a channel…</option>
                    {ytChannels.map(c => (
                      <option key={c.id} value={c.channelId}>{c.channelTitle}{c.isDefault ? ' (default)' : ''}</option>
                    ))}
                  </select>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => syncVideos()}
                  loading={syncing}
                  disabled={syncing}
                  leftIcon={!syncing ? <RefreshCw size={14} /> : undefined}
                >
                  {syncing ? `Syncing${syncProgress ? ` (${syncProgress.pulled})` : ''}…` : 'Sync videos'}
                </Button>
              </>
            )}
            {/* Refresh — re-runs the loader for whichever tab is active
                (videos, Posts, or Scheduled). 2026-06-09: was previously
                only reloading videos, which silently did nothing when the
                user was on the Posts/Scheduled tab. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => refreshActiveTabRef.current()}
              loading={loading || postsLoading || scheduledLoading}
              disabled={loading || postsLoading || scheduledLoading}
              leftIcon={!(loading || postsLoading || scheduledLoading) ? <RefreshCw size={14} /> : undefined}
              title="Reload the active tab from the database / WordPress"
            >
              {(loading || postsLoading || scheduledLoading) ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />

      <CapBannerHost />

      {/* From-link generator — create a post from a product link/ASIN (no video).
          On publish it refreshes whatever tab is active so the new post appears. */}
      {fromLinkOpen && (
        <FromLinkModal
          onClose={() => setFromLinkOpen(false)}
          onDone={() => {
            // Land the user on the Posts tab and reload so the freshly
            // published "from a link" post is immediately visible (it has no
            // source video, so it shows in the orphan / Older-posts list).
            setActiveTab('posts')
            loadWpPosts()
          }}
        />
      )}

      {/* Tab bar — split Videos into Horizontal (16:9 long-form, blog source)
          and Vertical (9:16 Shorts, Instagram source) since the workflows differ */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-white/10 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {([
          { key: 'horizontal' as const, label: 'Horizontal Videos' },
          { key: 'vertical' as const, label: 'Vertical Videos' },
          { key: 'posts' as const, label: `Published Posts & Social Push${postsLoaded ? ` (${allBlogPosts.length})` : ''}` },
          { key: 'scheduled' as const, label: `Scheduled${scheduledItems ? ` (${scheduledItems.filter(s => s.status === 'pending').length})` : ''}` },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key)
              // 2026-06-09: drop the "only on first click" gate. Each tab
              // click now re-fetches its data source so a user who, e.g.,
              // schedules a post in another tab and switches back sees the
              // updated count immediately. `postsLoading`/`scheduledLoading`
              // still prevent overlapping in-flight requests.
              if (key === 'posts' && !postsLoading) loadWpPosts()
              if (key === 'scheduled' && !scheduledLoading) loadScheduled()
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === key
                ? 'border-[#7C3AED] text-[#7C3AED]'
                : 'border-transparent text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {fixCatResult && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">
          <span>{fixCatResult}</span>
          <button onClick={() => setFixCatResult(null)} className="text-[#86868b] hover:text-[#1d1d1f]"><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : activeTab === 'scheduled' ? (
        <ScheduledList
          items={scheduledItems}
          loading={scheduledLoading}
          error={scheduledError}
          onRefresh={loadScheduled}
          onCancel={cancelScheduled}
        />
      ) : activeTab === 'posts' ? (
        <div className="flex flex-col gap-2">
          {imgToast && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#34c759]/30 bg-[#34c759]/5 px-3 py-2 text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">
              <span>{imgToast}</span>
              <button onClick={() => setImgToast(null)} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"><X size={13} /></button>
            </div>
          )}
          {/* Search — find older posts by title */}
          {!postsLoading && allBlogPosts.length > 0 && (
            <div className="relative max-w-md mb-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
              <input
                type="text"
                value={postSearch}
                onChange={e => setPostSearch(e.target.value)}
                placeholder={`Search ${allBlogPosts.length} posts by title…`}
                className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#7C3AED]"
              />
              {postSearch && (
                <button onClick={() => setPostSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#ff3b30]" title="Clear">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {/* Bulk action toolbar */}
          {!postsLoading && allBlogPosts.length > 0 && (
            <div className="flex items-center gap-3 pb-1 flex-wrap">
              <button
                onClick={backfillVideoLinks}
                disabled={backfilling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#34c759] text-white rounded-lg hover:bg-[#2db34a] disabled:opacity-60 transition-colors"
                title="Link old posts to their YouTube videos so Rewrite works"
              >
                {backfilling ? <><Loader2 size={11} className="animate-spin" /> Linking…</> : '⚡ Link missing videos'}
              </button>
              <button
                onClick={() => setSelectedPostIds(new Set(filteredPosts.filter(p => !p.thumbnail).map(p => p.id)))}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
              >
                Select no-thumbnail
              </button>
              <button
                onClick={() => setSelectedPostIds(new Set(filteredPosts.map(p => p.id)))}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
              >
                {postQuery ? `Select all ${filteredPosts.length} matching` : 'Select all'}
              </button>
              {selectedPostIds.size > 0 && (
                <>
                  <button
                    onClick={() => setSelectedPostIds(new Set())}
                    className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                  >
                    Clear ({selectedPostIds.size})
                  </button>
                  {/* Bulk Rewrite DISABLED 2026-06-12 (cost control — each rewrite
                      is a full Opus generation; a bulk click fires N at once).
                      Rewrite one post at a time. Flip BULK_GENERATION_ENABLED to restore. */}
                  {BULK_GENERATION_ENABLED && (userTier === 'pro' || userTier === 'admin') && (
                    <button
                      onClick={bulkRewriteSelected}
                      disabled={bulkRewriting || bulkDeleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#7C3AED] text-white rounded-lg hover:bg-[#7C3AED]/90 disabled:opacity-60 transition-colors"
                    >
                      {bulkRewriting
                        ? <><Loader2 size={11} className="animate-spin" /> Rewriting {bulkRewriteProgress?.done ?? 0}/{bulkRewriteProgress?.total ?? 0}…</>
                        : <><RefreshCw size={11} /> Rewrite {selectedPostIds.size} selected</>
                      }
                    </button>
                  )}
                  <button
                    onClick={bulkDeleteSelected}
                    disabled={bulkDeleting || bulkRewriting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-60 transition-colors"
                  >
                    {bulkDeleting ? <><Loader2 size={11} className="animate-spin" /> Deleting…</> : `Delete ${selectedPostIds.size} selected`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Published Posts — one chronological stream ───────────────
              Every post live on the blog, newest first, no split. A
              video-backed post (a library video with a generated/scheduled
              post, or a touched vertical) renders the rich VideoCard with full
              push / schedule / re-roll controls; everything else — comparisons,
              buying guides, link posts, and older/orphan reviews — renders the
              lightweight card with social fan-out. Merged + chronological
              2026-06-13 per user request: "if it's on the WordPress blog, it's
              in Published Posts."
          */}
          {(() => {
            if (postsLoading) {
              return (
                <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Loading posts from WordPress…
                </div>
              )
            }
            if (allBlogPosts.length === 0) {
              return (
                <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No posts live yet</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Everything you publish lands here — from a video (Videos tab → Generate), a comparison, a buying guide, or just a product link (New post from a link). The full post lands on your site in about 60 seconds.</p>
                </div>
              )
            }
            // Sort by BLOG PUBLISH date, newest first. Video-backed posts use
            // the post's publishedAt (falling back to social-push / video
            // dates); standalone posts use their WordPress date.
            const videoTs = (v: Record<string, unknown>): number => {
              const p = posts[v.id as string]
              if (p?.publishedAt) { const t = new Date(p.publishedAt).getTime(); if (!isNaN(t)) return t }
              const fb = (v.tiktok_posted_at as string) || (v.instagram_posted_at as string) || (v.published_at as string) || ''
              const t = new Date(fb || 0).getTime(); return isNaN(t) ? 0 : t
            }
            const postTs = (d: string | null): number => { const t = new Date(d || 0).getTime(); return isNaN(t) ? 0 : t }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type StreamItem = { kind: 'video'; ts: number; video: any } | { kind: 'post'; ts: number; post: any }
            const stream: StreamItem[] = [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...([...horizontalDone, ...verticalDone] as any[]).map((v): StreamItem => ({ kind: 'video', ts: videoTs(v), video: v })),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...(orphanPosts as any[]).map((p): StreamItem => ({ kind: 'post', ts: postTs(p.date), post: p })),
            ].sort((a, b) => b.ts - a.ts)
            const matched = postQuery
              ? stream.filter(it => it.kind === 'video'
                  ? (((it.video.title as string) || '').toLowerCase().includes(postQuery)
                      || ((posts[it.video.id as string]?.title) || '').toLowerCase().includes(postQuery)
                      || ((it.video.channel_title as string) || '').toLowerCase().includes(postQuery))
                  : ((it.post.title || '').replace(/<[^>]+>/g, '').toLowerCase().includes(postQuery)))
              : stream
            if (matched.length === 0) {
              return (
                <div className="card p-6 max-w-md flex flex-col items-center text-center gap-2">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">No posts match &ldquo;{postSearch}&rdquo;</p>
                  <button onClick={() => setPostSearch('')} className="text-xs text-[#7C3AED] hover:underline">Clear search</button>
                </div>
              )
            }
            const totalPages = Math.max(1, Math.ceil(matched.length / POSTS_PER_PAGE))
            const safePage = Math.min(recentPage, totalPages)
            const start = (safePage - 1) * POSTS_PER_PAGE
            const end = Math.min(start + POSTS_PER_PAGE, matched.length)
            const sliced = matched.slice(start, end)
            return (
              <div className="flex flex-col gap-3 mb-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {matched.length}{postQuery && matched.length !== stream.length ? ` of ${stream.length}` : ''} post{matched.length !== 1 ? 's' : ''}
                    {totalPages > 1 && (
                      <span className="ml-2 text-[11px] font-normal text-[#86868b] dark:text-[#8e8e93]">showing {start + 1}–{end}</span>
                    )}
                  </h3>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Newest first · everything live on your blog</p>
                </div>
                {sliced.map(it => {
                  if (it.kind === 'video') {
                    const video = it.video
                    return (
                  <VideoCard
                    key={video.id as string}
                    video={video}
                    post={posts[video.id as string] || null}
                    wpSiteUrl={wpSiteUrl}
                    fbConnected={fbConnected}
                    pinterestConnected={pinterestConnected}
                    threadsConnected={threadsConnected}
                    linkedInConnected={linkedInConnected}
                    twitterConnected={twitterConnected}
                    blueskyConnected={blueskyConnected}
                    telegramConnected={telegramConnected}
                    instagramConnected={instagramConnected}
                    tiktokConnected={tiktokConnected}
                    fbAccounts={fbAccounts}
                    igAccounts={igAccounts}
                    userTier={userTier}
                    brandNiches={brandNiches}
                    customCategories={customCategories}
                    brandDisclaimer={brandDisclaimer}
                    brandFacebookGroups={brandFacebookGroups}
                    failedSchedulePlatforms={posts[video.id as string]?.postId ? failedSchedules[posts[video.id as string]!.postId!] : undefined}
                    onCustomCategoryAdded={setCustomCategories}
                    onGenerated={(vid, url, title, postId) => setPosts((prev) => ({ ...prev, [vid]: { url, title, postId } }))}
                    onDismiss={() => dismissVideo(video.id as string)}
                    onDelete={(postId) => {
                      setPosts((prev) => {
                        const next = { ...prev }
                        const vid = video.id as string
                        if (next[vid]?.postId === postId) delete next[vid]
                        return next
                      })
                    }}
                    onPinPreview={setPinPreview}
                  />
                    )
                  }
                  const post = it.post
                  return (
            <div key={post.id} className={`card p-4 transition-colors ${selectedPostIds.has(post.id) ? 'ring-2 ring-[#7C3AED]/40 bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
              <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedPostIds.has(post.id)}
                onChange={() => toggleSelect(post.id)}
                className="flex-shrink-0 w-4 h-4 rounded accent-[#7C3AED] cursor-pointer"
              />
              <div className="w-24 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#2c2c2e]">
                {post.thumbnail
                  ? <img src={post.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                {/* SECURITY: render WP title as TEXT, not HTML. The WP REST
                    `title.rendered` field is raw HTML that came from another
                    WordPress install (Editor role, plugin, or compromised
                    site) — `dangerouslySetInnerHTML` here was a stored XSS
                    in the MVP origin. We decode HTML entities (so &amp; →
                    &) but never execute markup. Fixed 2026-06-06 audit. */}
                <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 leading-snug">
                  {(post.title || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '–').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'")}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    let slug = ''
                    try { slug = new URL(post.link).pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() || '' } catch { /* ignore */ }
                    const sc = slug ? seoScores[slug] : undefined
                    if (sc === undefined) return null
                    const col = sc >= 80 ? '#34c759' : sc >= 60 ? '#ff9500' : '#ff3b30'
                    return (
                      <Link href="/seo" title="Open the SEO hub" className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: col, background: `${col}1a` }}>
                        SEO {sc}
                      </Link>
                    )
                  })()}
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
                    {post.date ? new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Rewrite is Pro-only and one-shot per post. Hide for
                    everyone else — they manually edit in WordPress. */}
                {post.videoId && (userTier === 'pro' || userTier === 'admin') && (
                  <button
                    onClick={() => { setRewriteModalFeedback(''); setRewriteModal({ wpPostId: post.id, videoId: post.videoId!, used: post.rewriteCount ?? 0 }) }}
                    disabled={rewritingPostId === post.id}
                    className="text-xs text-[#86868b] hover:text-[#7C3AED] flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    {rewritingPostId === post.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {rewritingPostId === post.id ? 'Rewriting…' : 'Rewrite'}
                  </button>
                )}
                {post.link && (
                  <a href={post.link} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs flex items-center gap-1">
                    <ExternalLink size={11} /> View
                  </a>
                )}
                {/* Refresh images — re-runs the in-article image step. */}
                <button
                  onClick={() => refreshImages(post.id, post.videoId)}
                  disabled={refreshingImagesId === post.id}
                  className="text-xs text-[#86868b] hover:text-[#34c759] flex items-center gap-1 px-2 py-1 rounded hover:bg-green-50 transition-colors disabled:opacity-60"
                  title="Generate / refresh the photos inside this article"
                >
                  {refreshingImagesId === post.id ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                  {refreshingImagesId === post.id ? 'Adding…' : 'Images'}
                </button>
                <button
                  onClick={() => deletePostFromList(post.id)}
                  disabled={deletingPostId === post.id}
                  className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  {deletingPostId === post.id ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
                </button>
              </div>
              </div>
              {/* Manual edit — full-width block in the card column so the
                  editor stays contained (matches the video-card editor); inside
                  the right-aligned action row it overflowed the card. */}
              <ManualEdit postId={String(post.id)} />
              {/* Social fan-out — works for video-less ("from a link") posts
                  too, keyed on the WordPress post id. */}
              <OrphanPostShare
                postId={post.mvpId || String(post.id)}
                postUrl={post.link}
                postTitle={post.title}
                postImage={post.thumbnail}
                initialPosted={post.posted}
                pinned={pinnedPostIds.has(post.mvpId || String(post.id)) || !!post.pinnedPersisted}
                userTier={userTier}
                fbConnected={fbConnected}
                pinterestConnected={pinterestConnected}
                threadsConnected={threadsConnected}
                linkedInConnected={linkedInConnected}
                twitterConnected={twitterConnected}
                blueskyConnected={blueskyConnected}
                telegramConnected={telegramConnected}
                brandDisclaimer={brandDisclaimer}
                brandFacebookGroups={brandFacebookGroups}
                fbAccounts={fbAccounts}
                onPinPreview={setPinPreview}
              />
            </div>
                  )
                })}
                {totalPages > 1 && (
                  <Pagination
                    page={safePage}
                    totalPages={totalPages}
                    onChange={(p) => {
                      setRecentPage(p)
                      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                  />
                )}
              </div>
            )
          })()}
        </div>
      ) : !allReady ? (
        <SetupGate checks={checks!} />
      ) : visibleVideos.length === 0 && videos.length === 0 ? (
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Youtube size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">No videos synced yet</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">One click and we pull every public, unlisted, and draft video from your channel. ASIN-tagged videos become instant generation candidates.</p>
          </div>
          <button onClick={() => syncVideos()} disabled={syncing} className="btn-primary text-sm">
            {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing {syncProgress ? `(${syncProgress.pulled})` : ''}…</> : 'Sync now'}
          </button>
        </div>
      ) : currentTabVideos.length === 0 ? (
        <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {activeTab === 'vertical' ? 'No vertical videos found' : 'No horizontal videos found'}
          </p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] max-w-sm">
            {activeTab === 'vertical'
              ? 'No YouTube Shorts yet — these are the source for Instagram Reels & Stories. Record one on YouTube, hit Sync again, and it shows up here.'
              : 'All your synced videos look like Shorts. Hit Sync again to refresh, or open the Vertical Videos tab to publish them as Reels.'}
          </p>
          <button onClick={() => syncVideos()} disabled={syncing} className="btn-secondary text-xs">
            {syncing ? <><Loader2 size={11} className="animate-spin" /> Syncing {syncProgress ? `(${syncProgress.pulled})` : ''}…</> : <><RefreshCw size={11} /> Re-sync videos</>}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Filter + sort bar — operates on the active video tab */}
          <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e]">
            <input
              type="search"
              value={videoSearch}
              onChange={e => setVideoSearch(e.target.value)}
              placeholder="Search title, channel, description…"
              className="flex-1 min-w-[180px] text-xs px-3 py-1.5 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none"
            />
            {tabChannels.length > 1 && (
              <select
                value={videoChannel}
                onChange={e => setVideoChannel(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none max-w-[200px]"
                title="Filter by YouTube channel"
              >
                <option value="">All channels ({tabChannels.length})</option>
                {tabChannels.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select
              value={videoGenFilter}
              onChange={e => setVideoGenFilter(e.target.value as 'all' | 'ungenerated' | 'generated')}
              className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none"
              title="Filter by post status"
            >
              <option value="all">All status</option>
              <option value="ungenerated">Not yet posted</option>
              <option value="generated">Already posted</option>
            </select>
            <select
              value={videoSort}
              onChange={e => setVideoSort(e.target.value as 'newest' | 'oldest' | 'views' | 'title')}
              className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none"
              title="Sort videos"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="views">Most viewed</option>
              <option value="title">Title A–Z</option>
            </select>
            {filtersActive && (
              <button
                onClick={() => { setVideoSearch(''); setVideoChannel(''); setVideoGenFilter('all'); setVideoSort('newest') }}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline px-1"
              >
                Reset
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles size={14} className="text-[#7C3AED]" />
              <span className="text-[#6e6e73] dark:text-[#ebebf0]">
                {filtersActive
                  ? `Showing ${displayVideos.length} of ${currentTabVideos.length} videos`
                  : activeTab === 'vertical'
                    ? `${verticalVideos.length} vertical video${verticalVideos.length !== 1 ? 's' : ''} — source for Instagram Reels & Stories`
                    : `${generatedCount} of ${horizontalVideos.length} long-form videos published as blog posts (each can also become an Instagram image post)`}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {dismissed.size > 0 && (
                <>
                  <button
                    onClick={() => setShowHidden(s => !s)}
                    className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                    title="Reveal videos you've hidden with Dismiss"
                  >
                    {showHidden ? 'Hide hidden' : `Show hidden (${dismissed.size})`}
                  </button>
                  <button
                    onClick={unhideAllVideos}
                    className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                    title="Bring every hidden video back"
                  >
                    Unhide all
                  </button>
                </>
              )}
              {activeTab === 'horizontal' && selectedVideoIds.size === 0 && displayVideos.some(v => !posts[v.id as string]) && (
                <button
                  onClick={() => setSelectedVideoIds(new Set(displayVideos.filter(v => !posts[v.id as string]).map(v => v.id as string)))}
                  className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline"
                >
                  Select all ungenerated
                </button>
              )}
              {selectedVideoIds.size > 0 && (() => {
                // Partition selected videos by generated/ungenerated so the
                // action buttons can show the right counts and gate themselves
                // (e.g. Schedule only makes sense for videos with a post).
                const selectedVideosArr = visibleVideos.filter(v => selectedVideoIds.has(v.id as string))
                const ungenerated = selectedVideosArr.filter(v => !posts[v.id as string])
                const generated   = selectedVideosArr.filter(v =>  posts[v.id as string])
                const bulkBusy = bulkGenerating || bulkCategoryApplying
                return (
                  <>
                    <button
                      onClick={() => setSelectedVideoIds(new Set())}
                      disabled={bulkBusy}
                      className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] underline disabled:opacity-60"
                    >
                      Clear ({selectedVideoIds.size})
                    </button>
                    {/* Bulk generate + bulk schedule DISABLED 2026-06-12 (cost
                        control). One unattended "Generate N" / "Bulk schedule N"
                        click could fire dozens–hundreds of Opus generations — the
                        overnight-$60 spike. Generate one video at a time from its
                        card. Flip BULK_GENERATION_ENABLED to restore. */}
                    {BULK_GENERATION_ENABLED && ungenerated.length > 0 && (
                      <button
                        onClick={bulkGenerateSelected}
                        disabled={bulkBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#7C3AED] text-white rounded-lg hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
                      >
                        {bulkGenerating
                          ? <><Loader2 size={11} className="animate-spin" /> Generating {bulkGenerateProgress?.done ?? 0}/{bulkGenerateProgress?.total ?? 0}…</>
                          : <><Sparkles size={11} /> Generate {ungenerated.length} ungenerated</>
                        }
                      </button>
                    )}
                    {BULK_GENERATION_ENABLED && ungenerated.length > 0 && (
                      <button
                        onClick={() => setBulkScheduleVideosOpen(true)}
                        disabled={bulkBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#7C3AED]/40 text-[#7C3AED] rounded-lg hover:bg-[#7C3AED]/5 disabled:opacity-60 transition-colors"
                        title="Schedule generation + social cascade for each selected video at staggered times"
                      >
                        <Calendar size={11} /> Bulk schedule {ungenerated.length}
                      </button>
                    )}
                    {/* Set Category — works on all selected, generated or not.
                        Inline picker so it stays on-page (no modal needed). */}
                    <div className="relative">
                      <button
                        onClick={() => setBulkCategoryOpen(o => !o)}
                        disabled={bulkBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-lg hover:border-gray-300 disabled:opacity-60 transition-colors"
                      >
                        {bulkCategoryApplying
                          ? <><Loader2 size={11} className="animate-spin" /> Applying {bulkCategoryProgress?.done ?? 0}/{bulkCategoryProgress?.total ?? 0}…</>
                          : <>Set category…</>
                        }
                      </button>
                      {bulkCategoryOpen && !bulkCategoryApplying && (
                        <div className="absolute top-full mt-1 right-0 z-30 bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 rounded-lg shadow-xl max-h-[300px] overflow-y-auto w-56">
                          {brandNiches.length > 0 && (
                            <div className="border-b border-gray-100 dark:border-white/10 py-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] px-3 py-1.5">Your brand niches</p>
                              {brandNiches.map(c => (
                                <button key={c} onClick={() => bulkSetCategory(c)} className="block w-full text-left px-3 py-1.5 text-xs text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/5">{c}</button>
                              ))}
                            </div>
                          )}
                          {customCategories.length > 0 && (
                            <div className="border-b border-gray-100 dark:border-white/10 py-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] px-3 py-1.5">Custom</p>
                              {customCategories.map(c => (
                                <button key={c} onClick={() => bulkSetCategory(c)} className="block w-full text-left px-3 py-1.5 text-xs text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/5">{c}</button>
                              ))}
                            </div>
                          )}
                          <div className="py-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] px-3 py-1.5">Other</p>
                            {ALL_CATEGORIES.filter(c => !brandNiches.includes(c) && !customCategories.includes(c)).map(c => (
                              <button key={c} onClick={() => bulkSetCategory(c)} className="block w-full text-left px-3 py-1.5 text-xs text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/5">{c}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {generated.length > 0 && (
                      <button
                        onClick={() => setBulkScheduleOpen(true)}
                        disabled={bulkBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-lg hover:border-gray-300 disabled:opacity-60 transition-colors"
                      >
                        Schedule {generated.length}…
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
          {displayVideos.map((video) => {
            const isSelected = selectedVideoIds.has(video.id as string)
            return (
              <div key={video.id as string} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleVideoSelect(video.id as string)}
                  className="mt-5 flex-shrink-0 w-4 h-4 rounded accent-[#7C3AED] cursor-pointer"
                  title="Select for bulk actions"
                />
                <div className="flex-1 min-w-0">
                  <VideoCard
                    video={video}
                    post={posts[video.id as string] || null}
                    wpSiteUrl={wpSiteUrl}
                    fbConnected={fbConnected}
                    pinterestConnected={pinterestConnected}
                    threadsConnected={threadsConnected}
                    linkedInConnected={linkedInConnected}
                    twitterConnected={twitterConnected}
                    blueskyConnected={blueskyConnected}
                    telegramConnected={telegramConnected}
                    instagramConnected={instagramConnected}
                    tiktokConnected={tiktokConnected}
                    fbAccounts={fbAccounts}
                    igAccounts={igAccounts}
                    userTier={userTier}
                    brandNiches={brandNiches}
                    customCategories={customCategories}
                    brandDisclaimer={brandDisclaimer}
                    brandFacebookGroups={brandFacebookGroups}
                    failedSchedulePlatforms={posts[video.id as string]?.postId ? failedSchedules[posts[video.id as string]!.postId!] : undefined}
                    onCustomCategoryAdded={setCustomCategories}
                    onGenerated={(vid, url, title, postId) => setPosts((prev) => ({ ...prev, [vid]: { url, title, postId } }))}
                    onDismiss={() => dismissVideo(video.id as string)}
                    onDelete={(postId) => {
                      setPosts((prev) => {
                        const next = { ...prev }
                        const vid = video.id as string
                        if (next[vid]?.postId === postId) delete next[vid]
                        return next
                      })
                    }}
                    onPinPreview={setPinPreview}
                  />
                </div>
              </div>
            )
          })}
          {nextPageToken && (
            <button onClick={loadMore} disabled={loadingMore} className="btn-secondary text-sm self-center mt-2">
              {loadingMore ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : <><RefreshCw size={14} /> Load more videos</>}
            </button>
          )}
        </div>
      )}

      {/* Pinterest preview modal */}
      {pinPreview && (
        <PinterestPreviewModal
          data={pinPreview}
          onPublish={handlePublishPin}
          onClose={() => { if (!pinPublishingFor) setPinPreview(null) }}
        />
      )}

      {/* Recategorize preview modal — dryRun first, apply on confirm. */}
      {catPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !catApplying && setCatPreview(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/10">
              <div>
                <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Recategorize preview</h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  {catPreview.length} post{catPreview.length !== 1 ? 's' : ''} will be re-categorized. Nothing&apos;s saved yet.
                </p>
              </div>
              <button
                onClick={() => !catApplying && setCatPreview(null)}
                disabled={catApplying}
                className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              <ul className="flex flex-col gap-2">
                {catPreview.map((row, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                    <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex-1 line-clamp-2">{row.title}</p>
                    <span className="text-xs font-semibold text-[#7C3AED] whitespace-nowrap mt-0.5">→ {row.category}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
              <button
                onClick={() => !catApplying && setCatPreview(null)}
                disabled={catApplying}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={applyFixCategories}
                disabled={catApplying}
                className="btn-primary text-sm"
              >
                {catApplying
                  ? <><Loader2 size={14} className="animate-spin" /> Applying…</>
                  : `Apply to ${catPreview.length} post${catPreview.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Affiliate-link repair preview — dryRun first, apply on confirm. */}
      {affPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !affApplying && setAffPreview(null)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/10">
              <div>
                <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {affMode === 'regroup' ? 'Re-route Geniuslinks to per-site groups' : 'Fix affiliate links'}
                </h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  {affMode === 'regroup'
                    ? `${affPreview.length} post${affPreview.length !== 1 ? 's' : ''} carry a geni.us link that will be re-wrapped in the correct per-site group. Each link gets a NEW shortcode — the old one stays alive in your Geniuslink dashboard but is no longer in your post. Uncheck any you want to skip.`
                    : `${affPreview.length} post${affPreview.length !== 1 ? 's' : ''} have a broken buy link. Uncheck any you don't want to change — nothing's saved yet.`}
                </p>
              </div>
              <button
                onClick={() => !affApplying && setAffPreview(null)}
                disabled={affApplying}
                className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pt-3 flex items-center gap-3 text-xs">
              <button onClick={() => setAffSelected(new Set(affPreview.map(r => r.postId)))} className="text-[#7C3AED] hover:underline">Select all</button>
              <span className="text-[#d2d2d7] dark:text-white/15">·</span>
              <button onClick={() => setAffSelected(new Set())} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline">Select none</button>
              <span className="ml-auto text-[#86868b]">{affSelected.size} of {affPreview.length} selected</span>
            </div>

            <div className="overflow-y-auto flex-1 p-5 pt-3">
              <ul className="flex flex-col gap-2">
                {affPreview.map((row) => {
                  const checked = affSelected.has(row.postId)
                  return (
                    <li
                      key={row.postId}
                      onClick={() => setAffSelected(prev => { const n = new Set(prev); if (n.has(row.postId)) n.delete(row.postId); else n.add(row.postId); return n })}
                      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-[#f5f5f7] dark:bg-[#2c2c2e]' : 'bg-transparent border border-dashed border-gray-200 dark:border-white/10 opacity-60'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {}}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#7C3AED] cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] mb-1 line-clamp-2">{row.title}</p>
                        <p className="text-[11px] text-[#ff3b30] break-all font-mono">− {row.oldUrl}</p>
                        <p className="text-[11px] text-[#34c759] break-all font-mono">+ {row.newUrl}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 dark:border-white/10">
              <button
                onClick={() => !affApplying && setAffPreview(null)}
                disabled={affApplying}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={applyFixAffiliate}
                disabled={affApplying || affSelected.size === 0}
                className="btn-primary text-sm"
              >
                {affApplying
                  ? <><Loader2 size={14} className="animate-spin" /> Fixing…</>
                  : `Fix ${affSelected.size} link${affSelected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Schedule modal — only the videos that have a published post
          are passed in, because scheduling requires an existing blog_posts.id. */}
      {/* Bulk schedule UN-GENERATED videos — full generate + cascade per
          video at staggered times. Content-calendar feature for the
          backlog. See components/content/BulkScheduleVideosModal.tsx. */}
      {bulkScheduleVideosOpen && (() => {
        const eligible = visibleVideos
          .filter(v => selectedVideoIds.has(v.id as string) && !posts[v.id as string])
          .map(v => ({ id: v.id as string, title: v.title as string }))
        const connectedSet = new Set<SchedulableSocial>()
        if (fbConnected) connectedSet.add('facebook')
        if (threadsConnected) connectedSet.add('threads')
        if (twitterConnected) connectedSet.add('twitter')
        if (linkedInConnected) connectedSet.add('linkedin')
        if (blueskyConnected) connectedSet.add('bluesky')
        if (telegramConnected) connectedSet.add('telegram')
        return (
          <BulkScheduleVideosModal
            videos={eligible}
            connectedChannels={connectedSet}
            open={bulkScheduleVideosOpen}
            onClose={() => setBulkScheduleVideosOpen(false)}
            onDone={({ successCount, videoIds }) => {
              if (successCount > 0) {
                // Move successfully scheduled videos out of selection so
                // the user sees the kanban transition naturally on close.
                setSelectedVideoIds(prev => {
                  const next = new Set(prev)
                  for (const id of videoIds) next.delete(id)
                  return next
                })
                // Refresh the Scheduled tab next time it opens.
                setScheduledItems(null)
              }
              setBulkScheduleVideosOpen(false)
            }}
          />
        )
      })()}

      {bulkScheduleOpen && (() => {
        const eligible = visibleVideos
          .filter(v => selectedVideoIds.has(v.id as string) && posts[v.id as string]?.postId)
          .map(v => ({
            postId: posts[v.id as string]!.postId!,
            videoTitle: v.title as string,
          }))
        return (
          <BulkScheduleModal
            posts={eligible}
            platforms={[
              { key: 'facebook', label: 'Facebook', color: '#1877f2', connected: fbConnected,        dryRunEndpoint: '/api/blog/facebook-post' },
              { key: 'threads',  label: 'Threads',  color: '#000000', connected: threadsConnected,   dryRunEndpoint: '/api/blog/threads-post' },
              { key: 'twitter',  label: 'X',        color: '#000000', connected: twitterConnected,   dryRunEndpoint: '/api/blog/twitter-post' },
              { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2', connected: linkedInConnected,  dryRunEndpoint: '/api/blog/linkedin-post' },
              { key: 'bluesky',  label: 'Bluesky',  color: '#1185fe', connected: blueskyConnected,   dryRunEndpoint: '/api/blog/bluesky-post' },
              { key: 'telegram', label: 'Telegram', color: '#229ED9', connected: telegramConnected,  dryRunEndpoint: '/api/blog/telegram-post' },
            ]}
            fbAccounts={fbAccounts}
            onClose={() => setBulkScheduleOpen(false)}
            onScheduled={({ ok, failed, firstError }) => {
              setFixCatResult(`${ok} scheduled${failed > 0 ? ` · ${failed} failed${firstError ? ` (${firstError})` : ''}` : ''}`)
              setSelectedVideoIds(new Set())
              // Refresh the Scheduled tab next time it opens
              setScheduledItems(null)
            }}
          />
        )
      })()}

      {/* Posts-tab row-level Rewrite modal. Captures the Pro user's
          feedback before triggering the one-shot AI rewrite. */}
      {rewriteModal && (
        <RewriteFeedbackModal
          value={rewriteModalFeedback}
          used={rewriteModal.used}
          onChange={setRewriteModalFeedback}
          onCancel={() => setRewriteModal(null)}
          onSubmit={() => {
            const fb = rewriteModalFeedback.trim()
            const target = rewriteModal
            setRewriteModal(null)
            if (!target || fb.length === 0) return
            rewritePost(target.wpPostId, target.videoId, fb)
          }}
        />
      )}
      <ConfirmHost />
    </>
  )
}
