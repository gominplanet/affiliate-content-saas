'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { BrandProfileGuide } from '@/components/guide/tool-guides'
import { Save, Check, Plus, Trash2, Upload, X, RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { InfoTip } from '@/components/ui/InfoTip'
import GeniuslinkGroupsPanel from '@/components/brand/GeniuslinkGroupsPanel'
import { GENIUSLINK_SIGNUP_URL, GENIUSLINK_PITCH } from '@/lib/geniuslink-signup'

async function uploadBrandImage(
  file: File,
  userId: string,
  kind: 'logo' | 'header-banner' | 'about-photo',
): Promise<string> {
  const supabase = createBrowserClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  // Unique path per upload, not a stable overwrite — Supabase Storage's
  // CDN (Cloudflare) caches by path and typically ignores query strings,
  // so reusing the path keeps serving the old image for up to a year
  // (cacheControl: 31536000) no matter what cache-buster we append.
  // A fresh path = fresh CDN entry, no stale image. The previous file
  // becomes an orphan (negligible cost for small brand assets).
  const path = `${userId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('headshots').upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('headshots').getPublicUrl(path)
  return data.publicUrl
}

interface FacebookGroup { name: string; url: string }

// ─── Amazon-style niches ──────────────────────────────────────────────────────
const NICHES = [
  'Home & Kitchen', 'Electronics & Tech', 'Outdoor & Sports', 'Beauty & Personal Care',
  'Health & Wellness', 'Pet Supplies', 'Tools & Home Improvement', 'Toys & Games',
  'Books & Education', 'Fashion & Apparel', 'Garden & Outdoors', 'Automotive',
  'Baby & Kids', 'Office & Productivity', 'Food & Grocery', 'Travel & Luggage',
  'Arts & Crafts', 'Musical Instruments', 'Software & Apps', 'Finance & Investing',
]

const TONE_OPTIONS = [
  'Professional', 'Conversational', 'Bold', 'Friendly',
  'Educational', 'Persuasive', 'Humorous', 'Inspiring',
]

// ─── Color palette ────────────────────────────────────────────────────────────
const COLORS = [
  // Blues
  '#7C3AED', '#0ea5e9', '#3b82f6', '#6366f1',
  // Greens
  '#34c759', '#10b981', '#22c55e', '#84cc16',
  // Reds / Pinks
  '#ff3b30', '#ef4444', '#ec4899', '#f43f5e',
  // Oranges / Yellows
  '#ff9500', '#f97316', '#eab308', '#fbbf24',
  // Purples
  '#af52de', '#a855f7', '#7c3aed', '#8b5cf6',
  // Neutrals
  '#1d1d1f', '#374151', '#6b7280', '#d1d5db',
]

/** Flag a value that clearly isn't a Geniuslink API key/secret — those are
 *  long hex tokens (the form placeholder is `e353413c5f52…`). Catches the
 *  common mistake of pasting an email, a URL, or a store name into these
 *  fields (the real-world cause of a silent 401). Lenient on purpose: the
 *  live "Test connection" call is the authoritative gate; this is just an
 *  instant inline nudge so the mistake is caught at entry, not weeks later. */
function geniuslinkCredLooksWrong(v: string): boolean {
  const t = (v || '').trim()
  if (!t) return false
  if (/[@\s]|:\/\//.test(t)) return true       // an email, URL, or whitespace
  if (!/^[a-f0-9-]{12,}$/i.test(t)) return true // not a hex-ish token, or too short
  return false
}

/** Normalize a user-typed hex to `#rrggbb`, expanding `#rgb` shorthand and
 *  tolerating a missing `#`. Returns null if it isn't a valid hex color. */
function normalizeHex(raw: string): string | null {
  let t = raw.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(t)) t = t.split('').map((c) => c + c).join('')
  return /^[0-9a-fA-F]{6}$/.test(t) ? `#${t.toLowerCase()}` : null
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  // Local echo so the user can type freely (incl. partial/invalid states)
  // without the field fighting the committed value. Re-sync when `value`
  // changes from outside (a preset swatch or the native picker).
  const [hexText, setHexText] = useState(value)
  useEffect(() => { setHexText(value) }, [value])

  const commitHex = (raw: string) => {
    const norm = normalizeHex(raw)
    if (norm) onChange(norm)
    else setHexText(value) // invalid → snap back to the committed color
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-md border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ backgroundColor: value }} />
        <p className="text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0]">{label}</p>
      </div>

      {/* Custom hex: native picker + free-type field. Type any #RRGGBB. */}
      <div className="flex items-center gap-2 mb-2.5">
        <input
          type="color"
          aria-label={`${label} custom color picker`}
          value={normalizeHex(value) || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded-md border border-gray-200 dark:border-white/10 bg-transparent cursor-pointer p-0.5 flex-shrink-0"
        />
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-[#86868b] pointer-events-none">#</span>
          <input
            type="text"
            value={hexText.replace(/^#/, '')}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHex((e.target as HTMLInputElement).value) } }}
            spellCheck={false}
            maxLength={7}
            placeholder="7C3AED"
            className="w-full pl-5 pr-2 py-1.5 rounded-lg border bg-transparent text-xs font-mono text-[#1d1d1f] dark:text-[#f5f5f7] uppercase"
            style={{ borderColor: 'var(--border-bright, #d2d2d7)' }}
          />
        </div>
      </div>

      {/* Quick presets */}
      <div className="grid grid-cols-8 gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => onChange(color)}
            className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor: value.toLowerCase() === color.toLowerCase() ? '#1d1d1f' : 'transparent',
            }}
            title={color}
          />
        ))}
      </div>
    </div>
  )
}

interface BrandData {
  name: string
  tagline: string
  /** Long-form "About Me" bio shown in the blog footer + author card.
   *  Distinct from the one-line tagline. Syncs to the WP theme as
   *  profile.authorBio (footer bio → falls back to tagline when empty). */
  author_bio: string
  author_name: string
  website_url: string
  niches: string[]
  tone: string[]
  post_length: string
  cta_style: string
  /** Per-brand override for the in-article image count (0..4). Null =
   *  legacy default (word-scaled, tier-capped). Set in Brand Profile;
   *  used by /api/blog/generate + /api/blog/refresh-images via the
   *  3rd argument to allowedBlogImages. 2026-06-07. */
  blog_image_count: number | null
  /** 2026-06-08 (#14): when true, every generated post gets a "What we'd
   *  improve" section between the body and FAQ — manufacturer-facing
   *  critique distinct from the consumer-facing Cons. Opt-in because it
   *  reads more critical and not all creators want it on by default. */
  include_improvements_section: boolean
  /** 2026-06-09: per-brand section toggles. All default true to preserve
   *  existing behavior. Untick to keep that section out of every post —
   *  useful for "pure narrative" video-review style. */
  include_quick_verdict: boolean
  include_pros_cons:     boolean
  include_scorecard:     boolean
  include_faq:           boolean
  affiliate_disclaimer: string
  primary_color: string
  secondary_color: string
  // Blog header/footer background colors ('' = use theme default). The theme
  // auto-picks a readable text color from whatever background is chosen.
  header_bg_color: string
  footer_bg_color: string
  // Writing Style / About You / Target Reader / Words to Avoid now
  // live on the LEARN page (single editing surface for voice).
  // gear_sections + youtube_description_block moved to the YouTube page
  // (/connect-youtube) — see components/youtube/YouTubeDescriptionSettings.
  /** Facebook Groups the user admins — saved for one-click manual sharing
   *  (Meta's API can't post to Groups, only Pages). */
  facebook_groups: FacebookGroup[]
  logo_url: string
  header_banner_url: string
  headshot_url: string
  font_theme: string
  // Social URLs — moved here from Customize Blog (single source of truth)
  youtube_channel_url: string
  instagram_url: string
  tiktok_url: string
  twitter_url: string
  pinterest_url: string
  facebook_url: string
  threads_url: string
  amazon_storefront_url: string
  linktree_url: string
  /** Public URL of the creator's hosted media kit. Pre-fills the
   *  /collaborations form so brands get the kit link in every pitch
   *  email. Set once here; the collab form can override per-pitch. */
  media_kit_url: string
  contact_email: string
  /** Channel the creator wants brands to reach them through. Drives the
   *  "Let's Work Together" line in generated YouTube descriptions and the
   *  reply-to channel in collab emails. */
  contact_preference: 'website' | 'email'
  // Private — shipping details for product samples (collab emails only)
  sample_full_name: string
  sample_address: string
  sample_phone: string
}

