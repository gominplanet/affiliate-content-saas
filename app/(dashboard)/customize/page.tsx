'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Header from '@/components/layout/Header'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Plus, Trash2, Save, Loader2, ToggleLeft, ToggleRight,
  Youtube, Facebook, Instagram, Link, AlignLeft, ChevronDown, ChevronUp,
  Twitter, Mail, Upload, X, RefreshCw,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdBlock {
  id: string
  imageUrl: string
  linkUrl: string
  position: number // in-content only: after paragraph N
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

interface FooterData {
  bio: string
  socials: SocialLinks
  links: CustomLink[]
}

interface BlogCustomizations {
  sidebar: AdBlock[]
  incontent: AdBlock[]
  footer: FooterData
}

const emptyFooter: FooterData = {
  bio: '',
  socials: { youtube: '', facebook: '', instagram: '', threads: '', pinterest: '', tiktok: '', twitter: '', contact: '' },
  links: [],
}

const defaultCustomizations: BlogCustomizations = {
  sidebar: [],
  incontent: [],
  footer: emptyFooter,
}

function newBlock(): AdBlock {
  return { id: crypto.randomUUID(), imageUrl: '', linkUrl: '', position: 2, enabled: true }
}

// Migrate legacy blocks that had type/html fields
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateBlock(raw: any): AdBlock {
  return {
    id: raw.id ?? crypto.randomUUID(),
    imageUrl: raw.imageUrl ?? '',
    linkUrl: raw.linkUrl ?? '',
    position: raw.position ?? 2,
    enabled: raw.enabled ?? true,
  }
}

// ── Image upload helper ───────────────────────────────────────────────────────

async function uploadBannerImage(file: File, userId: string): Promise<string> {
  const supabase = createBrowserClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
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
  block,
  onChange,
  onDelete,
  showPosition,
  userId,
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
    setUploading(true)
    setUploadError(null)
    try {
      const url = await uploadBannerImage(file, userId)
      onChange({ ...block, imageUrl: url })
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed. Try pasting an image URL instead.')
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="border border-[var(--border-2)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)]">
        <div className="flex items-center gap-3">
          <button onClick={() => onChange({ ...block, enabled: !block.enabled })} className="text-[var(--text-3)]">
            {block.enabled
              ? <ToggleRight size={20} className="text-[#0071e3]" />
              : <ToggleLeft size={20} />}
          </button>
          <span className="text-sm font-medium text-[var(--text)]">Affiliate Banner</span>
          {!block.enabled && <span className="text-xs text-[var(--text-3)]">(disabled)</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(o => !o)} className="text-[var(--text-3)] hover:text-[var(--text)]">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button onClick={onDelete} className="text-[var(--text-3)] hover:text-[#ff3b30]">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {open && (
        <div className="p-4 flex flex-col gap-4">

          {/* Image upload / preview */}
          {block.imageUrl ? (
            <div className="relative">
              <img
                src={block.imageUrl}
                alt="Banner preview"
                className="w-full rounded-lg border border-[var(--border-2)] object-cover max-h-40"
              />
              <button
                onClick={() => onChange({ ...block, imageUrl: '' })}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#ff3b30] text-white flex items-center justify-center shadow"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div
              className={`relative rounded-xl border-2 border-dashed transition-colors ${
                dragging ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-[var(--border-2)] hover:border-[#0071e3]'
              }`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full flex flex-col items-center gap-2 py-8 text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
              >
                {uploading
                  ? <Loader2 size={22} className="animate-spin text-[#0071e3]" />
                  : <Upload size={22} />
                }
                <span className="text-xs font-medium">
                  {uploading ? 'Uploading…' : 'Click to upload or drag an image here'}
                </span>
                <span className="text-[11px] text-[var(--text-3)]">PNG, JPG, GIF, WebP</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              />
            </div>
          )}

          {uploadError && (
            <p className="text-xs text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
              {uploadError}
            </p>
          )}

          {/* Affiliate link */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Affiliate link</label>
            <input
              type="url"
              value={block.linkUrl}
              onChange={e => onChange({ ...block, linkUrl: e.target.value })}
              placeholder="https://amzn.to/your-link"
              className="input-field w-full"
            />
            <p className="text-[11px] text-[var(--text-3)] mt-1">Visitors who click the image will go to this URL.</p>
          </div>

          {/* Position (in-content only) */}
          {showPosition && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Show after paragraph</label>
              <select
                value={block.position}
                onChange={e => onChange({ ...block, position: Number(e.target.value) })}
                className="input-field w-44"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                  <option key={n} value={n}>Paragraph {n}</option>
                ))}
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
      setData({
        ...defaultCustomizations,
        ...bc,
        sidebar:   (bc.sidebar   ?? []).map(migrateBlock),
        incontent: (bc.incontent ?? []).map(migrateBlock),
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
      setPurged(true)
      setTimeout(() => setPurged(false), 3000)
    } finally {
      setPurging(false)
    }
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
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  // ── Sidebar helpers ──────────────────────────────────────────────────────────
  function updateSidebar(blocks: AdBlock[]) { setData(d => ({ ...d, sidebar: blocks })) }
  function addSidebarBlock() { updateSidebar([...data.sidebar, newBlock()]) }
  function updateSidebarBlock(id: string, b: AdBlock) { updateSidebar(data.sidebar.map(x => x.id === id ? b : x)) }
  function deleteSidebarBlock(id: string) { updateSidebar(data.sidebar.filter(x => x.id !== id)) }

  // ── In-content helpers ───────────────────────────────────────────────────────
  function updateIncontent(blocks: AdBlock[]) { setData(d => ({ ...d, incontent: blocks })) }
  function addIncontentBlock() { updateIncontent([...data.incontent, newBlock()]) }
  function updateIncontentBlock(id: string, b: AdBlock) { updateIncontent(data.incontent.map(x => x.id === id ? b : x)) }
  function deleteIncontentBlock(id: string) { updateIncontent(data.incontent.filter(x => x.id !== id)) }

  // ── Footer helpers ───────────────────────────────────────────────────────────
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
        <Header title="Customize Blog" subtitle="Manage your WordPress blog's sidebar, content, and footer." />
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
        subtitle="Manage your WordPress blog's sidebar, content, and footer."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={purgeCache}
              disabled={purging || saving}
              className="btn-secondary flex items-center gap-2"
              title="Clear LiteSpeed cache so your latest changes appear immediately on the blog"
            >
              {purging ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {purged ? 'Cache cleared!' : purging ? 'Clearing…' : 'Clear Cache'}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save & Push to WordPress'}
            </button>
          </div>
        }
      />

      <div className="flex flex-col gap-6 max-w-2xl">

        {/* Sidebar */}
        <Section
          title="Sidebar Banners"
          description="Clickable image banners shown in the right sidebar on every blog post. Great for featured products or affiliate offers."
        >
          <div className="flex flex-col gap-3">
            {data.sidebar.map(block => (
              <BannerBlockEditor
                key={block.id}
                block={block}
                onChange={b => updateSidebarBlock(block.id, b)}
                onDelete={() => deleteSidebarBlock(block.id)}
                showPosition={false}
                userId={userId}
              />
            ))}
            <button
              onClick={addSidebarBlock}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors"
            >
              <Plus size={15} /> Add sidebar banner
            </button>
          </div>
        </Section>

        {/* In-content */}
        <Section
          title="In-Content Banners"
          description="Clickable image banners injected directly inside each blog post. Choose which paragraph they appear after."
        >
          <div className="flex flex-col gap-3">
            {data.incontent.map(block => (
              <BannerBlockEditor
                key={block.id}
                block={block}
                onChange={b => updateIncontentBlock(block.id, b)}
                onDelete={() => deleteIncontentBlock(block.id)}
                showPosition={true}
                userId={userId}
              />
            ))}
            <button
              onClick={addIncontentBlock}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors"
            >
              <Plus size={15} /> Add in-content banner
            </button>
          </div>
        </Section>

        {/* Footer */}
        <Section
          title="Footer"
          description="Shown in the footer of every page on your blog."
        >
          <div className="flex flex-col gap-5">

            {/* Bio */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5 flex items-center gap-1.5">
                <AlignLeft size={13} /> About / Bio
              </label>
              <textarea
                value={data.footer.bio}
                onChange={e => updateFooter({ bio: e.target.value })}
                rows={4}
                placeholder="Tell your readers who you are and what your blog is about…"
                className="input-field w-full resize-y"
              />
            </div>

            {/* Socials */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-3">Social Links</label>
              <div className="flex flex-col gap-2">
                {(
                  [
                    { key: 'youtube',   label: 'YouTube',      icon: Youtube,   placeholder: 'https://youtube.com/@yourchannel' },
                    { key: 'instagram', label: 'Instagram',    icon: Instagram, placeholder: 'https://instagram.com/yourhandle' },
                    { key: 'tiktok',    label: 'TikTok',       icon: Link,      placeholder: 'https://tiktok.com/@yourhandle' },
                    { key: 'twitter',   label: 'X / Twitter',  icon: Twitter,   placeholder: 'https://x.com/yourhandle' },
                    { key: 'pinterest', label: 'Pinterest',    icon: Link,      placeholder: 'https://pinterest.com/yourprofile' },
                    { key: 'facebook',  label: 'Facebook',     icon: Facebook,  placeholder: 'https://facebook.com/yourpage' },
                    { key: 'threads',   label: 'Threads',      icon: Link,      placeholder: 'https://threads.net/@yourhandle' },
                    { key: 'contact',   label: 'Contact email', icon: Mail,     placeholder: 'hello@yourdomain.com' },
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
            </div>

            {/* Custom links */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-3">Custom Links</label>
              <div className="flex flex-col gap-2">
                {data.footer.links.map(link => (
                  <div key={link.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={link.label}
                      onChange={e => updateCustomLink(link.id, { label: e.target.value })}
                      placeholder="Label"
                      className="input-field w-32"
                    />
                    <input
                      type="url"
                      value={link.url}
                      onChange={e => updateCustomLink(link.id, { url: e.target.value })}
                      placeholder="https://…"
                      className="input-field flex-1"
                    />
                    <button onClick={() => deleteCustomLink(link.id)} className="text-[var(--text-3)] hover:text-[#ff3b30]">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addCustomLink}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors"
                >
                  <Plus size={15} /> Add link
                </button>
              </div>
            </div>

          </div>
        </Section>

      </div>
    </>
  )
}
