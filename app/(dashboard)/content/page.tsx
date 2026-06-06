'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createBrowserClient } from '@/lib/supabase/client'
import PageHero from '@/components/layout/PageHero'
import { useConfirm } from '@/components/ui/useConfirm'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { TutorialVideo } from '@/components/TutorialVideo'
import { CapBannerHost, dispatchCapReached } from '@/components/CapReachedBanner'
import { SOCIAL_CAP } from '@/lib/social-cap'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import type { SchedulableSocial } from '@/lib/schedule-types'
import { renderThumbnailOverlay, pickWeightedStyleIndex } from '@/lib/thumbnail-overlay'
import { effectiveTier } from '@/lib/view-as'
import { metaEnabled } from '@/lib/feature-flags'
import {
  Youtube, Wand2, ExternalLink, CheckCircle, AlertCircle,
  RefreshCw, Loader2, ChevronRight, Sparkles, X, Facebook, Pin, Edit3, MessageCircle, Save, Upload, Search, Calendar,
} from 'lucide-react'
import type { PinPreviewData } from '@/components/PinterestPreviewModal'
import { TikTokDirectModal } from '@/components/TikTokDirectModal'
import { InstagramDirectModal } from '@/components/InstagramDirectModal'
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

/** Coerce an API `error` field (which may be a string OR an object) into a
 *  readable string. Prevents the "[object Object]" UI bug when a route
 *  serializes a non-string error. */
function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const m = e as { message?: unknown; error?: unknown }
    if (typeof m.message === 'string') return m.message
    if (typeof m.error === 'string') return m.error
    try { return JSON.stringify(e) } catch { /* ignore */ }
  }
  return ''
}

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

// ── Generation status badge ───────────────────────────────────────────────────
type GenStatus = 'idle' | 'generating' | 'done' | 'error'

const GEN_STEPS = ['Reading transcript…', 'Generating blog post…', 'Publishing to WordPress…', 'Adding product photos…']

/** Pro-only modal that collects "what was missing" feedback before
 *  the one-shot AI rewrite fires. Submit is disabled until the user
 *  has typed something — the whole point of capturing the feedback
 *  is to steer the second draft, so a blank submission would just
 *  reproduce the original. */
function RewriteFeedbackModal({
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onCancel)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Rewrite this post"
        tabIndex={-1}
      >
        <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
          Rewrite this post
        </h3>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Pro plans include <span className="font-semibold">one AI rewrite per post</span>.
          Tell us what was missing so the second draft is actually different.
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          autoFocus
          placeholder="e.g. The post focused too much on price — I wanted more on the build quality and a stronger opening hook. Also missing: comparison to the model I mentioned at minute 4."
          className="w-full text-sm p-3 rounded-lg bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#7C3AED] focus:outline-none leading-relaxed"
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg text-xs font-medium text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={value.trim().length === 0}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Rewrite now
          </button>
        </div>
        <p className="text-[10px] text-[#86868b] mt-3">
          Heads up — this counts as your one rewrite for this post. After this, further changes must be made manually in WordPress.
        </p>
      </div>
    </div>
  )
}

// Unified social pill used in the per-video card. Same shape for every
// platform — brand color is applied to the icon only when unposted, and
// fills the whole pill when posted. Keeps the row visually coherent
// regardless of how many networks the user has connected.
function SocialPill({
  brand,
  icon,
  label,
  postedLabel,
  posted,
  loading,
  onClick,
  locked,
}: {
  brand: string
  icon: React.ReactNode
  label: string
  postedLabel: string
  posted: boolean
  loading: boolean
  onClick?: () => void
  /** Platform is connected but not allowed on the user's tier — show a
   *  locked pill that links to pricing instead of posting. */
  locked?: boolean
}) {
  if (locked) {
    return (
      <a
        href="/pricing"
        title={`${label} publishing is on a higher plan — upgrade to unlock`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-gray-300 dark:border-white/15 text-[#86868b] hover:border-[#7C3AED]/40 hover:text-[#7C3AED] transition-colors"
      >
        <span style={{ display: 'inline-flex', opacity: 0.55 }}>{icon}</span>
        <span>{label}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-gray-100 dark:bg-white/10">Upgrade</span>
      </a>
    )
  }
  if (posted) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white shadow-sm"
        style={{ background: brand }}
      >
        <CheckCircle size={11} /> {postedLabel}
      </span>
    )
  }
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:border-gray-300 dark:hover:border-white/20 disabled:opacity-60 transition-all"
    >
      {loading
        ? <Loader2 size={11} className="animate-spin" style={{ color: brand }} />
        : <span style={{ color: brand, display: 'inline-flex' }}>{icon}</span>
      }
      <span>{label}</span>
    </button>
  )
}

