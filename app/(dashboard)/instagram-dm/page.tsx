'use client'

// Instagram and Facebook comment→DM automation (Labs, admin only).
//
// Someone comments the keyword on a post, MVP DMs them a link:
//   - a post with its own keyword + link (an Auto-DM Reel from Clip Factory, or
//     any existing post picked below) sends that link;
//   - a post MVP published sends that post's own product link;
//   - any other post sends the backup link, else the Link in Bio shop, unless
//     "every post" is off.
// The status panels say whether comments are reaching MVP at all, and Recent
// comments says what happened to each one, so a skip never looks like silence.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { InstagramDmGuide } from '@/components/guide/tool-guides'
import Link from 'next/link'
import { toast } from 'sonner'
import { Instagram, MessageCircle, Loader2, Info, FlaskConical, Trash2, Flame, ExternalLink, RefreshCw, Link2 } from 'lucide-react'
import FacebookDmStatus from '@/components/instagram/FacebookDmStatus'
import InstagramDmStatus from '@/components/instagram/InstagramDmStatus'

const EXAMPLE_LINK = 'https://mvpl.ink/abc123'
const DEFAULT_TEMPLATE = 'Here you go 🔗 {link}'

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

interface IgPost {
  id: string
  caption: string
  mediaType: string
  productType: string
  thumb: string | null
  permalink: string | null
  timestamp: string | null
  campaign: { id: string; keyword: string; link: string; product_name: string | null; status: string } | null
  sends: { kind: 'own' | 'mvp' | 'backup' | 'nothing'; keyword: string; link: string | null }
}

interface Recent { platform: string; at: string | null; tone: 'good' | 'bad' | 'wait' | 'muted'; title: string; detail: string | null }

const TONE: Record<Recent['tone'], { bg: string; fg: string }> = {
  good: { bg: 'rgba(52,199,89,0.14)', fg: '#16a34a' },
  bad: { bg: 'rgba(255,59,48,0.12)', fg: '#dc2626' },
  wait: { bg: 'rgba(255,149,0,0.14)', fg: '#c2410c' },
  muted: { bg: 'var(--surface-2)', fg: 'var(--text-faint)' },
}

// In Labs, so admin only: everyone else is sent to the dashboard.
export default function InstagramDmPage() {
  const tier = useEffectiveTier()
  const router = useRouter()
  useEffect(() => { if (tier !== null && tier !== 'admin') router.replace('/dashboard') }, [tier, router])
  if (tier !== 'admin') return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  return <InstagramDm />
}

