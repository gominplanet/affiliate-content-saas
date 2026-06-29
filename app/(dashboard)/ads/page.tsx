'use client'

// ── Ads ─────────────────────────────────────────────────────────────────────
// One home for everything monetization: Google AdSense (Auto ads + verification
// + ads.txt), Sidebar Banners, the Homepage Banner Strip, and In-Content
// Banners. These all live in the SAME `blog_customizations` JSONB blob as the
// Customize Blog page; the save here POSTs ONLY the ad fields and the writer
// deep-merges, so nothing a creator set on Customize Blog is ever clobbered.

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Plus, Trash2, Save, Loader2, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Upload, X, Image as ImageIcon,
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

interface HomepageAd {
  id: string
  imageUrl: string
  linkUrl: string
}

interface AdsData {
  sidebar: AdBlock[]
  incontent: AdBlock[]
  homepageAds: HomepageAd[]
  homepageAdsEnabled: boolean
  adsenseClientId: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
          {!block.enabled && <span className="text-xs text-[var(--text-3)]">(disabled — won&apos;t show on site)</span>}
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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

// ── Main page ─────────────────────────────────────────────────────────────────

const EMPTY: AdsData = { sidebar: [], incontent: [], homepageAds: padHomepageAds(null), homepageAdsEnabled: true, adsenseClientId: '' }

export default function AdsPage() {
  const supabase = createBrowserClient()
  const [data, setData] = useState<AdsData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState('')

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUserId(user.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await supabase
      .from('integrations')
      .select('blog_customizations')
      .eq('user_id', user.id)
      .single()
    const bc = (row?.blog_customizations ?? {}) as {
      sidebar?: unknown[]; incontent?: unknown[]; homepageAds?: unknown
      homepageAdsEnabled?: boolean; adsenseClientId?: string
    }
    setData({
      sidebar: (bc.sidebar ?? []).map(migrateBlock),
      incontent: (bc.incontent ?? []).map(migrateBlock),
      homepageAds: padHomepageAds(bc.homepageAds),
      homepageAdsEnabled: typeof bc.homepageAdsEnabled === 'boolean' ? bc.homepageAdsEnabled : true,
      adsenseClientId: typeof bc.adsenseClientId === 'string' ? bc.adsenseClientId : '',
    })
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    try {
      // POST ONLY the ad fields. The writer deep-merges into the existing
      // blog_customizations blob, so theme/SEO/footer settings are untouched.
      const res = await fetch('/api/wordpress/customizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sidebar: data.sidebar,
          incontent: data.incontent,
          homepageAds: data.homepageAds,
          homepageAdsEnabled: data.homepageAdsEnabled,
          adsenseClientId: data.adsenseClientId,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) { toast.error(json.error || `Save failed (${res.status})`); return }
      if (json.wordpress === 'failed') {
        toast.error(json.wordpressError || 'WordPress push failed — check your credentials in Site & Integrations.')
      } else {
        fetch('/api/wordpress/purge-cache', { method: 'POST' }).catch(() => {})
        toast.success('Saved — pushed to your blog.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Ad-block handlers
  const updateSidebar = (blocks: AdBlock[]) => setData(d => ({ ...d, sidebar: blocks }))
  const updateIncontent = (blocks: AdBlock[]) => setData(d => ({ ...d, incontent: blocks }))
  const updateHomepageAd = (i: number, patch: Partial<HomepageAd>) =>
    setData(d => ({ ...d, homepageAds: d.homepageAds.map((a, idx) => idx === i ? { ...a, ...patch } : a) }))
  const clearHomepageAd = (i: number) =>
    setData(d => ({ ...d, homepageAds: d.homepageAds.map((a, idx) => idx === i ? { ...a, imageUrl: '', linkUrl: '' } : a) }))
  async function handleHomepageAdFile(i: number, file: File) {
    if (!userId) return
    try {
      const url = await uploadImage(file, userId, 'homepage-ads')
      updateHomepageAd(i, { imageUrl: url })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image upload failed.')
    }
  }

  const SaveButton = () => (
    <button
      onClick={save}
      disabled={saving || loading}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
    >
      {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
      {saving ? 'Saving…' : 'Save'}
    </button>
  )

  return (
    <div className="max-w-3xl mx-auto px-6 sm:px-8 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <PageHero
          title="Ads"
          subtitle="Everything that earns on your blog — Google AdSense plus your affiliate banners. Changes push straight to your site."
        />
        <div className="pt-1"><SaveButton /></div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)] py-16 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-6">

          {/* Google AdSense */}
          <Section
            title="Google AdSense"
            description="Earn ad revenue alongside your affiliate links. Paste your AdSense Publisher ID and MVP verifies your site, adds Google's official Auto-ads code to every page, and serves your ads.txt — no WordPress editing. Google then places ads automatically across your posts."
          >
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[var(--text)]">AdSense Publisher ID</label>
              <input
                type="text"
                value={data.adsenseClientId}
                onChange={e => {
                  // Accept a bare ca-pub ID, or pull it out of a pasted snippet.
                  const v = e.target.value
                  const m = v.match(/ca-pub-\d{10,20}/i)
                  setData(d => ({ ...d, adsenseClientId: m ? m[0].toLowerCase() : v.trim() }))
                }}
                placeholder="ca-pub-XXXXXXXXXXXXXXXX"
                spellCheck={false}
                className="w-full max-w-xs px-3 py-2 rounded-lg border border-[var(--border-2)] bg-[var(--surface)] text-sm font-mono focus:outline-none focus:border-[#7C3AED]"
              />
              {data.adsenseClientId && !/^ca-pub-\d{10,20}$/.test(data.adsenseClientId) && (
                <p className="text-xs text-[#ff9500]">⚠ That doesn&apos;t look like an AdSense Publisher ID — it should be <code>ca-pub-</code> followed by ~16 digits (e.g. <code>ca-pub-1234567890123456</code>). You can also paste your whole AdSense code snippet and we&apos;ll pull the ID out. It won&apos;t go live until the format is valid.</p>
              )}
              <p className="text-xs text-[var(--text-3)] leading-relaxed">
                Once saved, MVP adds the verification meta tag + Auto-ads script to every page and serves <code>/ads.txt</code> for you. Then switch on <b>Auto ads</b> in your AdSense dashboard and Google places ads automatically.
              </p>
              <details className="mt-1 rounded-lg border border-[var(--border-2)] bg-[var(--surface-2)] p-3 text-xs text-[var(--text-2)] leading-relaxed">
                <summary className="cursor-pointer font-medium text-[var(--text)] select-none">How do I find my Publisher ID + turn ads on? (step by step)</summary>
                <ol className="list-decimal ml-4 mt-3 flex flex-col gap-2">
                  <li>Go to <a href="https://adsense.google.com" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">adsense.google.com</a> and sign in (or sign up — it&apos;s free).</li>
                  <li>Add your blog&apos;s domain as a site. Your <b>Publisher ID</b> looks like <code>ca-pub-1234567890123456</code> — find it under <b>Account → Settings → Account information</b>.</li>
                  <li>Paste that ID into the box above and click <b>Save</b>. MVP adds the verification code and <code>ads.txt</code> for you — no WordPress editing.</li>
                  <li>Back in AdSense, finish the <b>site review</b> (Google checks your site has content + the code, which is already in place). Approval can take a few hours up to a couple of weeks.</li>
                  <li>Once approved, open <b>Ads → By site</b>, switch on <b>Auto ads</b>, and pick your ad types. Google starts placing ads across your blog automatically.</li>
                </ol>
                <p className="mt-3 text-[var(--text-3)]">Prefer ads in specific spots? Use the sidebar / in-content banners below to drop an ad unit exactly where you want it instead.</p>
              </details>
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
                  onChange={b => updateSidebar(data.sidebar.map(x => x.id === block.id ? b : x))}
                  onDelete={() => updateSidebar(data.sidebar.filter(x => x.id !== block.id))}
                  showPosition={false} userId={userId}
                />
              ))}
              <button onClick={() => updateSidebar([...data.sidebar, newBlock()])}
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
            <label className="flex items-center gap-3 mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={data.homepageAdsEnabled}
                onChange={(e) => setData(d => ({ ...d, homepageAdsEnabled: e.target.checked }))}
                className="w-4 h-4 rounded accent-[#7C3AED]"
              />
              <span className="text-sm font-medium text-[var(--text-1)]">Show this strip on the homepage</span>
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
                  onChange={b => updateIncontent(data.incontent.map(x => x.id === block.id ? b : x))}
                  onDelete={() => updateIncontent(data.incontent.filter(x => x.id !== block.id))}
                  showPosition={true} userId={userId}
                />
              ))}
              <button onClick={() => updateIncontent([...data.incontent, newBlock()])}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border-2)] text-sm text-[var(--text-3)] hover:border-[#7C3AED] hover:text-[#7C3AED] transition-colors">
                <Plus size={15} /> Add in-content banner
              </button>
            </div>
          </Section>

          <div className="flex justify-end pt-1"><SaveButton /></div>
        </div>
      )}
    </div>
  )
}