// Curated font pairings shown to users. Theme renders these via Google Fonts.
const FONT_THEMES = [
  {
    key: 'editorial',
    name: 'Editorial',
    description: 'Premium editorial. Serif headlines, sans body.',
    heading: '"Charter", Georgia, serif',
    body: '-apple-system, "Inter", sans-serif',
  },
  {
    key: 'modern',
    name: 'Modern',
    description: 'Clean tech blog. Inter everywhere.',
    heading: '"Inter", -apple-system, sans-serif',
    body: '"Inter", -apple-system, sans-serif',
  },
  {
    key: 'classic',
    name: 'Classic Magazine',
    description: 'Elegant editorial. Playfair Display + Lora.',
    heading: '"Playfair Display", Georgia, serif',
    body: '"Lora", Georgia, serif',
  },
  {
    key: 'bold',
    name: 'Bold Startup',
    description: 'Geometric and confident. Space Grotesk + DM Sans.',
    heading: '"Space Grotesk", -apple-system, sans-serif',
    body: '"DM Sans", -apple-system, sans-serif',
  },
  {
    key: 'minimal',
    name: 'Minimal',
    description: 'System fonts only. Fastest load, no Google Fonts.',
    heading: '-apple-system, "Helvetica Neue", Arial, sans-serif',
    body: '-apple-system, "Helvetica Neue", Arial, sans-serif',
  },
] as const

const DEFAULT: BrandData = {
  name: '',
  tagline: '',
  author_bio: '',
  author_name: '',
  website_url: '',
  niches: [],
  tone: [],
  post_length: 'medium',
  cta_style: 'soft_recommendation',
  include_improvements_section: false,
  include_quick_verdict: true,
  include_pros_cons: true,
  include_scorecard: true,
  include_faq: true,
  // Null = use the tier-default (word-scaled). Existing users keep
  // legacy behavior until they explicitly pick a number.
  blog_image_count: null,
  affiliate_disclaimer: 'This post contains affiliate links. I may earn a commission at no extra cost to you.',
  primary_color: '#7C3AED',
  secondary_color: '#34c759',
  header_bg_color: '',
  footer_bg_color: '',
  facebook_groups: [],
  logo_url: '',
  header_banner_url: '',
  headshot_url: '',
  font_theme: 'editorial',
  youtube_channel_url: '',
  instagram_url: '',
  tiktok_url: '',
  twitter_url: '',
  pinterest_url: '',
  facebook_url: '',
  threads_url: '',
  amazon_storefront_url: '',
  linktree_url: '',
  media_kit_url: '',
  contact_email: '',
  contact_preference: 'website',
  sample_full_name: '',
  sample_address: '',
  sample_phone: '',
}

/**
 * Sanity-check a social profile URL and return a human warning, or null.
 *
 * These fields render as icons on the creator's live blog, so a typo ships
 * publicly and silently. A real case: an email address typed into the Threads
 * field became `https://someone@gmail.com`, which browsers read as a username
 * plus the host `gmail.com` — so the icon sat on the blog pointing nowhere,
 * and the creator couldn't tell which icon it even was.
 *
 * Deliberately a WARNING, not a block. Custom domains, link shorteners and
 * regional hosts are all legitimate, and trapping someone behind a validator
 * that is wrong about their URL is worse than a wrong icon.
 */
function socialUrlWarning(raw: string, label: string, hosts: string[]): string | null {
  const v = raw.trim()
  if (!v) return null

  // A bare email address in a link field.
  if (/^mailto:/i.test(v) || /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(v)) {
    return `That looks like an email address. Put it in Contact email below — this field wants your ${label} link.`
  }

  let host: string
  try {
    host = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase()
  } catch {
    return `That doesn't look like a web address. It should look like ${hosts[0]}/yourhandle`
  }
  if (!host.includes('.')) {
    return `That doesn't look like a web address. It should look like ${hosts[0]}/yourhandle`
  }
  if (hosts.length && !hosts.some(h => host === h || host.endsWith(`.${h}`))) {
    return `This points to ${host}, which doesn't look like ${label}. Check it, or clear the field to hide the icon.`
  }
  return null
}

