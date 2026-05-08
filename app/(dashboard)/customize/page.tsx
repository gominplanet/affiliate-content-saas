'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Plus, Trash2, Save, Loader2, Image, Code2, ToggleLeft, ToggleRight,
  Youtube, Facebook, Instagram, Link, AlignLeft, ChevronDown, ChevronUp
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type BlockType = 'html' | 'image'

interface AdBlock {
  id: string
  type: BlockType
  html: string
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
  socials: { youtube: '', facebook: '', instagram: '', threads: '', pinterest: '' },
  links: [],
}

const defaultCustomizations: BlogCustomizations = {
  sidebar: [],
  incontent: [],
  footer: emptyFooter,
}

function newBlock(): AdBlock {
  return { id: crypto.randomUUID(), type: 'html', html: '', imageUrl: '', linkUrl: '', position: 2, enabled: true }
}

// ── Ad Block Editor ───────────────────────────────────────────────────────────

function AdBlockEditor({
  block,
  onChange,
  onDelete,
  showPosition,
}: {
  block: AdBlock
  onChange: (b: AdBlock) => void
  onDelete: () => void
  showPosition: boolean
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border border-[var(--border-2)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)]">
        <div className="flex items-center gap-3">
          <button onClick={() => onChange({ ...block, enabled: !block.enabled })} className="text-[var(--text-3)]">
            {block.enabled
              ? <ToggleRight size={20} className="text-[#0071e3]" />
              : <ToggleLeft size={20} />}
          </button>
          <span className="text-sm font-medium text-[var(--text)]">
            {block.type === 'html' ? 'HTML Block' : 'Image Block'}
          </span>
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
        <div className="p-4 flex flex-col gap-3">
          {/* Type toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => onChange({ ...block, type: 'html' })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                block.type === 'html'
                  ? 'bg-[#0071e3] text-white'
                  : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border-2)]'
              }`}
            >
              <Code2 size={12} /> HTML
            </button>
            <button
              onClick={() => onChange({ ...block, type: 'image' })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                block.type === 'image'
                  ? 'bg-[#0071e3] text-white'
                  : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--border-2)]'
              }`}
            >
              <Image size={12} /> Image + Link
            </button>
          </div>

          {block.type === 'html' ? (
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">HTML Code</label>
              <textarea
                value={block.html}
                onChange={e => onChange({ ...block, html: e.target.value })}
                rows={5}
                placeholder="Paste any HTML, ad code, or affiliate widget here…"
                className="input-field w-full font-mono text-xs resize-y"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Image URL</label>
                <input
                  type="url"
                  value={block.imageUrl}
                  onChange={e => onChange({ ...block, imageUrl: e.target.value })}
                  placeholder="https://example.com/banner.jpg"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Affiliate Link URL</label>
                <input
                  type="url"
                  value={block.linkUrl}
                  onChange={e => onChange({ ...block, linkUrl: e.target.value })}
                  placeholder="https://amzn.to/your-link"
                  className="input-field w-full"
                />
              </div>
              {block.imageUrl && (
                <div className="rounded-lg overflow-hidden border border-[var(--border-2)] max-w-xs">
                  <img src={block.imageUrl} alt="preview" className="w-full h-auto" />
                </div>
              )}
            </>
          )}

          {showPosition && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Insert after paragraph</label>
              <select
                value={block.position}
                onChange={e => onChange({ ...block, position: Number(e.target.value) })}
                className="input-field w-40"
              >
                {[1, 2, 3, 4, 5].map(n => (
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

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (supabase as any)
      .from('integrations')
      .select('blog_customizations')
      .eq('user_id', user.id)
      .single()
    if (row?.blog_customizations) {
      setData({ ...defaultCustomizations, ...row.blog_customizations })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

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
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save & Push to WordPress'}
          </button>
        }
      />

      <div className="flex flex-col gap-6 max-w-2xl">

        {/* Sidebar */}
        <Section
          title="Sidebar Ads"
          description="These blocks appear in the right sidebar column on every blog post."
        >
          <div className="flex flex-col gap-3">
            {data.sidebar.map(block => (
              <AdBlockEditor
                key={block.id}
                block={block}
                onChange={b => updateSidebarBlock(block.id, b)}
                onDelete={() => deleteSidebarBlock(block.id)}
                showPosition={false}
              />
            ))}
            <button
              onClick={addSidebarBlock}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors"
            >
              <Plus size={15} /> Add sidebar block
            </button>
          </div>
        </Section>

        {/* In-content */}
        <Section
          title="In-Content Ads"
          description="Injected directly inside each blog post after the specified paragraph."
        >
          <div className="flex flex-col gap-3">
            {data.incontent.map(block => (
              <AdBlockEditor
                key={block.id}
                block={block}
                onChange={b => updateIncontentBlock(block.id, b)}
                onDelete={() => deleteIncontentBlock(block.id)}
                showPosition={true}
              />
            ))}
            <button
              onClick={addIncontentBlock}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#0071e3] hover:text-[#0071e3] transition-colors"
            >
              <Plus size={15} /> Add in-content block
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
                    { key: 'youtube', label: 'YouTube', icon: Youtube, placeholder: 'https://youtube.com/@yourchannel' },
                    { key: 'facebook', label: 'Facebook', icon: Facebook, placeholder: 'https://facebook.com/yourpage' },
                    { key: 'instagram', label: 'Instagram', icon: Instagram, placeholder: 'https://instagram.com/yourhandle' },
                    { key: 'threads', label: 'Threads', icon: Link, placeholder: 'https://threads.net/@yourhandle' },
                    { key: 'pinterest', label: 'Pinterest', icon: Link, placeholder: 'https://pinterest.com/yourprofile' },
                  ] as const
                ).map(({ key, label, icon: Icon, placeholder }) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center flex-shrink-0">
                      <Icon size={15} className="text-[var(--text-3)]" />
                    </div>
                    <input
                      type="url"
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
