'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The creator's Passport Links, each with a group dropdown so they can curate the
// automatic channel-grouping into their own campaign buckets — the manual side of
// the Geniuslink-groups workflow. Collapsible (lists can be long), searchable, and
// self-refreshing after a move. Reassigning bumps the page's reloadKey so the
// analytics + group counts above update too.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LinkIcon, Copy, Check, Loader2, Search, ExternalLink } from 'lucide-react'

interface Group { id: string; name: string }
interface PLink { code: string; label: string | null; asin: string | null; destinationUrl: string | null; groupId: string | null; url: string; createdAt: string }

export default function PassportLinksList({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<PLink[]>([])
  const [total, setTotal] = useState(0)
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const [lr, gr] = await Promise.all([
        fetch(`/api/passport/links?limit=100${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`).then((r) => r.json()),
        fetch('/api/passport/groups').then((r) => r.json()),
      ])
      if (lr?.ok) { setLinks(lr.links || []); setTotal(lr.total || 0) }
      if (gr?.ok) setGroups(gr.groups || [])
    } catch { /* keep prior */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) void load(q) }, [open, load]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(q), 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  async function assign(code: string, groupId: string) {
    setSavingCode(code)
    const gid = groupId || null
    // optimistic
    setLinks((prev) => prev.map((l) => (l.code === code ? { ...l, groupId: gid } : l)))
    try {
      const res = await fetch('/api/passport/links', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, groupId: gid }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Could not move the link.'); await load(q); return }
      onChanged?.()
    } finally { setSavingCode(null) }
  }

  function copy(url: string, code: string) {
    navigator.clipboard?.writeText(url).then(() => { setCopied(code); setTimeout(() => setCopied(null), 1600) }).catch(() => toast.error('Could not copy.'))
  }

  const targetLabel = (l: PLink) => l.label || l.asin || (l.destinationUrl ? l.destinationUrl.replace(/^https?:\/\//, '').slice(0, 48) : l.code)

  return (
    <div className="card p-0 overflow-hidden mb-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <LinkIcon size={15} style={{ color: '#7C3AED' }} />
        <span className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Your links{total ? ` (${total.toLocaleString()})` : ''}</span>
        <span className="text-[12px]" style={{ color: '#7C3AED' }}>{open ? 'Hide' : 'Manage groups per link'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="relative my-3 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search links…" className="input-field w-full pl-9 text-sm" />
          </div>

          {loading && links.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-[var(--text-faint)]"><Loader2 size={18} className="animate-spin" /></div>
          ) : links.length === 0 ? (
            <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-soft)' }}>
              {q.trim() ? 'No links match.' : 'No Passport Links yet. They appear here as you create links or MVP makes them for your posts.'}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {links.map((l) => (
                <div key={l.code} className="flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{targetLabel(l)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono truncate max-w-[200px] inline-flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                        {l.url.replace(/^https?:\/\//, '')} <ExternalLink size={9} />
                      </a>
                      <button onClick={() => copy(l.url, l.code)} title="Copy link" style={{ color: 'var(--text-faint)' }}>
                        {copied === l.code ? <Check size={11} style={{ color: '#34c759' }} /> : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {savingCode === l.code && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-faint)' }} />}
                    <select value={l.groupId || ''} onChange={(e) => assign(l.code, e.target.value)} className="input-field text-[12px] w-auto py-1">
                      <option value="">Ungrouped</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
