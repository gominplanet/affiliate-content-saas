'use client'

// Instagram comment→DM automation (Phase 1). Two ways to run it:
//
//  1. GLOBAL (top card): when a viewer comments the keyword on ANY MVP-published
//     IG post, MVP DMs them THAT post's affiliate link — per-post link resolved
//     automatically at send time.
//  2. AUTO-DM REELS (bottom card): upload a vertical video + an affiliate link +
//     a trigger word. MVP writes a caption (product blurb + "comment X for the
//     link"), publishes it as a Reel, and DMs that exact link to anyone who
//     comments the word on it. One standalone campaign per Reel.
//
// Goes live once Meta approves the messaging permissions (Phase 2). The Reel
// itself publishes today (content-publishing permission MVP already has); the
// auto-DM part activates on approval. See project_ig_comment_to_dm.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Instagram, MessageCircle, Loader2, Info, FlaskConical, Upload, Video, Trash2, Wand2, Send, Link2, Sparkles } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

const EXAMPLE_LINK = 'https://geni.us/Abc123'

interface Campaign {
  id: string
  ig_media_id: string | null
  keyword: string
  link: string
  product_name: string | null
  caption: string | null
  status: string
  error: string | null
  created_at: string
}

export default function InstagramDmPage() {
  const supabase = createBrowserClient()

  // ── Global settings ─────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [keyword, setKeyword] = useState('LINK')
  const [template, setTemplate] = useState('Here you go 🔗 {link}\n\nReply STOP to opt out.')
  const [replyToComment, setReplyToComment] = useState(true)

  // ── Auto-DM Reel composer ───────────────────────────────────────────────────
  const fileInput = useRef<HTMLInputElement>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [cUrl, setCUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [cProduct, setCProduct] = useState('')
  const [cDescription, setCDescription] = useState('')
  const [cLink, setCLink] = useState('')
  const [cKeyword, setCKeyword] = useState('LINK')
  const [cCaption, setCCaption] = useState('')
  const [captionLoading, setCaptionLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  useEffect(() => {
    fetch('/api/instagram/dm-settings')
      .then(r => r.json())
      .then(d => {
        const s = d.settings || {}
        setEnabled(!!s.enabled)
        setKeyword(s.keyword || 'LINK')
        setCKeyword(s.keyword || 'LINK')
        setTemplate(s.message_template || 'Here you go 🔗 {link}\n\nReply STOP to opt out.')
        setReplyToComment(s.reply_to_comment !== false)
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => setLoading(false))
    loadCampaigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadCampaigns() {
    fetch('/api/instagram/dm-campaign')
      .then(r => r.json())
      .then(d => setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []))
      .catch(() => { /* ignore */ })
  }

  const preview = template.includes('{link}') ? template.replace(/\{link\}/g, EXAMPLE_LINK) : `${template}\n${EXAMPLE_LINK}`

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/instagram/dm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, keyword, message_template: template, reply_to_comment: replyToComment }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not save'); return }
      toast.success('Auto-DM settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) { toast.error('Pick a video file (.mp4).'); return }
    if (file.size > 200 * 1024 * 1024) { toast.error('Video is over 200MB — trim or compress it first.'); return }
    setUploading(true)
    setFileName(file.name)
    setVideoUrl('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/dm-${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('instagram-videos').upload(path, file, {
        cacheControl: '3600', upsert: true, contentType: file.type || 'video/mp4',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      setVideoUrl(urlData.publicUrl)
      toast.success('Video uploaded')
    } catch (err) {
      setFileName('')
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function resolveUrl() {
    if (!/^https?:\/\//i.test(cUrl.trim())) { toast.error('Paste a full product link (https://…).'); return }
    setResolving(true)
    try {
      const res = await fetch('/api/instagram/dm-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolveUrl: cUrl.trim(), keyword: cKeyword }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not read that link'); return }
      if (d.affiliateUrl) setCLink(d.affiliateUrl)
      if (d.productName) setCProduct(d.productName)
      if (d.caption) setCCaption(d.caption)
      toast.success(d.affiliateUrl && d.affiliateUrl !== cUrl.trim()
        ? 'Turned it into your affiliate link + wrote a caption'
        : 'Pulled the product details')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that link')
    } finally {
      setResolving(false)
    }
  }

  async function generateCaption() {
    if (!cProduct.trim()) { toast.error('Add a product name first.'); return }
    setCaptionLoading(true)
    try {
      const qs = new URLSearchParams({ preview: '1', productName: cProduct, description: cDescription, keyword: cKeyword })
      const res = await fetch(`/api/instagram/dm-campaign?${qs}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not generate a caption'); return }
      setCCaption(d.caption || '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate a caption')
    } finally {
      setCaptionLoading(false)
    }
  }

  async function publishReel() {
    if (!videoUrl) { toast.error('Upload a vertical video first.'); return }
    if (!/^https?:\/\//i.test(cLink.trim())) { toast.error('Add the affiliate link to DM.'); return }
    if (!cProduct.trim()) { toast.error('Add a product name.'); return }
    setPublishing(true)
    try {
      const res = await fetch('/api/instagram/dm-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl, link: cLink.trim(), keyword: cKeyword, productName: cProduct, description: cDescription, caption: cCaption,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Publish failed'); return }
      toast.success('Reel published — it will auto-DM your link on the trigger word')
      // Reset the composer
      setVideoUrl(''); setFileName(''); setCProduct(''); setCDescription(''); setCLink(''); setCCaption('')
      if (fileInput.current) fileInput.current.value = ''
      loadCampaigns()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  async function deactivate(id: string) {
    try {
      const res = await fetch(`/api/instagram/dm-campaign?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Could not deactivate'); return }
      toast.success('Campaign deactivated')
      setCampaigns(cs => cs.map(c => (c.id === id ? { ...c, status: 'disabled' } : c)))
    } catch {
      toast.error('Could not deactivate')
    }
  }

  const inputStyle = { borderColor: 'var(--border-bright)', color: 'var(--text)' } as const

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Instagram size={20} className="text-[#E1306C]" />
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Instagram Auto-DM</h1>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(220,38,38,0.12)', color: '#DC2626' }}>
          <FlaskConical size={11} /> Labs
        </span>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
        When someone comments your keyword on an Instagram post, MVP automatically DMs them the right
        affiliate link — no manual replies, no “link in bio.”
      </p>

      {/* Pending-approval banner */}
      <div className="rounded-xl border p-3 flex items-start gap-2 text-[13px]"
        style={{ background: 'rgba(255,149,0,0.07)', borderColor: 'rgba(255,149,0,0.3)', color: 'var(--text-soft)' }}>
        <Info size={15} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
        <span>
          <strong style={{ color: 'var(--text)' }}>Setup now, live after Meta approval.</strong> Instagram
          messaging needs Meta&apos;s sign-off on MVP&apos;s app (in progress). Configure it here — the auto-DM
          starts sending the moment approval lands. Reels you publish below go out right away.
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm py-8 justify-center" style={{ color: 'var(--text-faint)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* ── GLOBAL settings ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border p-5 flex flex-col gap-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Global rule — every post you publish</p>
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Comment the keyword on any MVP-published post → MVP DMs that post&apos;s own affiliate link.
              </p>
            </div>

            {/* Enable */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#E1306C]" />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Enable comment → auto-DM</p>
                <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Runs on every post you publish to Instagram.</p>
              </div>
            </label>

            {/* Keyword */}
            <div>
              <label htmlFor="ig-dm-keyword" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Trigger keyword</label>
              <input id="ig-dm-keyword" value={keyword} onChange={e => setKeyword(e.target.value)} maxLength={40}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle} placeholder="LINK" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Matched as a whole word, case-insensitive. e.g. a comment of “link please!” triggers on “LINK”.
              </p>
            </div>

            {/* Message template */}
            <div>
              <label htmlFor="ig-dm-msg" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>DM message</label>
              <textarea id="ig-dm-msg" value={template} onChange={e => setTemplate(e.target.value)} rows={3} maxLength={900}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm font-mono" style={inputStyle} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Use <code>{'{link}'}</code> where the post&apos;s link goes. Keep the opt-out line — Meta requires it.
              </p>
            </div>

            {/* Live preview */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>Preview</p>
              <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap max-w-[80%]"
                style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)', color: '#fff' }}>
                <MessageCircle size={12} className="inline mr-1 opacity-80" />{preview}
              </div>
            </div>

            {/* Public reply */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={replyToComment} onChange={e => setReplyToComment(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#E1306C]" />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Also reply publicly “Sent you a DM! 📩”</p>
                <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Shows other viewers the DM is on its way (recommended).</p>
              </div>
            </label>

            <button onClick={save} disabled={saving}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)' }}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save settings'}
            </button>
          </div>

          {/* ── AUTO-DM REEL composer ───────────────────────────────────────── */}
          <div className="rounded-2xl border p-5 flex flex-col gap-4"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                <Video size={15} className="text-[#E1306C]" /> Auto-DM Reel
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Upload a vertical video + a link. MVP writes the caption, posts the Reel, and DMs that exact
                link to anyone who comments your trigger word on it.
              </p>
            </div>

            {/* Product URL → affiliate link + caption */}
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-bright)', background: 'var(--surface-2)' }}>
              <label htmlFor="dm-url" className="flex items-center gap-1.5 text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
                <Sparkles size={14} className="text-[#E1306C]" /> Paste a product link — MVP does the rest
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input id="dm-url" value={cUrl} onChange={e => setCUrl(e.target.value)} maxLength={500}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); resolveUrl() } }}
                  className="flex-1 px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle}
                  placeholder="Amazon / any store URL, or a geni.us link" />
                <button type="button" onClick={resolveUrl} disabled={resolving}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)' }}>
                  {resolving ? <><Loader2 size={14} className="animate-spin" /> Reading…</> : <><Link2 size={14} /> Get link + caption</>}
                </button>
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                We convert it to your Geniuslink (or tagged Amazon link) and fill in the product name, caption, and DM link below. Everything stays editable.
              </p>
            </div>

            {/* Video upload */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Vertical video</label>
              <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/*" onChange={onPickVideo} className="hidden" id="dm-video" />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}
                className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-dashed text-sm disabled:opacity-60"
                style={{ borderColor: 'var(--border-bright)', color: 'var(--text-soft)' }}>
                {uploading ? <><Loader2 size={15} className="animate-spin" /> Uploading…</>
                  : videoUrl ? <><Video size={15} className="text-green-500" /> {fileName || 'Video ready'} — replace</>
                  : <><Upload size={15} /> Choose a vertical .mp4</>}
              </button>
            </div>

            {/* Product name */}
            <div>
              <label htmlFor="dm-product" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Product name</label>
              <input id="dm-product" value={cProduct} onChange={e => setCProduct(e.target.value)} maxLength={200}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle}
                placeholder="e.g. Anker 737 Power Bank" />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="dm-desc" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>
                Short description <span style={{ color: 'var(--text-faint)' }}>(optional)</span>
              </label>
              <textarea id="dm-desc" value={cDescription} onChange={e => setCDescription(e.target.value)} rows={2} maxLength={800}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle}
                placeholder="A sentence or two about the product — MVP polishes it into the caption." />
            </div>

            {/* Link + keyword */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="dm-link" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Affiliate link to DM</label>
                <input id="dm-link" value={cLink} onChange={e => setCLink(e.target.value)} maxLength={500}
                  className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle}
                  placeholder="https://geni.us/…" />
              </div>
              <div>
                <label htmlFor="dm-kw" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Trigger word</label>
                <input id="dm-kw" value={cKeyword} onChange={e => setCKeyword(e.target.value)} maxLength={30}
                  className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle} placeholder="LINK" />
              </div>
            </div>

            {/* Caption */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="dm-caption" className="block text-sm font-medium" style={{ color: 'var(--text)' }}>Caption</label>
                <button type="button" onClick={generateCaption} disabled={captionLoading}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold disabled:opacity-60" style={{ color: '#E1306C' }}>
                  {captionLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  {cCaption ? 'Regenerate' : 'Generate caption'}
                </button>
              </div>
              <textarea id="dm-caption" value={cCaption} onChange={e => setCCaption(e.target.value)} rows={5} maxLength={2200}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm" style={inputStyle}
                placeholder="Leave blank to auto-write it on publish, or Generate to preview + edit." />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                MVP always ends the caption with “Comment <strong>{cKeyword || 'LINK'}</strong> to get the link,” so viewers know what to do.
              </p>
            </div>

            <button onClick={publishReel} disabled={publishing || uploading}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)' }}>
              {publishing ? <><Loader2 size={14} className="animate-spin" /> Publishing…</> : <><Send size={14} /> Publish Reel</>}
            </button>
          </div>

          {/* ── Existing campaigns ──────────────────────────────────────────── */}
          {campaigns.length > 0 && (
            <div className="rounded-2xl border p-5 flex flex-col gap-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Your Auto-DM Reels</p>
              {campaigns.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-3 py-2.5 border-b last:border-0"
                  style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                      {c.product_name || 'Reel'}
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={c.status === 'active'
                          ? { background: 'rgba(34,197,94,0.14)', color: '#16a34a' }
                          : { background: 'var(--surface-2)', color: 'var(--text-faint)' }}>
                        {c.status}
                      </span>
                    </p>
                    <p className="text-[12px] truncate" style={{ color: 'var(--text-faint)' }}>
                      Comment “{c.keyword}” → {c.link}
                    </p>
                  </div>
                  {c.status === 'active' && (
                    <button onClick={() => deactivate(c.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                      <Trash2 size={13} /> Off
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