export default function BrandPage() {
  const supabase = createBrowserClient()
  const [data, setData] = useState<BrandData>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [wpPushNote, setWpPushNote] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [headshotUploading, setHeadshotUploading] = useState(false)
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)
  // Geniuslink + Amazon-tag fallback live on the `integrations` table
  // (not `brand_profiles`) but logically belong with the brand identity —
  // they're how affiliate URLs get routed across the user's content. Moved
  // here from /setup → Integrations tab on 2026-06-05 so all "this is my
  // brand and how it monetizes" settings sit on one page.
  const [geniuslinkKey, setGeniuslinkKey] = useState('')
  const [geniuslinkSecret, setGeniuslinkSecret] = useState('')
  // How the blog link is shortened when a post is shared to social:
  // 'direct' (plain URL, free), 'geniuslink' (branded, tracked, costs per
  // click), or 'bitly' (free short link, needs the creator's Bitly token).
  const [blogSocialLinkMode, setBlogSocialLinkMode] = useState<'direct' | 'geniuslink' | 'bitly'>('direct')
  const [bitlyToken, setBitlyToken] = useState('')
  const [amazonAssociatesTag, setAmazonAssociatesTag] = useState('')
  // Google Search Console — read-only SEO connection, lives in this card now.
  const [gscConnected, setGscConnected] = useState(false)
  const [gscBusy, setGscBusy] = useState(false)

  // GSC OAuth returns here (returnTo=/brand) with a result marker — surface it,
  // flip connected, then strip the params so a refresh doesn't re-toast.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const ok = sp.get('gsc_connected'); const err = sp.get('gsc_error')
    if (!ok && !err) return
    if (ok) { setGscConnected(true); toast.success('Search Console connected.') }
    else if (err) toast.error(`Couldn’t connect Search Console: ${decodeURIComponent(err)}`)
    const url = new URL(window.location.href)
    ;['gsc_connected', 'gsc_error', 'gsc_property', 'gsc_no_property'].forEach(k => url.searchParams.delete(k))
    window.history.replaceState({}, '', url.pathname + url.search)
  }, [])

  async function disconnectGsc() {
    setGscBusy(true)
    try {
      const res = await fetch('/api/auth/gsc/disconnect', { method: 'POST' })
      if (res.ok) { setGscConnected(false); toast.success('Search Console disconnected.') }
      else toast.error('Could not disconnect. Try again.')
    } catch { toast.error('Something went wrong. Try again.') }
    finally { setGscBusy(false) }
  }
  // Geniuslink group-setup state. Powers the "Verify groups" panel inside
  // the Geniuslink card — runs POST /api/geniuslink/setup which finds or
  // auto-creates the required tracking groups (MVP-YOUTUBE for the YT
  // Co-Pilot path; one named after each site's domain for the blog path).
  // Surfaces "needs-manual-create" rows with a deep link to the user's
  // Geniuslink dashboard when the auto-create endpoint is rejected.
  type GeniusTarget = {
    kind: 'youtube' | 'site'
    groupName: string
    label: string
    siteId?: string
    status: 'cached' | 'matched-existing' | 'auto-created' | 'needs-manual-create' | 'error'
    groupId?: number
    detail: string
  }
  type GeniusSetupResult = {
    ok: boolean
    hasCredentials: boolean
    manualCreateUrl: string
    targets: GeniusTarget[]
  }
  const [geniusSetup, setGeniusSetup] = useState<GeniusSetupResult | null>(null)
  const [geniusSetupBusy, setGeniusSetupBusy] = useState(false)
  async function runGeniuslinkSetup() {
    setGeniusSetupBusy(true)
    try {
      const res = await fetch('/api/geniuslink/setup', { method: 'POST' })
      const json = await res.json() as GeniusSetupResult
      setGeniusSetup(json)
    } catch (err) {
      console.error('[brand] geniuslink setup failed:', err)
      setGeniusSetup({
        ok: false,
        hasCredentials: !!geniuslinkKey && !!geniuslinkSecret,
        manualCreateUrl: 'https://my.geni.us/groups',
        targets: [],
      })
    } finally {
      setGeniusSetupBusy(false)
    }
  }

  // ── Live Geniuslink credential test ─────────────────────────────────────
  // Runs the real list-groups call so "Connected" means the keys actually
  // WORK — not just that both fields are non-empty (the old false positive
  // that let wrong values, e.g. an email, sit there silently 401ing).
  type GlTest = { status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string; groupCount?: number }
  const [glTest, setGlTest] = useState<GlTest>({ status: 'idle' })
  // Test the values currently in the form (pass them in the body so the user
  // gets ✓/✗ BEFORE saving).
  const testGeniuslink = useCallback(async () => {
    const key = geniuslinkKey.trim(); const secret = geniuslinkSecret.trim()
    if (!key || !secret) { setGlTest({ status: 'idle' }); return }
    setGlTest({ status: 'testing' })
    try {
      const res = await fetch('/api/geniuslink/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, apiSecret: secret }),
      })
      const json = await res.json() as { ok: boolean; groupCount?: number; error?: string }
      setGlTest(json.ok
        ? { status: 'ok', groupCount: json.groupCount }
        : { status: 'fail', message: json.error || 'Geniuslink rejected these credentials.' })
    } catch {
      setGlTest({ status: 'fail', message: 'Could not reach Geniuslink. Try again in a moment.' })
    }
  }, [geniuslinkKey, geniuslinkSecret])

  // On load, verify whatever is SAVED against the live API (no body → tests the
  // saved row) so the badge reflects reality the moment the page opens.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/geniuslink/test', { method: 'POST' })
        const json = await res.json() as { ok: boolean; groupCount?: number; error?: string }
        if (cancelled) return
        if (json.ok) setGlTest({ status: 'ok', groupCount: json.groupCount })
        // Ignore the "enter your key first" blank-state message — that's just
        // "not configured yet", not a failure worth flagging red.
        else if (json.error && !/enter your geniuslink/i.test(json.error)) {
          setGlTest({ status: 'fail', message: json.error })
        }
      } catch { /* silent on mount */ }
    })()
    return () => { cancelled = true }
  }, [])
  // User's tier — drives the dropdown options for "Images per article"
  // (Trial 0-2, Creator/Studio 0-3, Pro/Admin 0-4). Loaded alongside
  // the Geniuslink + Amazon-tag fields from `integrations` below. 2026-06-07.
  const [userTier, setUserTier] = useState<string>('trial')

  async function purgeCache() {
    setPurging(true)
    setPurged(false)
    try {
      const res = await fetch('/api/wordpress/purge-cache', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Cache purge failed.')
        return
      }
      setPurged(true)
      toast.success('Cache purged across your site.')
      setTimeout(() => setPurged(false), 2500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cache purge failed.')
    } finally {
      setPurging(false)
    }
  }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Load Geniuslink + Amazon-tag from `integrations` in parallel with the
    // brand_profiles row — they sit on different tables but render together
    // in the "Affiliate link routing" card below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase
      .from('integrations')
      .select('geniuslink_api_key, geniuslink_api_secret, wrap_blog_geniuslink, blog_social_link_mode, bitly_access_token, amazon_associates_tag, gsc_oauth_access_token, tier')
      .eq('user_id', user.id)
      .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data: intRow }: { data: any }) => {
        if (intRow) {
          setGeniuslinkKey(intRow.geniuslink_api_key ?? '')
          setGeniuslinkSecret(intRow.geniuslink_api_secret ?? '')
          // Prefer the new mode; fall back to the legacy wrap toggle for a row
          // that predates migration 274.
          const mode = intRow.blog_social_link_mode
          setBlogSocialLinkMode(mode === 'geniuslink' || mode === 'bitly' || mode === 'direct'
            ? mode
            : (intRow.wrap_blog_geniuslink === true ? 'geniuslink' : 'direct'))
          setBitlyToken(intRow.bitly_access_token ?? '')
          setAmazonAssociatesTag(intRow.amazon_associates_tag ?? '')
          setGscConnected(!!intRow.gsc_oauth_access_token)
          if (typeof intRow.tier === 'string') setUserTier(intRow.tier)
        }
      })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    if (row) {
      setData({
        name: row.name ?? '',
        tagline: row.tagline ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        author_bio: (row as any).author_bio ?? '',
        author_name: row.author_name ?? '',
        website_url: row.website_url ?? '',
        niches: row.niches ?? [],
        tone: row.tone ?? [],
        post_length: row.post_length ?? 'medium',
        cta_style: row.cta_style ?? 'soft_recommendation',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include_improvements_section: !!(row as any).include_improvements_section,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include_quick_verdict: (row as any).include_quick_verdict !== false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include_pros_cons:     (row as any).include_pros_cons !== false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include_scorecard:     (row as any).include_scorecard !== false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include_faq:           (row as any).include_faq !== false,
        // blog_image_count is nullable in DB; null = "use tier default".
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blog_image_count: typeof (row as any).blog_image_count === 'number' ? (row as any).blog_image_count : null,
        affiliate_disclaimer: row.affiliate_disclaimer ?? DEFAULT.affiliate_disclaimer,
        primary_color: row.primary_color ?? '#7C3AED',
        secondary_color: row.secondary_color ?? '#34c759',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        header_bg_color: (row as any).header_bg_color ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        footer_bg_color: (row as any).footer_bg_color ?? '',
        // facebook_groups is JSONB; we always write the typed shape but the
        // schema returns Json. Narrow at the read.
        facebook_groups: (row.facebook_groups ?? []) as unknown as FacebookGroup[],
        logo_url: row.logo_url ?? '',
        header_banner_url: row.header_banner_url ?? '',
        headshot_url: row.headshot_url ?? '',
        font_theme: row.font_theme ?? 'editorial',
        youtube_channel_url: row.youtube_channel_url ?? '',
        instagram_url: row.instagram_url ?? '',
        tiktok_url: row.tiktok_url ?? '',
        twitter_url: row.twitter_url ?? '',
        pinterest_url: row.pinterest_url ?? '',
        facebook_url: row.facebook_url ?? '',
        threads_url: row.threads_url ?? '',
        amazon_storefront_url: row.amazon_storefront_url ?? '',
        linktree_url: row.linktree_url ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        media_kit_url: ((row as any).media_kit_url as string | null | undefined) ?? '',
        contact_email: row.contact_email ?? '',
        contact_preference: (row.contact_preference === 'email' ? 'email' : 'website'),
        sample_full_name: row.sample_full_name ?? '',
        sample_address: row.sample_address ?? '',
        sample_phone: row.sample_phone ?? '',
      })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    setSaveError(null)
    setWpPushNote(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    // Normalize URL fields: auto-prepend https:// when the user typed just
    // "youtube.com/@channel" without a protocol. Email field left as-is.
    const normalizeUrl = (val: string): string => {
      const trimmed = (val || '').trim()
      if (!trimmed) return ''
      if (/^https?:\/\//i.test(trimmed)) return trimmed
      return `https://${trimmed}`
    }
    const normalized: BrandData = {
      ...data,
      website_url:         normalizeUrl(data.website_url),
      youtube_channel_url: normalizeUrl(data.youtube_channel_url),
      instagram_url:       normalizeUrl(data.instagram_url),
      tiktok_url:          normalizeUrl(data.tiktok_url),
      twitter_url:         normalizeUrl(data.twitter_url),
      pinterest_url:       normalizeUrl(data.pinterest_url),
      facebook_url:        normalizeUrl(data.facebook_url),
      threads_url:         normalizeUrl(data.threads_url),
      amazon_storefront_url: normalizeUrl(data.amazon_storefront_url),
      media_kit_url:       normalizeUrl(data.media_kit_url),
      linktree_url: normalizeUrl(data.linktree_url),
    }
    // Update local state so the user sees their normalized URLs after save
    setData(normalized)

    // ── 1. Save to Supabase ─────────────────────────────────────────────────
    // header/footer chrome colors go in a SEPARATE tolerant update below so a
    // site whose DB hasn't run migration 193 yet can still save everything else.
    const { header_bg_color, footer_bg_color, ...mainBody } = normalized
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbError } = await supabase.from('brand_profiles').upsert(
      // BrandData carries a typed JSONB sub-shape (FacebookGroup[])
      // that don't structurally satisfy the schema's Json union; narrow at the
      // insert boundary — payload is schema-correct at runtime.
      { ...mainBody, user_id: user.id } as never,
      { onConflict: 'user_id' },
    )
    if (dbError) {
      setSaving(false)
      setSaveError(`Save failed: ${dbError.message}`)
      return
    }
    // Best-effort: persist the chrome colors. Swallow a missing-column error
    // (migration 193 not run) so it never blocks the rest of the save.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('brand_profiles').update({ header_bg_color, footer_bg_color } as never).eq('user_id', user.id)

    // ── 1b. Save Geniuslink + Amazon-tag to `integrations` ────────────────
    // These live on `integrations` (not `brand_profiles`) because they're
    // tied to auth state, but they belong with brand identity in the UI.
    // Fire and forget — a failure here doesn't block the brand-profile
    // save; we surface it in wpPushNote so the user sees it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: intError } = await (supabase as any)
        .from('integrations')
        .upsert(
          {
            user_id: user.id,
            geniuslink_api_key: geniuslinkKey.trim() || null,
            geniuslink_api_secret: geniuslinkSecret.trim() || null,
            blog_social_link_mode: blogSocialLinkMode,
            bitly_access_token: bitlyToken.trim() || null,
            // Keep the legacy flag in sync so any older reader still behaves.
            wrap_blog_geniuslink: blogSocialLinkMode === 'geniuslink',
            amazon_associates_tag: amazonAssociatesTag.trim() || null,
          },
          { onConflict: 'user_id' },
        )
      if (intError) {
        setWpPushNote(`Brand saved, but affiliate routing keys failed: ${intError.message}`)
      }
    } catch (e) {
      setWpPushNote(`Brand saved, but affiliate routing keys failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    }

    // ── 2. Sync to WordPress (route through our server so the same Application
    //      Password used for everything else is reused — no btoa in the browser
    //      and the route already handles auth-header edge cases). ────────────
    try {
      const res = await fetch('/api/wordpress/sync-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName:     normalized.author_name,
          brandName:      normalized.name,
          tagline:        normalized.tagline,
          authorBio:      normalized.author_bio,
          primaryColor:   normalized.primary_color,
          secondaryColor: normalized.secondary_color,
          headerBg:       normalized.header_bg_color,
          footerBg:       normalized.footer_bg_color,
          fontTheme:      normalized.font_theme,
          logoUrl:        normalized.logo_url,
          headerBannerUrl: normalized.header_banner_url,
          headshotUrl:    normalized.headshot_url,
          youtubeUrl:     normalized.youtube_channel_url,
          instagramUrl:   normalized.instagram_url,
          tiktokUrl:      normalized.tiktok_url,
          twitterUrl:     normalized.twitter_url,
          pinterestUrl:   normalized.pinterest_url,
          facebookUrl:    normalized.facebook_url,
          threadsUrl:     normalized.threads_url,
          contactEmail:   normalized.contact_email,
          niches:         normalized.niches,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setWpPushNote(json.error || 'Saved here, but the push to WordPress failed.')
      } else if (json.wordpress === 'not_connected') {
        // No WP connection — silent. The dashboard save still succeeded.
      } else if (json.wordpress === 'failed') {
        setWpPushNote(json.wordpressError || 'Saved here, but the push to WordPress failed.')
      } else if (json.wordpress === 'pushed') {
        // Auto-purge cache so the brand changes appear immediately on the live site.
        fetch('/api/wordpress/purge-cache', { method: 'POST' }).catch(() => {})
      }
    } catch (e) {
      setWpPushNote(e instanceof Error ? e.message : 'WordPress push failed.')
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function set<K extends keyof BrandData>(key: K, value: BrandData[K]) {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  async function handleImageUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'logo' | 'header-banner' | 'about-photo',
    column: 'logo_url' | 'header_banner_url' | 'headshot_url',
    setBusy: (b: boolean) => void,
  ) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')
      const url = await uploadBrandImage(file, user.id, kind)
      set(column, url)
      // Auto-save immediately, surgically — only the column that
      // changed. Don't spread the whole `data` object: if any column
      // in it doesn't exist in the DB yet (e.g. a brand-new migration
      // hasn't been run), the upsert is rejected and the upload
      // silently reverts. Capture the error so we surface it instead
      // of pretending success.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: saveErr } = await supabase
        .from('brand_profiles')
        .update({ [column]: url } as never)  // dynamic column key needs boundary narrow
        .eq('user_id', user.id)
      if (saveErr) throw new Error(saveErr.message)

      // Push the new image to WordPress immediately. Without this the
      // affiliateos_customizations option keeps the previous URL until
      // the user clicks the big Save button, so the live theme keeps
      // rendering the old banner/logo/headshot.
      const wpPayloadKey =
        column === 'logo_url'          ? 'logoUrl' :
        column === 'header_banner_url' ? 'headerBannerUrl' :
                                         'headshotUrl'
      await fetch('/api/wordpress/sync-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [wpPayloadKey]: url }),
      }).catch(() => { /* non-fatal — full Save will reconcile */ })

      // Purge the LiteSpeed/CDN cache so visitors see the new image on
      // the next request instead of the cached page with the old URL.
      fetch('/api/wordpress/purge-cache', { method: 'POST' }).catch(() => {})

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  function toggleArray(key: 'niches' | 'tone', value: string) {
    setData((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#86868b] dark:text-[#8e8e93] text-sm">
        Loading…
      </div>
    )
  }

  return (
    <>
      <PageHero
        guide={<BrandProfileGuide />}
        title="Brand Profile"
        subtitle="The single source of truth for every review you generate. The agent team reads this before writing — so your reviews actually sound like you."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={purgeCache}
              disabled={purging || saving}
              className="btn-secondary flex items-center gap-2"
              title="Clear LiteSpeed cache so changes appear immediately on the live blog"
            >
              {purging
                ? <><Loader2 size={14} className="animate-spin" /> Clearing…</>
                : purged
                ? <><Check size={14} /> Cleared!</>
                : <><RefreshCw size={14} /> Clear Site Cache</>
              }
            </button>
            <button onClick={save} disabled={saving} className="btn-primary">
              {saved
                ? <><Check size={14} /> Saved!</>
                : saving
                ? 'Saving…'
                : <><Save size={14} /> Save changes</>
              }
            </button>
          </div>
        }
      />

      {saveError && (
        <div className="mb-4 rounded-xl border border-[#ff3b30]/30 bg-[#ff3b30]/5 px-4 py-3">
          <p className="text-xs font-semibold text-[#ff3b30] mb-0.5">Save failed</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{saveError}</p>
        </div>
      )}
      {wpPushNote && (
        <div className="mb-4 rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 px-4 py-3">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Saved here, but the WordPress push failed</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{wpPushNote}</p>
        </div>
      )}


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — identity */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Basic info */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Brand Identity</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Brand / Site name</label>
                <input
                  type="text"
                  value={data.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. GearHunter"
                  className="input-field"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Tagline</label>
                <input
                  type="text"
                  value={data.tagline}
                  onChange={(e) => set('tagline', e.target.value)}
                  placeholder="One-line description of your brand"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Author name</label>
                <input
                  type="text"
                  value={data.author_name}
                  onChange={(e) => set('author_name', e.target.value)}
                  placeholder="Jane Smith"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Blog URL</label>
                <input
                  type="url"
                  value={data.website_url}
                  onChange={(e) => set('website_url', e.target.value)}
                  placeholder="https://yourblog.com"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Amazon storefront</label>
                <input
                  type="text"
                  value={data.amazon_storefront_url}
                  onChange={(e) => set('amazon_storefront_url', e.target.value)}
                  placeholder="amazon.com/shop/yourstore"
                  className="input-field"
                />
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">Used to pre-fill the Collaborations pitch email.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Linktree / link hub <span className="text-[#86868b]">(optional)</span></label>
                <input
                  type="text"
                  value={data.linktree_url}
                  onChange={(e) => set('linktree_url', e.target.value)}
                  placeholder="linktr.ee/yourname"
                  className="input-field"
                />
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">A single hub of all your channels. Pre-fills the Collaborations pitch email.</p>
              </div>
              {/* Media kit URL — added 2026-06-05 alongside the Oink
                  recommendation. Brands almost always ask for one
                  before agreeing to a deal; we surface it here so
                  every generated pitch email at /collaborations
                  includes the link automatically. Migration 102. */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">
                  Media kit URL <span className="text-[#86868b]">(optional but recommended)</span>
                </label>
                <input
                  type="text"
                  value={data.media_kit_url}
                  onChange={(e) => set('media_kit_url', e.target.value)}
                  placeholder="https://your-mediakit-link.com (Notion, Google Doc, Canva, hosted PDF…)"
                  className="input-field"
                />
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">
                  The quick and polished way to show your stats to curious brands — one clickable link instead of typing reach numbers into every reply. Paste yours here and every pitch email from /collaborations includes the link automatically. Don&apos;t have one? <a href="https://oinkforinfluencers.com/get-your-free-media-kit/" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Grab Oink&apos;s free template</a>.
                </p>
              </div>
            </div>
          </div>

          {/* Niches */}
          <div className="card p-6">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Affiliate Niches</h2>
              <InfoTip>The Researcher and Outline Architect agents use this to pull niche-relevant comparisons, FAQs, and SEO terms when drafting your reviews. Pick the categories that match the products you actually cover.</InfoTip>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">Select the product categories you promote.</p>
            <div className="flex flex-wrap gap-2">
              {NICHES.map((niche) => {
                const active = data.niches.includes(niche)
                return (
                  <button
                    key={niche}
                    onClick={() => toggleArray('niches', niche)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/30'
                        : 'bg-white dark:bg-[#1c1c1e] text-[#6e6e73] dark:text-[#ebebf0] border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40 hover:text-[#7C3AED]'
                    }`}
                  >
                    {niche}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Writing Style, About You, Target Reader and Words to Avoid
              moved to the LEARN page (single editing surface for voice). */}

          {/* Affiliate link routing — Geniuslink + Amazon-tag fallback.
              These travel with brand identity (they're the "how do my
              affiliate links work" answer), so they live here rather than
              buried in /setup → Integrations. Moved 2026-06-05. Stored on
              the `integrations` table; loaded/saved alongside the brand
              profile via the same Save button.
              id="affiliate" is the anchor the sidebar "Affiliate Links" entry
              (/brand#affiliate) jumps to; scroll-mt offsets the sticky header. */}
          <div id="affiliate" className="card p-6 scroll-mt-24">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Important Connections</h2>
              <InfoTip>
                The accounts that make your affiliate links earn and your SEO measurable: Geniuslink routes Amazon links to each shopper&apos;s local store (your Amazon tag is the fallback), and Search Console reports how your posts rank.
              </InfoTip>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              The key accounts behind monetization and SEO. Geniuslink is the smart link router (Amazon tag is the fallback), and Google Search Console powers your indexing + ranking data.
            </p>

            {/* Geniuslink */}
            <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mb-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#7C3AED]/10 flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink</p>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Geo-targeted short links from any ASIN</p>
                </div>
                {/* Badge reflects the LIVE test, not just "fields non-empty". */}
                {geniuslinkKey && geniuslinkSecret && (
                  glTest.status === 'ok' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[#34c759] flex-shrink-0">
                      <Check size={12} /> Connected
                    </span>
                  ) : glTest.status === 'fail' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[#ff3b30] flex-shrink-0">
                      <X size={12} /> Rejected
                    </span>
                  ) : glTest.status === 'testing' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[#86868b] flex-shrink-0">
                      <Loader2 size={12} className="animate-spin" /> Testing…
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[#ff9500] flex-shrink-0">
                      Not verified
                    </span>
                  )
                )}
              </div>
              {!(geniuslinkKey && geniuslinkSecret) && (
                <div className="mb-3 rounded-lg px-3 py-2.5" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.25)' }}>
                  <p className="text-[12px] font-semibold text-[#7C3AED]">Don&apos;t have Geniuslink yet?</p>
                  <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed">{GENIUSLINK_PITCH}</p>
                  <a href={GENIUSLINK_SIGNUP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold px-3 py-1.5 rounded-md bg-[#7C3AED] text-white hover:bg-[#6D28D9]">
                    Get Geniuslink →
                  </a>
                </div>
              )}
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
                In Geniuslink, open <a href="https://my.geni.us/tools" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Tools → &ldquo;Integrate with our API&rdquo;</a>, click <strong>Add an API key</strong>, then copy the API Key and API Secret here. (API access requires a paid Geniuslink plan.)
              </p>
              <div className="flex flex-col gap-2">
                <div>
                  <label htmlFor="brand-geniuslink-key" className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">API Key</label>
                  <input
                    id="brand-geniuslink-key"
                    name="geniuslink-key"
                    type="text"
                    value={geniuslinkKey}
                    onChange={e => { setGeniuslinkKey(e.target.value); setGlTest({ status: 'idle' }) }}
                    placeholder="e.g. e353413c5f52..."
                    className="input-field text-xs font-mono"
                  />
                  {geniuslinkCredLooksWrong(geniuslinkKey) && glTest.status !== 'ok' && (
                    <p className="mt-1 text-[10px] text-[#ff9500]">That doesn&apos;t look like a Geniuslink API key — it should be a long hex string like <code>e353413c5f52…</code>, not an email or store name.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="brand-geniuslink-secret" className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">API Secret</label>
                  <input
                    id="brand-geniuslink-secret"
                    name="geniuslink-secret"
                    type="password"
                    value={geniuslinkSecret}
                    onChange={e => { setGeniuslinkSecret(e.target.value); setGlTest({ status: 'idle' }) }}
                    placeholder="Your Geniuslink API secret"
                    className="input-field text-xs font-mono"
                  />
                  {geniuslinkCredLooksWrong(geniuslinkSecret) && glTest.status !== 'ok' && (
                    <p className="mt-1 text-[10px] text-[#ff9500]">That doesn&apos;t look like a Geniuslink API secret — copy the exact Secret from Geniuslink → Tools → &ldquo;Integrate with our API&rdquo;.</p>
                  )}
                </div>
              </div>

              {/* How the BLOG link is shortened when a post is shared to social.
                  Blog→Amazon links always use Geniuslink; this is only the link
                  back to the blog post itself, which earns no commission — so a
                  free option matters as click costs add up. */}
              <div className="mt-3">
                <span className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Blog link shared on social</span>
                <div className="flex flex-col gap-2">
                  {([
                    { key: 'direct', label: 'Direct link (free)', desc: 'Share the plain blog URL. No shortener, no click cost.' },
                    { key: 'geniuslink', label: 'Geniuslink', desc: 'Branded geni.us short link, tracked. Uses your Geniuslink key above and costs a click each time.' },
                    { key: 'bitly', label: 'Bitly (free)', desc: 'Free short link with click stats from your own Bitly account.' },
                  ] as const).map(opt => {
                    const on = blogSocialLinkMode === opt.key
                    return (
                      <label key={opt.key} className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border px-3 py-2"
                        style={{ borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: on ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
                        <input
                          type="radio"
                          name="blog-social-link-mode"
                          checked={on}
                          onChange={() => setBlogSocialLinkMode(opt.key)}
                          className="mt-0.5 w-4 h-4 accent-[#7C3AED]"
                        />
                        <span>
                          <span className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{opt.label}</span>
                          <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93]">{opt.desc}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                {blogSocialLinkMode === 'bitly' && (
                  <div className="mt-2">
                    <input
                      name="bitly-token"
                      type="password"
                      value={bitlyToken}
                      onChange={e => setBitlyToken(e.target.value)}
                      placeholder="Bitly access token"
                      className="input-field text-xs font-mono"
                    />
                    <p className="mt-1 text-[10px] text-[#86868b] dark:text-[#8e8e93]">Bitly → Settings → API → Generate token. Paste the generic access token here.</p>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-[#86868b] dark:text-[#8e8e93]">Applies to posts generated after you change it. Your blog&rsquo;s Amazon links always use Geniuslink with your group settings — this only affects the link back to your blog post on Facebook, LinkedIn, X, Threads, Bluesky and Telegram.</p>
              </div>

              {/* Live "does it actually work?" test — the real gate. Turns a
                  wrong key/secret into an immediate ✗ instead of a silent 401
                  the user only hits later when generating posts. */}
              {geniuslinkKey && geniuslinkSecret && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={testGeniuslink}
                    disabled={glTest.status === 'testing'}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-md border border-gray-200 dark:border-white/20 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED] hover:bg-[#7C3AED]/5 disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {glTest.status === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing…</> : 'Test connection'}
                  </button>
                  {glTest.status === 'ok' && (
                    <span className="text-[11px] font-medium text-[#34c759] flex items-center gap-1">
                      <Check size={12} /> Working{typeof glTest.groupCount === 'number' ? ` — ${glTest.groupCount} group${glTest.groupCount === 1 ? '' : 's'} on your account` : ''}
                    </span>
                  )}
                  {glTest.status === 'fail' && (
                    <span className="text-[11px] text-[#ff3b30] flex items-start gap-1 min-w-0">
                      <X size={12} className="flex-shrink-0 mt-0.5" /> <span>{glTest.message}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Group setup — verify the tracking groups MVP routes to. */}
              {geniuslinkKey && geniuslinkSecret && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/10">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Link tracking groups</p>
                      <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
                        MVP routes YouTube descriptions to <code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 rounded text-[10px]">MVP-YOUTUBE</code> and each blog post to a group named after the site&apos;s domain so you can see clicks by source. Verify they exist (or auto-create them).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={runGeniuslinkSetup}
                      disabled={geniusSetupBusy}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60 flex-shrink-0"
                    >
                      {geniusSetupBusy ? 'Checking…' : (geniusSetup ? 'Re-check' : 'Verify groups')}
                    </button>
                  </div>
                  {geniusSetup && (
                    <div className="space-y-1.5">
                      {geniusSetup.targets.length === 0 && (
                        <p className="text-[11px] text-[#86868b]">
                          {geniusSetup.hasCredentials
                            ? 'Add a WordPress site to enable per-blog grouping.'
                            : 'Add API key + secret above, then click "Verify groups".'}
                        </p>
                      )}
                      {geniusSetup.targets.map(t => {
                        const ok = t.status === 'cached' || t.status === 'matched-existing' || t.status === 'auto-created'
                        return (
                          <div key={`${t.kind}-${t.siteId ?? 'yt'}`} className="flex items-start gap-2 text-[11px]">
                            <span className="mt-0.5 flex-shrink-0">{ok ? '✅' : '⚠️'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {t.label} <span className="text-[#86868b] font-normal">→ <code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 rounded">{t.groupName}</code></span>
                              </p>
                              <p className="text-[#6e6e73] dark:text-[#ebebf0]">{t.detail}</p>
                              {t.status === 'needs-manual-create' && (
                                <a
                                  href={geniusSetup.manualCreateUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block mt-1 text-[#7C3AED] hover:underline font-medium"
                                >
                                  Open Geniuslink → create group named &quot;{t.groupName}&quot;
                                </a>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {geniuslinkKey && geniuslinkSecret && <GeniuslinkGroupsPanel />}
            </div>

            {/* Amazon Associates fallback */}
            <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#ff9900]/10 flex-shrink-0">
                  <span className="text-sm">🛒</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Amazon Associates tag</p>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Fallback when Geniuslink isn&apos;t set</p>
                </div>
                {amazonAssociatesTag && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-[#34c759] flex-shrink-0">
                    <Check size={12} /> Set
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
                Find your tag at <a href="https://affiliate-program.amazon.com/home/account/tag/manage" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Amazon Associates → Account → Manage Tracking IDs</a>. It looks like <code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 py-0.5 rounded text-[10px]">yourbrand-20</code>.
              </p>
              <div>
                <label htmlFor="brand-amazon-tag" className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Associates Tag</label>
                <input
                  id="brand-amazon-tag"
                  name="amazon-tag"
                  type="text"
                  value={amazonAssociatesTag}
                  onChange={e => setAmazonAssociatesTag(e.target.value)}
                  placeholder="e.g. yourbrand-20"
                  className="input-field text-xs font-mono"
                />
              </div>
            </div>

            {/* Google Search Console — read-only SEO data. Moved here from
                Connect Socials so the monetization + measurement accounts live
                together. OAuth (no Save button); connects/disconnects on click. */}
            <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mt-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#4285F4]/10 flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Google Search Console</p>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">See if posts are indexed + the searches that find them</p>
                </div>
                {gscConnected && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-[#34c759] flex-shrink-0">
                    <Check size={12} /> Connected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
                Connect <strong>read-only</strong> Search Console so MVP can show whether each post is indexed by Google, its clicks, impressions and ranking, and the real queries readers use to find it — the data behind your SEO score. We never write to it.
              </p>
              {gscConnected ? (
                <button
                  type="button"
                  onClick={disconnectGsc}
                  disabled={gscBusy}
                  className="inline-flex items-center gap-1.5 text-[11px] text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] disabled:opacity-50 transition-colors"
                >
                  {gscBusy ? <Loader2 size={12} className="animate-spin" /> : null} Disconnect Search Console
                </button>
              ) : (
                <a
                  href="/api/auth/gsc?returnTo=/brand"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#4285F4' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                  Connect Search Console
                </a>
              )}
            </div>
          </div>

          {/* Brand-outreach contact preference. Drives the "Let's Work
              Together" line in YouTube descriptions and the reply-to channel
              the AI uses when generating collaboration emails. */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Brand Outreach Contact</h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              How should brands reach you when they want to collaborate? This is what gets put in your YouTube descriptions and collab emails.
            </p>
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:border-[#7C3AED]/40"
                style={{ borderColor: data.contact_preference === 'website' ? '#7C3AED' : 'var(--border-2, #d2d2d7)' }}>
                <input
                  type="radio"
                  name="contact_preference"
                  checked={data.contact_preference === 'website'}
                  onChange={() => set('contact_preference', 'website')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Send them to my blog</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                    Uses the <span className="font-mono text-[11px]">Blog URL</span> field above ({data.website_url || <em className="opacity-60">not set yet</em>}).
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:border-[#7C3AED]/40"
                style={{ borderColor: data.contact_preference === 'email' ? '#7C3AED' : 'var(--border-2, #d2d2d7)' }}>
                <input
                  type="radio"
                  name="contact_preference"
                  checked={data.contact_preference === 'email'}
                  onChange={() => set('contact_preference', 'email')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Email me directly</p>
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                    Uses the <span className="font-mono text-[11px]">Contact email</span> field below ({data.contact_email || <em className="opacity-60">not set yet</em>}).
                  </p>
                </div>
              </label>
            </div>
            {data.contact_preference === 'website' && !data.website_url && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">Heads up — set your Blog URL above or generated YouTube descriptions will fall back to your email.</p>
            )}
            {data.contact_preference === 'email' && !data.contact_email && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">Heads up — set your Contact email below or generated YouTube descriptions will fall back to your blog.</p>
            )}
          </div>

          {/* Social links */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Social Links</h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Appear in the top utility bar and footer of your blog. Leave any blank that you don&apos;t use.
            </p>
            <div className="grid grid-cols-1 gap-3">
              {[
                { key: 'youtube_channel_url' as const, label: 'YouTube',   placeholder: 'youtube.com/@yourchannel', hosts: ['youtube.com', 'youtu.be'] },
                { key: 'instagram_url' as const,        label: 'Instagram', placeholder: 'instagram.com/yourhandle', hosts: ['instagram.com'] },
                { key: 'tiktok_url' as const,           label: 'TikTok',    placeholder: 'tiktok.com/@yourhandle', hosts: ['tiktok.com'] },
                { key: 'twitter_url' as const,          label: 'X / Twitter', placeholder: 'x.com/yourhandle', hosts: ['x.com', 'twitter.com'] },
                { key: 'pinterest_url' as const,        label: 'Pinterest', placeholder: 'pinterest.com/yourprofile', hosts: ['pinterest.com', 'pin.it'] },
                { key: 'facebook_url' as const,         label: 'Facebook',  placeholder: 'facebook.com/yourpage', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
                { key: 'threads_url' as const,          label: 'Threads',   placeholder: 'threads.net/@yourhandle', hosts: ['threads.net', 'threads.com'] },
                { key: 'contact_email' as const,        label: 'Contact email', placeholder: 'hello@yourdomain.com', hosts: [] },
              ].map(({ key, label, placeholder, hosts }) => {
                // Contact email is a real email field; everything else is a
                // link that ends up as a public icon on the blog.
                const warning = key === 'contact_email'
                  ? null
                  : socialUrlWarning(data[key], label, hosts)
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">{label}</label>
                    <input
                      type={key === 'contact_email' ? 'email' : 'text'}
                      value={data[key]}
                      onChange={(e) => set(key, e.target.value)}
                      placeholder={placeholder}
                      aria-invalid={warning ? true : undefined}
                      className="input-field text-sm"
                      style={warning ? { borderColor: '#ff9500' } : undefined}
                    />
                    {warning && (
                      <p className="text-[11px] mt-1 flex items-start gap-1" style={{ color: '#b25000' }}>
                        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                        <span>{warning}</span>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Facebook Groups — for one-click manual sharing */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Facebook Groups</h2>
              <button
                type="button"
                onClick={() => set('facebook_groups', [...data.facebook_groups, { name: '', url: '' }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C3AED] hover:underline"
              >
                <Plus size={12} /> Add group
              </button>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Paste the links to Facebook Groups you admin. When you push a post to Facebook, we&apos;ll list them so you can open each one and paste your post in (Meta&apos;s API can&apos;t post to Groups — only Pages).
            </p>
            {data.facebook_groups.length === 0 && (
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] italic">No groups yet — add one to enable one-click sharing.</p>
            )}
            <div className="space-y-2">
              {data.facebook_groups.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={g.name}
                    onChange={(e) => {
                      const updated = [...data.facebook_groups]
                      updated[i] = { ...updated[i], name: e.target.value }
                      set('facebook_groups', updated)
                    }}
                    placeholder="Group name"
                    className="input-field text-sm w-1/3"
                  />
                  <input
                    type="text"
                    value={g.url}
                    onChange={(e) => {
                      const updated = [...data.facebook_groups]
                      updated[i] = { ...updated[i], url: e.target.value }
                      set('facebook_groups', updated)
                    }}
                    placeholder="facebook.com/groups/yourgroup"
                    className="input-field text-sm flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => set('facebook_groups', data.facebook_groups.filter((_, idx) => idx !== i))}
                    className="text-[#86868b] hover:text-[#ff3b30] p-1"
                    title="Remove group"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Sample shipping details — private */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Product Sample Shipping</h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              Where brands can send you product samples. Used to fill in collaboration emails so you don&apos;t have to retype it each time.
            </p>
            <div className="rounded-lg p-3 mb-4 flex items-start gap-2" style={{ background: '#f0f7ff', border: '1px solid #cfe4ff' }}>
              <span className="text-xs leading-relaxed text-[#0a4a8f]">
                🔒 Private. This information is never shown on your blog, never shared or sold, and is only used to generate collaboration emails on your behalf.
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Full name</label>
                <input
                  type="text"
                  value={data.sample_full_name}
                  onChange={(e) => set('sample_full_name', e.target.value)}
                  placeholder="Jane Doe"
                  className="input-field text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Full address</label>
                <textarea
                  value={data.sample_address}
                  onChange={(e) => set('sample_address', e.target.value)}
                  placeholder="123 Main St, Apt 4&#10;Springfield, IL 62704&#10;United States"
                  rows={3}
                  className="input-field text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Telephone number</label>
                <input
                  type="tel"
                  value={data.sample_phone}
                  onChange={(e) => set('sample_phone', e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="input-field text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right — voice & style */}
        <div className="flex flex-col gap-5">

          {/* Brand Logo — id="logo" is the anchor the topbar search
              ("upload brand logo") jumps to; scroll-mt offsets the sticky header. */}
          <div id="logo" className="card p-5 scroll-mt-24">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Brand Logo</h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Used as your site favicon and in the footer of your WordPress blog. Square or transparent PNG works best.
            </p>
            <div className="flex items-center gap-4">
              {data.logo_url ? (
                <div className="relative group w-20 h-20 rounded-xl border border-gray-200 dark:border-white/10 bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img src={data.logo_url} alt="Brand logo" className="w-full h-full object-contain p-1" />
                  <button
                    onClick={() => set('logo_url', '')}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/20 flex items-center justify-center flex-shrink-0 bg-gray-50 dark:bg-white/5">
                  <span className="text-[10px] text-[#86868b] text-center leading-tight px-1">No logo</span>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 cursor-pointer hover:border-[#7C3AED] hover:bg-[#7C3AED]/5 transition-colors text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] w-fit ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={e => handleImageUpload(e, 'logo', 'logo_url', setLogoUploading)} />
                  {logoUploading
                    ? <><Upload size={13} className="animate-pulse" /> Uploading…</>
                    : <><Upload size={13} /> {data.logo_url ? 'Replace logo' : 'Upload logo'}</>}
                </label>
                <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">PNG, JPG, SVG or WebP · Auto-saved on upload</p>
              </div>
            </div>
          </div>

          {/* Header Banner — wide top strip on the blog */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Header Banner <span className="text-[#86868b] font-normal">(optional)</span></h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              The wide image at the top of every blog page. Recommended <strong>1920×240 px</strong> (8:1).
              Falls back to the Brand Logo if you don&apos;t upload one. Center your logo + tagline — narrow viewports letterbox, never crop.
            </p>
            <div className="flex items-center gap-4">
              {data.header_banner_url ? (
                <div className="relative group w-48 h-14 rounded-lg border border-gray-200 dark:border-white/10 bg-black flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img src={data.header_banner_url} alt="Header banner" className="w-full h-full object-contain" />
                  <button
                    onClick={() => set('header_banner_url', '')}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <div className="w-48 h-14 rounded-lg border-2 border-dashed border-gray-200 dark:border-white/20 flex items-center justify-center flex-shrink-0 bg-gray-50 dark:bg-white/5">
                  <span className="text-[10px] text-[#86868b]">No banner</span>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 cursor-pointer hover:border-[#7C3AED] hover:bg-[#7C3AED]/5 transition-colors text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] w-fit ${bannerUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => handleImageUpload(e, 'header-banner', 'header_banner_url', setBannerUploading)} />
                  {bannerUploading
                    ? <><Upload size={13} className="animate-pulse" /> Uploading…</>
                    : <><Upload size={13} /> {data.header_banner_url ? 'Replace banner' : 'Upload banner'}</>}
                </label>
                {data.header_banner_url && !bannerUploading && (
                  <p className="text-[11px] font-medium text-[#34c759] flex items-center gap-1">
                    <Check size={12} /> Saved — stays on your blog until you replace it
                  </p>
                )}
                <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">PNG, JPG or WebP · Auto-saved · Theme update (1.3.8+) required</p>
              </div>
            </div>
          </div>

          {/* About You — footer bio + round photo (the "About the reviewer" band) */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">About You <span className="text-[#86868b] font-normal">(optional)</span></h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Your bio + photo shown in the blog footer and the &ldquo;About the reviewer&rdquo; card at the bottom of every post.
            </p>

            {/* About Me bio → footer bio (falls back to your tagline if left blank) */}
            <div className="mb-5">
              <label htmlFor="brand-author-bio" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">About Me bio</label>
              <textarea
                id="brand-author-bio"
                value={data.author_bio}
                onChange={(e) => set('author_bio', e.target.value)}
                rows={4}
                maxLength={600}
                placeholder="A few sentences about who you are and why readers should trust your reviews — e.g. &quot;I'm Jane, and I've tested 200+ kitchen gadgets over 6 years. I only recommend gear I'd buy again with my own money.&quot;"
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm text-[#1d1d1f] dark:text-[#f5f5f7] resize-y"
                style={{ borderColor: 'var(--border-bright, #d2d2d7)' }}
              />
              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1">
                {data.author_bio.length}/600 · Shown in the footer &amp; author card. Leave blank to fall back to your tagline.
              </p>
            </div>

            <p className="text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-2">Photo — a round headshot (or logo) shown next to your bio. Recommended <strong>500×500 px</strong> square, displayed circular.</p>
            <div className="flex items-center gap-4">
              {data.headshot_url ? (
                <div className="relative group w-20 h-20 rounded-full border border-gray-200 dark:border-white/10 bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img src={data.headshot_url} alt="About you photo" className="w-full h-full object-cover" />
                  <button
                    onClick={() => set('headshot_url', '')}
                    className="absolute top-0 right-0 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full border-2 border-dashed border-gray-200 dark:border-white/20 flex items-center justify-center flex-shrink-0 bg-gray-50 dark:bg-white/5">
                  <span className="text-[10px] text-[#86868b] text-center leading-tight px-1">No photo</span>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 cursor-pointer hover:border-[#7C3AED] hover:bg-[#7C3AED]/5 transition-colors text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] w-fit ${headshotUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => handleImageUpload(e, 'about-photo', 'headshot_url', setHeadshotUploading)} />
                  {headshotUploading
                    ? <><Upload size={13} className="animate-pulse" /> Uploading…</>
                    : <><Upload size={13} /> {data.headshot_url ? 'Replace photo' : 'Upload photo'}</>}
                </label>
                <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">PNG, JPG or WebP · Auto-saved</p>
              </div>
            </div>
          </div>

          {/* Tone */}
          <div className="card p-5">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Brand Tone</h2>
              <InfoTip>Combine 2–3 for a richer voice. The Voice Matcher agent blends them — e.g. &quot;Conversational + Bold&quot; reads punchier than either alone. Skip this and posts default to neutral-professional.</InfoTip>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">Select all that apply — these blend into your review voice.</p>
            <div className="flex flex-col gap-1">
              {TONE_OPTIONS.map((tone) => {
                const active = data.tone.includes(tone)
                return (
                  <label key={tone} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <div
                      onClick={() => toggleArray('tone', tone)}
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${
                        active ? 'bg-[#7C3AED] border-[#7C3AED]' : 'border-gray-300'
                      }`}
                    >
                      {active && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{tone}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Writing preferences */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Content Preferences</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1.5">
                  Post length
                  <InfoTip>Drives target word count for the Body Drafter agent. Longer = better SEO ranking but takes longer to generate. Medium is the sweet spot for most product reviews.</InfoTip>
                </label>
                <select
                  value={data.post_length}
                  onChange={(e) => set('post_length', e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="short">Short (600–900 words)</option>
                  <option value="medium">Medium (900–1,500 words)</option>
                  <option value="long">Long (1,500–2,500 words)</option>
                  <option value="deep">Deep-dive (2,500+ words)</option>
                </select>
              </div>
              {/* Images per article — user override of the word-scaled
                  default. Options shown match the tier ceiling:
                    Trial      → 0, 1, 2
                    Creator    → 0, 1, 2, 3
                    Studio     → 0, 1, 2, 3
                    Pro/Admin  → 0, 1, 2, 3, 4
                  Hard rules enforced server-side: no back-to-back, no at
                  start, no at end. Picking 0 skips image gen entirely
                  (saves Re-roll cost). 2026-06-07. */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1.5">
                  Images per article
                  <InfoTip>How many AI photos drop inside each post body. They&rsquo;re always spaced through the article — never side-by-side, never at the very start or end. Pick &ldquo;0&rdquo; if you prefer text-only posts. &ldquo;Default&rdquo; scales with length (1 per ~750 words) up to the 2-image max. Each image adds a little AI cost, so 2 is the ceiling.</InfoTip>
                </label>
                {(() => {
                  // Hard global cap of 2 in-body images per post (2026-06-26
                  // product call — images are the main per-post AI cost driver,
                  // ~$0.04–0.05 each + a vision QC). Options are Default / 0 / 1
                  // / 2 for every tier. Mirrors the HARD_IMAGE_CAP in
                  // lib/tier.ts allowedBlogImages, which enforces the same
                  // ceiling server-side so "Default" can't exceed it either.
                  const maxImages = 2
                  const options: Array<number | 'default'> = ['default']
                  for (let i = 0; i <= maxImages; i++) options.push(i)
                  return (
                    <select
                      value={data.blog_image_count === null ? 'default' : String(data.blog_image_count)}
                      onChange={(e) => {
                        const v = e.target.value
                        set('blog_image_count', v === 'default' ? null : parseInt(v, 10))
                      }}
                      className="input-field text-xs"
                    >
                      {options.map((o) =>
                        o === 'default'
                          ? <option key="default" value="default">Default (auto, word-scaled)</option>
                          : <option key={o} value={String(o)}>{o === 0 ? '0 — text only, no images' : `${o} image${o === 1 ? '' : 's'} per post`}</option>
                      )}
                    </select>
                  )
                })()}
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1.5">
                  CTA style
                  <InfoTip>How the review asks for the click. &quot;Soft recommendation&quot; closes like advice — low-pressure. &quot;Direct CTA&quot; is an explicit, confident ask. (Pros/cons and comparison blocks are controlled separately under Post Sections below.)</InfoTip>
                </label>
                <select
                  value={data.cta_style === 'soft_recommendation' ? 'soft_recommendation' : data.cta_style === 'direct_cta' ? 'direct_cta' : 'soft_recommendation'}
                  onChange={(e) => set('cta_style', e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="soft_recommendation">Soft recommendation</option>
                  <option value="direct_cta">Direct CTA</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1.5">
                  Affiliate disclaimer
                  <InfoTip>Auto-inserted at the top of every published post. Required by the FTC if you earn from links. Edit the wording to match your jurisdiction.</InfoTip>
                </label>
                <textarea
                  rows={3}
                  value={data.affiliate_disclaimer}
                  onChange={(e) => set('affiliate_disclaimer', e.target.value)}
                  className="input-field resize-none text-xs"
                />
              </div>
              {/* 2026-06-09: per-brand section toggles. Default all ON;
                   creators who want a pure transcript-driven narrative can
                   untick any of these to drop that block from every post. */}
              <div className="md:col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6e6e73] dark:text-[#a8a8ad] mb-2">
                  Post sections
                </div>
                <div className="text-[11px] text-[#6e6e73] dark:text-[#a8a8ad] mb-3 leading-snug">
                  Each block below appears in every generated post by default. Untick any you don&apos;t want — useful if you prefer a pure narrative review driven by your video transcript with no structured add-ons.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {([
                    { key: 'include_quick_verdict', label: 'Quick Verdict box', desc: '2-3 sentence Buy-if / Skip-if summary at the top' },
                    { key: 'include_pros_cons',     label: 'Pros & Cons lists', desc: 'Two H2 lists styled as a green/red hero box at the top' },
                    { key: 'include_scorecard',     label: 'Scorecard + rating', desc: 'Overall 1-5 + Value / Quality / Ease / Durability bars' },
                    { key: 'include_faq',           label: 'FAQ section',       desc: 'Minimum 5 product-specific Q&A pairs at the bottom' },
                  ] as const).map(opt => (
                    <label key={opt.key} className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg border border-[#e5e5e7] dark:border-[#3a3a3c] hover:border-[#7C3AED] hover:bg-purple-50/30 dark:hover:bg-purple-950/10 transition-colors">
                      <input
                        type="checkbox"
                        checked={data[opt.key]}
                        onChange={(e) => set(opt.key, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-[#86868b] text-[#7C3AED] focus:ring-[#7C3AED]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{opt.label}</div>
                        <div className="text-[10px] text-[#6e6e73] dark:text-[#a8a8ad] mt-0.5 leading-snug">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {/* 2026-06-08 (#14): opt-in "What we'd improve" block — adds a
                   manufacturer-facing critique section to every generated
                   post. Spans full width so the description fits cleanly on
                   its own line. */}
              <div className="md:col-span-2">
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-[#e5e5e7] dark:border-[#3a3a3c] hover:border-[#FF6B00] hover:bg-orange-50/30 dark:hover:bg-orange-950/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={data.include_improvements_section}
                    onChange={(e) => set('include_improvements_section', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#86868b] text-[#FF6B00] focus:ring-[#FF6B00]"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                      Include a &quot;What we&apos;d improve&quot; section
                      <InfoTip>Adds a dedicated section to every review that addresses the manufacturer directly — 1–3 specific design, build, or packaging things the brand should fix in the next version. Distinct from the Cons list (which covers consumer-facing friction). This block reads as polite critique addressed to the maker, which builds editorial credibility but lands more critical in tone — so it&apos;s opt-in. The AI grounds every point in the actual transcript or product info; it will never invent a flaw to fill the section.</InfoTip>
                    </div>
                    <div className="text-[11px] text-[#6e6e73] dark:text-[#a8a8ad] mt-0.5 leading-snug">
                      Adds a 3-bullet &quot;what could be better&quot; block between the body and FAQ. Editorial credibility boost — but only turn on if your voice can carry the extra critique.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Brand colors */}
          <div className="card p-5">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Brand Colors</h2>
              <InfoTip>Primary color is the background of your auto-composed Instagram image posts and the accent in your blog theme. Secondary color highlights buttons and the &quot;FULL REVIEW →&quot; chip on IG images. Use brand colors that contrast well with white text.</InfoTip>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">Used in your blog theme and as the background of your Instagram image posts.</p>
            <div className="flex flex-col gap-5">
              <ColorPicker
                label="Primary color"
                value={data.primary_color}
                onChange={(c) => set('primary_color', c)}
              />
              <ColorPicker
                label="Secondary color"
                value={data.secondary_color}
                onChange={(c) => set('secondary_color', c)}
              />

              <div className="pt-4 border-t border-gray-100 dark:border-white/10">
                <div className="flex items-center gap-1.5 mb-1">
                  <h3 className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Blog header &amp; footer</h3>
                  <InfoTip>Set the background of your blog&apos;s top header bar and its footer. Leave on default, or pick any color — the text and icons adjust automatically to stay readable on whatever color you choose.</InfoTip>
                </div>
                <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-4">Optional. Default is a clean light header and a soft-charcoal footer.</p>

                <div className="flex flex-col gap-5">
                  <div>
                    <ColorPicker
                      label={`Header background${data.header_bg_color ? '' : ' (default)'}`}
                      value={data.header_bg_color || '#ffffff'}
                      onChange={(c) => set('header_bg_color', c)}
                    />
                    {data.header_bg_color && (
                      <button type="button" onClick={() => set('header_bg_color', '')}
                        className="text-[11px] text-[#7C3AED] hover:underline">Reset to default</button>
                    )}
                  </div>
                  <div>
                    <ColorPicker
                      label={`Footer background${data.footer_bg_color ? '' : ' (default)'}`}
                      value={data.footer_bg_color || '#1a1a1e'}
                      onChange={(c) => set('footer_bg_color', c)}
                    />
                    {data.footer_bg_color && (
                      <button type="button" onClick={() => set('footer_bg_color', '')}
                        className="text-[11px] text-[#7C3AED] hover:underline">Reset to default</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Fonts */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Typography</h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">Pick a font pairing for your blog. Applied site-wide.</p>
            <div className="flex flex-col gap-2">
              {FONT_THEMES.map(theme => {
                const active = data.font_theme === theme.key
                return (
                  <button
                    key={theme.key}
                    type="button"
                    onClick={() => set('font_theme', theme.key)}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      active
                        ? 'border-[#7C3AED] bg-[#7C3AED]/5'
                        : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]"
                        style={{ fontFamily: theme.heading }}
                      >
                        {theme.name}
                      </span>
                      {active && <Check size={14} className="text-[#7C3AED] flex-shrink-0" />}
                    </div>
                    <p
                      className="text-xs text-[#6e6e73] dark:text-[#ebebf0] m-0"
                      style={{ fontFamily: theme.body }}
                    >
                      {theme.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom save bar — mirrors the top action so users don't have to
          scroll back up to save a long form. */}
      <div className="mt-8 flex items-center justify-end gap-3 border-t border-gray-200 dark:border-white/10 pt-5">
        {saved && <span className="text-xs text-[#34c759] font-medium">Saved!</span>}
        <button onClick={save} disabled={saving} className="btn-primary">
          {saved
            ? <><Check size={14} /> Saved!</>
            : saving
            ? 'Saving…'
            : <><Save size={14} /> Save changes</>
          }
        </button>
      </div>
    </>
  )
}
