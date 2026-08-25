'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links groups — the Geniuslink-style bucketing control, laid out as a
// table (name · links · clicks · created · actions) like Geniuslink's Groups
// view. Each row is a filter: click it to scope the whole dashboard to that
// group. New links auto-land in a channel group server-side (lib/passport-links
// channelForSource); this is where the creator curates them. Link counts +
// created dates come from /api/passport/groups; per-group clicks from the
// analytics byGroup breakdown.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Layers, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react'

interface Group { id: string; name: string; links: number; createdAt: string }
interface ByGroup { id: string | null; name: string; count: number }

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

export default function PassportGroups({
  active, onSelect, byGroup, reloadKey = 0,
}: {
  active: string // '' all · 'none' ungrouped · else group id
  onSelect: (v: string) => void
  byGroup?: ByGroup[]
  reloadKey?: number
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [ungrouped, setUngrouped] = useState(0)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  const clicksFor = useCallback((id: string | null) => (byGroup || []).find((g) => g.id === id)?.count ?? 0, [byGroup])
  const totalClicks = (byGroup || []).reduce((s, g) => s + g.count, 0)
  const totalLinks = groups.reduce((s, g) => s + g.links, 0) + ungrouped

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/passport/groups')
      const d = await res.json()
      if (d?.ok) { setGroups(d.groups || []); setUngrouped(d.ungrouped || 0) }
    } catch { /* keep prior */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, reloadKey])

  async function create() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/passport/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Could not create the group.'); return }
      setNewName(''); setCreating(false); toast.success(`Group “${d.group.name}” created.`); await load()
    } finally { setBusy(false) }
  }

  async function rename(id: string) {
    const name = editName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/passport/groups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Could not rename the group.'); return }
      setEditing(null); await load()
    } finally { setBusy(false) }
  }

  async function remove(g: Group) {
    if (busy) return
    if (!window.confirm(`Delete the group “${g.name}”? Its ${g.links} link${g.links === 1 ? '' : 's'} stay, they just become ungrouped.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/passport/groups?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Could not delete the group.'); return }
      if (active === g.id) onSelect('')
      toast.success('Group deleted.'); await load()
    } finally { setBusy(false) }
  }

  const rowStyle = (val: string) => active === val
    ? { background: 'rgba(124,58,237,0.10)', boxShadow: 'inset 3px 0 0 #7C3AED' }
    : undefined

  const Num = ({ children }: { children: React.ReactNode }) => (
    <td className="px-3 py-2 text-right tabular-nums text-[12.5px]" style={{ color: 'var(--text-soft)' }}>{children}</td>
  )

  return (
    <div className="card p-0 overflow-hidden mb-5">
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <Layers size={14} style={{ color: '#7C3AED' }} />
        <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Groups</span>
        {loading && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-faint)' }} />}
        <button onClick={() => { setCreating((v) => !v); setNewName('') }} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#7C3AED' }}>
          <Plus size={13} /> New group
        </button>
      </div>

      {creating && (
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name (e.g. Holiday campaign)"
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            className="input-field text-[12.5px] py-1 flex-1 min-w-0 max-w-xs" />
          <button onClick={create} disabled={busy || !newName.trim()} className="text-[12px] font-semibold px-2.5 py-1 rounded-md text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
          </button>
          <button onClick={() => { setCreating(false); setNewName('') }} style={{ color: 'var(--text-faint)' }}><X size={15} /></button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              <th className="px-4 py-2 text-left font-semibold">Group</th>
              <th className="px-3 py-2 text-right font-semibold">Links</th>
              <th className="px-3 py-2 text-right font-semibold">Clicks</th>
              <th className="px-3 py-2 text-right font-semibold">Created</th>
              <th className="px-3 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {/* All groups */}
            <tr onClick={() => onSelect('')} className="cursor-pointer border-t" style={{ borderColor: 'var(--border)', ...rowStyle('') }}>
              <td className="px-4 py-2 text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>All groups</td>
              <Num>{totalLinks.toLocaleString()}</Num>
              <Num>{totalClicks.toLocaleString()}</Num>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
            </tr>

            {groups.map((g) => (
              <tr key={g.id} onClick={() => editing === g.id ? undefined : onSelect(g.id)} className="cursor-pointer border-t group" style={{ borderColor: 'var(--border)', ...rowStyle(g.id) }}>
                <td className="px-4 py-2">
                  {editing === g.id ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void rename(g.id); if (e.key === 'Escape') setEditing(null) }}
                        className="input-field text-[12.5px] py-0.5 max-w-[180px]" />
                      <button onClick={() => rename(g.id)} disabled={busy} title="Save" style={{ color: '#34c759' }}><Check size={15} /></button>
                      <button onClick={() => setEditing(null)} title="Cancel" style={{ color: 'var(--text-faint)' }}><X size={15} /></button>
                    </div>
                  ) : (
                    <span className="text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>{g.name}</span>
                  )}
                </td>
                <Num>{g.links.toLocaleString()}</Num>
                <Num>{clicksFor(g.id).toLocaleString()}</Num>
                <td className="px-3 py-2 text-right text-[11.5px] whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>{fmtDate(g.createdAt)}</td>
                <td className="px-3 py-2">
                  {editing !== g.id && (
                    <div className="flex items-center justify-end gap-2 opacity-60" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setEditing(g.id); setEditName(g.name) }} title="Rename" style={{ color: 'var(--text-soft)' }}><Pencil size={13} /></button>
                      <button onClick={() => remove(g)} title="Delete" style={{ color: 'var(--text-faint)' }} className="hover:text-[#b3261e]"><Trash2 size={13} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {(ungrouped > 0 || active === 'none') && (
              <tr onClick={() => onSelect('none')} className="cursor-pointer border-t" style={{ borderColor: 'var(--border)', ...rowStyle('none') }}>
                <td className="px-4 py-2 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>Ungrouped</td>
                <Num>{ungrouped.toLocaleString()}</Num>
                <Num>{clicksFor(null).toLocaleString()}</Num>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2"></td>
              </tr>
            )}

            {!loading && groups.length === 0 && ungrouped === 0 && (
              <tr className="border-t" style={{ borderColor: 'var(--border)' }}>
                <td colSpan={5} className="px-4 py-6 text-center text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
                  No groups yet. Your links auto-group by channel as you create them, or add a campaign group above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
