'use client'

// Instagram comment→DM automation (Phase 1) — SETTINGS + CAMPAIGN LIST.
//
// The GLOBAL rule (below): comment the keyword on any MVP-published IG post →
// MVP DMs that post's own affiliate link (per-post link resolved at send time).
//
// Per-post Auto-DM Reels are CREATED in Clip Factory (source a Short/upload →
// burn a CTA → paste a product link → set a trigger word → publish). Each one
// shows up in the list here, where you can turn it off. Goes live once Meta
// approves the messaging permissions (Phase 2). See project_ig_comment_to_dm.

import { useEffect, useState } from 'react'
import { InstagramDmGuide } from '@/components/guide/tool-guides'
import Link from 'next/link'
import { toast } from 'sonner'
import { Instagram, MessageCircle, Loader2, Info, FlaskConical, Trash2, Flame } from 'lucide-react'
import FacebookDmStatus from '@/components/instagram/FacebookDmStatus'

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [keyword, setKeyword] = useState('LINK')
  const [template, setTemplate] = useState('Here you go 🔗 {link}\n\nReply STOP to opt out.')
  const [replyToComment, setReplyToComment] = useState(true)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  useEffect(() => {
    fetch('/api/instagram/dm-settings')
      .then(r => r.json())
      .then(d => {
        const s = d.settings || {}
        setEnabled(!!s.enabled)
        setKeyword(s.keyword || 'LINK')
        setTemplate(s.message_template || 'Here you go 🔗 {link}\n\nReply STOP to opt out.')
        setReplyToComment(s.reply_to_comment !== false)
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => setLoading(false))
    loadCampaigns()
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
        When someone comments your keyword on an Instagram <em>or Facebook</em> post, MVP automatically DMs
        them the right affiliate link — no manual replies, no “link in bio.”
      </p>

      {/* Pending-approval banner */}
      <div className="rounded-xl border p-3 flex items-start gap-2 text-[13px]"
        style={{ background: 'rgba(255,149,0,0.07)', borderColor: 'rgba(255,149,0,0.3)', color: 'var(--text-soft)' }}>
        <Info size={15} className="text-[#ff9500] flex-shrink-0 mt-0.5" />
        <span>
          <strong style={{ color: 'var(--text)' }}>Setup now, live after Meta approval.</strong> Instagram
          messaging needs Meta&apos;s sign-off on MVP&apos;s app (in progress). Configure it here — the auto-DM
          starts sending the moment approval lands.
        </span>
      </div>

      {/* Live self-diagnostic for the Facebook comment→DM chain (why a trigger
          isn't firing). Pulls /api/facebook/dm-debug — admin/self only. */}
      <FacebookDmStatus />

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
                Comment the keyword on any MVP-published Instagram or Facebook post → MVP DMs that post&apos;s own affiliate link.
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
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm"
                style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }} placeholder="LINK" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Matched as a whole word, case-insensitive. e.g. a comment of “link please!” triggers on “LINK”.
              </p>
            </div>

            {/* Message template */}
            <div>
              <label htmlFor="ig-dm-msg" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text)' }}>DM message</label>
              <textarea id="ig-dm-msg" value={template} onChange={e => setTemplate(e.target.value)} rows={3} maxLength={900}
                className="w-full px-3 py-2 rounded-lg border bg-transparent text-sm font-mono"
                style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }} />
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

          {/* ── Create an Auto-DM Reel → Clip Factory ───────────────────────── */}
          <div className="rounded-2xl border p-4 flex items-start gap-3"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <Flame size={18} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Want a Reel with its own trigger word + link?</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                Head to Clip Factory — make a clip or pick a Short, add a CTA, paste a product link, and flip on
                Auto-DM. Each one you publish shows up below.
              </p>
              <Link href="/clip-factory"
                className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white"
                style={{ background: '#7C3AED' }}>
                <Flame size={13} /> Open Clip Factory
              </Link>
            </div>
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
