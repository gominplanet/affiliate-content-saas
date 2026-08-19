'use client'

// Brand Hub — one consolidated view of every brand relationship. Folds inbound
// inquiries, outbound pitches, and Amazon Creator Connections campaigns into a
// single per-brand timeline so a creator can see their whole history with a
// brand in one place: who reached out, who they contacted, and what came of it.

import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Handshake, Loader2, Search, Inbox, Send, Tag, MessageSquare, CheckCircle2,
  FileText, ExternalLink, Mail, ChevronDown, ChevronRight, Users,
} from 'lucide-react'
import type { BrandHubData, BrandEntity, BrandEvent, BrandChannel } from '@/lib/brand-hub-types'

const PURPLE = '#7C3AED'

const CHANNEL_META: Record<BrandChannel, { label: string; bg: string; fg: string }> = {
  inbound:  { label: 'Inbound', bg: 'rgba(52,199,89,0.12)', fg: '#248a3d' },
  pitch:    { label: 'Pitched', bg: 'rgba(0,122,255,0.12)', fg: '#0063cc' },
  campaign: { label: 'Campaign', bg: 'rgba(124,58,237,0.12)', fg: PURPLE },
}

function statusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'Joined': return { bg: 'rgba(52,199,89,0.14)', fg: '#248a3d' }
    case 'Accepted': return { bg: 'rgba(52,199,89,0.12)', fg: '#248a3d' }
    case 'Messaged': return { bg: 'rgba(0,122,255,0.12)', fg: '#0063cc' }
    case 'Pitched': return { bg: 'rgba(0,122,255,0.10)', fg: '#0063cc' }
    case 'Inquiry received': return { bg: 'rgba(255,149,0,0.14)', fg: '#b45309' }
    default: return { bg: 'var(--surface-2)', fg: 'var(--text-3)' }
  }
}

function eventIcon(type: BrandEvent['type']) {
  switch (type) {
    case 'inquiry': return <Inbox size={13} />
    case 'pitch': return <Send size={13} />
    case 'campaign_added': return <Tag size={13} />
    case 'campaign_messaged': return <MessageSquare size={13} />
    case 'campaign_accepted': return <CheckCircle2 size={13} />
    case 'campaign_joined': return <Handshake size={13} />
    case 'post_published': return <FileText size={13} />
  }
}

