'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Header from '@/components/layout/Header'
import { TutorialVideo } from '@/components/TutorialVideo'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Plus, Trash2, Save, Loader2, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp,
  Upload, X, RefreshCw, Sparkles, AlertCircle, Image as ImageIcon,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdBlock {
  id: string
  type: 'image' | 'html'
  imageUrl: string
  linkUrl: string
  html: string
  position: number
  enabled: boolean
  label: string
}

interface SocialLinks {
  youtube: string
  facebook: string
  instagram: string
  threads: string
  pinterest: string
  tiktok: string
  twitter: string
  contact: string
}

interface CustomLink {
  id: string
  label: string
  url: string
}

interface AboutData {
  bio: string
  logoUrl: string
  headerBg: 'black' | 'white'
}

interface FooterData {
  socials: SocialLinks
  links: CustomLink[]
}

interface PickOfDayConfig {
  enabled: boolean
  label: string
  showOnSidebar: boolean
  showOnHomepage: boolean
  rotation: '12h' | '24h' | 'pinned'
  pinnedPostId: string  // only used when rotation === 'pinned'
}

interface HomepageAd {
  id: string
  imageUrl: string
  linkUrl: string
}

interface BlogCustomizations {
  sidebar: AdBlock[]
  incontent: AdBlock[]
  /** Always exactly 3 slots — the homepage shows a fixed 3-up strip. */
  homepageAds: HomepageAd[]
  /** Master switch for the homepage 3-up strip. When false the whole
   *  section is hidden on the homepage. When true with empty slots the
   *  theme renders "Advertise here" placeholders. */
  homepageAdsEnabled: boolean
  about: AboutData
  footer: FooterData
  pickOfDay: PickOfDayConfig
  /** Raw <meta> tags injected into the site's <head> — domain verification
   *  for Google Search Console, Pinterest, Facebook, Bing, etc. One full
   *  tag string per entry. Sanitized server-side in the WP plugin. */
  headMetaTags: string[]
  /** Google Tag Manager container — one ID, theme injects both the
   *  head <script> and the <body> noscript iframe. Configure GA4, Ads,
   *  Pixel, etc. inside GTM. Format strictly validated: GTM-XXXXXXX. */
  analytics: { gtmId: string }
}

const emptyAbout: AboutData = { bio: '', logoUrl: '', headerBg: 'black' }
const emptyFooter: FooterData = {
  socials: { youtube: '', facebook: '', instagram: '', threads: '', pinterest: '', tiktok: '', twitter: '', contact: '' },
  links: [],
}
const defaultPickOfDay: PickOfDayConfig = {
  enabled: true,
  label: 'Our Pick of the Day',
  showOnSidebar: true,
  showOnHomepage: false,
  rotation: '24h',
  pinnedPostId: '',
}

function newHomepageAd(): HomepageAd {
  return { id: crypto.randomUUID(), imageUrl: '', linkUrl: '' }
}

const defaultHomepageAds: HomepageAd[] = [newHomepageAd(), newHomepageAd(), newHomepageAd()]

/** Pad an incoming array to exactly 3 slots so the UI + theme can rely on length. */
function padHomepageAds(input: unknown): HomepageAd[] {
  const arr = Array.isArray(input) ? (input as Partial<HomepageAd>[]) : []
  const padded: HomepageAd[] = []
  for (let i = 0; i < 3; i++) {
    const a = arr[i]
    padded.push({
      id: (a && typeof a.id === 'string') ? a.id : crypto.randomUUID(),
      imageUrl: (a && typeof a.imageUrl === 'string') ? a.imageUrl : '',
      linkUrl: (a && typeof a.linkUrl === 'string') ? a.linkUrl : '',
    })
  }
  return padded
}

const defaultCustomizations: BlogCustomizations = {
  sidebar: [],
  incontent: [],
  homepageAds: defaultHomepageAds,
  homepageAdsEnabled: true,
  about: emptyAbout,
  footer: emptyFooter,
  pickOfDay: defaultPickOfDay,
  headMetaTags: [],
  analytics: { gtmId: '' },
}