function GenerateButton({
  videoId, youtubeVideoId, existingPost, userTier, onDone,
}: {
  videoId: string
  /** YouTube native id — lets the extension grab real HD frames for the
   *  in-article photos (retouched by AI). Optional. */
  youtubeVideoId?: string
  existingPost?: { url: string; title: string; postId?: string; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null } | null
  /** Drives whether the Rewrite button shows at all (Pro/Admin only). */
  userTier: Tier
  onDone: (url: string, title: string, postId: string) => void
}) {
  const [status, setStatus] = useState<GenStatus>(existingPost ? 'done' : 'idle')
  const [stepIdx, setStepIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState(existingPost || null)
  // Rewrite modal — opens when a Pro user hits the Rewrite button on a
  // published post. Captures the "what's missing" feedback before
  // firing the regeneration so the second draft is actually different.
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteFeedback, setRewriteFeedback] = useState('')
  // Per-generation choice: drop real video frames into the post body, or
  // ship a text-only post. Defaults ON (richer posts), user can opt out
  // before hitting Generate. Rewrites keep the same preference.
  // Off by default — when the box is ticked we attempt to add 2–3 in-article
  // photos (storyboard-frame retouches or Amazon-product re-stages). Ticked
  // = user explicitly opts in to the longer generation + the extra AI cost.
  const [includeImages, setIncludeImages] = useState(false)
  // Optional: bring-your-own in-article images (up to 3). When present, these
  // are placed throughout the post INSTEAD of AI-generated photos.
  const [userImages, setUserImages] = useState<string[]>([])
  const [imgBusy, setImgBusy] = useState(false)
  const [imgErr, setImgErr] = useState<string | null>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const supabase = createBrowserClient()
  const { confirm, ConfirmHost } = useConfirm()

  useEffect(() => {
    if (status !== 'generating') return
    const interval = setInterval(() => setStepIdx((i) => (i < GEN_STEPS.length - 1 ? i + 1 : i)), 9000)
    return () => clearInterval(interval)
  }, [status])

  async function addUserImages(files: FileList | null) {
    if (!files || files.length === 0) return
    setImgErr(null)
    const room = 3 - userImages.length
    if (room <= 0) { setImgErr('Up to 3 images'); return }
    setImgBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const next: string[] = []
      for (const f of Array.from(files).slice(0, room)) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > 10 * 1024 * 1024) { setImgErr('Each image must be under 10 MB'); continue }
        const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `${user.id}/blog/${videoId}/${crypto.randomUUID()}.${ext}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (supabase.storage as any).from('product-images').upload(path, f, {
          cacheControl: '31536000', upsert: false, contentType: f.type || 'image/jpeg',
        })
        if (upErr) throw new Error(upErr.message || 'Upload failed')
        const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
        if (urlData?.publicUrl) next.push(urlData.publicUrl)
      }
      if (next.length) setUserImages(prev => [...prev, ...next].slice(0, 3))
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setImgBusy(false)
      if (imgInputRef.current) imgInputRef.current.value = ''
    }
  }

  function removeUserImage(url: string) {
    setUserImages(prev => prev.filter(u => u !== url))
  }

  async function generate(opts?: { rewriteFeedback?: string }) {
    setStatus('generating')
    setStepIdx(0)
    setError(null)
    try {
      // Frame capture used to live here — the extension would open a YouTube
      // tab in the background to scrub HD frames. That tab-opening is what
      // the user kept seeing, and it's no longer needed: /api/blog/generate
      // now pulls evenly-spaced frames from YouTube's own storyboard tiles
      // server-side (lib/youtube-storyboards) — same "real frames" benefit,
      // zero browser tabs, no extension required.
      const callGenerate = async (allowEmptyTranscript = false) => {
        const r = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            includeImages,
            ...(includeImages && userImages.length > 0 ? { userImageUrls: userImages } : {}),
            ...(opts?.rewriteFeedback ? { rewriteFeedback: opts.rewriteFeedback } : {}),
            ...(allowEmptyTranscript ? { allowEmptyTranscript: true } : {}),
          }),
        })
        let d: Record<string, unknown> = {}
        try { d = await r.json() } catch { throw new Error(`Server error (${r.status}) — check Vercel logs`) }
        return { res: r, data: d }
      }
      let { res, data } = await callGenerate(false)
      // If the gate fires, give the user a one-click "generate anyway" with
      // the quality caveat clear — they keep control without us silently
      // proceeding.
      if (!res.ok && data.reason === 'no_transcript') {
        const proceed = await confirm({
          title: 'No transcript available — generate anyway?',
          description:
            'Without a transcript the post will be shorter and less specific (no lived experiences to ground on). ' +
            'Recommended: enable captions in YouTube Studio → Subtitles, then retry — auto-captions usually appear within 24h.',
          confirmLabel: 'Generate anyway',
          cancelLabel: 'Wait for captions',
        })
        if (proceed) {
          ;({ res, data } = await callGenerate(true))
        }
      }
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(
            (data.error as string) || 'You\'ve hit your posts cap for this period.',
            {
              cap: (data.cap as string) || 'posts',
              currentTier: data.currentTier as string | undefined,
              upgrade: data.upgrade as { tier: string; label: string; limit: number | null } | null | undefined,
            },
          )
          setStatus('idle')
          return
        }
        throw new Error(errText(data.error) || 'Generation failed')
      }
      setResult({ url: data.wordpressUrl as string, title: data.title as string })

      // The AI in-article image step lives inside the generate route's
      // after() block. Vercel routinely cuts that block off before the slow
      // fal calls (~30-90s of work after the response ships) — so on most
      // initial generations the post lands text-only even when "Include
      // photos" was ticked. Refresh-images is the exact same image-gen
      // path running as a fresh synchronous request, which works
      // reliably. Auto-trigger it here so the user gets images on the
      // FIRST attempt instead of having to manually hit "Refresh images"
      // after every post. Skipped when the user uploaded their own
      // images (those flow through a different, fast branch that does
      // complete inside after()).
      if (includeImages && userImages.length === 0 && data.wordpressPostId) {
        setStepIdx(GEN_STEPS.length - 1) // "Adding product photos…"
        try {
          const imgRes = await fetch('/api/blog/refresh-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wordpressPostId: data.wordpressPostId }),
          })
          const imgData: Record<string, unknown> = await imgRes.json().catch(() => ({}))
          if (imgRes.ok && typeof imgData.count === 'number') {
            const count = imgData.count
            // Reflect the count on the badge straight away so the user
            // sees "🖼 N" without a Content-page reload.
            setResult((prev) => prev ? { ...prev, bodyImagesCount: count } : prev)
          } else if (!imgRes.ok) {
            // Surface the auto-trigger failure as a toast instead of
            // silently swallowing it — 2026-06-05 user report of "ticked
            // Include images but got none" was an auto-trigger failure
            // we never told them about. The post itself is fine; the
            // user can still hit Images manually to retry.
            const msg = (imgData.error as string | undefined) || `Couldn't add in-article images (${imgRes.status}).`
            toast.error(`${msg} Click Images on the post row to retry.`, { duration: 6000 })
          }
        } catch (e) {
          // Non-fatal — the post is already published — but tell the user
          // so they know to click Images manually instead of thinking the
          // toggle was ignored. Network errors / aborts land here.
          const msg = e instanceof Error ? e.message : 'Image step failed.'
          toast.error(`${msg} Click Images on the post row to retry.`, { duration: 6000 })
        }
      }

      setStatus('done')
      onDone(data.wordpressUrl as string, data.title as string, data.postId as string)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  const isPro = userTier === 'pro' || userTier === 'admin'

  if (status === 'done' && result) {
    return (
      <div className="flex items-center gap-2">
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-[#34c759] hover:underline">
          <CheckCircle size={13} /> View post <ExternalLink size={11} />
        </a>
        {/* Google indexing status (from the nightly cron + on-demand re-checks).
            ✓ = in Google's index. ⚠️ = not in the index yet (new posts can take
            days; old ones that flip back to this state may have been dropped).
            Null/undefined = no signal yet → hide the badge. */}
        {result.indexed === true && (
          <span className="inline-flex items-center text-[#34c759]" title="Indexed by Google — it shows in search results.">
            <CheckCircle size={12} />
          </span>
        )}
        {result.indexed === false && (
          <span className="inline-flex items-center text-[#ff9500]" title={result.coverage || 'Not in Google’s index yet — new posts can take days to weeks. Open the SEO page to request indexing.'}>
            <AlertCircle size={12} />
          </span>
        )}
        {/* In-article image diagnostic — read straight off blog_posts.body_images_count.
            null  → either the user didn't tick "Include photos", or the after()
                    block that does image-gen hasn't completed yet (legacy posts
                    pre-this-column also stay null). Hide the badge entirely so
                    we don't yell at people whose tick was deliberately off.
            0     → after() ran but failed to insert anything — the actual case
                    we shipped this column to surface (Hostinger WAF, fal
                    hiccup, prompt empty). Orange ⚠ "Images failed".
            >0    → green count, e.g. "🖼 3". */}
        {typeof result.bodyImagesCount === 'number' && result.bodyImagesCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[#34c759]" title={`${result.bodyImagesCount} in-article image${result.bodyImagesCount === 1 ? '' : 's'} added to this post.`}>
            <span aria-hidden>🖼</span><span className="text-[10px] font-semibold">{result.bodyImagesCount}</span>
          </span>
        )}
        {result.bodyImagesCount === 0 && (
          <span className="inline-flex items-center gap-0.5 text-[#ff9500]" title="‘Include photos’ was on but no in-article images made it in. Try ‘Refresh images’ on the post, or check your WordPress media upload (Hostinger WAF on POST /wp-json/wp/v2/media is the usual cause).">
            <span aria-hidden>🖼</span><span className="text-[10px] font-semibold">!</span>
          </span>
        )}
        {/* Rewrite is Pro-only and one-shot per post. Non-Pro users
            see no button — they manually edit the post in WordPress. */}
        {isPro && (
          <button
            onClick={() => { setRewriteFeedback(''); setRewriteOpen(true) }}
            className="flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors"
            title="Rewrite this post once with fresh AI content based on your feedback"
          >
            <RefreshCw size={11} /> Rewrite
          </button>
        )}
        {rewriteOpen && (
          <RewriteFeedbackModal
            value={rewriteFeedback}
            onChange={setRewriteFeedback}
            onCancel={() => setRewriteOpen(false)}
            onSubmit={() => {
              const fb = rewriteFeedback.trim()
              setRewriteOpen(false)
              if (fb.length === 0) return
              generate({ rewriteFeedback: fb })
            }}
          />
        )}
      </div>
    )
  }
  if (status === 'generating') {
    return (
      <div className="flex items-center gap-2 text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        <Loader2 size={13} className="animate-spin text-[#7C3AED]" />
        <span>{GEN_STEPS[stepIdx]}</span>
        {/* ConfirmHost is required so the "no transcript — generate anyway?"
            dialog (raised from inside generate() right after status flips to
            'generating') has a host in this branch's tree. */}
        <ConfirmHost />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-[#ff3b30] line-clamp-3">{error}</p>
        <button onClick={() => generate()} className="text-xs text-[#7C3AED] hover:underline text-left">Retry →</button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5 flex-wrap">
        <button onClick={() => generate()} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7C3AED] text-white text-xs font-semibold rounded-lg hover:bg-[#7C3AED]/90 transition-colors">
          <Wand2 size={12} /> Generate post
        </button>
        <label
          className="flex items-center gap-1.5 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] cursor-pointer select-none"
          title="Add photos to the post body. Uncheck for a text-only post."
        >
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
            className="accent-[#7C3AED] w-3.5 h-3.5"
          />
          Include photos in the article
        </label>
        {includeImages && (
          <>
            <input
              ref={imgInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => addUserImages(e.target.files)}
            />
            <button
              onClick={() => imgInputRef.current?.click()}
              disabled={imgBusy || userImages.length >= 3}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/10 text-[11px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED] disabled:opacity-50 transition-colors"
              title="Upload up to 3 of your own photos to use throughout the article instead of the AI ones"
            >
              {imgBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              {userImages.length > 0 ? `Your photos (${userImages.length}/3)` : 'Upload your own'}
            </button>
          </>
        )}
      </div>

      {includeImages && (
        <div className="flex items-center gap-2 flex-wrap">
          {userImages.map((u) => (
            <div key={u} className="relative w-12 h-12 rounded-md overflow-hidden border border-gray-200 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="Article image" className="w-full h-full object-cover" />
              <button
                onClick={() => removeUserImage(u)}
                aria-label="Remove image"
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 hover:bg-[#ff3b30] text-white flex items-center justify-center"
              >
                <X size={9} />
              </button>
            </div>
          ))}
          {/* Explain the default so the option is discoverable. */}
          <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
            {userImages.length > 0
              ? 'Your photos will be placed through the article.'
              : 'By default we generate AI photos of the actual product in different real-world settings — or upload your own.'}
          </span>
          {imgErr && <span className="text-[10px] text-[#ff3b30]">{imgErr}</span>}
        </div>
      )}
    </div>
  )
}

// ── Manual word editor ────────────────────────────────────────────────────────
// Expands an inline editor with the published article's text. Structure
// (headings, links — incl. affiliate links) is preserved; the user edits
// the wording. Save persists to blog_posts.content AND the live WP post.
function ManualEdit({ postId }: { postId?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const seeded = useRef(false)

  // Seed the contentEditable AFTER it mounts (it only renders once
  // loading is false). Only once per open so user edits aren't clobbered.
  useEffect(() => {
    if (open && !loading && ref.current && !seeded.current) {
      ref.current.innerHTML = html
      seeded.current = true
    }
  }, [open, loading, html])

  async function toggle() {
    if (open) { setOpen(false); seeded.current = false; return }
    seeded.current = false
    setMsg(null)
    if (!postId) { setHtml(''); setOpen(true); setMsg('No post to edit yet.'); return }
    setOpen(true); setLoading(true)
    try {
      const res = await fetch(`/api/blog/content?postId=${postId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load the article')
      setHtml(data.content || '')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!ref.current || !postId) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/blog/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, content: ref.current.innerHTML }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.warning) {
        // Saved locally but WP push had an issue — keep open so the
        // user sees why.
        setMsg(data.warning)
      } else {
        // Success — collapse the editor.
        setOpen(false)
        seeded.current = false
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={open ? 'basis-full order-last mt-1' : ''}>
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors"
      >
        <Edit3 size={11} /> {open ? 'Close editor' : 'Manual edit'}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[#86868b] py-8 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading article…
            </div>
          ) : (
            <>
              <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                className="max-w-none min-h-[220px] max-h-[480px] overflow-auto text-sm leading-relaxed text-[#1d1d1f] dark:text-[#f5f5f7] outline-none rounded-lg border border-gray-100 dark:border-white/5 p-3 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:font-semibold [&_a]:text-[#7C3AED] [&_a]:underline [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2"
              />
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <button
                  onClick={save}
                  disabled={saving || !postId}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
                >
                  {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save changes</>}
                </button>
                <button onClick={() => { setOpen(false); seeded.current = false }} className="text-xs text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white">Cancel</button>
                {msg && <span className="text-[11px] text-[#6e6e73] dark:text-[#8e8e93]">{msg}</span>}
              </div>
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">
                Edit the wording directly. Headings and links (including affiliate links) are kept — saving updates the live WordPress post.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Instagram Publish modal ───────────────────────────────────────────────────
// Opens when the user clicks the Instagram pill on a video card. Walks them
// through: upload vertical MP4 (if not yet) → pick mode (Reel/Story/Both) →
// publish. Calls the parent's posted callbacks so the pill state updates.
function InstagramPublishModal({
  postId,
  videoDbId,
  videoKind,
  alreadyReeled,
  alreadyStoried,
  igAccounts,
  onClose,
  onPublishStart,
  onPublishEnd,
  onReelPosted,
  onStoryPosted,
}: {
  postId: string
  videoDbId: string
  /** 'vertical' = upload-MP4 path (Reels). 'horizontal' = auto-composed-image path (Feed image). */
  videoKind: 'horizontal' | 'vertical'
  alreadyReeled: boolean
  alreadyStoried: boolean
  /** Connected IG accounts (Pro multi-account) for the per-post picker. */
  igAccounts: Array<{ id: string; displayName: string | null; isDefault: boolean }>
  onClose: () => void
  onPublishStart: () => void
  onPublishEnd: () => void
  onReelPosted: () => void
  onStoryPosted: (affiliateUrl: string) => void
}) {
  const supabase = createBrowserClient()
  // Which IG account to publish to (Pro multi-account). Defaults to the last
  // choice, then the default account. Persisted across sessions.
  const [selectedIgAccountId, setSelectedIgAccountId] = useState<string>(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('mvp_ig_account_choice') } catch { /* ignore */ }
    if (saved && igAccounts.some(a => a.id === saved)) return saved
    return igAccounts.find(a => a.isDefault)?.id ?? igAccounts[0]?.id ?? ''
  })
  // Media-ready URL — instagram_video_url for vertical, instagram_image_url for horizontal
  const [existingUrl, setExistingUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string>('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Image generation state (horizontal kind only)
  const [generatingImage, setGeneratingImage] = useState(false)
  // Default mode: Both unless one's already been done — then only the missing one
  // Feed-post mode is 'reel' for vertical, 'image' for horizontal — kept in `feedMode`.
  const feedMode: 'reel' | 'image' = videoKind === 'horizontal' ? 'image' : 'reel'
  const initialMode: 'reel' | 'image' | 'story' | 'both' =
    alreadyReeled && !alreadyStoried ? 'story' : alreadyStoried && !alreadyReeled ? feedMode : 'both'
  const [mode, setMode] = useState<'reel' | 'image' | 'story' | 'both'>(initialMode)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [previewedReelCaption, setPreviewedReelCaption] = useState('')
  const [previewedAffiliateUrl, setPreviewedAffiliateUrl] = useState<string | null>(null)
  // ── AI native IG image (Pro-only) ────────────────────────────────────────
  // Source-picker state. For horizontal videos the user can choose between
  // the existing "compose from YT thumbnail" path (free, fast) and the new
  // "generate native 4:5 AI image" path (Pro, slow, paid). Vertical videos
  // are MP4-upload only and don't see any of this.
  const [igSource, setIgSource] = useState<'compose' | 'ai'>('compose')
  const [aiHeadline, setAiHeadline] = useState('')
  const [aiFaceModelId, setAiFaceModelId] = useState<string | null>(null)
  const [aiFaceModels, setAiFaceModels] = useState<Array<{ id: string; name: string; trigger_token: string }>>([])
  const [aiTier, setAiTier] = useState<string>('trial')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // Track which overlay style was used on the current AI image so the
  // 👍 / 👎 feedback row can attribute the reaction to a style. Cleared
  // whenever we leave the AI path or reset the preview.
  const [aiStyleId, setAiStyleId] = useState<string | null>(null)
  const [aiFeedbackSent, setAiFeedbackSent] = useState<'like' | 'dislike' | null>(null)
  // Aggregated feedback summary used to bias the random style picker.
  // Re-fetched on mount + after every reaction so weights stay fresh.
  const [styleWeights, setStyleWeights] = useState<{ liked: Record<string, number>; disliked: Record<string, number> }>({ liked: {}, disliked: {} })

  // Load Pro status + face models on mount so the AI option only shows
  // to users who can actually use it. Free-tier users see no second
  // option (they get the existing compose flow only).
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: intRow } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).single()
        setAiTier(effectiveTier(intRow?.tier as string))
        const fmRes = await fetch('/api/face-models')
        if (fmRes.ok) {
          const fm = await fmRes.json()
          const ready = ((fm.models as Array<{ id: string; name: string; trigger_token: string; status: string }>) || [])
            .filter(m => m.status === 'ready')
            .map(m => ({ id: m.id, name: m.name, trigger_token: m.trigger_token }))
          setAiFaceModels(ready)
        }
        // Pull aggregated 👍/👎 history for the IG surface so the random
        // style picker biases toward styles this user has rewarded —
        // niche-aware: weights styles that worked on this video's category.
        try {
          let nicheParam = ''
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: catRow } = await supabase.from('youtube_videos')
              .select('selected_category').eq('id', videoDbId).single()
            const cat = (catRow?.selected_category as string | null)?.trim()
            if (cat) nicheParam = `&niche=${encodeURIComponent(cat)}`
          } catch { /* overall weights */ }
          const fbRes = await fetch(`/api/thumbnail-feedback?surface=instagram${nicheParam}`)
          if (fbRes.ok) {
            const fb = await fbRes.json()
            setStyleWeights({ liked: fb.liked || {}, disliked: fb.disliked || {} })
          }
        } catch { /* silent — picker just goes uniform */ }
      } catch { /* silent — picker just won't render */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aiIsPro = aiTier === 'pro' || aiTier === 'admin'

  /** Fire the IG-native AI image generation. On success, the returned
   *  imageUrl is wired into existingUrl so the rest of the modal treats
   *  it exactly like a composed image — preview, mode picker, publish all
   *  unchanged. */
  async function handleGenerateAIImage(opts: { force?: boolean } = {}) {
    setAiGenerating(true)
    setAiError(null)
    try {
      const res = await fetch('/api/instagram/generate-ai-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          customHeadline: aiHeadline.trim() || undefined,
          faceModelId: aiFaceModelId || undefined,
          // Explicit Regenerate click bypasses the server-side cache and
          // burns a fresh credit. First-time generations leave this off
          // so re-opening the modal re-uses the previous result for free.
          force: opts.force === true,
        }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) {
        if (data.limitReached) {
          dispatchCapReached(data.error || 'Cap reached.', {
            cap: data.cap || 'instagram_ai', currentTier: data.currentTier, upgrade: data.upgrade,
          })
          return
        }
        throw new Error(data.error || 'AI generation failed')
      }
      // Draw the headline overlay onto the Fal-returned image so the
      // user gets a viral-looking IG post, not a clean portrait with
      // no caption. 4:5 canvas (1080×1350). Falls back to the raw URL
      // if canvas/CORS fails so we never end up worse than before.
      const rawUrl = data.imageUrl as string
      const overlayHook = (data.overlayHook as string) || ''
      let finalUrl = rawUrl
      let styleId: string | null = null
      if (overlayHook) {
        try {
          const styleIndex = pickWeightedStyleIndex(styleWeights.liked, styleWeights.disliked)
          // Smart text-zone (vision) keeps the caption off the face when present.
          const textPosition = (data.textPosition as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center' | null) || undefined
          const faceBox = (data.faceBox as { x: number; y: number; w: number; h: number } | null) || undefined
          const overlayed = await renderThumbnailOverlay(rawUrl, overlayHook, { width: 1080, height: 1350, styleIndex, position: textPosition, faceBox })
          finalUrl = overlayed.url
          styleId = overlayed.styleId
        } catch (overlayErr) {
          console.warn('[ig-ai-overlay]', overlayErr)
        }
      }
      setAiStyleId(styleId)
      setAiFeedbackSent(null)
      setExistingUrl(finalUrl)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiGenerating(false)
    }
  }

  /** Record a 👍 / 👎 reaction on the current AI image. Best-effort — we
   *  don't surface errors because feedback shouldn't block publishing. */
  async function submitAiFeedback(reaction: 'like' | 'dislike') {
    if (!existingUrl) return
    setAiFeedbackSent(reaction)
    try {
      await fetch('/api/thumbnail-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thumbnailUrl: existingUrl,
          reaction,
          // styleId may be null on legacy cached images that pre-date the
          // hook persistence — still record the surface-level signal.
          styleId: aiStyleId,
          surface: 'instagram',
          modelUsed: aiFaceModelId ? 'fal-flux-lora' : 'fal-flux-pro-v1.1',
          videoId: videoDbId,
        }),
      })
      // Optimistically bump local weights so the next regen reflects the
      // signal without waiting on a round-trip.
      if (aiStyleId) {
        setStyleWeights(prev => {
          const next = { liked: { ...prev.liked }, disliked: { ...prev.disliked } }
          const bucket = reaction === 'like' ? next.liked : next.disliked
          bucket[aiStyleId] = (bucket[aiStyleId] || 0) + 1
          return next
        })
      }
    } catch (e) {
      console.warn('[ig-ai-feedback]', e)
    }
  }

  // Load whichever URL applies to this kind
  useEffect(() => {
    const col = videoKind === 'horizontal' ? 'instagram_image_url' : 'instagram_video_url'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;supabase.from('youtube_videos').select(col).eq('id', videoDbId).single().then(({ data }: { data: Record<string, string | null> | null }) => {
      const url = data?.[col]
      if (url) setExistingUrl(url)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDbId, videoKind])

  /** Horizontal kind: kick off server-side image composition. */
  async function handleGenerateImage() {
    setGeneratingImage(true)
    setUploadError(null)
    setUploadProgress('Composing image…')
    try {
      const res = await fetch('/api/instagram/compose-thumbnail-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoDbId }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(data.error || 'Image generation failed')
      setExistingUrl(data.instagramImageUrl as string)
      setUploadProgress('')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Image generation failed')
      setUploadProgress('')
    } finally {
      setGeneratingImage(false)
    }
  }

  async function handleFileUpload(file: File) {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setUploadError('Please select a video file (MP4 recommended).')
      return
    }
    // 300MB cap. The upload goes browser → Supabase Storage directly (not
    // through a Vercel function), so the ceiling is the Supabase bucket's
    // file_size_limit (set to 300MB) — well within Instagram's ~1GB Reel limit.
    if (file.size > 300 * 1024 * 1024) {
      setUploadError(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — videos must be under 300MB. Compress and retry.`)
      return
    }
    setUploading(true)
    setUploadError(null)
    setUploadProgress('Uploading…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/${videoDbId}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'video/mp4',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      const publicUrl = urlData.publicUrl
      // Persist on youtube_videos so the publish route can read it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateErr } = await supabase.from('youtube_videos').update({ instagram_video_url: publicUrl }).eq('id', videoDbId)
      if (updateErr) throw new Error(updateErr.message || 'Save failed')
      setExistingUrl(publicUrl)
      setUploadProgress('')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  /** Re-trigger preview generation when the user changes mode after previewing. */
  function resetPreview() {
    setPreviewLoaded(false)
    setPreviewedReelCaption('')
    setPreviewedAffiliateUrl(null)
    setPublishError(null)
  }

  const apiKind: 'video' | 'image' = videoKind === 'horizontal' ? 'image' : 'video'

  /** Step 3 — call publish route with dryRun: true to get the editable caption + affiliate URL. */
  async function previewContent() {
    setPreviewing(true)
    setPublishError(null)
    try {
      const res = await fetch('/api/blog/instagram-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, kind: apiKind, mode, dryRun: true, socialAccountId: selectedIgAccountId || undefined }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setPreviewedReelCaption((data.reelCaption as string) ?? '')
      setPreviewedAffiliateUrl((data.affiliateUrl as string) ?? null)
      setPreviewLoaded(true)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  /** Step 4 — publish using the (possibly edited) caption from the preview step. */
  async function publish() {
    if (!existingUrl) {
      setPublishError(videoKind === 'horizontal' ? 'Generate the Instagram image first.' : 'Upload a vertical MP4 first.')
      return
    }
    setPublishing(true)
    setPublishError(null)
    onPublishStart()
    try {
      const sendsFeedCaption = mode === feedMode || mode === 'both'
      const res = await fetch('/api/blog/instagram-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          kind: apiKind,
          mode,
          caption: sendsFeedCaption ? previewedReelCaption : undefined,
          socialAccountId: selectedIgAccountId || undefined,
        }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) throw new Error(data.error || 'Publish failed')

      if (data.reelId || data.imagePostId) onReelPosted()
      if (data.storyId) onStoryPosted(data.affiliateUrl ?? '')

      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setPublishError('Published with warnings: ' + data.warnings.join(' · '))
        return
      }
      onClose()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
      onPublishEnd()
    }
  }

  return (
    <InstagramPublishModalShell onClose={onClose}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Publish to Instagram</h3>
            </div>
            <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
              <X size={16} />
            </button>
          </div>

          {/* Account picker — only when the user has more than one IG account. */}
          {igAccounts.length > 1 && (
            <div className="mb-5">
              <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5 block">Publish to account</label>
              <select
                value={selectedIgAccountId}
                onChange={e => {
                  const v = e.target.value
                  setSelectedIgAccountId(v)
                  try { localStorage.setItem('mvp_ig_account_choice', v) } catch { /* ignore */ }
                }}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none"
              >
                {igAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.displayName || 'Instagram account'}</option>
                ))}
              </select>
            </div>
          )}

          {/* Step 1 — Media source (video upload for vertical, auto-image for horizontal) */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
              {videoKind === 'horizontal'
                ? '1. Instagram image (4:5, auto-composed from your thumbnail)'
                : '1. Vertical video (9:16, MP4, <300MB)'}
            </p>
            {existingUrl ? (
              videoKind === 'horizontal' ? (
                <div className="rounded-lg bg-[#34c759]/5 border border-[#34c759]/30 p-3">
                  <div className="flex items-start gap-3">
                    {/* Bigger preview — 200px wide, 4:5 ratio. Big enough
                        to actually evaluate the headline + face before
                        publishing, without dominating the modal. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={existingUrl} alt="Composed Instagram image" className="w-44 rounded-md object-cover border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ aspectRatio: '4/5' }} />
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                        <CheckCircle size={12} className="text-[#34c759]" /> Image ready
                      </p>
                      {/* Regenerate routes to whichever source the user
                          picked. AI path forces a fresh generation server-
                          side so the user actually gets a NEW image (not
                          the cached one). */}
                      {aiIsPro && igSource === 'ai' ? (
                        <button
                          onClick={() => handleGenerateAIImage({ force: true })}
                          disabled={aiGenerating}
                          className="text-[11px] text-[#5856d6] hover:underline inline-flex items-center gap-1 disabled:opacity-60 self-start"
                        >
                          {aiGenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate AI image
                        </button>
                      ) : (
                        <button onClick={handleGenerateImage} disabled={generatingImage} className="text-[11px] text-[#7C3AED] hover:underline inline-flex items-center gap-1 disabled:opacity-60 self-start">
                          {generatingImage ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                        </button>
                      )}
                      {/* Reset / Discard — clears existingUrl so the source
                          picker (Compose vs AI) reappears. Lets the user
                          switch paths without closing the whole modal. */}
                      <button
                        onClick={() => {
                          setExistingUrl(null)
                          setUploadError(null)
                          setAiError(null)
                          setAiStyleId(null)
                          setAiFeedbackSent(null)
                          // Reset preview state so old caption draft
                          // doesn't carry across the source switch.
                          resetPreview()
                        }}
                        disabled={generatingImage || aiGenerating}
                        className="text-[11px] text-[#ff3b30] hover:underline inline-flex items-center gap-1 disabled:opacity-60 self-start"
                      >
                        <X size={10} /> Discard &amp; pick a different source
                      </button>
                      {/* 👍 / 👎 feedback — only on AI images where we
                          captured a styleId. The picker on the next gen
                          biases toward 'like' styles + away from 'dislike'
                          styles, so this is the user training their own
                          random generator. */}
                      {aiIsPro && igSource === 'ai' && (
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[10px] text-[#86868b]">Train the AI:</span>
                          <button
                            onClick={() => submitAiFeedback('like')}
                            disabled={aiFeedbackSent !== null}
                            className={`text-[11px] px-2 py-0.5 rounded border transition ${aiFeedbackSent === 'like' ? 'bg-[#34c759]/20 border-[#34c759] text-[#34c759]' : 'border-gray-200 dark:border-white/10 hover:border-[#34c759]'} disabled:opacity-60`}
                            title="I'd use this thumbnail"
                          >
                            👍
                          </button>
                          <button
                            onClick={() => submitAiFeedback('dislike')}
                            disabled={aiFeedbackSent !== null}
                            className={`text-[11px] px-2 py-0.5 rounded border transition ${aiFeedbackSent === 'dislike' ? 'bg-[#ff3b30]/20 border-[#ff3b30] text-[#ff3b30]' : 'border-gray-200 dark:border-white/10 hover:border-[#ff3b30]'} disabled:opacity-60`}
                            title="Not this style"
                          >
                            👎
                          </button>
                          {aiFeedbackSent && (
                            <span className="text-[10px] text-[#86868b]">Thanks — saved.</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-lg bg-[#34c759]/5 border border-[#34c759]/30">
                  <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                    <CheckCircle size={12} className="text-[#34c759]" /> Video ready
                  </p>
                  <button onClick={() => { setExistingUrl(null); resetPreview() }} className="text-[11px] text-[#7C3AED] hover:underline">
                    Replace
                  </button>
                </div>
              )
            ) : videoKind === 'horizontal' ? (
              <div className="space-y-3">
                {/* Source picker — only renders for Pro users. Trial/Creator —
                    see just the compose button (current behavior). */}
                {aiIsPro && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIgSource('compose')}
                      className={`flex-1 p-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        igSource === 'compose'
                          ? 'border-[#E1306C] bg-[#E1306C]/5 text-[#1d1d1f] dark:text-[#f5f5f7]'
                          : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'
                      }`}
                    >
                      Compose from YT thumbnail
                      <span className="block text-[10px] font-normal text-[#86868b] mt-0.5">Free · 5s</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIgSource('ai')}
                      className={`flex-1 p-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        igSource === 'ai'
                          ? 'border-[#5856d6] bg-[#5856d6]/5 text-[#1d1d1f] dark:text-[#f5f5f7]'
                          : 'border-gray-200 dark:border-white/10 text-[#6e6e73] dark:text-[#ebebf0] hover:border-gray-300'
                      }`}
                    >
                      ✨ Generate native AI image
                      <span className="block text-[10px] font-normal text-[#86868b] mt-0.5">Pro · 4:5 portrait · ~30s</span>
                    </button>
                  </div>
                )}

                {/* AI configuration form — face picker + headline lock */}
                {aiIsPro && igSource === 'ai' && (
                  <div className="p-3 rounded-lg border border-[#5856d6]/30 bg-[#5856d6]/5 space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                        Headline <span className="font-normal text-[#86868b]">(optional · leave blank for AI to pick)</span>
                      </label>
                      <input
                        type="text"
                        value={aiHeadline}
                        onChange={(e) => setAiHeadline(e.target.value)}
                        placeholder="e.g. GAME CHANGER!"
                        maxLength={40}
                        disabled={aiGenerating}
                        className="w-full text-xs px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] focus:border-[#5856d6] focus:outline-none uppercase tracking-wide"
                      />
                    </div>
                    {aiFaceModels.length > 0 ? (
                      <div>
                        <label className="block text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Face</label>
                        <div className="flex flex-col gap-1">
                          <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs ${aiFaceModelId === null ? 'border-[#5856d6] bg-white dark:bg-[#0a0a0a]' : 'border-gray-200 dark:border-white/10'}`}>
                            <input type="radio" name="ig-face" checked={aiFaceModelId === null} onChange={() => setAiFaceModelId(null)} />
                            <span>No face — product-only</span>
                          </label>
                          {aiFaceModels.map(m => (
                            <label key={m.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs ${aiFaceModelId === m.id ? 'border-[#5856d6] bg-white dark:bg-[#0a0a0a]' : 'border-gray-200 dark:border-white/10'}`}>
                              <input type="radio" name="ig-face" checked={aiFaceModelId === m.id} onChange={() => setAiFaceModelId(m.id)} />
                              <span className="font-medium">{m.name}</span>
                              <span className="text-[10px] text-[#86868b]">({m.trigger_token})</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
                        No trained faces yet — the AI will generate a product-only portrait. <Link href="/face-training" className="text-[#5856d6] hover:underline">Train your face</Link> for stronger Instagram results.
                      </p>
                    )}
                    <button
                      onClick={() => handleGenerateAIImage()}
                      disabled={aiGenerating}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #5856d6 0%, #E1306C 100%)' }}
                    >
                      {aiGenerating
                        ? <><Loader2 size={11} className="animate-spin" /> Generating (20-40s)…</>
                        : <>✨ Generate AI image</>}
                    </button>
                    {aiError && <p className="text-[11px] text-[#ff3b30]">{aiError}</p>}
                    <p className="text-[10px] text-[#86868b] italic">
                      Each generation counts as 1 of your monthly Instagram AI credits. Re-opening this modal later re-uses the same image free.
                    </p>
                  </div>
                )}

                {/* Compose button — only shown when source = compose OR user is not Pro */}
                {(!aiIsPro || igSource === 'compose') && (
                  <button
                    onClick={handleGenerateImage}
                    disabled={generatingImage}
                    className="w-full flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 hover:border-[#E1306C] cursor-pointer transition-colors disabled:cursor-wait"
                  >
                    {generatingImage ? (
                      <>
                        <Loader2 size={20} className="animate-spin text-[#E1306C] mb-2" />
                        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{uploadProgress || 'Composing image…'}</p>
                      </>
                    ) : (
                      <>
                        <Wand2 size={18} className="text-[#86868b] dark:text-[#8e8e93] mb-2" />
                        <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Compose Instagram image</p>
                        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">YouTube thumbnail + title + your brand · 1080×1350</p>
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 hover:border-[#7C3AED] cursor-pointer transition-colors">
                <input type="file" accept="video/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])} disabled={uploading} />
                {uploading ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-[#7C3AED] mb-2" />
                    <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{uploadProgress || 'Uploading…'}</p>
                  </>
                ) : (
                  <>
                    <Wand2 size={18} className="text-[#86868b] dark:text-[#8e8e93] mb-2" />
                    <p className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">Click to upload vertical MP4</p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">9:16 aspect ratio, 3–90 seconds, under 300MB</p>
                  </>
                )}
              </label>
            )}
            {uploadError && <p className="text-[11px] text-[#ff3b30] mt-2">{uploadError}</p>}
          </div>

          {/* Step 2 — Mode picker */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. What to publish</p>
            <div className="grid grid-cols-3 gap-2">
              {(videoKind === 'horizontal' ? ([
                { val: 'image' as const, label: 'Feed post', hint: 'Image + SEO caption + 20 hashtags. No clickable link (IG limitation).', disabled: alreadyReeled && !alreadyStoried },
                { val: 'story' as const, label: 'Story only', hint: 'Image + link sticker (you add the sticker manually after).', disabled: alreadyStoried && !alreadyReeled },
                { val: 'both' as const, label: 'Both', hint: 'Feed post for reach + Story for affiliate clicks. Recommended.', disabled: alreadyReeled && alreadyStoried },
              ]) : ([
                { val: 'reel' as const, label: 'Reel only', hint: 'Max SEO caption + 20 hashtags. No clickable link (IG limitation).', disabled: alreadyReeled && !alreadyStoried },
                { val: 'story' as const, label: 'Story only', hint: 'Video + link sticker (you add the sticker manually after).', disabled: alreadyStoried && !alreadyReeled },
                { val: 'both' as const, label: 'Both', hint: 'Reel for reach + Story for affiliate clicks. Recommended.', disabled: alreadyReeled && alreadyStoried },
              ])).map(opt => (
                <button
                  key={opt.val}
                  onClick={() => { setMode(opt.val); resetPreview() }}
                  disabled={opt.disabled}
                  className={`p-3 rounded-lg border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    mode === opt.val
                      ? 'border-[#E1306C] bg-[#E1306C]/5'
                      : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                >
                  <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{opt.label}</p>
                  <p className="text-[10px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mt-1">{opt.hint}</p>
                </button>
              ))}
            </div>
            {(alreadyReeled || alreadyStoried) && (
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 italic">
                Already posted: {alreadyReeled && 'Reel'}{alreadyReeled && alreadyStoried && ' + '}{alreadyStoried && 'Story'}
              </p>
            )}
          </div>

          {/* Step 3 — Preview (collapses into Publish once user has previewed) */}
          {!previewLoaded ? (
            <div className="mb-5">
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Preview the AI caption before publishing</p>
              <button
                onClick={previewContent}
                disabled={previewing}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 hover:bg-gray-200 dark:hover:bg-white/20 disabled:opacity-60 transition-colors"
              >
                {previewing ? <><Loader2 size={12} className="animate-spin" /> Generating preview…</> : <><Wand2 size={12} /> Preview AI content</>}
              </button>
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
                We&apos;ll show you the generated caption + hashtags so you can edit them before publishing. Nothing posts to Instagram until you click Publish.
              </p>
            </div>
          ) : (
            <div className="mb-5">
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Edit before publishing</p>

              {(mode === feedMode || mode === 'both') && (
                <div className="mb-3">
                  <label className="text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1 block">{videoKind === 'horizontal' ? 'Post' : 'Reel'} caption + hashtags <span className="text-[#86868b]">({previewedReelCaption.length}/2200)</span></label>
                  <textarea
                    value={previewedReelCaption}
                    onChange={e => setPreviewedReelCaption(e.target.value.slice(0, 2200))}
                    rows={9}
                    className="w-full text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#E1306C] focus:outline-none leading-relaxed font-mono"
                    placeholder="Caption will appear here once preview is generated"
                  />
                  <button onClick={previewContent} disabled={previewing} className="text-[10px] text-[#7C3AED] hover:underline mt-1 inline-flex items-center gap-1 disabled:opacity-60">
                    {previewing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                  </button>
                </div>
              )}

              {(mode === 'story' || mode === 'both') && previewedAffiliateUrl && (
                <div className="rounded-lg border border-[#E1306C]/30 bg-[#E1306C]/5 p-3 mb-3">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Story link (you&apos;ll add this as a Link Sticker after publish)</p>
                  <code className="text-[11px] font-mono text-[#7C3AED] break-all">{previewedAffiliateUrl}</code>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                    The Story video publishes automatically. Instagram&apos;s API doesn&apos;t expose link stickers, so you&apos;ll tap to copy this URL after publish and paste it into a Link sticker on your phone (5 sec).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Publish (only shown once preview is loaded) */}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={publishing} className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] px-3 py-2">
              Cancel
            </button>
            <button
              onClick={publish}
              disabled={!existingUrl || !previewLoaded || publishing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
              title={!previewLoaded ? 'Preview the AI content first' : ''}
            >
              {publishing ? <><Loader2 size={12} className="animate-spin" /> Publishing…</> : <>Publish to Instagram</>}
            </button>
          </div>
          {publishError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{publishError}</p>}
        </div>
    </InstagramPublishModalShell>
  )
}

/** Modal shell wrapper for InstagramPublishModal — gives proper focus
 *  trap, scroll lock, Escape close, and restore-focus via useModalA11y. */
function InstagramPublishModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onClose)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Publish to Instagram"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

// ── Video card ────────────────────────────────────────────────────────────────
function VideoCard({
  video, post, wpSiteUrl, fbConnected, pinterestConnected, threadsConnected, linkedInConnected, twitterConnected, blueskyConnected, telegramConnected, instagramConnected, tiktokConnected, fbAccounts, igAccounts, userTier, brandNiches, customCategories, brandDisclaimer, brandFacebookGroups, onCustomCategoryAdded,
  onGenerated, onDismiss, onDelete, onPinPreview,
}: {
  video: Record<string, unknown>
  post?: { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; scheduledFor?: string | null; scheduleMode?: string | null; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string; instagramReelId?: string; instagramStoryId?: string } | null
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
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: id }),
        })
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

    if (fbConnected && !fbPosted) {
      tasks.push(
        fetch('/api/blog/facebook-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId, socialAccountId: effectiveFbAccountId ?? undefined }) })
          .then(r => { if (r.ok) setFbPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (linkedInConnected && !liPosted) {
      tasks.push(
        fetch('/api/blog/linkedin-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setLiPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (threadsConnected && !thPosted) {
      tasks.push(
        fetch('/api/blog/threads-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setThPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (twitterConnected && !twPosted) {
      tasks.push(
        fetch('/api/blog/twitter-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setTwPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (blueskyConnected && !bsPosted) {
      tasks.push(
        fetch('/api/blog/bluesky-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setBsPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }
    if (telegramConnected && !tgPosted) {
      tasks.push(
        fetch('/api/blog/telegram-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: currentPostId }) })
          .then(r => { if (r.ok) setTgPosted(true) })
          .catch(() => { /* non-fatal */ }),
      )
    }

    await Promise.allSettled(tasks)
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

  const editorUrl = wpSiteUrl && post?.wpPostId ? `${wpSiteUrl}/wp-admin/post.php?post=${post.wpPostId}&action=edit` : null

  return (
    <div className="card p-4 flex gap-4 items-start">
      {thumb && (
        <div className="w-28 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100" style={{ height: '72px' }}>
          <img src={thumb} alt={title} className="w-full h-full object-cover" />
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
              {/* Schedule — only surfaced when the post hasn't been
                  generated yet AND isn't already queued. Opens
                  ScheduleModal which calls /api/blog/schedule-publish:
                  generates the post NOW (so the user gets immediate
                  preview + credit is consumed up front) and queues the
                  WP publish + social cascade for the chosen time.
                  Mirrors the "Publish to all" pattern — one button →
                  cross-channel cascade — with the only difference being
                  WHEN it fires. Hidden when isScheduledPending so the
                  user can't double-schedule the same row. */}
              {!post && !isScheduledPending && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  title="Generate now, publish later — pick a date/time and which socials to push"
                  className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg whitespace-nowrap border transition-colors hover:bg-[rgba(124,58,237,0.10)]"
                  style={{ borderColor: 'var(--border-bright, rgba(255,255,255,0.14))', color: 'var(--text, #F5F5F7)' }}
                >
                  <Calendar size={12} /> Schedule
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
                {editorUrl && (
                  <a href={editorUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors">
                    <ExternalLink size={11} /> Edit in WP
                  </a>
                )}
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
                />
              )}
              {linkedInConnected && (
                <SocialPill
                  brand="#0A66C2"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>}
                  label="LinkedIn" postedLabel="On LinkedIn"
                  posted={liPosted} loading={liPosting} onClick={handleLinkedInPost}
                  locked={!tierAllowsSocial(userTier, 'linkedin')}
                />
              )}
              {twitterConnected && (
                <SocialPill
                  brand="#000000"
                  icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>}
                  label="X" postedLabel="On X"
                  posted={twPosted} loading={twPosting} onClick={handleTwitterPost}
                  locked={!tierAllowsSocial(userTier, 'twitter')}
                />
              )}
              {blueskyConnected && (
                <SocialPill
                  brand="#1185fe"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>}
                  label="Bluesky" postedLabel="On Bluesky"
                  posted={bsPosted} loading={bsPosting} onClick={handleBlueskyPost}
                  locked={!tierAllowsSocial(userTier, 'bluesky')}
                />
              )}
              {telegramConnected && (
                <SocialPill
                  brand="#229ED9"
                  icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>}
                  label="Telegram" postedLabel="On Telegram"
                  posted={tgPosted} loading={tgPosting} onClick={handleTelegramPost}
                  locked={!tierAllowsSocial(userTier, 'telegram')}
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
}

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

  // Sort: pending first (oldest-due at top), then everything else by most recent.
  const sorted = [...items].sort((a, b) => {
    const aPending = a.status === 'pending' ? 0 : 1
    const bPending = b.status === 'pending' ? 0 : 1
    if (aPending !== bPending) return aPending - bPending
    return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          {items.filter(i => i.status === 'pending').length} pending · {items.length} total
        </p>
        <button onClick={onRefresh} className="text-xs text-[#7C3AED] hover:underline inline-flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {sorted.map(item => {
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
          <div key={item.id} className="card p-4 flex items-start gap-3">
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
  const [posts, setPosts] = useState<Record<string, { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; scheduledFor?: string | null; scheduleMode?: string | null; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string; instagramReelId?: string; instagramStoryId?: string }>>({})
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
  const [syncProgress, setSyncProgress] = useState<{ pulled: number; pages: number } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pinPreview, setPinPreview] = useState<PinPreviewData | null>(null)
  const [pinPublishingFor, setPinPublishingFor] = useState<string | null>(null)
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
  // Scheduled posts list (loaded on demand when the Scheduled tab opens)
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[] | null>(null)
  const [scheduledLoading, setScheduledLoading] = useState(false)
  const [scheduledError, setScheduledError] = useState<string | null>(null)
  const [allBlogPosts, setAllBlogPosts] = useState<{ id: number; title: string; link: string; date: string; thumbnail: string | null; videoId: string | null }[]>([])
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
  const [rewriteModal, setRewriteModal] = useState<{ wpPostId: number; videoId: string } | null>(null)
  const [rewriteModalFeedback, setRewriteModalFeedback] = useState('')
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsLoaded, setPostsLoaded] = useState(false)
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null)
  const [refreshingImagesId, setRefreshingImagesId] = useState<number | null>(null)
  const [imgToast, setImgToast] = useState<string | null>(null)
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set())
  // Search box for the Posts tab — filters the published list by title.
  const [postSearch, setPostSearch] = useState('')
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkRewriting, setBulkRewriting] = useState(false)
  const [bulkRewriteProgress, setBulkRewriteProgress] = useState<{ done: number; total: number } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set())
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState<{ done: number; total: number } | null>(null)
  // Bulk Set Category — inline picker shown when the user clicks the
  // "Set category" button in the action bar.
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false)
  const [bulkCategoryApplying, setBulkCategoryApplying] = useState(false)
  const [bulkCategoryProgress, setBulkCategoryProgress] = useState<{ done: number; total: number } | null>(null)
  // Bulk Schedule — modal opens with date picker + platform multi-select
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
      const all: Record<string, unknown>[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastError: any = null
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
      (sb.from('blog_posts') as any).select('id,video_id,wordpress_url,title,wordpress_post_id,body_images_count,scheduled_for,schedule_mode,facebook_post_id,pinterest_pin_id,threads_post_id,linkedin_post_id,twitter_post_id,bluesky_post_uri,telegram_message_id,instagram_reel_id,instagram_story_id').eq('user_id', user.id).eq('status', 'published'),
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

    const postMap: Record<string, { url: string; title: string; postId?: string; wpPostId?: number; indexed?: boolean | null; coverage?: string | null; bodyImagesCount?: number | null; scheduledFor?: string | null; scheduleMode?: string | null; facebookPostId?: string; pinterestPinId?: string; threadsPostId?: string; linkedInPostId?: string; twitterPostId?: string; blueskyPostUri?: string; telegramMessageId?: string; instagramReelId?: string; instagramStoryId?: string }> = {}
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
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

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

      // Build a complete wpPostId → videoId map directly from Supabase
      // (the WP posts API fallback misses many posts due to thumbnail naming)
      const wpPostIds = (data.posts ?? []).map((p: { id: number }) => p.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sbPosts } = await supabase
        .from('blog_posts')
        .select('wordpress_post_id,video_id')
        .eq('user_id', user?.id ?? '')
        .in('wordpress_post_id', wpPostIds)
        .not('video_id', 'is', null)

      const sbMap: Record<number, string> = {}
      for (const p of (sbPosts ?? []) as { wordpress_post_id: number; video_id: string }[]) {
        if (p.wordpress_post_id && p.video_id) sbMap[p.wordpress_post_id] = p.video_id
      }

      // Merge: prefer Supabase map, fall back to WP API result
      const merged = (data.posts ?? []).map((p: { id: number; videoId: string | null }) => ({
        ...p,
        videoId: sbMap[p.id] ?? p.videoId ?? null,
      }))

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
      const res = await fetch('/api/blog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          ...(rewriteFeedback?.trim() ? { rewriteFeedback: rewriteFeedback.trim() } : {}),
        }),
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
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: post.videoId }),
        })
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
    let success = 0; let failed = 0; let firstError = ''
    for (let i = 0; i < toGenerate.length; i++) {
      const video = toGenerate[i]
      setBulkGenerateProgress({ done: i, total: toGenerate.length })
      try {
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: video.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setPosts(prev => ({ ...prev, [video.id as string]: { url: data.wordpressUrl ?? '', title: data.title ?? '', postId: data.postId } }))
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
    setBulkGenerateProgress(null)
    setBulkGenerating(false)
    setSelectedVideoIds(new Set())
    if (failed > 0) setFixCatResult(`${success} generated · ${failed} failed${firstError ? ` (${firstError})` : ''}`)
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

  async function syncVideos() {
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
          body: JSON.stringify(token ? { pageToken: token } : {}),
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
          action: { label: 'Open Setup', onClick: () => { window.location.href = '/setup?tab=integrations' } },
        })
      } else if (e?.code === 'youtube_quota') {
        toast.error('YouTube API daily quota hit. Try again after midnight Pacific time.')
      } else if (e?.code === 'channel_not_found') {
        toast.error('YouTube channel id not found. Double-check the id in Setup → Integrations.', {
          action: { label: 'Fix it', onClick: () => { window.location.href = '/setup?tab=integrations' } },
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
  async function previewFixAffiliate() {
    setAffPreviewLoading(true)
    setFixCatResult(null)
    try {
      const res = await fetch('/api/blog/fix-affiliate-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
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
        body: JSON.stringify({ fixes }),
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
  const visibleVideos = videos.filter(v => showHidden || !dismissed.has(v.id as string))
  // Split videos by orientation. is_vertical comes from YouTube sync (duration
  // ≤ 180s OR #Shorts in title). For backwards-compat rows where is_vertical
  // is null, default to horizontal (the existing behavior pre-migration).
  const horizontalVideos = visibleVideos.filter(v => v.is_vertical !== true)
  const verticalVideos = visibleVideos.filter(v => v.is_vertical === true)
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
  const horizontalTodo = horizontalVideos.filter(v => !posts[v.id as string])
  const verticalTodo = verticalVideos.filter(v => !v.tiktok_posted_at && !v.instagram_posted_at)
  // Generated horizontal videos go in Posts. Touched verticals go in Posts.
  // Union for the Posts tab's rich VideoCard render.
  const horizontalDone = horizontalVideos.filter(v => !!posts[v.id as string])
  const verticalDone = verticalVideos.filter(v => !!v.tiktok_posted_at || !!v.instagram_posted_at)
  // Which set the current tab shows. Vertical tab gets Shorts only.
  const currentTabVideos = activeTab === 'vertical' ? verticalTodo : horizontalTodo
  const generatedCount = Object.keys(posts).length

  // Unique channel list, derived from the current tab's videos — drives the
  // channel filter dropdown. Sorted alphabetically for stable UI.
  const tabChannels = Array.from(new Set(
    currentTabVideos.map(v => (v.channel_title as string) || '').filter(Boolean)
  )).sort((a, b) => a.localeCompare(b))

  // Apply search + channel + generated filter, then sort. Pure derivation —
  // the underlying `videos` array is never mutated.
  const search = videoSearch.trim().toLowerCase()
  const displayVideos = currentTabVideos
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
    })
  const filtersActive = !!(search || videoChannel || videoGenFilter !== 'all' || videoSort !== 'newest')

  // Posts-tab search: filter the published list by title (strip HTML entities
  // for a forgiving match). Bulk-select + the list both use this.
  // ALSO filter to "orphans" — posts whose source video isn't in the current
  // youtube_videos list. Without this, the "Older posts archive" section
  // duplicates every row already shown in the rich VideoCard "Recent"
  // section above. Orphans matter (older posts, deleted videos), so we
  // keep them visible; non-orphans live in Recent.
  const postQuery = postSearch.trim().toLowerCase()
  const videoIdsInLibrary = new Set(videos.map(v => v.id as string))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orphanPosts = allBlogPosts.filter((p: any) => !p.videoId || !videoIdsInLibrary.has(p.videoId))
  const filteredPosts = postQuery
    ? orphanPosts.filter(p => (p.title || '').replace(/<[^>]+>/g, '').toLowerCase().includes(postQuery))
    : orphanPosts

  return (
    <>
      <PageHero
        title="Library"
        subtitle={
          loading ? 'Loading…' :
          activeTab === 'scheduled'
            ? `Queued posts that will fire automatically. The cron runs every minute, your computer can be off.`
            : activeTab === 'posts'
            ? `Published reviews. Manage social fan-out from each card. ${allBlogPosts.length} post${allBlogPosts.length !== 1 ? 's' : ''} live.`
            : activeTab === 'vertical'
              ? `Shorts to Instagram Reels & Stories. Click the Instagram pill on a card to publish. ${verticalVideos.length} vertical video${verticalVideos.length !== 1 ? 's' : ''}.`
              : horizontalVideos.length > 0
                ? `Long-form videos to blog posts + Instagram image posts. Click Generate Post to start. ${horizontalVideos.length} video${horizontalVideos.length !== 1 ? 's' : ''} · ${generatedCount} published.`
                : 'Hit Sync to pull every YouTube video into your generation queue.'
        }
        actions={
          <div className="flex items-center gap-2">
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
              onClick={previewFixAffiliate}
              loading={affPreviewLoading}
              disabled={affPreviewLoading || affApplying}
              title="Scan published posts for broken affiliate links and repair them"
            >
              {affPreviewLoading ? 'Scanning links…' : 'Fix Affiliate Links'}
            </Button>
            {(activeTab === 'horizontal' || activeTab === 'vertical') && (
              <Button
                variant="secondary"
                size="sm"
                onClick={syncVideos}
                loading={syncing}
                disabled={syncing}
                leftIcon={!syncing ? <RefreshCw size={14} /> : undefined}
              >
                {syncing ? `Syncing${syncProgress ? ` (${syncProgress.pulled})` : ''}…` : 'Sync videos'}
              </Button>
            )}
          </div>
        }
      />

      <TutorialVideo sectionKey="library" />
      <CapBannerHost />

      {/* Tab bar — split Videos into Horizontal (16:9 long-form, blog source)
          and Vertical (9:16 Shorts, Instagram source) since the workflows differ */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-white/10 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {([
          { key: 'horizontal' as const, label: 'Horizontal Videos' },
          { key: 'vertical' as const, label: 'Vertical Videos' },
          { key: 'posts' as const, label: `Posts${postsLoaded ? ` (${allBlogPosts.length})` : ''}` },
          { key: 'scheduled' as const, label: `Scheduled${scheduledItems ? ` (${scheduledItems.filter(s => s.status === 'pending').length})` : ''}` },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key)
              if (key === 'posts' && !postsLoaded && !postsLoading) loadWpPosts()
              if (key === 'scheduled' && !scheduledItems && !scheduledLoading) loadScheduled()
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
                  {/* Bulk Rewrite is Pro-only. Server still enforces
                      the one-rewrite-per-post rule per row. */}
                  {(userTier === 'pro' || userTier === 'admin') && (
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

          {/* ── Recent activity (kanban) ──────────────────────────────────
              Rich VideoCard rows for every video that's been "touched":
                - Horizontal: a blog post exists (live or scheduled)
                - Vertical: TikTok or Instagram push succeeded
              This is what the user sees as "in flight or done" — the
              workspace for socials, schedule edits, and re-pushes. The
              flat WP-post list below stays as a searchable archive for
              older posts whose source video may no longer be present.
              IA shift 2026-06-06.
          */}
          {(horizontalDone.length > 0 || verticalDone.length > 0) && (() => {
            // Sort by recency. Use publication date as tiebreaker — posts
            // first, then verticals by tiktok/instagram posted_at.
            const recent = [...horizontalDone, ...verticalDone].sort((a, b) => {
              const ta = new Date(((a.published_at as string) || (a.tiktok_posted_at as string) || (a.instagram_posted_at as string) || 0)).getTime()
              const tb = new Date(((b.published_at as string) || (b.tiktok_posted_at as string) || (b.instagram_posted_at as string) || 0)).getTime()
              return tb - ta
            })
            return (
              <div className="flex flex-col gap-3 mb-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Recent ({recent.length})</h3>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Posts with a source video — push, schedule, refresh, edit</p>
                </div>
                {recent.map((video) => (
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
                ))}
                <div className="border-t border-[#e5e5ea] dark:border-white/10 mt-1" />
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                  Older posts archive ({allBlogPosts.length} total — includes ones with no matching YouTube video)
                </p>
              </div>
            )
          })()}

          {postsLoading ? (
            <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-12 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading posts from WordPress…
            </div>
          ) : allBlogPosts.length === 0 ? (
            <div className="card p-8 max-w-md flex flex-col items-center text-center gap-3">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No reviews live yet</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Head to the Videos tab, pick one with an Amazon ASIN, and click Generate. The full review lands on your site in about 60 seconds.</p>
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="card p-6 max-w-md flex flex-col items-center text-center gap-2">
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">No posts match &ldquo;{postSearch}&rdquo;</p>
              <button onClick={() => setPostSearch('')} className="text-xs text-[#7C3AED] hover:underline">Clear search</button>
            </div>
          ) : filteredPosts.map(post => (
            <div key={post.id} className={`card p-4 flex items-center gap-3 transition-colors ${selectedPostIds.has(post.id) ? 'ring-2 ring-[#7C3AED]/40 bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
              <input
                type="checkbox"
                checked={selectedPostIds.has(post.id)}
                onChange={() => toggleSelect(post.id)}
                className="flex-shrink-0 w-4 h-4 rounded accent-[#7C3AED] cursor-pointer"
              />
              <div className="w-24 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-[#2c2c2e]">
                {post.thumbnail
                  ? <img src={post.thumbnail} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] line-clamp-2 leading-snug" dangerouslySetInnerHTML={{ __html: post.title }} />
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
                    onClick={() => { setRewriteModalFeedback(''); setRewriteModal({ wpPostId: post.id, videoId: post.videoId! }) }}
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
                {/* Edit manually — opens the post in the WordPress editor. */}
                {post.link && (
                  <a
                    href={`${new URL(post.link).origin}/wp-admin/post.php?post=${post.id}&action=edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#86868b] hover:text-[#7C3AED] flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    title="Edit this post manually in WordPress"
                  >
                    <Edit3 size={11} /> Edit
                  </a>
                )}
                <button
                  onClick={() => deletePostFromList(post.id)}
                  disabled={deletingPostId === post.id}
                  className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  {deletingPostId === post.id ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
                </button>
              </div>
            </div>
          ))}
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
          <button onClick={syncVideos} disabled={syncing} className="btn-primary text-sm">
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
          <button onClick={syncVideos} disabled={syncing} className="btn-secondary text-xs">
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
                    {ungenerated.length > 0 && (
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
                <h3 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Fix affiliate links</h3>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  {affPreview.length} post{affPreview.length !== 1 ? 's' : ''} have a broken buy link. Uncheck any you don&apos;t want to change — nothing&apos;s saved yet.
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