function InstagramDm() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [keyword, setKeyword] = useState('LINK')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [replyToComment, setReplyToComment] = useState(true)
  const [anyPost, setAnyPost] = useState(true)
  const [fallbackLink, setFallbackLink] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [posts, setPosts] = useState<IgPost[]>([])
  const [postsError, setPostsError] = useState<string | null>(null)
  const [postsLoading, setPostsLoading] = useState(true)
  const [shopFallback, setShopFallback] = useState<string | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editKeyword, setEditKeyword] = useState('')
  const [editLink, setEditLink] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [reviewUrl, setReviewUrl] = useState('https://developers.facebook.com/apps/')
  const onReviewUrl = useCallback((u: string) => setReviewUrl(u), [])

  useEffect(() => {
    fetch('/api/instagram/dm-settings')
      .then(r => r.json())
      .then(d => {
        const s = d.settings || {}
        setEnabled(!!s.enabled)
        setKeyword(s.keyword || 'LINK')
        setTemplate(s.message_template || DEFAULT_TEMPLATE)
        setReplyToComment(s.reply_to_comment !== false)
        setAnyPost(s.any_post !== false)
        setFallbackLink(s.fallback_link || '')
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => setLoading(false))
    loadCampaigns()
    loadPosts()
  }, [])

  function loadCampaigns() {
    fetch('/api/instagram/dm-campaign')
      .then(r => r.json())
      .then(d => setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []))
      .catch(() => { /* ignore */ })
  }

  function loadPosts() {
    setPostsLoading(true)
    fetch('/api/instagram/dm-posts', { cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Could not load posts (${r.status})`)
        setPosts(Array.isArray(d.posts) ? d.posts : [])
        setPostsError(d.mediaError || null)
        setShopFallback(d.fallback || null)
        setRecent(Array.isArray(d.recent) ? d.recent : [])
      })
      .catch(e => setPostsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPostsLoading(false))
  }

  const preview = template.includes('{link}') ? template.replace(/\{link\}/g, EXAMPLE_LINK) : `${template}\n${EXAMPLE_LINK}`

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/instagram/dm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, keyword, message_template: template, reply_to_comment: replyToComment, any_post: anyPost, fallback_link: fallbackLink }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not save'); return }
      if (d.warning) toast.warning(d.warning, { duration: 12000 })
      else toast.success('Auto-DM settings saved')
      loadPosts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function deactivate(id: string) {
    try {
      const res = await fetch(`/api/instagram/dm-campaign?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Could not turn it off'); return }
      toast.success('Turned off for that post')
      setCampaigns(cs => cs.map(c => (c.id === id ? { ...c, status: 'disabled' } : c)))
      loadPosts()
    } catch {
      toast.error('Could not turn it off')
    }
  }

  function startEdit(p: IgPost) {
    setEditing(p.id)
    setEditKeyword(p.campaign?.status === 'active' ? p.campaign.keyword : keyword)
    setEditLink(p.campaign?.status === 'active' ? p.campaign.link : '')
  }

  async function saveEdit(p: IgPost) {
    setEditSaving(true)
    try {
      const res = await fetch('/api/instagram/dm-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: p.id, keyword: editKeyword, link: editLink, label: p.caption.slice(0, 80) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not save'); return }
      toast.success('Saved for that post')
      setEditing(null)
      loadPosts()
      loadCampaigns()
    } finally {
      setEditSaving(false)
    }
  }

  function sendsWords(p: IgPost): { text: string; tone: Recent['tone'] } {
    switch (p.sends.kind) {
      case 'own': return { text: `“${p.sends.keyword}” sends ${p.sends.link}`, tone: 'good' }
      case 'mvp': return { text: `“${p.sends.keyword}” sends this post's product link`, tone: 'good' }
      case 'backup': return { text: `“${p.sends.keyword}” sends your backup link`, tone: 'wait' }
      default: return { text: 'Nothing is sent on this post', tone: 'muted' }
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Instagram size={20} className="text-[#E1306C]" />
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Instagram Auto-DM</h1>
        <InstagramDmGuide />
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(220,38,38,0.12)', color: '#DC2626' }}>
          <FlaskConical size={11} /> Labs
        </span>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
        When someone comments your keyword on an Instagram <em>or Facebook</em> post, MVP DMs them the right link.
        No manual replies, no “link in bio.”
      </p>

      {/* Approval banner */}
      <div className="rounded-xl border p-3 flex items-start gap-2 text-[13px]"
        style={{ background: 'rgba(255,149,0,0.07)', borderColor: 'rgba(255,149,0,0.3)', color: 'var(--text-soft)' }}>
        <Info size={15} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
        <span>
          <strong style={{ color: 'var(--text)' }}>Until Meta approves the app, only comments from you and testers come through.</strong>{' '}
          Meta holds back everyone else&apos;s comments until it approves the two messaging permissions.{' '}
          <a href={reviewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline" style={{ color: 'var(--text)' }}>
            Check Meta approval <ExternalLink size={12} />
          </a>
        </span>
      </div>

      <InstagramDmStatus onAppReviewUrl={onReviewUrl} />
      <FacebookDmStatus />

      {loading ? (
        <div className="flex items-center gap-2 text-sm py-8 justify-center" style={{ color: 'var(--text-faint)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* ── Settings ───────────────────────────────────────────────────── */}
          <div className="rounded-2xl border p-5 flex flex-col gap-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Settings</p>
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                One keyword for your Instagram and Facebook posts. A post with its own keyword below uses that instead.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#E1306C]" />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Turn on comment → auto-DM</p>
                <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Posts with their own keyword below work even when this is off.</p>
              </div>
            </label>

            <div>
              <label htmlFor="ig-dm-keyword" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Trigger keyword</label>
              <input id="ig-dm-keyword" value={keyword} onChange={e => setKeyword(e.target.value)} maxLength={40}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm"
                style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }} placeholder="LINK" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Matched as a whole word, in any case. A comment of “link please!” triggers on “LINK”.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={anyPost} onChange={e => setAnyPost(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#E1306C]" />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Also on posts MVP did not publish</p>
                <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  Posts you made in the Instagram or Facebook app send the backup link below.
                </p>
              </div>
            </label>

            {anyPost && (
              <div>
                <label htmlFor="ig-dm-fallback" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>Backup link</label>
                <input id="ig-dm-fallback" value={fallbackLink} onChange={e => setFallbackLink(e.target.value)} maxLength={500}
                  className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm"
                  style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }}
                  placeholder={shopFallback || 'https://'} />
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                  {fallbackLink.trim()
                    ? 'Sent on posts MVP did not publish and that have no link of their own.'
                    : shopFallback
                      ? `Left empty, MVP sends your Link in Bio shop: ${shopFallback}`
                      : 'Left empty, nothing is sent on those posts, because your Link in Bio shop is not published yet.'}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="ig-dm-msg" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>DM message</label>
              <textarea id="ig-dm-msg" value={template} onChange={e => setTemplate(e.target.value)} rows={3} maxLength={900}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm font-mono"
                style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Use <code>{'{link}'}</code> where the link goes. MVP adds the affiliate disclosure, and says the link goes to Amazon when it does, if your message does not already.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>Preview</p>
              <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap max-w-[80%]"
                style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)', color: '#fff' }}>
                <MessageCircle size={12} className="inline mr-1 opacity-80" />{preview}
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={replyToComment} onChange={e => setReplyToComment(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-[#E1306C]" />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Also reply publicly “Sent you a DM! 📩”</p>
                <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>Shows other viewers the DM is on its way.</p>
              </div>
            </label>

            <button onClick={save} disabled={saving}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)' }}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save settings'}
            </button>
          </div>

          {/* ── Recent comments ────────────────────────────────────────────── */}
          <div className="rounded-2xl border p-5 flex flex-col gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold flex-1" style={{ color: 'var(--text)' }}>Recent comments</p>
              <button onClick={loadPosts} disabled={postsLoading} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {postsLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
              </button>
            </div>
            {recent.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                No comments have reached MVP yet. If you commented the keyword and nothing shows here after a minute, the status panels above say why.
              </p>
            ) : (
              <ul className="flex flex-col">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 py-2 border-b last:border-0 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                    <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full mt-0.5"
                      style={{ background: TONE[r.tone].bg, color: TONE[r.tone].fg }}>{r.title}</span>
                    <span className="min-w-0 flex-1" style={{ color: 'var(--text-soft)' }}>
                      <span className="break-words">{r.detail}</span>
                      <span className="block text-[11px]" style={{ color: 'var(--text-faint)' }}>
                        {r.platform === 'facebook' ? 'Facebook' : 'Instagram'}{r.at ? ` · ${new Date(r.at).toLocaleString()}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Your Instagram posts ───────────────────────────────────────── */}
          <div className="rounded-2xl border p-5 flex flex-col gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Your Instagram posts</p>
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                What a keyword comment sends on each one. Give any post its own keyword and link, including posts you made in the Instagram app.
              </p>
            </div>
            {postsLoading && posts.length === 0 && (
              <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={13} className="animate-spin" /> Loading your posts…</p>
            )}
            {postsError && <p className="text-[13px] text-[#ff3b30]">Could not list your posts: {postsError}</p>}
            {posts.map(p => {
              const w = sendsWords(p)
              const own = p.campaign?.status === 'active'
              return (
                <div key={p.id} className="flex flex-col gap-2 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-start gap-3">
                    {p.thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.thumb} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" style={{ background: 'var(--surface-2)' }} />
                      : <div className="w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--surface-2)' }}><Instagram size={16} style={{ color: 'var(--text-faint)' }} /></div>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] line-clamp-2" style={{ color: 'var(--text)' }}>{p.caption || '(no caption)'}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {p.productType === 'REELS' ? 'Reel' : p.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : p.mediaType === 'VIDEO' ? 'Video' : 'Post'}
                        {p.timestamp ? ` · ${new Date(p.timestamp).toLocaleDateString()}` : ''}
                        {p.permalink && <> · <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="underline">Open</a></>}
                      </p>
                      <span className="inline-block mt-1 text-[11px] px-1.5 py-0.5 rounded-md break-all" style={{ background: TONE[w.tone].bg, color: TONE[w.tone].fg }}>{w.text}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <button onClick={() => (editing === p.id ? setEditing(null) : startEdit(p))}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                        <Link2 size={13} /> {own ? 'Edit' : 'Own link'}
                      </button>
                      {own && p.campaign && (
                        <button onClick={() => deactivate(p.campaign!.id)} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                          <Trash2 size={13} /> Off
                        </button>
                      )}
                    </div>
                  </div>
                  {editing === p.id && (
                    <div className="flex flex-col sm:flex-row gap-2 sm:pl-[60px]">
                      <input value={editKeyword} onChange={e => setEditKeyword(e.target.value)} maxLength={30} placeholder="LINK"
                        aria-label="Keyword for this post"
                        className="sm:w-28 px-3 py-1.5 rounded-lg border bg-transparent text-sm"
                        style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }} />
                      <input value={editLink} onChange={e => setEditLink(e.target.value)} maxLength={500} placeholder="https://your link"
                        aria-label="Link for this post"
                        className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border bg-transparent text-sm"
                        style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }} />
                      <button onClick={() => saveEdit(p)} disabled={editSaving}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
                        style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)' }}>
                        {editSaving ? <Loader2 size={13} className="animate-spin" /> : null} Save
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Create an Auto-DM Reel → Clip Factory ───────────────────────── */}
          <div className="rounded-2xl border p-4 flex items-start gap-3"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <Flame size={18} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Want a new Reel with its own trigger word and link?</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                Head to Clip Factory. Make a clip or pick a Short, add a CTA, paste a product link, and turn on
                Auto-DM. Each one you publish shows up below.
              </p>
              <Link href="/clip-factory"
                className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white"
                style={{ background: '#7C3AED' }}>
                <Flame size={13} /> Open Clip Factory
              </Link>
            </div>
          </div>

          {/* ── Every post with its own keyword ────────────────────────────── */}
          {campaigns.length > 0 && (
            <div className="rounded-2xl border p-5 flex flex-col gap-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Posts with their own keyword</p>
              {campaigns.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-3 py-2.5 border-b last:border-0"
                  style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                      {c.product_name || 'Post'}
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={c.status === 'active'
                          ? { background: 'rgba(34,197,94,0.14)', color: '#16a34a' }
                          : { background: 'var(--surface-2)', color: 'var(--text-faint)' }}>
                        {c.status === 'active' ? 'on' : c.status === 'disabled' ? 'off' : c.status}
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
