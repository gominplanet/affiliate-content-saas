'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
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

/**
 * Reviewer Trust Block — shows at the top of every blog post (right under
 * the H1) when enabled. Builds E-E-A-T signals for Google, makes the
 * "real person behind the review" obvious to readers, and bumps AI
 * Overviews credibility. Defaults pull from brand_profiles; everything
 * here is per-blog override.
 */
interface AuthorBlockData {
  enabled: boolean
  name: string         // "Seb & Michelle"
  tagline: string      // 1-2 sentence credibility line, e.g. "I've personally tested 200+ Amazon products on camera since 2024"
  photoUrl: string     // Author/host headshot
  linkUrl: string      // Optional link — author page, YouTube channel, etc.
  linkLabel: string    // Display text for the link ("More about me", "Watch my reviews")
}

/**
 * Mid-article newsletter form — appears inline at a configurable paragraph
 * position on every single post. Uses the same submit endpoint + visual
 * treatment as the [mvp-newsletter] sidebar shortcode; just placed in the
 * flow of reading. Best-performing email-capture pattern for affiliate sites
 * (1-3% conversion of post readers vs <0.5% for sidebar-only).
 */
interface NewsletterInlineData {
  enabled: boolean
  afterParagraph: number  // 1-8, where in the body it inserts
  title: string
  subtitle: string
  button: string
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
  authorBlock: AuthorBlockData
  newsletterInline: NewsletterInlineData
  footer: FooterData
  pickOfDay: PickOfDayConfig
  /** Raw <meta> tags injected into the site's <head> — domain verification
   *  for Google Search Console, Pinterest, Facebook, Bing, etc. One full
   *  tag string per entry. Sanitized server-side in the WP plugin. */
  headMetaTags: string[]
  /** Analytics IDs the theme injects:
   *  - ga4Id:  a GA4 Measurement ID (G-XXXXXXXX) → theme injects gtag.js
   *            directly. The simple, one-step path; no GTM needed.
   *  - gtmId:  a Google Tag Manager container (GTM-XXXXXXX) → theme injects
   *            the GTM head <script> + <body> noscript. Advanced path for
   *            users who want multiple pixels / custom events.
   *  Both are strictly format-validated before injection. */
  analytics: { gtmId: string; ga4Id: string }
}

