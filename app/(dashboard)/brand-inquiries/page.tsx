'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Handshake, Mail, Archive, Loader2, Inbox } from 'lucide-react'
import BrandCtaSettings from '@/components/brand/BrandCtaSettings'

interface Inquiry {
  id: string
  brand_name: string | null
  contact_name: string | null
  contact_email: string | null
  message: string
  source_url: string | null
  read_at: string | null
  created_at: string
}

export default function BrandInquiriesPage() {
  const [items, setItems] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/brand-inquiries')
      const d = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(d.inquiries)) setItems(d.inquiries)
      // Opening the inbox clears the unread state (the bell + nav badge).
      if ((d.unread ?? 0) > 0) {
        fetch('/api/brand-inquiries', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markAllRead: true }),
        }).catch(() => {})
      }
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function archive(id: string) {
    setBusy(id)
    try {
      const res = await fetch('/api/brand-inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'archive' }),
      })
      if (res.ok) setItems(list => list.filter(i => i.id !== id))
      else toast.error('Could not archive that message.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Handshake size={22} className="text-[#7C3AED]" /> Brand Inquiries
        </h1>
        <p className="text-sm text-[var(--text-3)] mt-1">
          Messages brands sent through the &quot;Work with brands&quot; banner on your blog. Set the banner up on the right.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Left column — the message inbox */}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text)] mb-3">Messages</h2>
          {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-3)] text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-[var(--text-3)]">
          <Inbox size={28} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">No brand messages yet. When a brand fills out your blog form, it shows up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map(i => (
            <div key={i.id} className={`card p-4 ${i.read_at ? '' : 'border-l-2 border-l-[#7C3AED]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">{i.brand_name || i.contact_name || 'Brand inquiry'}</p>
                  <p className="text-xs text-[var(--text-3)]">
                    {i.contact_name && i.brand_name ? `${i.contact_name} · ` : ''}
                    {i.contact_email || 'no email provided'} · {new Date(i.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {i.contact_email && (
                    <a
                      href={`mailto:${i.contact_email}?subject=${encodeURIComponent('Re: your message via my blog')}`}
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium text-white bg-[#7C3AED] hover:bg-[#6D28D9]"
                    >
                      <Mail size={12} /> Reply
                    </a>
                  )}
                  <button
                    onClick={() => archive(i.id)}
                    disabled={busy === i.id}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs text-[var(--text-3)] hover:bg-[var(--surface-2)] disabled:opacity-60"
                  >
                    {busy === i.id ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />} Archive
                  </button>
                </div>
              </div>
              <p className="text-sm text-[var(--text)] mt-2 whitespace-pre-wrap break-words">{i.message}</p>
              {i.source_url && (
                <a href={i.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--text-3)] hover:text-[#7C3AED] mt-2 inline-block truncate max-w-full">
                  From: {i.source_url}
                </a>
              )}
            </div>
          ))}
        </div>
          )}
        </div>

        {/* Right column — the editable "Work with brands" banner block */}
        <div className="lg:sticky lg:top-4">
          <BrandCtaSettings />
        </div>
      </div>
    </div>
  )
}