function fmtDate(iso: string): string {
  const t = Date.parse(iso)
  if (!t || t < 1000) return ''
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!t) return ''
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function BrandHubPage() {
  const [data, setData] = useState<BrandHubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [channel, setChannel] = useState<'all' | BrandChannel>('all')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/brand-hub')
      const d = await res.json().catch(() => null)
      if (res.ok && d) setData(d)
      else toast.error('Could not load your brand history.')
    } catch {
      toast.error('Could not load your brand history.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const brands = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.brands.filter(b => {
      if (channel !== 'all' && !b.channels.includes(channel)) return false
      if (needle && !b.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [data, q, channel])

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Handshake size={22} className="text-[#7C3AED]" /> Brand Hub
        </h1>
        <p className="text-sm text-[var(--text-3)] mt-1">
          Every brand you&apos;ve talked to, in one place. Inbound inquiries, pitches you sent, and Amazon campaigns, all on one timeline per brand.
        </p>
      </div>

      {/* Totals */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Stat label="Brands" value={data.totals.brands} icon={<Users size={14} />} />
          <Stat label="Inbound" value={data.totals.inquiries} icon={<Inbox size={14} />} accent={data.totals.unread > 0 ? `${data.totals.unread} unread` : undefined} />
          <Stat label="Pitches sent" value={data.totals.pitches} icon={<Send size={14} />} />
          <Stat label="Campaigns" value={data.totals.campaigns} icon={<Tag size={14} />} />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search brands…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[#7C3AED]"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'inbound', 'pitch', 'campaign'] as const).map(c => {
            const on = channel === c
            const label = c === 'all' ? 'All' : CHANNEL_META[c].label
            return (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className="px-3 h-8 rounded-lg text-xs font-medium border transition"
                style={{
                  borderColor: on ? PURPLE : 'var(--border)',
                  background: on ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: on ? PURPLE : 'var(--text-3)',
                }}
              >{label}</button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-3)] text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading your brand history…
        </div>
      ) : brands.length === 0 ? (
        <div className="card p-8 text-center text-[var(--text-3)]">
          <Handshake size={28} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">
            {data && data.totals.brands > 0
              ? 'No brands match that filter.'
              : 'No brand relationships yet. When a brand messages your blog, you send a pitch, or you add an Amazon campaign, it shows up here.'}
          </p>
          {data && data.totals.brands === 0 && (
            <div className="flex items-center justify-center gap-3 mt-3 text-xs">
              <Link href="/collaborations" className="text-[#7C3AED] hover:underline">Send a pitch</Link>
              <Link href="/cc-campaigns" className="text-[#7C3AED] hover:underline">Browse campaigns</Link>
              <Link href="/brand-inquiries" className="text-[#7C3AED] hover:underline">Set up your inbox</Link>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {brands.map(b => (
            <BrandCard key={b.key} brand={b} open={open === b.key} onToggle={() => setOpen(open === b.key ? null : b.key)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, icon, accent }: { label: string; value: number; icon: ReactNode; accent?: string }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-[var(--text-3)] text-xs">{icon} {label}</div>
      <div className="text-xl font-bold text-[var(--text)] mt-0.5">{value}</div>
      {accent && <div className="text-[11px] font-medium text-[#b45309] mt-0.5">{accent}</div>}
    </div>
  )
}

function BrandCard({ brand, open, onToggle }: { brand: BrandEntity; open: boolean; onToggle: () => void }) {
  const sc = statusColor(brand.status)
  return (
    <div className={`card p-0 overflow-hidden ${brand.unread > 0 ? 'border-l-2 border-l-[#7C3AED]' : ''}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[var(--surface-2)] transition">
        <div className="min-w-0 flex items-center gap-3">
          {open ? <ChevronDown size={16} className="text-[var(--text-3)] shrink-0" /> : <ChevronRight size={16} className="text-[var(--text-3)] shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-[var(--text)] truncate">{brand.name}</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: sc.bg, color: sc.fg }}>{brand.status}</span>
              {brand.unread > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}>{brand.unread} unread</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {brand.channels.map(c => (
                <span key={c} className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: CHANNEL_META[c].bg, color: CHANNEL_META[c].fg }}>
                  {CHANNEL_META[c].label}
                </span>
              ))}
              <span className="text-[11px] text-[var(--text-3)]">· {brand.events.length} event{brand.events.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <span className="text-[11px] text-[var(--text-3)] shrink-0">{fmtRelative(brand.lastActivityAt)}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <ol className="relative flex flex-col gap-3">
            {brand.events.map((e, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full shrink-0" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}>
                  {eventIcon(e.type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--text)]">
                      {e.title}
                      {e.unread && <span className="ml-1.5 text-[10px] font-semibold text-[#7C3AED]">new</span>}
                    </span>
                    <span className="text-[11px] text-[var(--text-3)] shrink-0">{fmtDate(e.at)}</span>
                  </div>
                  {e.product && <p className="text-[12px] text-[var(--text-3)] mt-0.5 truncate">{e.product}</p>}
                  {e.detail && (
                    <p className="text-[12px] text-[var(--text)] mt-1 whitespace-pre-wrap break-words line-clamp-4">{e.detail}</p>
                  )}
                  {e.platforms && e.platforms.length > 0 && (
                    <p className="text-[11px] text-[var(--text-3)] mt-1">To: {e.platforms.join(', ')}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    {e.email && (
                      <a href={`mailto:${e.email}?subject=${encodeURIComponent('Re: your message')}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7C3AED] hover:underline">
                        <Mail size={11} /> Reply
                      </a>
                    )}
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7C3AED] hover:underline">
                        <ExternalLink size={11} /> {e.type === 'post_published' ? 'View post' : 'Open'}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