const emptyAbout: AboutData = { bio: '', logoUrl: '', headerBg: 'black' }
const emptyAuthorBlock: AuthorBlockData = {
  enabled: true,
  name: '',
  tagline: '',
  photoUrl: '',
  linkUrl: '',
  linkLabel: 'More about me',
}
const emptyNewsletterInline: NewsletterInlineData = {
  enabled: false,
  afterParagraph: 3,
  title: 'Want the best Amazon finds in your inbox?',
  subtitle: 'A short monthly email with the products I tested + actually liked. No spam.',
  button: 'Subscribe',
}
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
  authorBlock: emptyAuthorBlock,
  newsletterInline: emptyNewsletterInline,
  footer: emptyFooter,
  pickOfDay: defaultPickOfDay,
  headMetaTags: [],
  analytics: { gtmId: '', ga4Id: '' },
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
            {block.enabled ? <ToggleRight size={20} className="text-[#7C3AED]" /> : <ToggleLeft size={20} />}
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
                    className="px-2 py-1 text-[10px] rounded-md border border-[var(--border-2)] text-[var(--text-3)] hover:text-[#7C3AED] hover:border-[#7C3AED]/40 transition-colors whitespace-nowrap"
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
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${!isHtml ? 'bg-[#7C3AED] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
            >
              Image
            </button>
            <button
              onClick={() => onChange({ ...block, type: 'html' })}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${isHtml ? 'bg-[#7C3AED] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
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
                  className={`relative rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-[var(--border-2)] hover:border-[#7C3AED]'}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                >
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="w-full flex flex-col items-center gap-2 py-8 text-[var(--text-3)] hover:text-[var(--text)] transition-colors">
                    {uploading ? <Loader2 size={22} className="animate-spin text-[#7C3AED]" /> : <Upload size={22} />}
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
      .select('logo_url, author_name, headshot_url, youtube_channel_url')
      .eq('user_id', user.id)
      .single()
    const canonicalLogoUrl: string = brandRow?.logo_url ?? ''
    // Author block defaults pulled from Brand Profile (single source of truth
    // for who-you-are). User can override per-blog in the form below.
    const brandAuthorName: string = brandRow?.author_name ?? ''
    const brandHeadshot: string = brandRow?.headshot_url ?? ''
    const brandYouTube: string = brandRow?.youtube_channel_url ?? ''
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
      // Author block — start from brand defaults, let blog overrides win
      // for each individual field. enabled defaults to true on first load
      // so the trust signal is on by default.
      const authorBlock: AuthorBlockData = {
        enabled:   typeof bc.authorBlock?.enabled === 'boolean' ? bc.authorBlock.enabled : true,
        name:      bc.authorBlock?.name      ?? brandAuthorName,
        tagline:   bc.authorBlock?.tagline   ?? '',
        photoUrl:  bc.authorBlock?.photoUrl  ?? brandHeadshot,
        linkUrl:   bc.authorBlock?.linkUrl   ?? brandYouTube,
        linkLabel: bc.authorBlock?.linkLabel ?? 'More about me',
      }
      // Mid-article newsletter — OFF by default; user opts in.
      const newsletterInline: NewsletterInlineData = {
        enabled:        typeof bc.newsletterInline?.enabled === 'boolean' ? bc.newsletterInline.enabled : false,
        afterParagraph: Math.max(1, Math.min(8, Number(bc.newsletterInline?.afterParagraph) || 3)),
        title:          bc.newsletterInline?.title    ?? emptyNewsletterInline.title,
        subtitle:       bc.newsletterInline?.subtitle ?? emptyNewsletterInline.subtitle,
        button:         bc.newsletterInline?.button   ?? emptyNewsletterInline.button,
      }
      setData({
        ...defaultCustomizations,
        ...bc,
        authorBlock,
        newsletterInline,
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
          ga4Id: typeof bc.analytics?.ga4Id === 'string' ? bc.analytics.ga4Id : '',
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
      if (json.error) { toast.error(json.error); return }
      setPurged(true)
      toast.success('Cache purged across your site.')
      setTimeout(() => setPurged(false), 3000)
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
      if (json.error) { toast.error(json.error); return }
      if (json.wordpress === 'failed') {
        setWpPushError(json.wordpressError || 'WordPress push failed — check your credentials in Site & Integrations.')
      } else {
        // Auto-purge cache so changes appear immediately on the live blog.
        fetch('/api/wordpress/purge-cache', { method: 'POST' }).catch(() => {})
      }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  function updateAuthorBlock(patch: Partial<AuthorBlockData>) {
    setData(d => ({ ...d, authorBlock: { ...d.authorBlock, ...patch } }))
  }
  function updateNewsletterInline(patch: Partial<NewsletterInlineData>) {
    setData(d => ({ ...d, newsletterInline: { ...d.newsletterInline, ...patch } }))
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
      toast.error(err instanceof Error ? err.message : 'Image upload failed.')
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
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">Check your WordPress credentials in <a href="/setup?tab=integrations" className="text-[#7C3AED] hover:underline">Site & Integrations</a>, then save again.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 max-w-2xl">

        <TutorialVideo sectionKey="customize" />

        {/* Cross-link banner */}
        <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 px-4 py-3 flex items-start gap-3">
          <Sparkles size={16} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Brand stuff lives in Brand Profile</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
              Your logo, header banner, bio, social links, brand name, tagline, fonts, and colors are all managed in <a href="/brand" className="text-[#7C3AED] hover:underline font-medium">Brand Profile</a>. This page is for blog-specific layout: sidebar/in-content ads, Pick of the Day, and custom footer links.
            </p>
          </div>
        </div>

        {/* Logo Banner section removed from the UI — the live header is now
            driven by Brand Profile's Header Banner image (full-width wide
            asset). headerBg + logo fallback still persisted in
            data.about for backwards compat with users who haven't
            uploaded a header banner yet. */}

        {/* Reviewer Trust Block — author byline at top of every post */}
        <Section
          title="Reviewer Trust Block"
          description={`Shown at the top of every blog post, right under the headline. Tells Google + AI Overviews who's actually behind the review (E-E-A-T signal — big ranking lift), and tells readers "this is a real human" so they don't bounce. Defaults pull from your Brand Profile; override here per blog if you want.`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">Show on every post</p>
                <p className="text-xs text-[var(--text-3)]">Turn the trust block on or off site-wide.</p>
              </div>
              <button
                onClick={() => updateAuthorBlock({ enabled: !data.authorBlock.enabled })}
                className="text-[var(--text-3)]"
                aria-label="Toggle Reviewer Trust Block"
              >
                {data.authorBlock.enabled
                  ? <ToggleRight size={28} className="text-[#7C3AED]" />
                  : <ToggleLeft size={28} />}
              </button>
            </div>

            {data.authorBlock.enabled && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Reviewer name</label>
                  <input
                    type="text"
                    value={data.authorBlock.name}
                    onChange={e => updateAuthorBlock({ name: e.target.value })}
                    placeholder="e.g. Seb & Michelle"
                    className="input-field w-full"
                  />
                  <p className="text-[11px] text-[var(--text-3)] mt-1">Defaults to Brand Profile → Author name.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Credibility tagline</label>
                  <textarea
                    value={data.authorBlock.tagline}
                    onChange={e => updateAuthorBlock({ tagline: e.target.value })}
                    placeholder={'1-2 sentences proving you\'re the real deal.\n\ne.g. "I\'ve personally tested 200+ Amazon products on camera since 2024. Every review here is based on hands-on use, not paid placements."'}
                    rows={3}
                    maxLength={300}
                    className="input-field w-full resize-y"
                  />
                  <p className="text-[11px] text-[var(--text-3)] mt-1">The single most important field — concrete numbers + how long you've been doing this beats vague "passionate about reviews" claims. {data.authorBlock.tagline.length}/300</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Photo URL</label>
                  <input
                    type="url"
                    value={data.authorBlock.photoUrl}
                    onChange={e => updateAuthorBlock({ photoUrl: e.target.value })}
                    placeholder="https://…/your-headshot.jpg"
                    className="input-field w-full"
                  />
                  <p className="text-[11px] text-[var(--text-3)] mt-1">Defaults to Brand Profile → Headshot. Use a real photo (face visible) — animated avatars hurt trust signals.</p>
                  {data.authorBlock.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.authorBlock.photoUrl} alt="Reviewer headshot preview" className="mt-2 rounded-full object-cover border border-[var(--border-2)]" style={{ width: 56, height: 56 }} />
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Link URL <span className="text-[var(--text-3)] font-normal">(optional)</span></label>
                    <input
                      type="url"
                      value={data.authorBlock.linkUrl}
                      onChange={e => updateAuthorBlock({ linkUrl: e.target.value })}
                      placeholder="https://youtube.com/@you"
                      className="input-field w-full"
                    />
                    <p className="text-[11px] text-[var(--text-3)] mt-1">Where the "More about me" link goes — YouTube channel, About page, etc.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Link label</label>
                    <input
                      type="text"
                      value={data.authorBlock.linkLabel}
                      onChange={e => updateAuthorBlock({ linkLabel: e.target.value })}
                      placeholder="More about me"
                      maxLength={40}
                      className="input-field w-full"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </Section>

        {/* Mid-article newsletter form */}
        <Section
          title="Mid-article newsletter form"
          description="Capture emails mid-read while attention is highest. Inserts an inline subscribe form after the Nth paragraph of every single review post. Best converting placement for affiliate sites — typically 1-3% of readers vs <0.5% sidebar-only."
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">Show on every post</p>
                <p className="text-xs text-[var(--text-3)]">Site-wide toggle. Uses your existing MVP newsletter list — same signups as the sidebar form.</p>
              </div>
              <button
                onClick={() => updateNewsletterInline({ enabled: !data.newsletterInline.enabled })}
                className="text-[var(--text-3)]"
                aria-label="Toggle mid-article newsletter form"
              >
                {data.newsletterInline.enabled
                  ? <ToggleRight size={28} className="text-[#7C3AED]" />
                  : <ToggleLeft size={28} />}
              </button>
            </div>

            {data.newsletterInline.enabled && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Show after paragraph</label>
                  <select
                    value={data.newsletterInline.afterParagraph}
                    onChange={e => updateNewsletterInline({ afterParagraph: Number(e.target.value) })}
                    className="input-field w-40"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                      <option key={n} value={n}>After paragraph {n}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[var(--text-3)] mt-1">3-4 is the sweet spot — past the hook, before the reader bounces. If the post has fewer paragraphs than this, the form appends at the end so it still has a shot.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Headline</label>
                  <input
                    type="text"
                    value={data.newsletterInline.title}
                    onChange={e => updateNewsletterInline({ title: e.target.value })}
                    maxLength={120}
                    className="input-field w-full"
                  />
                  <p className="text-[11px] text-[var(--text-3)] mt-1">Curiosity-driven beats generic — "Get the next review in your inbox" converts about half as well as "The 5 best Amazon finds I tested this month".</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Subtitle</label>
                  <textarea
                    value={data.newsletterInline.subtitle}
                    onChange={e => updateNewsletterInline({ subtitle: e.target.value })}
                    maxLength={300}
                    rows={2}
                    className="input-field w-full resize-y"
                  />
                  <p className="text-[11px] text-[var(--text-3)] mt-1">One short sentence. Include the "no spam" reassurance — it lifts opt-ins.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Button label</label>
                  <input
                    type="text"
                    value={data.newsletterInline.button}
                    onChange={e => updateNewsletterInline({ button: e.target.value })}
                    maxLength={40}
                    className="input-field w-44"
                  />
                </div>
              </>
            )}
          </div>
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
                  ? <ToggleRight size={28} className="text-[#7C3AED]" />
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
                          className="px-2 py-1 text-[10px] rounded-md border border-[var(--border-2)] text-[var(--text-3)] hover:text-[#7C3AED] hover:border-[#7C3AED]/40 transition-colors whitespace-nowrap"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-3 rounded-xl border border-[var(--border-2)] cursor-pointer hover:border-[#7C3AED]/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={data.pickOfDay.showOnSidebar}
                      onChange={e => updatePickOfDay({ showOnSidebar: e.target.checked })}
                      className="w-4 h-4 accent-[#7C3AED]"
                    />
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">Show in sidebar</p>
                      <p className="text-xs text-[var(--text-3)]">On every single post page.</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl border border-[var(--border-2)] cursor-pointer hover:border-[#7C3AED]/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={data.pickOfDay.showOnHomepage}
                      onChange={e => updatePickOfDay({ showOnHomepage: e.target.checked })}
                      className="w-4 h-4 accent-[#7C3AED]"
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
                          className={`px-4 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-[#7C3AED] text-white' : 'text-[var(--text-3)] hover:text-[var(--text)] bg-[var(--surface-2)]'}`}
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
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#7C3AED] hover:text-[#7C3AED] transition-colors">
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
              className="w-4 h-4 rounded accent-[#7C3AED]"
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
                  <label className="flex flex-col items-center justify-center aspect-video rounded-lg border-2 border-dashed border-[var(--border-2)] text-xs text-[var(--text-3)] hover:border-[#7C3AED] hover:text-[#7C3AED] cursor-pointer transition-colors text-center px-3">
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
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#7C3AED] hover:text-[#7C3AED] transition-colors">
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
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#7C3AED] hover:text-[#7C3AED] transition-colors">
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
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#7C3AED] hover:text-[#7C3AED] transition-colors"
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
          description="See your blog traffic in Google Analytics. Most people only need the simple GA4 path below — paste one ID and you're done. No code to copy anywhere."
        >
          <div className="flex flex-col gap-6">

            {/* ── Easy path: GA4 Measurement ID (injects gtag.js directly) ── */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
                Google Analytics 4 — Measurement ID
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#34c759]/15 text-[#1c7a35]">Recommended</span>
              </label>
              <input
                type="text"
                value={data.analytics.ga4Id}
                onChange={e => setData(d => ({ ...d, analytics: { ...d.analytics, ga4Id: e.target.value.trim().toUpperCase() } }))}
                placeholder="G-XXXXXXXXXX"
                spellCheck={false}
                className="w-full max-w-xs px-3 py-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] text-sm font-mono focus:outline-none focus:border-[#7C3AED]"
              />
              {data.analytics.ga4Id && !/^G-[A-Z0-9]{4,12}$/.test(data.analytics.ga4Id) && (
                <p className="text-xs text-[#ff9500]">⚠ That doesn&apos;t look like a GA4 Measurement ID — it should be <code>G-</code> followed by letters/numbers (e.g. <code>G-ABC123XYZ</code>). A <code>GTM-</code> ID goes in the box below instead. It won&apos;t inject until the format is valid.</p>
              )}

              <details className="mt-1 rounded-lg border border-[var(--border-2)] bg-[var(--surface-2)] p-3 text-xs text-[var(--text-2)] leading-relaxed">
                <summary className="cursor-pointer font-medium text-[var(--text)] select-none">How do I find my GA4 Measurement ID? (step by step)</summary>
                <ol className="list-decimal ml-4 mt-3 flex flex-col gap-2">
                  <li>Go to <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">analytics.google.com</a> and sign in with the Google account you want to own your stats.</li>
                  <li><b>First time using Analytics?</b> Click <b>Start measuring</b>, then create an <b>Account</b> (your name or brand) and a <b>Property</b> (your blog) — set your country, currency, and time zone.</li>
                  <li>When it asks what you want to measure, choose <b>Web</b>. Enter your blog&apos;s full URL (e.g. <code>https://yourblog.com</code>) and a stream name, then click <b>Create stream</b>.</li>
                  <li>You&apos;ll land on <b>Web stream details</b>. Your <b>Measurement ID</b> is at the top right — it looks like <code>G-XXXXXXXXXX</code>. Copy it.</li>
                  <li><b>Already had Analytics set up?</b> Click the <b>gear ⚙ (Admin)</b> at the bottom-left → under <b>Property</b> click <b>Data streams</b> → click your web stream → copy the <b>Measurement ID</b> at the top.</li>
                  <li>Paste it into the box above and click <b>Save</b> at the top of this page.</li>
                  <li><b>Check it works:</b> open your blog in a new tab, then in Analytics go to <b>Reports → Realtime</b>. Within ~30 seconds you should see <b>1 active user</b> (that&apos;s you). Full reports (sessions, top pages, traffic sources) fill in over the next 24–48 hours.</li>
                </ol>
                <p className="mt-3 text-[var(--text-3)]">No code to paste anywhere — the theme injects Google&apos;s official tag for you the moment a valid <code>G-</code> ID is saved.</p>
              </details>
            </div>

            {/* ── Advanced path: Google Tag Manager ── */}
            <div className="flex flex-col gap-2 border-t border-[var(--border-2)] pt-5">
              <label className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
                Google Tag Manager — Container ID
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-3)]">Advanced · optional</span>
              </label>
              <input
                type="text"
                value={data.analytics.gtmId}
                onChange={e => setData(d => ({ ...d, analytics: { ...d.analytics, gtmId: e.target.value.trim().toUpperCase() } }))}
                placeholder="GTM-XXXXXXX"
                spellCheck={false}
                className="w-full max-w-xs px-3 py-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] text-sm font-mono focus:outline-none focus:border-[#7C3AED]"
              />
              {data.analytics.gtmId && !/^GTM-[A-Z0-9]{4,12}$/.test(data.analytics.gtmId) && (
                <p className="text-xs text-[#ff9500]">⚠ ID format looks off — should be <code>GTM-</code> followed by uppercase letters/numbers (e.g. <code>GTM-P9NPW64B</code>). It won&apos;t inject until the format is valid.</p>
              )}
              <p className="text-xs text-[var(--text-3)] leading-relaxed">
                Only needed if you want to manage <b>several</b> tags in one place (Google Ads, Facebook/Meta Pixel, Pinterest tag, custom conversions). Create a free <b>Web</b> container at <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">tagmanager.google.com</a>, copy the <code>GTM-XXXXXXX</code> ID, and paste it here — the theme injects both GTM snippets (head + body) automatically. You&apos;d then add your GA4 tag inside GTM. <b>If you just want Google Analytics, use the GA4 box above and leave this blank.</b>
              </p>
            </div>
          </div>
        </Section>

        {/* Bottom save bar — mirrors the top action so users don't have to
            scroll back up after editing a long page. */}
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--border-2)] pt-5">
          {saved && <span className="text-xs text-[#34c759] font-medium">Saved!</span>}
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save & Push to Blog'}
          </button>
        </div>

      </div>
    </>
  )
}
