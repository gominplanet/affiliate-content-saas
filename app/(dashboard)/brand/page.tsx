'use client'

import { useEffect, useState, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { Save, Check, Plus, Trash2, GripVertical, Upload, X, RefreshCw, Loader2 } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { InfoTip } from '@/components/ui/InfoTip'

async function uploadLogo(file: File, userId: string): Promise<string> {
  const supabase = createBrowserClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${userId}/logo.${ext}`
  const { error } = await supabase.storage.from('headshots').upload(path, file, {
    cacheControl: '31536000',
    upsert: true,  // overwrite — only one logo per user
  })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('headshots').getPublicUrl(path)
  return data.publicUrl
}

interface GearItem { name: string; url: string }
interface GearSection { title: string; items: GearItem[] }

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
  '#0071e3', '#0ea5e9', '#3b82f6', '#6366f1',
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

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-md border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ backgroundColor: value }} />
        <p className="text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0]">{label}</p>
        <code className="text-xs font-mono text-[#86868b] dark:text-[#8e8e93] ml-auto">{value}</code>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => onChange(color)}
            className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor: value === color ? '#1d1d1f' : 'transparent',
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
  author_name: string
  website_url: string
  niches: string[]
  tone: string[]
  post_length: string
  cta_style: string
  affiliate_disclaimer: string
  primary_color: string
  secondary_color: string
  // Writing Style / About You / Target Reader / Words to Avoid now
  // live on the LEARN page (single editing surface for voice).
  gear_sections: GearSection[]
  logo_url: string
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
  contact_email: string
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
    description: 'Wirecutter-style. Serif headlines, sans body.',
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
  author_name: '',
  website_url: '',
  niches: [],
  tone: [],
  post_length: 'medium',
  cta_style: 'soft_recommendation',
  affiliate_disclaimer: 'This post contains affiliate links. I may earn a commission at no extra cost to you.',
  primary_color: '#0071e3',
  secondary_color: '#34c759',
  gear_sections: [],
  logo_url: '',
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
  contact_email: '',
  sample_full_name: '',
  sample_address: '',
  sample_phone: '',
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
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)

  async function purgeCache() {
    setPurging(true)
    setPurged(false)
    try {
      const res = await fetch('/api/wordpress/purge-cache', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(json.error || 'Cache purge failed.')
        return
      }
      setPurged(true)
      setTimeout(() => setPurged(false), 2500)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cache purge failed.')
    } finally {
      setPurging(false)
    }
  }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: row } = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    if (row) {
      setData({
        name: row.name ?? '',
        tagline: row.tagline ?? '',
        author_name: row.author_name ?? '',
        website_url: row.website_url ?? '',
        niches: row.niches ?? [],
        tone: row.tone ?? [],
        post_length: row.post_length ?? 'medium',
        cta_style: row.cta_style ?? 'soft_recommendation',
        affiliate_disclaimer: row.affiliate_disclaimer ?? DEFAULT.affiliate_disclaimer,
        primary_color: row.primary_color ?? '#0071e3',
        secondary_color: row.secondary_color ?? '#34c759',
        gear_sections: row.gear_sections ?? [],
        logo_url: row.logo_url ?? '',
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
        contact_email: row.contact_email ?? '',
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
      linktree_url: normalizeUrl(data.linktree_url),
    }
    // Update local state so the user sees their normalized URLs after save
    setData(normalized)

    // ── 1. Save to Supabase ─────────────────────────────────────────────────
    const { error: dbError } = await supabase.from('brand_profiles').upsert(
      { ...normalized, user_id: user.id },
      { onConflict: 'user_id' },
    )
    if (dbError) {
      setSaving(false)
      setSaveError(`Save failed: ${dbError.message}`)
      return
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
          primaryColor:   normalized.primary_color,
          secondaryColor: normalized.secondary_color,
          fontTheme:      normalized.font_theme,
          logoUrl:        normalized.logo_url,
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

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLogoUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')
      const url = await uploadLogo(file, user.id)
      set('logo_url', url)
      // Auto-save immediately
      await supabase.from('brand_profiles').upsert(
        { ...data, logo_url: url, user_id: user.id },
        { onConflict: 'user_id' },
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setLogoUploading(false)
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
      <Header
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
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Website URL</label>
                <input
                  type="url"
                  value={data.website_url}
                  onChange={(e) => set('website_url', e.target.value)}
                  placeholder="https://yourdomain.com"
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
                        ? 'bg-[#0071e3]/10 text-[#0071e3] border-[#0071e3]/30'
                        : 'bg-white dark:bg-[#1c1c1e] text-[#6e6e73] dark:text-[#ebebf0] border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40 hover:text-[#0071e3]'
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

          {/* Social links */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Social Links</h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Appear in the top utility bar and footer of your blog. Leave any blank that you don&apos;t use.
            </p>
            <div className="grid grid-cols-1 gap-3">
              {[
                { key: 'youtube_channel_url' as const, label: 'YouTube',   placeholder: 'youtube.com/@yourchannel' },
                { key: 'instagram_url' as const,        label: 'Instagram', placeholder: 'instagram.com/yourhandle' },
                { key: 'tiktok_url' as const,           label: 'TikTok',    placeholder: 'tiktok.com/@yourhandle' },
                { key: 'twitter_url' as const,          label: 'X / Twitter', placeholder: 'x.com/yourhandle' },
                { key: 'pinterest_url' as const,        label: 'Pinterest', placeholder: 'pinterest.com/yourprofile' },
                { key: 'facebook_url' as const,         label: 'Facebook',  placeholder: 'facebook.com/yourpage' },
                { key: 'threads_url' as const,          label: 'Threads',   placeholder: 'threads.net/@yourhandle' },
                { key: 'contact_email' as const,        label: 'Contact email', placeholder: 'hello@yourdomain.com' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">{label}</label>
                  <input
                    type={key === 'contact_email' ? 'email' : 'text'}
                    value={data[key]}
                    onChange={(e) => set(key, e.target.value)}
                    placeholder={placeholder}
                    className="input-field text-sm"
                  />
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

          {/* YouTube gear sections */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube Description Sections</h2>
              <button
                type="button"
                onClick={() => set('gear_sections', [...data.gear_sections, { title: '', items: [{ name: '', url: '' }] }])}
                className="flex items-center gap-1 text-xs text-[#0071e3] hover:underline"
              >
                <Plus size={12} /> Add section
              </button>
            </div>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              These sections appear at the bottom of every YouTube description — great for your gear, editing setup, or any recurring affiliate links.
            </p>
            {data.gear_sections.length === 0 && (
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] italic">No sections yet. Click "Add section" to create one.</p>
            )}
            <div className="flex flex-col gap-5">
              {data.gear_sections.map((section, si) => (
                <div key={si} className="border border-gray-200 dark:border-white/10 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-[#86868b] dark:text-[#8e8e93] flex-shrink-0" />
                    <input
                      type="text"
                      value={section.title}
                      onChange={e => {
                        const updated = [...data.gear_sections]
                        updated[si] = { ...updated[si], title: e.target.value }
                        set('gear_sections', updated)
                      }}
                      placeholder="e.g. WHAT I USE TO RECORD MY VIDEOS"
                      className="input-field text-xs font-semibold flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => set('gear_sections', data.gear_sections.filter((_, i) => i !== si))}
                      className="text-[#ff3b30] hover:opacity-70 flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2 pl-5">
                    {section.items.map((item, ii) => (
                      <div key={ii} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={item.name}
                          onChange={e => {
                            const updated = [...data.gear_sections]
                            updated[si].items[ii] = { ...updated[si].items[ii], name: e.target.value }
                            set('gear_sections', updated)
                          }}
                          placeholder="Product name"
                          className="input-field text-xs flex-1"
                        />
                        <input
                          type="url"
                          value={item.url}
                          onChange={e => {
                            const updated = [...data.gear_sections]
                            updated[si].items[ii] = { ...updated[si].items[ii], url: e.target.value }
                            set('gear_sections', updated)
                          }}
                          placeholder="https://amzn.to/..."
                          className="input-field text-xs flex-1 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...data.gear_sections]
                            updated[si].items = updated[si].items.filter((_, i) => i !== ii)
                            set('gear_sections', updated)
                          }}
                          className="text-[#86868b] hover:text-[#ff3b30] flex-shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...data.gear_sections]
                        updated[si].items.push({ name: '', url: '' })
                        set('gear_sections', updated)
                      }}
                      className="flex items-center gap-1 text-xs text-[#0071e3] hover:underline self-start mt-1"
                    >
                      <Plus size={11} /> Add item
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — voice & style */}
        <div className="flex flex-col gap-5">

          {/* Brand Logo */}
          <div className="card p-5">
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
                <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 cursor-pointer hover:border-[#0071e3] hover:bg-[#0071e3]/5 transition-colors text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] w-fit ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
                  {logoUploading
                    ? <><Upload size={13} className="animate-pulse" /> Uploading…</>
                    : <><Upload size={13} /> {data.logo_url ? 'Replace logo' : 'Upload logo'}</>}
                </label>
                <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">PNG, JPG, SVG or WebP · Auto-saved on upload</p>
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
                        active ? 'bg-[#0071e3] border-[#0071e3]' : 'border-gray-300'
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
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1.5">
                  CTA style
                  <InfoTip>How the review nudges readers to buy. &quot;Soft recommendation&quot; reads like advice; &quot;Direct CTA&quot; is more salesy; &quot;Comparison table&quot; / &quot;Pros &amp; cons&quot; structure the verdict block differently.</InfoTip>
                </label>
                <select
                  value={data.cta_style}
                  onChange={(e) => set('cta_style', e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="soft_recommendation">Soft recommendation</option>
                  <option value="direct_cta">Direct CTA</option>
                  <option value="comparison_table">Comparison table</option>
                  <option value="pros_cons">Pros / cons list</option>
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
                        ? 'border-[#0071e3] bg-[#0071e3]/5'
                        : 'border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]"
                        style={{ fontFamily: theme.heading }}
                      >
                        {theme.name}
                      </span>
                      {active && <Check size={14} className="text-[#0071e3] flex-shrink-0" />}
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
    </>
  )
}
