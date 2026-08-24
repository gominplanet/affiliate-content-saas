'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links groups: the Geniuslink-style bucketing control. Renders filter
// chips (All / each group / Ungrouped) that scope the dashboard, plus an inline
// manager to create, rename, and delete groups. New links auto-land in a channel
// group server-side (see lib/passport-links channelForSource); this is where the
// creator curates them. Click counts come from the analytics byGroup breakdown;
// the authoritative group list + link counts come from /api/passport/groups.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Layers, Plus, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react'

interface Group { id: string; name: string; links: number }
interface ByGroup { id: string | null; name: string; count: number }

export default function PassportGroups({
  active, onSelect, byGroup, reloadKey = 0,
}: {
  active: string // '' all · 'none' ungrouped · else group id
  onSelect: (v: string) => void
  byGroup?: ByGroup[]
  /** bump to refetch group + link counts after a reassignment elsewhere. */
  reloadKey?: number
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [ungrouped, setUngrouped] = useState(0)
  const [loading, setLoading] = useState(true)
  const [manage, setManage] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  const clicksFor = useCallback((id: string | null) => {
    const hit = (byGroup || []).find((g) => g.id === id)
    return hit?.count ?? 0
  }, [byGroup])

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

  const chip = (val: string, label: string, count: number | null) => (
    <button key={val || 'all'} onClick={() => onSelect(val)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors"
      style={active === val
        ? { borderColor: '#7C3AED', color: '#7C3AED', background: 'rgba(124,58,237,0.10)' }
        : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
      {label}
      {count != null && <span className="text-[11px] font-normal" style={{ color: 'var(--text-faint)' }}>{count.toLocaleString()}</span>}
    </button>
  )

  return (
    <div className="card p-3 mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <Layers size={14} style={{ color: '#7C3AED' }} />
        <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Groups</span>
        <button onClick={() => setManage((v) => !v)} className="ml-auto text-[12px] font-medium" style={{ color: '#7C3AED' }}>
          {manage ? 'Done' : 'Manage'}
        </button>
      </div>

      {/* Filter chips — scope the whole dashboard to a group. */}
      <div className="flex flex-wrap items-center gap-2">
        {chip('', 'All groups', null)}
        {groups.map((g) => chip(g.id, g.name, clicksFor(g.id)))}
        {(ungrouped > 0 || active === 'none') && chip('none', 'Ungrouped', clicksFor(null))}
        {loading && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-faint)' }} />}
      </div>

      {/* Manage — create / rename / delete. */}
      {manage && (
        <div className="mt-3 pt-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--border)' }}>
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 text-[12.5px]">
              {editing === g.id ? (
                <>
                  <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void rename(g.id); if (e.key === 'Escape') setEditing(null) }}
                    className="input-field text-[12.5px] py-1 flex-1 min-w-0" />
                  <button onClick={() => rename(g.id)} disabled={busy} title="Save" style={{ color: '#34c759' }}><Check size={15} /></button>
                  <button onClick={() => setEditing(null)} title="Cancel" style={{ color: 'var(--text-faint)' }}><X size={15} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate font-medium" style={{ color: 'var(--text)' }}>{g.name}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{g.links} link{g.links === 1 ? '' : 's'}</span>
                  <button onClick={() => { setEditing(g.id); setEditName(g.name) }} title="Rename" style={{ color: 'var(--text-soft)' }}><Pencil size={13} /></button>
                  <button onClick={() => remove(g)} title="Delete" style={{ color: 'var(--text-faint)' }} className="hover:text-[#b3261e]"><Trash2 size={13} /></button>
                </>
              )}
            </div>
          ))}
          {creating ? (
            <div className="flex items-center gap-2 mt-1">
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name"
                onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
                className="input-field text-[12.5px] py-1 flex-1 min-w-0" />
              <button onClick={create} disabled={busy || !newName.trim()} className="text-[12px] font-semibold px-2.5 py-1 rounded-md text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
              </button>
              <button onClick={() => { setCreating(false); setNewName('') }} style={{ color: 'var(--text-faint)' }}><X size={15} /></button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold mt-1 self-start" style={{ color: '#7C3AED' }}>
              <Plus size={13} /> New group
            </button>
          )}
        </div>
      )}
    </div>
  )
}
