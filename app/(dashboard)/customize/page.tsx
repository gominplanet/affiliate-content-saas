'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Header from '@/components/layout/Header'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Plus, Trash2, Save, Loader2, ToggleLeft, ToggleRight,
  Youtube, Facebook, Instagram, Link, AlignLeft, ChevronDown, ChevronUp,
  Twitter, Mail, Upload, X, RefreshCw, Sparkles, Image as ImageIcon,
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
}

interface FooterData {
  socials: SocialLinks
  links: CustomLink[]
}

interface BlogCustomizations {
  sidebar: AdBlock[]
  incontent: AdBlock[]
  about: AboutData
  footer: FooterData
}

const emptyAbout: AboutData = { bio: '', logoUrl: '' }
const emptyFooter: FooterData = {
  socials: { youtube: '', facebook: '', instagram: '', threads: '', pinterest: '', tiktok: '', twitter: '', contact: '' },
  links: [],
}

const defaultCustomizations: BlogCustomizations = {
  sidebar: [],
  incontent: [],
  about: emptyAbout,
  footer: emptyFooter,
}

function newBlock(): AdBlock {
  return { id: crypto.randomUUID(), type: 'image', imageUrl: '', linkUrl: '', html: '', position: 2, enabled: true }
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
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)
  const [userId, setUserId] = useState('')

  // About Me state
  const [rewriting, setRewriting] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [aboutError, setAboutError] = useState<string | null>(null)
  const logoFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
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
        bio:     bc.about?.bio ?? bc.footer?.bio ?? '',
        logoUrl: bc.about?.logoUrl ?? bc.about?.imageUrl ?? '',
      }
      setData({
        ...defaultCustomizations,
        ...bc,
        sidebar:   (bc.sidebar   ?? []).map(migrateBlock),
        incontent: (bc.incontent ?? []).map(migrateBlock),
        about,
        footer: { ...emptyFooter, ...(bc.footer ?? {}), socials },
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
    try {
      const res = await fetch('/api/wordpress/customizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (json.error) { alert(json.error); return }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  function updateAbout(patch: Partial<AboutData>) {
    setData(d => ({ ...d, about: { ...d.about, ...patch } }))
  }

  async function handleLogoImage(file: File) {
    if (!file.type.startsWith('image/')) { setAboutError('Please upload an image file.'); return }
    setLogoUploading(true); setAboutError(null)
    try {
      const url = await uploadImage(file, userId, 'about')
      updateAbout({ logoUrl: url })
    } catch (e) {
      setAboutError(e instanceof Error ? e.message : 'Upload failed.')
    } finally { setLogoUploading(false) }
  }

  async function rewriteBio() {
    if (!data.about.bio.trim()) {
      alert('Write a few notes about yourself first, then click Rewrite.')
      return
    }
    setRewriting(true)
    try {
      const res = await fetch('/api/blog/rewrite-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: data.about.bio }),
      })
      if (!res.ok) {
        let errMsg = 'Rewrite failed — please try again.'
        try { errMsg = (await res.json()).error || errMsg } catch { /* HTML error page */ }
        alert(errMsg)
        return
      }
      const json = await res.json()
      if (json.error) { alert(json.error); return }
      updateAbout({ bio: json.bio })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Rewrite failed. Please try again.')
    } finally { setRewriting(false) }
  }

  function updateSidebar(blocks: AdBlock[]) { setData(d => ({ ...d, sidebar: blocks })) }
  function addSidebarBlock() { updateSidebar([...data.sidebar, newBlock()]) }
  function updateSidebarBlock(id: string, b: AdBlock) { updateSidebar(data.sidebar.map(x => x.id === id ? b : x)) }
  function deleteSidebarBlock(id: string) { updateSidebar(data.sidebar.filter(x => x.id !== id)) }

  function updateIncontent(blocks: AdBlock[]) { setData(d => ({ ...d, incontent: blocks })) }
  function addIncontentBlock() { updateIncontent([...data.incontent, newBlock()]) }
  function updateIncontentBlock(id: string, b: AdBlock) { updateIncontent(data.incontent.map(x => x.id === id ? b : x)) }
  function deleteIncontentBlock(id: string) { updateIncontent(data.incontent.filter(x => x.id !== id)) }

  function updateFooter(patch: Partial<FooterData>) { setData(d => ({ ...d, footer: { ...d.footer, ...patch } })) }
  function updateSocial(key: keyof SocialLinks, val: string) {
    setData(d => ({ ...d, footer: { ...d.footer, socials: { ...d.footer.socials, [key]: val } } }))
  }
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
        <Header title="Customize Blog" subtitle="Manage your WordPress blog's look and content." />
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
        subtitle="Manage your WordPress blog's look and content."
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

      <div className="flex flex-col gap-6 max-w-2xl">

        {/* About Me */}
        <Section
          title="About Me"
          description="Shown below the social icons on your homepage. Introduce yourself to your readers."
        >
          <div className="flex flex-col gap-5">

            {/* Brand logo */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5"><ImageIcon size={13} /> Brand logo</label>
              {data.about.logoUrl ? (
                <div className="relative inline-block">
                  <img src={data.about.logoUrl} alt="Logo" className="h-16 rounded-xl object-contain border border-[var(--border-2)] px-2 bg-white" />
                  <button onClick={() => updateAbout({ logoUrl: '' })}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#ff3b30] text-white flex items-center justify-center shadow">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => logoFileRef.current?.click()} disabled={logoUploading}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-[var(--border-2)] text-xs text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors w-fit">
                  {logoUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {logoUploading ? 'Uploading…' : 'Upload logo'}
                </button>
              )}
              <input ref={logoFileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoImage(f); e.target.value = '' }} />
              {aboutError && <p className="text-xs text-[#ff3b30]">{aboutError}</p>}
            </div>

            {/* Bio */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[var(--text-2)] flex items-center gap-1.5">
                  <AlignLeft size={13} /> Bio
                </label>
                <button
                  onClick={rewriteBio}
                  disabled={rewriting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 disabled:opacity-50 transition-colors"
                >
                  {rewriting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {rewriting ? 'Rewriting…' : 'MVP Affiliate Rewrite Tool'}
                </button>
              </div>
              <textarea
                value={data.about.bio}
                onChange={e => updateAbout({ bio: e.target.value })}
                rows={5}
                placeholder="Write a few things about yourself — where you're from, why you started reviewing products, what you love, who you help. Then hit the AI Rewrite button and it will turn your notes into a polished bio."
                className="input-field w-full resize-y"
              />
              <p className="text-[11px] text-[var(--text-3)] mt-1.5">
                Tip: jot down a few sentences about yourself and click <strong>MVP Affiliate Rewrite Tool</strong> — the AI knows your brand and will write a polished bio for you. Edit it as you like.
              </p>
            </div>

          </div>
        </Section>

        {/* Social Links */}
        <Section
          title="Social Links"
          description="Displayed in a row below your latest reviews on the homepage."
        >
          <div className="flex flex-col gap-2">
            {(
              [
                { key: 'youtube',   label: 'YouTube',       icon: Youtube,   placeholder: 'https://youtube.com/@yourchannel' },
                { key: 'instagram', label: 'Instagram',     icon: Instagram, placeholder: 'https://instagram.com/yourhandle' },
                { key: 'tiktok',   label: 'TikTok',        icon: Link,      placeholder: 'https://tiktok.com/@yourhandle' },
                { key: 'twitter',  label: 'X / Twitter',   icon: Twitter,   placeholder: 'https://x.com/yourhandle' },
                { key: 'pinterest',label: 'Pinterest',      icon: Link,      placeholder: 'https://pinterest.com/yourprofile' },
                { key: 'facebook', label: 'Facebook',       icon: Facebook,  placeholder: 'https://facebook.com/yourpage' },
                { key: 'threads',  label: 'Threads',        icon: Link,      placeholder: 'https://threads.net/@yourhandle' },
                { key: 'contact',  label: 'Contact email',  icon: Mail,      placeholder: 'hello@yourdomain.com' },
              ] as const
            ).map(({ key, label, icon: Icon, placeholder }) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center flex-shrink-0">
                  <Icon size={15} className="text-[var(--text-3)]" />
                </div>
                <input
                  type={key === 'contact' ? 'email' : 'url'}
                  value={data.footer.socials[key]}
                  onChange={e => updateSocial(key, e.target.value)}
                  placeholder={placeholder}
                  className="input-field flex-1 text-sm"
                />
              </div>
            ))}
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

      </div>
    </>
  )
}