function newBlock(): AdBlock {
  return { id: crypto.randomUUID(), type: 'image', imageUrl: '', linkUrl: '', html: '', position: 2, enabled: true, label: '' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateBlock(raw: any): AdBlock {
  return {
    id: raw.id ?? crypto.randomUUID(),
    type: raw.type === 'html' ? 'html' : 'image',
    imageUrl: raw.imageUrl ?? '',
    linkUrl: raw.linkUrl ?? '',
    html: raw.html ?? '',
    position: raw.position ?? 2,
    enabled: raw.enabled ?? true,
    label: raw.label ?? '',
  }
}

// ── Image upload helper ───────────────────────────────────────────────────────

async function uploadImage(file: File, userId: string, folder: string): Promise<string> {
  const supabase = createBrowserClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${userId}/${folder}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('ad-banners').upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('ad-banners').getPublicUrl(path)
  return data.publicUrl
}

// ── Banner Block Editor ───────────────────────────────────────────────────────

function BannerBlockEditor({
  block, onChange, onDelete, showPosition, userId,
}: {
  block: AdBlock
  onChange: (b: AdBlock) => void
  onDelete: () => void
  showPosition: boolean
  userId: string
}) {
  const [open, setOpen] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { setUploadError('Please upload an image file.'); return }
    setUploading(true); setUploadError(null)
    try {
      const url = await uploadImage(file, userId, 'banners')
      onChange({ ...block, imageUrl: url })
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.')
    } finally { setUploading(false) }
  }

  const isHtml = block.type === 'html'

  return (
    <div className="border border-[var(--border-2)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)]">
        <div className="flex items-center gap-3">
          <button onClick={() => onChange({ ...block, enabled: !block.enabled })} className="text-[var(--text-3)]">
            {block.enabled ? <ToggleRight size={20} className="text-[#0071e3]" /> : <ToggleLeft size={20} />}
          </button>
          <span className="text-sm font-medium text-[var(--text)]">Affiliate Banner</span>
          {!block.enabled && <span className="text-xs text-[var(--text-3)]">(disabled — won't show on site)</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(o => !o)} className="text-[var(--text-3)] hover:text-[var(--text)]">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button onClick={onDelete} className="text-[var(--text-3)] hover:text-[#ff3b30]"><Trash2 size={15} /></button>
        </div>
      </div>

      {open && (
        <div className="p-4 flex flex-col gap-4">

          {/* Label (eyebrow shown above the block) */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Label <span className="text-[var(--text-3)] font-normal">(optional)</span></label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={block.label}
                onChange={e => onChange({ ...block, label: e.target.value })}
                placeholder="e.g. Sponsored, Our Pick, Advertisement"
                maxLength={30}
                className="input-field flex-1 text-sm"
              />
              <div className="flex gap-1">
                {['Sponsored', 'Our Pick', 'Advertisement'].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChange({ ...block, label: preset })}
                    className="px-2 py-1 text-[10px] rounded-md border border-[var(--border-2)] text-[var(--text-3)] hover:text-[#0071e3] hover:border-[#0071e3]/40 transition-colors whitespace-nowrap"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-[var(--text-3)] mt-1">Shown as a small uppercase eyebrow above the banner. Leave blank for a clean look.</p>
          </div>

          {/* Type tabs */}
          <div className="flex rounded-lg border border-[var(--border-2)] overflow-hidden w-fit">
            <button
              onClick={() => onChange({ ...block, type: 'image' })}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${!isHtml ? 'bg-[#0071e3] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
            >
              Image
            </button>
            <button
              onClick={() => onChange({ ...block, type: 'html' })}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${isHtml ? 'bg-[#0071e3] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
            >
              HTML Code
            </button>
          </div>

          {/* Image mode */}
          {!isHtml && (
            <>
              {block.imageUrl ? (
                <div className="relative">
                  <img src={block.imageUrl} alt="Banner preview" className="rounded-lg border border-[var(--border-2)] object-contain" style={{ width: 350, height: 'auto' }} />
                  <button onClick={() => onChange({ ...block, imageUrl: '' })}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#ff3b30] text-white flex items-center justify-center shadow">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div
                  className={`relative rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-[var(--border-2)] hover:border-[#0071e3]'}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                >
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="w-full flex flex-col items-center gap-2 py-8 text-[var(--text-3)] hover:text-[var(--text)] transition-colors">
                    {uploading ? <Loader2 size={22} className="animate-spin text-[#0071e3]" /> : <Upload size={22} />}
                    <span className="text-xs font-medium">{uploading ? 'Uploading…' : 'Click to upload or drag an image here'}</span>
                    <span className="text-[11px] text-[var(--text-3)]">PNG, JPG, GIF, WebP · displayed at 350px wide</span>
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
                </div>
              )}
              {uploadError && <p className="text-xs text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{uploadError}</p>}
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Affiliate link</label>
                <input type="url" value={block.linkUrl} onChange={e => onChange({ ...block, linkUrl: e.target.value })}
                  placeholder="https://amzn.to/your-link" className="input-field w-full" />
                <p className="text-[11px] text-[var(--text-3)] mt-1">Visitors who click the image go to this URL.</p>
              </div>
            </>
          )}

          {/* HTML mode */}
          {isHtml && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Embed code</label>
              <textarea
                value={block.html}
                onChange={e => onChange({ ...block, html: e.target.value })}
                rows={6}
                placeholder={'Paste your affiliate HTML here — Impact, ShareASale, CJ, custom iframes, etc.\n\nExample:\n<a href="https://…"><img src="https://…" /></a>'}
                className="input-field w-full font-mono text-xs resize-y"
              />
              <p className="text-[11px] text-[var(--text-3)] mt-1.5">
                The HTML is output as-is on your site. Displayed at 350px wide — height follows the content.
              </p>
            </div>
          )}

          {/* Position (in-content only) */}
          {showPosition && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Show after paragraph</label>
              <select value={block.position} onChange={e => onChange({ ...block, position: Number(e.target.value) })} className="input-field w-44">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>Paragraph {n}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        <p className="text-xs text-[var(--text-3)] mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomizePage() {
  const supabase = createBrowserClient()
  const [data, setData] = useState<BlogCustomizations>(defaultCustomizations)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [wpPushError, setWpPushError] = useState<string | null>(null)
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)
  const [userId, setUserId] = useState('')

  // (Logo upload / bio / socials editing was removed — those are managed in Brand Profile now.)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    // Pull the canonical logo URL from brand_profiles — that's the single source
    // of truth (set in Brand Profile). We only use blog_customizations.about
    // for blog-specific layout choices (the banner background color).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('logo_url')
      .eq('user_id', user.id)
      .single()
    const canonicalLogoUrl: string = brandRow?.logo_url ?? ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (supabase as any)
      .from('integrations')
      .select('blog_customizations')
      .eq('user_id', user.id)
      .single()
    if (row?.blog_customizations) {
      const bc = row.blog_customizations
      const profile = bc.profile ?? {}
      const socials: SocialLinks = {
        youtube:   bc.footer?.socials?.youtube   || profile.youtubeUrl   || '',
        instagram: bc.footer?.socials?.instagram || profile.instagramUrl || '',
        facebook:  bc.footer?.socials?.facebook  || profile.facebookUrl  || '',
        pinterest: bc.footer?.socials?.pinterest || profile.pinterestUrl || '',
        tiktok:    bc.footer?.socials?.tiktok    || profile.tiktokUrl    || '',
        twitter:   bc.footer?.socials?.twitter   || profile.twitterUrl   || '',
        threads:   bc.footer?.socials?.threads   || profile.threadsUrl   || '',
        contact:   bc.footer?.socials?.contact   || profile.contactEmail || '',
      }
      const about: AboutData = {
        bio:      bc.about?.bio ?? bc.footer?.bio ?? '',
        // Brand Profile is the source of truth for the logo. Fall back to any
        // value stored in blog_customizations only if brand_profiles is empty.
        logoUrl:  canonicalLogoUrl || bc.about?.logoUrl || bc.about?.imageUrl || '',
        headerBg: bc.about?.headerBg === 'white' ? 'white' : 'black',
      }
      setData({
        ...defaultCustomizations,
        ...bc,
        sidebar:   (bc.sidebar   ?? []).map(migrateBlock),
        incontent: (bc.incontent ?? []).map(migrateBlock),
        homepageAds: padHomepageAds(bc.homepageAds),
        homepageAdsEnabled: typeof bc.homepageAdsEnabled === 'boolean' ? bc.homepageAdsEnabled : true,
        about,
        footer: { ...emptyFooter, ...(bc.footer ?? {}), socials },
        pickOfDay: { ...defaultPickOfDay, ...(bc.pickOfDay ?? {}) },
        headMetaTags: Array.isArray(bc.headMetaTags) ? bc.headMetaTags.filter((t: unknown): t is string => typeof t === 'string') : [],
        analytics: {
          gtmId: typeof bc.analytics?.gtmId === 'string' ? bc.analytics.gtmId : '',
        },
      })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function purgeCache() {
    setPurging(true)
    try {
      const res = await fetch('/api/wordpress/purge-cache', { method: 'POST' })
      const json = await res.json()
      if (json.error) { alert(json.error); return }
      setPurged(true); setTimeout(() => setPurged(false), 3000)
    } finally { setPurging(false) }
  }

  async function save() {
    setSaving(true)
    setWpPushError(null)
    try {
      const res = await fetch('/api/wordpress/customizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (json.error) { alert(json.error); return }
      if (json.wordpress === 'failed') {
        setWpPushError(json.wordpressError || 'WordPress push failed — check your credentials in Site & Integrations.')
      } else {
        // Auto-purge cache so changes appear immediately on the live blog.
        fetch('/api/wordpress/purge-cache', { method: 'POST' }).catch(() => {})
      }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  function updateAbout(patch: Partial<AboutData>) {
    setData(d => ({ ...d, about: { ...d.about, ...patch } }))
  }

  function updateSidebar(blocks: AdBlock[]) { setData(d => ({ ...d, sidebar: blocks })) }
  function addSidebarBlock() { updateSidebar([...data.sidebar, newBlock()]) }
  function updateSidebarBlock(id: string, b: AdBlock) { updateSidebar(data.sidebar.map(x => x.id === id ? b : x)) }
  function deleteSidebarBlock(id: string) { updateSidebar(data.sidebar.filter(x => x.id !== id)) }

  function updateIncontent(blocks: AdBlock[]) { setData(d => ({ ...d, incontent: blocks })) }
  function addIncontentBlock() { updateIncontent([...data.incontent, newBlock()]) }
  function updateIncontentBlock(id: string, b: AdBlock) { updateIncontent(data.incontent.map(x => x.id === id ? b : x)) }
  function deleteIncontentBlock(id: string) { updateIncontent(data.incontent.filter(x => x.id !== id)) }

  function updateHomepageAd(index: number, patch: Partial<HomepageAd>) {
    setData(d => ({
      ...d,
      homepageAds: d.homepageAds.map((a, i) => i === index ? { ...a, ...patch } : a),
    }))
  }
  function clearHomepageAd(index: number) {
    setData(d => ({
      ...d,
      homepageAds: d.homepageAds.map((a, i) => i === index ? { ...a, imageUrl: '', linkUrl: '' } : a),
    }))
  }
  async function handleHomepageAdFile(index: number, file: File) {
    if (!userId) return
    try {
      const url = await uploadImage(file, userId, 'homepage-ads')
      updateHomepageAd(index, { imageUrl: url })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Image upload failed.')
    }
  }

  function updatePickOfDay(patch: Partial<PickOfDayConfig>) {
    setData(d => ({ ...d, pickOfDay: { ...d.pickOfDay, ...patch } }))
  }

  function updateFooter(patch: Partial<FooterData>) { setData(d => ({ ...d, footer: { ...d.footer, ...patch } })) }
  function addCustomLink() {
    updateFooter({ links: [...data.footer.links, { id: crypto.randomUUID(), label: '', url: '' }] })
  }
  function updateCustomLink(id: string, patch: Partial<CustomLink>) {
    updateFooter({ links: data.footer.links.map(l => l.id === id ? { ...l, ...patch } : l) })
  }
  function deleteCustomLink(id: string) {
    updateFooter({ links: data.footer.links.filter(l => l.id !== id) })
  }

  if (loading) {
    return (
      <>
        <Header title="Customize Blog" subtitle="Edit the bits of your site that aren't covered by Brand Profile — Pick of the Day, in-content ad slots, footer links." />
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)] py-8">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </>
    )
  }

  return (
    <>
      <Header
        title="Customize Blog"
        subtitle="Edit the bits of your site that aren't covered by Brand Profile — Pick of the Day, in-content ad slots, footer links."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={purgeCache} disabled={purging || saving} className="btn-secondary flex items-center gap-2"
              title="Clear cache so your latest changes appear immediately">
              {purging ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {purged ? 'Cleared!' : purging ? 'Clearing…' : 'Clear Cache'}
            </button>
            <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save & Push to Blog'}
            </button>
          </div>
        }
      />

      {wpPushError && (
        <div className="max-w-2xl mb-2 rounded-xl border border-[#ff9500]/30 bg-[#ff9500]/5 px-4 py-3 flex items-start gap-3">
          <AlertCircle size={15} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Saved to dashboard, but WordPress push failed</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{wpPushError}</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">Check your WordPress credentials in <a href="/setup?tab=integrations" className="text-[#0071e3] hover:underline">Site & Integrations</a>, then save again.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 max-w-2xl">

        {/* TODO: replace videoId with the real Customize Blog tutorial. */}
        <TutorialVideo
          sectionKey="customize"
          videoId="dQw4w9WgXcQ"
          title="Customize Blog — banner strip, in-content ads, analytics"
          description="Where every blog visual setting lives and what each one does."
        />

        {/* Cross-link banner */}
        <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 px-4 py-3 flex items-start gap-3">
          <Sparkles size={16} className="text-[#0071e3] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Brand stuff lives in Brand Profile</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
              Your logo, bio, social links, brand name, tagline, fonts, and colors are managed in <a href="/brand" className="text-[#0071e3] hover:underline font-medium">Brand Profile</a>. This page is for blog-specific layout: how the logo banner looks, sidebar/in-content ads, Pick of the Day, and custom footer links.
            </p>
          </div>
        </div>

        {/* Logo banner background (display choice for the logo from Brand Profile) */}
        <Section
          title="Logo Banner"
          description="The logo from your Brand Profile appears as a full-width strip at the top of every page. Pick the background color."
        >
          {data.about.logoUrl ? (
            <div className="flex flex-col gap-3">
              <div className="flex rounded-lg border border-[var(--border-2)] overflow-hidden w-fit">
                {(['black', 'white'] as const).map(bg => (
                  <button
                    key={bg}
                    onClick={() => updateAbout({ headerBg: bg })}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors capitalize ${data.about.headerBg === bg ? 'bg-[#0071e3] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
                  >
                    {bg}
                  </button>
                ))}
              </div>
              <div
                className="rounded-lg overflow-hidden border border-[var(--border-2)] flex items-center justify-center py-3 px-6"
                style={{ background: data.about.headerBg === 'white' ? '#ffffff' : '#000000' }}
              >
                <img src={data.about.logoUrl} alt="Banner preview" className="h-10 object-contain" />
              </div>
              <p className="text-[11px] text-[var(--text-3)]">Preview of how the banner will look on your site.</p>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-3)]">
              Upload your logo in <a href="/brand" className="text-[#0071e3] hover:underline font-medium">Brand Profile</a> first, then come back here to choose the background color.
            </p>
          )}
        </Section>

        {/* Pick of the Day */}
        <Section
          title="Pick of the Day"
          description="A featured post that rotates automatically every 24 hours. Shows in the sidebar, the homepage, or both. Picked randomly from all published posts — same pick all day for every visitor, different pick each day."
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">Enable Pick of the Day</p>
                <p className="text-xs text-[var(--text-3)]">Turn the whole feature on or off site-wide.</p>
              </div>
              <button
                onClick={() => updatePickOfDay({ enabled: !data.pickOfDay.enabled })}
                className="text-[var(--text-3)]"
                aria-label="Toggle Pick of the Day"
              >
                {data.pickOfDay.enabled
                  ? <ToggleRight size={28} className="text-[#0071e3]" />
                  : <ToggleLeft size={28} />}
              </button>
            </div>

            {data.pickOfDay.enabled && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Label shown above the pick</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={data.pickOfDay.label}
                      onChange={e => updatePickOfDay({ label: e.target.value })}
                      maxLength={40}
                      className="input-field flex-1 text-sm"
                      placeholder="Our Pick of the Day"
                    />
                    <div className="flex gap-1">
                      {['Our Pick of the Day', "Editor's Choice", 'Best Value', 'Today\'s Pick'].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => updatePickOfDay({ label: preset })}
                          className="px-2 py-1 text-[10px] rounded-md border border-[var(--border-2)] text-[var(--text-3)] hover:text-[#0071e3] hover:border-[#0071e3]/40 transition-colors whitespace-nowrap"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-3 rounded-xl border border-[var(--border-2)] cursor-pointer hover:border-[#0071e3]/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={data.pickOfDay.showOnSidebar}
                      onChange={e => updatePickOfDay({ showOnSidebar: e.target.checked })}
                      className="w-4 h-4 accent-[#0071e3]"
                    />
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">Show in sidebar</p>
                      <p className="text-xs text-[var(--text-3)]">On every single post page.</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl border border-[var(--border-2)] cursor-pointer hover:border-[#0071e3]/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={data.pickOfDay.showOnHomepage}
                      onChange={e => updatePickOfDay({ showOnHomepage: e.target.checked })}
                      className="w-4 h-4 accent-[#0071e3]"
                    />
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">Show on homepage</p>
                      <p className="text-xs text-[var(--text-3)]">As a dedicated section.</p>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Rotation</label>
                  <div className="flex rounded-lg border border-[var(--border-2)] overflow-hidden w-fit">
                    {([
                      { key: '12h',    label: 'Every 12 hours' },
                      { key: '24h',    label: 'Every 24 hours' },
                      { key: 'pinned', label: 'Pin a specific post' },
                    ] as const).map(opt => {
                      const active = data.pickOfDay.rotation === opt.key
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => updatePickOfDay({ rotation: opt.key })}
                          className={`px-4 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-[#0071e3] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-[var(--text-3)] mt-1">
                    {data.pickOfDay.rotation === '12h' && 'A new pick at midnight and noon (server time). Same pick for every visitor in each window.'}
                    {data.pickOfDay.rotation === '24h' && 'A new pick at midnight (server time). Same pick all day for every visitor.'}
                    {data.pickOfDay.rotation === 'pinned' && 'Locked to the post you choose below — no rotation.'}
                  </p>
                </div>

                {data.pickOfDay.rotation === 'pinned' && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Post URL to pin</label>
                    <input
                      type="url"
                      value={data.pickOfDay.pinnedPostId}
                      onChange={e => updatePickOfDay({ pinnedPostId: e.target.value })}
                      placeholder="https://yourdomain.com/your-review-post-slug/"
                      className="input-field text-sm"
                    />
                    <p className="text-[11px] text-[var(--text-3)] mt-1">Paste the full URL of the post you want to feature. Open your blog, click the post you want, copy the URL from your browser&apos;s address bar.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>

        {/* Sidebar banners */}
        <Section
          title="Sidebar Banners"
          description="Affiliate banners shown in the right sidebar on every blog post. Use an image upload or paste HTML from Impact, ShareASale, CJ, etc."
        >
          <div className="flex flex-col gap-3">
            {data.sidebar.map(block => (
              <BannerBlockEditor
                key={block.id} block={block}
                onChange={b => updateSidebarBlock(block.id, b)}
                onDelete={() => deleteSidebarBlock(block.id)}
                showPosition={false} userId={userId}
              />
            ))}
            <button onClick={addSidebarBlock}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors">
              <Plus size={15} /> Add sidebar banner
            </button>
          </div>
        </Section>

        {/* Homepage 3-up banner strip */}
        <Section
          title="Homepage Banner Strip"
          description="Three banner slots that appear in a row on your homepage (where readers see a clear ad break). Upload a 16:9 image and an optional destination URL. Empty slots show an 'Advertise here' placeholder."
        >
          {/* Master on/off toggle. Off = the entire 3-up strip is hidden
              on the homepage. On with empty slots = "Advertise here" tiles. */}
          <label className="flex items-center gap-3 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={data.homepageAdsEnabled}
              onChange={(e) => setData(d => ({ ...d, homepageAdsEnabled: e.target.checked }))}
              className="w-4 h-4 rounded accent-[#0071e3]"
            />
            <span className="text-sm font-medium text-[var(--text-1)]">
              Show this strip on the homepage
            </span>
            <span className="text-xs text-[var(--text-3)]">
              {data.homepageAdsEnabled
                ? 'On — empty slots will show an "Advertise here" placeholder.'
                : 'Off — strip is hidden from the homepage.'}
            </span>
          </label>
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 transition-opacity ${data.homepageAdsEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            {data.homepageAds.map((ad, i) => (
              <div key={ad.id} className="flex flex-col gap-2.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Slot {i + 1}</p>
                {ad.imageUrl ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ad.imageUrl} alt="" className="w-full aspect-video object-cover rounded-lg border border-[var(--border-2)]" />
                    <button
                      onClick={() => clearHomepageAd(i)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center hover:bg-[#ff3b30]"
                      aria-label="Clear image"
                      title="Clear image"
                    >×</button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center aspect-video rounded-lg border-2 border-dashed border-[var(--border-2)] text-xs text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] cursor-pointer transition-colors text-center px-3">
                    <ImageIcon size={18} className="mb-1.5 opacity-50" />
                    <span>Upload JPG or PNG</span>
                    <span className="text-[10px] opacity-70 mt-0.5">16:9 — same shape as a post thumbnail</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleHomepageAdFile(i, f) }}
                    />
                  </label>
                )}
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-3)] uppercase tracking-wider mb-1">Destination URL</label>
                  <input
                    type="url"
                    value={ad.linkUrl}
                    onChange={(e) => updateHomepageAd(i, { linkUrl: e.target.value })}
                    placeholder="https://example.com/your-offer"
                    className="input-field text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* In-content banners */}
        <Section
          title="In-Content Banners"
          description="Affiliate banners injected inside each blog post. Use an image upload or paste HTML embed code. Choose which paragraph they appear after."
        >
          <div className="flex flex-col gap-3">
            {data.incontent.map(block => (
              <BannerBlockEditor
                key={block.id} block={block}
                onChange={b => updateIncontentBlock(block.id, b)}
                onDelete={() => deleteIncontentBlock(block.id)}
                showPosition={true} userId={userId}
              />
            ))}
            <button onClick={addIncontentBlock}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors">
              <Plus size={15} /> Add in-content banner
            </button>
          </div>
        </Section>

        {/* Custom footer links */}
        <Section
          title="Custom Links"
          description="Extra links shown in the page footer alongside your social icons."
        >
          <div className="flex flex-col gap-2">
            {data.footer.links.map(link => (
              <div key={link.id} className="flex items-center gap-2">
                <input type="text" value={link.label} onChange={e => updateCustomLink(link.id, { label: e.target.value })}
                  placeholder="Label" className="input-field w-32" />
                <input type="url" value={link.url} onChange={e => updateCustomLink(link.id, { url: e.target.value })}
                  placeholder="https://…" className="input-field flex-1" />
                <button onClick={() => deleteCustomLink(link.id)} className="text-[var(--text-3)] hover:text-[#ff3b30]">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button onClick={addCustomLink}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors">
              <Plus size={15} /> Add link
            </button>
          </div>
        </Section>

        {/* Site verification / head meta tags */}
        <Section
          title="Site Verification & Meta Tags"
          description="Paste verification <meta> tags from Google Search Console, Pinterest, Facebook, Bing, etc. They're injected into your site's <head> on every page. One full tag per box."
        >
          <div className="flex flex-col gap-2">
            {data.headMetaTags.map((tag, i) => (
              <div key={i} className="flex items-start gap-2">
                <textarea
                  value={tag}
                  onChange={e => setData(d => {
                    const next = [...d.headMetaTags]
                    next[i] = e.target.value
                    return { ...d, headMetaTags: next }
                  })}
                  rows={2}
                  placeholder={'<meta name="google-site-verification" content="…" />'}
                  className="input-field flex-1 font-mono text-xs resize-none leading-relaxed"
                  spellCheck={false}
                />
                <button
                  onClick={() => setData(d => ({ ...d, headMetaTags: d.headMetaTags.filter((_, idx) => idx !== i) }))}
                  className="text-[var(--text-3)] hover:text-[#ff3b30] mt-2"
                  title="Remove"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setData(d => ({ ...d, headMetaTags: [...d.headMetaTags, ''] }))}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors"
            >
              <Plus size={15} /> Add meta tag
            </button>
            <p className="text-xs text-[var(--text-3)] leading-relaxed mt-1">
              Only <code className="bg-[var(--surface-2)] px-1 rounded">&lt;meta&gt;</code> tags are allowed —
              anything else (scripts, styles, arbitrary HTML) is stripped server-side for security. Changes
              go live on your next save.
            </p>
          </div>
        </Section>

        <Section
          title="Analytics & Tracking"
          description="Install Google Tag Manager once — then manage Google Analytics (GA4), ads pixels, Pinterest tag, Facebook Pixel, and conversion tracking inside GTM without touching code again."
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-[var(--text)]">Google Tag Manager Container ID</label>
            <input
              type="text"
              value={data.analytics.gtmId}
              onChange={e => setData(d => ({ ...d, analytics: { ...d.analytics, gtmId: e.target.value.trim() } }))}
              placeholder="GTM-XXXXXXX"
              spellCheck={false}
              className="w-full max-w-xs px-3 py-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] text-sm font-mono focus:outline-none focus:border-[#0071e3]"
            />
            {data.analytics.gtmId && !/^GTM-[A-Z0-9]{4,12}$/.test(data.analytics.gtmId) && (
              <p className="text-xs text-[#ff9500]">⚠ ID format looks off — should be <code>GTM-</code> followed by uppercase letters/numbers (e.g. <code>GTM-P9NPW64B</code>). It won&apos;t inject until the format is valid.</p>
            )}
            <p className="text-xs text-[var(--text-3)] leading-relaxed">
              Get a free container at <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">tagmanager.google.com</a> →
              create a new container for &quot;Web&quot; → copy the <code>GTM-XXXXXXX</code> ID from the install snippets. The theme automatically injects both code snippets (head + body); you don&apos;t need to paste them anywhere. Inside GTM, add a Google Analytics 4 Configuration tag with your measurement ID and you&apos;ll have full analytics. Leave blank to inject nothing.
            </p>
          </div>
        </Section>

      </div>
    </>
  )
}
